"""Plot boundaries without drawing: find the plots on an orthomosaic, label
them from a field design file, save them as the app's plot-boundary version,
and cut the orthomosaic into plot images.

This is the agent's way through the Process tab's "Plot Boundary Prep" and
"Split Into Plot Images" steps. The geometry is found by measuring
vegetation on the orthomosaic (beds across, tiers along the field); the
agent's part is to give the layout facts, look at the overlay it gets back,
and correct what is off.
"""
from __future__ import annotations

import csv
import json
import math
import os
import re
import warnings
from pathlib import Path
from typing import Any, Optional

from .client import AGENT_DIR
from .process_runs import scope_from_path
from .tools import _bool, _int, _str, _tool, client, process_tab

WORK = AGENT_DIR / "work" / "ortho"
_num = {"type": "number"}


# ── georeferencing (GeoTIFF tags + UTM, no GIS libraries) ────────────────────

def _utm_to_lonlat(e: float, n: float, zone: int, north: bool) -> tuple[float, float]:
    a, f = 6378137.0, 1 / 298.257223563
    k0, e2 = 0.9996, f * (2 - f)
    ep2 = e2 / (1 - e2)
    x, y = e - 500000.0, n if north else n - 10000000.0
    m = y / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    phi1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
            + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    c1, t1 = ep2 * math.cos(phi1) ** 2, math.tan(phi1) ** 2
    n1 = a / math.sqrt(1 - e2 * math.sin(phi1) ** 2)
    r1 = a * (1 - e2) / (1 - e2 * math.sin(phi1) ** 2) ** 1.5
    d = x / (n1 * k0)
    lat = phi1 - (n1 * math.tan(phi1) / r1) * (
        d ** 2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720)
    lon = (d - (1 + 2 * t1 + c1) * d ** 3 / 6
           + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120) / math.cos(phi1)
    return math.degrees(lon) + (zone - 1) * 6 - 180 + 3, math.degrees(lat)


def _lonlat_to_utm(lon: float, lat: float, zone: int) -> tuple[float, float]:
    a, f = 6378137.0, 1 / 298.257223563
    k0, e2 = 0.9996, f * (2 - f)
    ep2 = e2 / (1 - e2)
    phi, lam = math.radians(lat), math.radians(lon)
    lam0 = math.radians((zone - 1) * 6 - 180 + 3)
    n = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    t, c = math.tan(phi) ** 2, ep2 * math.cos(phi) ** 2
    aa = math.cos(phi) * (lam - lam0)
    mm = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
              - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * phi)
              + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * phi)
              - (35 * e2 ** 3 / 3072) * math.sin(6 * phi))
    x = k0 * n * (aa + (1 - t + c) * aa ** 3 / 6 + (5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * aa ** 5 / 120) + 500000.0
    y = k0 * (mm + n * math.tan(phi) * (aa ** 2 / 2 + (5 - t + 9 * c + 4 * c ** 2) * aa ** 4 / 24
                                       + (61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * aa ** 6 / 720))
    return x, (y + 10000000.0 if lat < 0 else y)


class Ortho:
    """An orthomosaic from storage: pixels (reduced if large) and the mapping
    from pixel to longitude/latitude."""

    def __init__(self, path: str, max_side: int = 5000):
        from PIL import Image

        Image.MAX_IMAGE_PIXELS = None
        self.path = path
        WORK.mkdir(parents=True, exist_ok=True)
        local = _raster_copy(path, max_side, mask=True)
        im = Image.open(local)
        tags = im.tag_v2
        scale, tie, keys = tags.get(33550), tags.get(33922), tags.get(34735)
        if not scale or not tie:
            raise ValueError("this file has no georeferencing (not a GeoTIFF)")
        epsg = None
        if keys:
            for i in range(4, len(keys), 4):
                if keys[i] == 3072:                        # projected CRS
                    epsg = int(keys[i + 3])
                elif keys[i] == 2048 and epsg is None and int(keys[i + 3]) == 4326:   # geographic
                    epsg = 4326
        self.epsg = epsg
        full_w, full_h = im.size
        frame = 0
        for i in range(getattr(im, "n_frames", 1)):      # smallest overview that is still detailed enough
            im.seek(i)
            if max(im.size) <= max_side:
                frame = i
                break
            frame = i
        im.seek(frame)
        self.local, self.frame = local, frame
        self.image = im.convert("RGBA")
        self.w, self.h = self.image.size
        k = full_w / self.w
        self.px_x, self.px_y = float(scale[0]) * k, float(scale[1]) * k      # metres (or degrees) per pixel
        self.x0 = float(tie[3]) - float(tie[0]) * float(scale[0])
        self.y0 = float(tie[4]) + float(tie[1]) * float(scale[1])
        if epsg and 32601 <= epsg <= 32660:
            self.zone, self.north = epsg - 32600, True
        elif epsg and 32701 <= epsg <= 32760:
            self.zone, self.north = epsg - 32700, False
        elif epsg == 4326:
            self.zone = 0
            self.north = True
        else:
            raise ValueError(f"unsupported map projection (EPSG {epsg}); expected UTM or WGS84")

    @property
    def metres_per_px(self) -> float:
        return self.px_x if self.zone else self.px_x * 111_320 * math.cos(math.radians(self.y0))

    def proj(self, lon: float, lat: float) -> tuple[float, float]:
        """Longitude/latitude in this map's own coordinates."""
        return (lon, lat) if not self.zone else _lonlat_to_utm(lon, lat, self.zone)

    def unproj(self, x: float, y: float) -> list[float]:
        if not self.zone:
            return [round(x, 8), round(y, 8)]
        lon, lat = _utm_to_lonlat(x, y, self.zone, self.north)
        return [round(lon, 8), round(lat, 8)]

    def pixel(self, lon: float, lat: float) -> tuple[float, float]:
        x, y = self.proj(lon, lat)
        return (x - self.x0) / self.px_x, (self.y0 - y) / self.px_y

    def coverage(self, ring: list) -> float:
        """Share of a polygon (lon/lat ring) that has image on this
        orthomosaic, from a 7x7 grid of points across it."""
        import numpy as np

        if not hasattr(self, "_alpha"):
            self._alpha = np.asarray(self.image)[..., 3] > 0
        pts = [self.pixel(p[0], p[1]) for p in ring[:4]]
        if len(pts) < 4:
            return 0.0
        (x0, y0), (x1, y1), (x2, y2), (x3, y3) = pts
        hit = 0
        for u in np.linspace(0.1, 0.9, 7):
            for w in np.linspace(0.1, 0.9, 7):
                x = (1 - u) * (1 - w) * x0 + u * (1 - w) * x1 + u * w * x2 + (1 - u) * w * x3
                y = (1 - u) * (1 - w) * y0 + u * (1 - w) * y1 + u * w * y2 + (1 - u) * w * y3
                c, r = int(x), int(y)
                if 0 <= r < self._alpha.shape[0] and 0 <= c < self._alpha.shape[1] and self._alpha[r, c]:
                    hit += 1
        return hit / 49.0

    def lonlat(self, col: float, row: float) -> list[float]:
        x, y = self.x0 + col * self.px_x, self.y0 - row * self.px_y
        if not self.zone:
            return [round(x, 8), round(y, 8)]
        lon, lat = _utm_to_lonlat(x, y, self.zone, self.north)
        return [round(lon, 8), round(lat, 8)]


# ── finding the plots ────────────────────────────────────────────────────────

def _runs(mask) -> list[tuple[int, int]]:
    out, start = [], None
    for i, v in enumerate(list(mask) + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i))
            start = None
    return out


def _smooth(a, k: int):
    import numpy as np

    k = max(1, int(k))
    return np.convolve(np.pad(a, k // 2, mode="edge"), np.ones(k) / k, mode="valid")[: len(a)]


def furrow_grid(soil, m: float, pitch_hint_m: Optional[float] = None) -> Optional[dict]:
    """The furrows in a bare-ground brightness profile across the field
    (ridges light, furrows dark; NaN where there is no bare ground):
    {"pitch_px", "phase_px" (a furrow's position), "strength"}, or None."""
    import numpy as np

    p = np.asarray(soil, dtype=float)
    ok = np.isfinite(p)
    if ok.sum() * m < 6:
        return None
    fill = np.where(ok, p, np.nanmean(p))
    q = _smooth(fill, 0.08 / m) - _smooth(fill, 3.0 / m)
    q[~ok] = 0.0
    w = ok.astype(float)
    lo_m, hi_m = (0.95 * pitch_hint_m, 1.05 * pitch_hint_m) if pitch_hint_m else (0.6, 3.2)
    ac = []
    for L in range(max(2, int(lo_m / m)), int(hi_m / m) + 2):
        if L >= len(q) - 2:
            break
        a, b, ww = q[:-L], q[L:], w[:-L] * w[L:]
        if ww.sum() * m < 3:
            break
        ac.append((float((a * b * ww).sum() / (np.sqrt((a * a * ww).sum() * (b * b * ww).sum()) + 1e-12)), L))
    peaks = [i for i in range(1, len(ac) - 1) if ac[i][0] >= ac[i - 1][0] and ac[i][0] >= ac[i + 1][0]]
    if not peaks:
        return None
    i = max(peaks, key=lambda j: ac[j][0])
    corr, L = ac[i]
    # A peak at half the spacing almost as strong: that is the furrow spacing.
    half = [j for j in peaks if abs(ac[j][1] - L / 2) <= 2 and ac[j][0] >= 0.8 * corr]
    if half and not pitch_hint_m:
        i = half[0]
        corr, L = ac[i]
    (c0, _), (c2, _) = ac[i - 1], ac[i + 1]
    den = c0 - 2 * corr + c2
    pitch = L + (0.5 * (c0 - c2) / den if den < 0 else 0.0)
    if corr < 0.25:
        return None
    # Where the furrows are: fold the profile at that spacing; the furrow is the dark phase.
    idx = np.flatnonzero(ok)
    nb = max(8, int(pitch))
    bins = ((idx % pitch) / pitch * nb).astype(int) % nb
    tot = np.bincount(bins, weights=q[idx], minlength=nb)
    cnt = np.bincount(bins, minlength=nb)
    prof = np.where(cnt > 0, tot / np.maximum(cnt, 1), 0.0)
    k = max(1, nb // 12)
    circ = np.convolve(np.concatenate([prof[-k:], prof, prof[:k]]), np.ones(2 * k + 1) / (2 * k + 1), "same")[k:-k]
    phase = float(np.argmin(circ) + 0.5) / nb * pitch
    return {"pitch_px": float(pitch), "phase_px": phase, "strength": round(corr, 2)}


def fit_beds(prof, u0: int, u1: int, beds: int, m: float, grid: Optional[dict] = None,
             pitch_m: Optional[float] = None, border_beds: Optional[list] = None,
             border_side: Optional[int] = None) -> dict:
    """Bed edges across a planted block (pixels on the profile's axis).

    Splitting the block evenly into the design's beds goes wrong when the
    block holds more beds than the design (border beds) or a weedy strip:
    each box then spans a furrow.

    `grid`: the furrows read from bare ground at the field's ends (see
    furrow_grid), visible all season even after the canopy closes. Then
    the planted beds are counted between the furrows and the design's
    beds taken from among them; the rest are border beds, split evenly
    between the sides, an odd one on the side whose outer bed is weaker
    (`border_beds` = [first side, other side] overrides; `border_side`
    0/1 puts them all on the first/other side). Without it: the spacing is read from
    the plants' own repeat, or `pitch_m` (measured on an earlier date) is
    used, else the block is split evenly. Returns {"edges": [n+1 pixels],
    "pitch_px", "method", "source", "beds_in_block", "border_beds"}."""
    import numpy as np

    n = max(1, int(beds))
    expected = (u1 - u0) / n
    even = {"edges": [u0 + k * expected for k in range(n + 1)], "pitch_px": expected, "method": "even"}

    def centred(pitch, phase, src):
        # Furrows at phase + j*pitch. Planted beds: those with at least half
        # the cover of the well-grown ones (a weedy or bare strip is not a bed).
        p = np.asarray(prof, dtype=float)
        j0 = int(np.floor((u0 - phase) / pitch)) - 2
        j1 = int(np.ceil((u1 - phase) / pitch)) + 2
        cover = {}
        for j in range(j0, j1):
            a, b = int(phase + j * pitch), int(phase + (j + 1) * pitch)
            if 0 <= a < b <= len(p):
                cover[j] = float(p[a:b].mean())
        top = sorted(cover.values(), reverse=True)[:n]
        mid = int(round(((u0 + u1) / 2 - phase) / pitch - 0.5))
        run: list = []
        if top and mid in cover:
            cut = 0.5 * float(np.median(top))
            lo_j = hi_j = mid
            while cover.get(lo_j - 1, 0) >= cut:
                lo_j -= 1
            while cover.get(hi_j + 1, 0) >= cut:
                hi_j += 1
            run = list(range(lo_j, hi_j + 1))
        if len(run) < n:
            js = int(round(((u0 + u1) / 2 - phase) / pitch - n / 2))
            left = right = 0
        else:
            extra = len(run) - n
            if border_beds is not None:
                left = int(border_beds[0])
            elif border_side is not None:
                # Border beds all on one side (the field's outer edge): the
                # design's beds run up to the other end of the planted beds.
                left = extra if border_side == 0 else 0
            elif extra % 2 == 0:
                left = extra // 2
            else:
                # One border bed more on one side: the weaker outer bed is the border.
                left = extra // 2 + (1 if cover[run[0]] < cover[run[-1]] else 0)
            left = max(0, min(extra, left))
            js = run[0] + left
            right = extra - left
        return {"edges": [phase + (js + i) * pitch for i in range(n + 1)], "pitch_px": float(pitch),
                "method": "furrows", "source": src, "beds_in_block": len(run) or None,
                "border_beds": [left, right],
                "bed_cover": [round(cover[j], 2) for j in run]}

    if grid:
        return centred(grid["pitch_px"], grid["phase_px"], grid.get("source", "furrows at the field's ends"))
    if expected * m < 0.3 or len(prof) < 10:
        return even
    lo = int(max(0, u0 - 0.6 * expected))
    hi = int(min(len(prof), u1 + 0.6 * expected))
    if pitch_m:
        # Spacing known, furrows not seen: the design's beds in the middle of the block.
        pitch = pitch_m / m
        return {**centred(pitch, (u0 + u1) / 2 - n / 2 * pitch, "bed spacing measured earlier this season"),
                "method": "known spacing"}

    q = _smooth(np.asarray(prof, dtype=float), 0.15 / m)
    seg = q[lo:hi] - q[lo:hi].mean()
    if seg.std() < 1e-6:
        return even
    lags = range(max(2, int(0.6 / m)), max(3, int(min(3.5 / m, 1.3 * expected))))
    ac = []
    for L in lags:
        if L >= len(seg) - 2:
            break
        a, b = seg[:-L], seg[L:]
        ac.append((float((a * b).mean() / (a.std() * b.std() + 1e-9)), L))
    peaks = [(c, L) for i, (c, L) in enumerate(ac)
             if 0 < i < len(ac) - 1 and c >= ac[i - 1][0] and c >= ac[i + 1][0]]
    if not peaks:
        return even
    corr, pitch = max(peaks)
    # Two plant rows per bed can repeat at half the bed spacing.
    if pitch < 0.6 * expected and any(abs(L - 2 * pitch) <= 2 for _, L in peaks):
        pitch *= 2
    if corr < 0.15 or not 0.5 * expected <= pitch <= 1.15 * expected:
        return even
    sm = q
    # Where the beds sit: most plant inside the middle of each bed, least at its furrows.
    best, start = None, lo
    for s0 in range(lo, int(hi - n * pitch) + 1):
        inner = sum(sm[int(s0 + (k + 0.2) * pitch): int(s0 + (k + 0.8) * pitch)].mean() for k in range(n))
        edge = sum(sm[min(len(sm) - 1, int(s0 + k * pitch))] for k in range(n + 1))
        score = inner - 0.5 * edge
        if best is None or score > best:
            best, start = score, s0
    edges = []
    for k in range(n + 1):
        c = start + k * pitch
        a, b = int(max(0, c - 0.25 * pitch)), int(min(len(sm), c + 0.25 * pitch + 1))
        if b <= a:
            edges.append(c)
            continue
        # The furrow's middle: the centre of the low stretch near the expected
        # edge (a wide furrow has no single lowest point, only noise).
        w = sm[a:b]
        low = np.flatnonzero(w <= w.min() + 0.25 * (w.max() - w.min()))
        edges.append(float(a + low.mean()))
    # The outer edges have bare ground beyond them, not a furrow: one bed
    # spacing from their inner neighbours.
    if n >= 2:
        edges[0] = edges[1] - pitch
        edges[n] = edges[n - 1] + pitch
    # Keep edges in order and every bed at least half the spacing wide.
    for k in range(1, n + 1):
        if edges[k] - edges[k - 1] < 0.5 * pitch:
            edges[k] = edges[k - 1] + pitch
    return {"edges": edges, "pitch_px": float(pitch), "method": "furrows", "source": "plants"}


def _end_soil(ortho: "Ortho", long_is_rows: bool, spans: list, target_m: float = 0.012):
    """Bare-ground brightness across the field over `spans` (along-field
    ranges, in the overview's pixels) from a finer overview (~1 cm/px):
    furrows are a few centimetres of shadow. Returns (profile, fine px per
    overview px) or (None, 1)."""
    import numpy as np
    from PIL import Image

    im = Image.open(ortho.local)
    pick = None
    for i in range(getattr(im, "n_frames", 1)):
        im.seek(i)
        fw, fh = im.size
        mf = ortho.metres_per_px * ortho.w / fw
        if mf <= target_m * 1.4 and fw * fh <= 60e6:
            pick = i                                   # coarsest one that is fine enough
    if pick is None:
        return None, 1.0
    im.seek(pick)
    fw, fh = im.size
    k = fw / ortho.w
    a = np.asarray(im.convert("RGBA"))
    prof_sum = np.zeros(fw if long_is_rows else fh)
    prof_n = np.zeros_like(prof_sum)
    for s0, s1 in spans:
        f0, f1 = int(s0 * k), int(s1 * k)
        blk = a[f0:f1] if long_is_rows else a[:, f0:f1].transpose(1, 0, 2)
        if blk.size == 0:
            continue
        rgb = blk[..., :3].astype(np.float32) / 255.0
        exg = (2 * rgb[..., 1] - rgb[..., 0] - rgb[..., 2]) / (rgb.sum(axis=2) + 1e-6)
        bare = (blk[..., 3] > 0) & (exg < 0.05)
        prof_sum += np.where(bare, rgb.mean(axis=2), 0).sum(axis=0)
        prof_n += bare.sum(axis=0)
    rows = sum(int((s1 - s0) * k) for s0, s1 in spans)
    if rows == 0:
        return None, k
    with np.errstate(invalid="ignore", divide="ignore"):
        prof = np.where(prof_n >= 0.3 * rows, prof_sum / prof_n, np.nan)
    return prof, k


def _coverage_check():
    """covers(ortho, feature) for multiortho.assign, from each orthomosaic's
    overview (loaded once)."""
    loaded: dict = {}

    def covers(o: dict, feature: dict) -> float:
        if o["path"] not in loaded:
            try:
                loaded[o["path"]] = Ortho(o["path"])
            except Exception:
                loaded[o["path"]] = None
        ortho = loaded[o["path"]]
        ring = ((feature.get("geometry") or {}).get("coordinates") or [[]])[0]
        return ortho.coverage(ring) if ortho is not None else 1.0

    return covers


def _titiler() -> Optional[str]:
    """The stack's TiTiler, when this computer reaches it (gemi-hpc app tunnels one)."""
    url = os.environ.get("GEMI_TITILER_URL") or os.environ.get("GEMI_TITILER_TARGET")
    return url.rstrip("/") if url else None


def _raster_copy(path: str, max_side: int = 5000, mask: bool = False) -> Path:
    """A raster from storage, on this computer. When the stack's TiTiler is reachable and the
    file is larger than needed, TiTiler sends a copy reduced to `max_side` pixels and
    reprojected to UTM (what the furrow and plot fitting work in): tens of MB instead of a
    multi-GB orthomosaic. Otherwise the whole file."""
    import json
    import urllib.parse
    import urllib.request

    tiler = _titiler()
    if not tiler:
        return _local_copy(path)
    WORK.mkdir(parents=True, exist_ok=True)
    local = WORK / (re.sub(r"[^A-Za-z0-9._-]", "_", path)[-120:] + f".{max_side}{'m' if mask else ''}.tif")
    if local.exists():
        return local
    url = urllib.parse.quote(f"s3://gemini/{path.removeprefix('gemini/')}", safe="")
    try:
        with urllib.request.urlopen(f"{tiler}/cog/info?url={url}", timeout=120) as r:
            info = json.loads(r.read())
    except Exception:
        return _local_copy(path)
    if max(info.get("width", 0), info.get("height", 0)) <= max_side and "326" in str(info.get("crs", "")):
        return _local_copy(path)
    crs = str(info.get("crs", ""))
    m = re.search(r"(?:EPSG[:/](?:0/)?)(32[67]\d\d)$", crs)
    if m:
        epsg = int(m.group(1))
    else:
        west, south, east, north = info["bounds"]           # geographic when the file is
        lon, lat = (west + east) / 2, (south + north) / 2
        epsg = (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1
    q = f"url={url}&max_size={max_side}&return_mask={'true' if mask else 'false'}&dst_crs=EPSG:{epsg}"
    with urllib.request.urlopen(f"{tiler}/cog/preview.tif?{q}", timeout=900) as r:
        tmp = local.with_suffix(".part")
        tmp.write_bytes(r.read())
    tmp.replace(local)
    return local


def _local_copy(path: str) -> Path:
    WORK.mkdir(parents=True, exist_ok=True)
    local = WORK / (re.sub(r"[^A-Za-z0-9._-]", "_", path)[-150:])
    if not local.exists():
        local.write_bytes(client().download(path))
    return local


def furrow_track(dsm_file, ortho: "Ortho", long_is_rows: bool, windows: list, u_lo: float, u_hi: float,
                 pitch_hint_m: Optional[float] = None) -> Optional[dict]:
    """The furrows from the elevation model (ODM's DSM): low ground between
    raised beds, whatever the light (an RGB furrow can be confused with a
    ridge's shadow). Beds are rarely exactly parallel to the image, so the
    furrows' position is measured in windows along the field (`windows`:
    (start, end, "end" | "alley") in the overview's along-field pixels) and
    fitted as straight lines: furrow j at across = phase + slope*along +
    j*pitch, in overview pixels. Returns {"pitch_px", "phase_px", "slope",
    "strength", "windows"} or None."""
    import numpy as np
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
    im = Image.open(dsm_file)
    tags = im.tag_v2
    scale, tie = tags.get(33550), tags.get(33922)
    if not scale or not tie or not ortho.zone:
        return None
    z = np.array(im, dtype=np.float32)
    nodata = tags.get(42113)
    z[~np.isfinite(z) | (z < -9000)] = np.nan
    if nodata not in (None, ""):
        try:
            z[z == float(nodata)] = np.nan
        except ValueError:
            pass
    sx, sy = float(scale[0]), float(scale[1])
    X0, Y0 = float(tie[3]) - float(tie[0]) * sx, float(tie[4]) + float(tie[1]) * sy
    # DSM pixel -> overview pixel: col = ox + j*kx, row = oy + i*ky
    kx, ky = sx / ortho.px_x, sy / ortho.px_y
    ox, oy = (X0 - ortho.x0) / ortho.px_x, (ortho.y0 - Y0) / ortho.px_y
    if not long_is_rows:                      # along = columns, across = rows
        z = z.T
        kx, ky, ox, oy = ky, kx, oy, ox
    mz = sx                                     # metres per DSM pixel
    m = ortho.metres_per_px
    j0 = max(0, int((u_lo - 2.0 / m - ox) / kx))
    j1 = min(z.shape[1], int((u_hi + 2.0 / m - ox) / kx) + 1)
    if j1 - j0 < 4.0 / mz:
        return None
    u = ox + np.arange(j0, j1) * kx              # across position of each DSM column, overview px

    def profile(a0, a1):
        i0, i1 = max(0, int((a0 - oy) / ky)), min(z.shape[0], int((a1 - oy) / ky))
        if i1 - i0 < 10:
            return None
        blk = z[i0:i1:max(1, (i1 - i0) // 200), j0:j1]
        cnt = np.isfinite(blk).sum(axis=0)
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)       # columns with no ground at all
            prof = np.where(cnt >= 0.5 * blk.shape[0], np.nanmedian(blk, axis=0), np.nan)
        ok = np.isfinite(prof)
        if ok.sum() * mz < 3:
            return None
        w = int(3.0 / mz)
        num = np.convolve(np.where(ok, prof, 0.0), np.ones(w), "same")
        den = np.convolve(ok.astype(float), np.ones(w), "same")
        return np.where(ok & (den > 0.5 * w), prof - num / np.maximum(den, 1), np.nan)

    profs = [(a0, a1, kind, profile(a0, a1)) for a0, a1, kind in windows]
    profs = [x for x in profs if x[3] is not None]
    if not profs:
        return None
    # Spacing: bare ground at the ends shows it best; the canopy's dips otherwise.
    pitches = []
    for kind in ("end", "alley"):
        for _, _, k_, pr in profs:
            if k_ != kind:
                continue
            g = furrow_grid(pr, mz, pitch_hint_m)
            if g:
                pitches.append((g["strength"], g["pitch_px"] * mz))
        if pitches:
            break
    if not pitches:
        return None
    pitch_m = float(sum(c * p for c, p in pitches) / sum(c for c, _ in pitches))
    if pitch_hint_m:
        pitch_m = float(pitch_hint_m)           # measured earlier this season: beds do not move
    P = pitch_m / m
    # Each window's furrow phase as a phasor; the slope that lines them up.
    zs, ws, ac = [], [], []
    for a0, a1, kind, pr in profs:
        ok = np.isfinite(pr)
        if ok.sum() * mz < 2 * pitch_m:
            continue
        c = np.sum(pr[ok] * np.exp(2j * np.pi * u[ok] / P)) / ok.sum()
        if abs(c) == 0:
            continue
        zs.append(-c / abs(c))                    # furrows are the low points
        ws.append(abs(c) * (2.0 if kind == "end" else 1.0))
        ac.append((a0 + a1) / 2)
    if len(zs) < 2:
        return None
    zs, ws, ac = np.array(zs), np.array(ws), np.array(ac)
    best = None
    for slope in np.linspace(-0.03, 0.03, 601):
        tot = np.sum(ws * zs * np.exp(-2j * np.pi * slope * ac / P))
        if best is None or abs(tot) > abs(best[1]):
            best = (slope, tot)
    slope, tot = best
    strength = float(abs(tot) / ws.sum())
    if strength < 0.5:
        return None
    phase = float((np.angle(tot) / (2 * np.pi)) % 1.0 * P)
    return {"pitch_px": P, "phase_px": phase, "slope": float(slope), "strength": round(strength, 2),
            "windows": len(zs)}


def find_layout(ortho: Ortho, beds: int, tiers: int, bed_axis: str = "auto", border_tiers: Optional[int] = None,
                block: int = 0, plot_length_m: Optional[float] = None, bed_pitch_m: Optional[float] = None,
                border_beds: Optional[list] = None, border_beds_at: Optional[str] = None,
                dsm_file=None, tier_pitch_m: Optional[float] = None, tier_shift_m: float = 0.0) -> dict:
    """Locate the planted block and its tier strips from vegetation.

    Tiers are the strips separated by alleys along the field's long axis;
    beds divide the block evenly across it. Returns pixel geometry and what
    was assumed, for the overlay and the caller's judgement.
    """
    import numpy as np

    a = np.asarray(ortho.image, dtype=np.float32)
    rgb, alpha = a[..., :3] / 255.0, a[..., 3] > 0
    exg = (2 * rgb[..., 1] - rgb[..., 0] - rgb[..., 2]) / (rgb.sum(axis=2) + 1e-6)
    # Threshold between soil and canopy chosen from this image (Otsu), so a
    # dark early-morning flight is handled like a bright midday one.
    vals = exg[alpha]
    hist, edges = np.histogram(vals, bins=128, range=(-0.2, 0.5))
    w = np.cumsum(hist).astype(np.float64)
    mu = np.cumsum(hist * (edges[:-1] + edges[1:]) / 2)
    between = (mu[-1] * w - mu * w[-1]) ** 2 / (w * (w[-1] - w) + 1e-9)
    thr = float(edges[int(np.argmax(between[:-1]))])
    veg = (exg > min(max(thr, 0.02), 0.12)) & alpha
    long_is_rows = ortho.h >= ortho.w if bed_axis == "auto" else bed_axis == "columns"
    v = veg if long_is_rows else veg.T                  # v[along, across]
    m = ortho.metres_per_px

    # Across the field: the planted blocks are the wide stretches of vegetation.
    across = _smooth(v.mean(axis=0), 0.3 / m)
    # Low cut, near bare soil: a field of several crops has sparse stretches (young
    # beans beside closed cowpea) that are still planted beds, not alleys.
    runs = _runs(across > 0.15 * across.max())
    # A thin dip (a weak bed) does not split a block either: join pieces under 0.8 m apart.
    joined: list = []
    for r in runs:
        if joined and (r[0] - joined[-1][1]) * m < 0.8:
            joined[-1] = (joined[-1][0], r[1])
        else:
            joined.append(tuple(r))
    blocks = [r for r in joined if (r[1] - r[0]) * m > 2.0]
    if not blocks:
        raise ValueError("no planted block found on this orthomosaic (is it mostly bare soil?)")
    blocks.sort(key=lambda r: -(r[1] - r[0]))
    if block >= len(blocks):
        raise ValueError(f"only {len(blocks)} block(s) found")
    u0, u1 = blocks[block]

    # Along the field, inside that block: strips of plants separated by alleys.
    along = _smooth(v[:, u0:u1].mean(axis=1), 0.25 / m)
    used, found, note = _tier_strips(along, m, tiers, border_tiers, tier_pitch_m)
    if tier_shift_m:
        # Moved along the field: + toward the image's bottom (south) when beds run north-south,
        # toward its right (east) otherwise.
        d = int(round(tier_shift_m / m))
        used = [(a_ + d, b + d) for a_, b in used]
        note = (note + "; " if note else "") + f"tiers moved {tier_shift_m:+.2f} m along the field"

    # Beds from the furrows between them, not an even split of the block.
    # Inside the plots the canopy can hide the furrows; bare ground in the
    # alleys between tiers and at the ends of the beds still shows them.
    t0, t1 = used[0][0], used[-1][1]
    # Beyond the outermost planted strips (border tiers included): headland.
    planted = np.flatnonzero(along > 0.30 * along.max())
    p0, p1 = (int(planted[0]), int(planted[-1])) if planted.size else (t0, t1)
    reach = int(4.0 / m)
    ends = [(max(0, p0 - reach), max(0, p0 - int(0.5 / m))), (min(v.shape[0], p1 + int(0.5 / m)), min(v.shape[0], p1 + reach))]
    grid, track, a_ref = None, None, (t0 + t1) / 2
    if dsm_file:
        try:
            # Bare ground: the field's ends and the alleys between tiers.
            wins = [(e0, e1, "end") for e0, e1 in ends if e1 - e0 > 0.5 / m] + \
                [(e0, s1, "alley") for (_, e0), (s1, _) in zip(used[:-1], used[1:]) if (s1 - e0) * m > 0.3]
            track = furrow_track(dsm_file, ortho, long_is_rows, wins, u0, u1, bed_pitch_m)
        except Exception:
            track = None
    if track:
        # Furrows at phase + slope*along + j*pitch: straighten the plants by the
        # slope, so the beds are upright where they are counted.
        grid = {"pitch_px": track["pitch_px"], "phase_px": track["phase_px"] + track["slope"] * a_ref,
                "source": "furrows in the elevation model"}
    else:
        try:
            soil, k = _end_soil(ortho, long_is_rows, [e for e in ends if e[1] - e[0] > 0.5 / m])
            if soil is not None:
                g = furrow_grid(soil, m / k, bed_pitch_m)
                if g:
                    grid = {"pitch_px": g["pitch_px"] / k, "phase_px": g["phase_px"] / k,
                            "source": "furrows at the field's ends"}
        except Exception:
            grid = None
    slope = track["slope"] if track else 0.0
    vt = v[t0:t1, :].astype(np.float32)
    if slope:
        for i in range(vt.shape[0]):
            sh = int(round(-slope * (t0 + i - a_ref)))
            if sh:
                vt[i] = np.roll(vt[i], sh)
    fit = fit_beds(vt.mean(axis=0), int(u0), int(u1), beds, m, grid=grid, pitch_m=bed_pitch_m,
                   border_beds=border_beds,
                   border_side=({"west": 0, "north": 0, "east": 1, "south": 1}.get(str(border_beds_at).lower())
                                if border_beds_at else None))
    bed_w = fit["pitch_px"]
    if fit["method"] != "even":
        u0, u1 = int(fit["edges"][0]), int(fit["edges"][-1])
        msg = (f"beds fitted to the furrows ({bed_w * m:.2f} m apart, from {fit.get('source', 'plants')})"
               if fit["method"] == "furrows" else f"beds {bed_w * m:.2f} m apart (spacing measured earlier this season)")
        if "border_beds" in fit:
            bl, br = fit["border_beds"]
            msg += f"; {fit['beds_in_block']} planted beds (cover {fit.get('bed_cover')})"
            sides = ("west", "east") if long_is_rows else ("north", "south")
            if bl or br:
                msg += f", the outer {bl} ({sides[0]}) and {br} ({sides[1]}) taken as border beds"
            if border_beds is None and not border_beds_at and (bl + br) % 2:
                msg += (f" - CHECK: one border bed more on one side; the {sides[0] if bl > br else sides[1]} "
                        "outer bed was weaker so taken as border (border_beds=[first side, other side] to set it)")
            if not fit.get("beds_in_block"):
                msg += f" - WARNING: fewer planted beds than the design's {beds}; check the overlay"
        if slope:
            msg += f"; beds slant {abs(slope) * (t1 - t0) * m:.2f} m across the field's length (followed)"
        note = (note + "; " if note else "") + msg

    used, even_note = _even_tiers(used, m, plot_length_m)
    note = "; ".join(x for x in (note, even_note) if x)
    if not 0.6 <= bed_w * m <= 2.5:
        note = (note + "; " if note else "") + (
            f"WARNING: {beds} beds across a {(u1 - u0) * m:.0f} m block makes beds {bed_w * m:.2f} m wide, "
            "not a usual bed width: the block found may be part of the field, or the flight covers fewer beds "
            "(record `beds`)")
    return {"long_is_rows": long_is_rows, "block": [int(u0), int(u1)], "tiers": [list(map(int, s)) for s in used],
            "bed_width_px": bed_w, "bed_edges": [float(e) for e in fit["edges"]],
            "bed_pitch_m": round(bed_w * m, 3) if fit["method"] != "even" else None,
            "bed_fit": fit["method"], "bed_source": fit.get("source"), "border_beds": fit.get("border_beds"),
            "bed_slope": slope, "bed_ref": a_ref, "strips_found": found, "blocks_found": len(blocks), "note": note,
            "block_width_m": round((u1 - u0) * m, 2), "field_length_m": round((used[-1][1] - used[0][0]) * m, 1),
            "tier_length_m": round(sum(b - a_ for a_, b in used) / len(used) * m, 2), "_veg": v}


def _tier_strips(along, m: float, tiers: int, border_tiers: Optional[int],
                 tier_pitch_m: Optional[float] = None) -> tuple[list, int, str]:
    """The tiers along a vegetation profile: (strips used, strips found, note).
    With the tier spacing known (`tier_pitch_m`: plot plus alley, from the field
    map), a count that does not match the design is solved by placing the design's
    tiers at that spacing where the alleys fall, rather than spreading them evenly."""
    import numpy as np

    strips = [r for r in _runs(along > 0.30 * along.max()) if (r[1] - r[0]) * m > 0.8]
    if len(strips) < 4:
        # Closed or uneven canopy: the alleys never fall near bare soil, but they
        # are still dips against the canopy around them.
        planted = along > 0.1 * along.max()
        dips = along - _smooth(along, 6.0 / m)
        strips = [r for r in _runs((dips > 0) & planted) if (r[1] - r[0]) * m > 0.8]
        # Those runs are only each tier's densest middle: a tier reaches from alley to
        # alley (the low point between two runs), less a margin for the alley itself.
        if len(strips) >= 2:
            lows = [a_ + int(np.argmin(along[a_:b_])) for (_, a_), (b_, _) in zip(strips[:-1], strips[1:])]
            pitch = float(np.median(np.diff(lows))) if len(lows) >= 2 else 0.0
            half = int(0.3 / m)
            cuts = ([lows[0] - int(pitch)] if pitch else [strips[0][0]]) + lows + \
                   ([lows[-1] + int(pitch)] if pitch else [strips[-1][1]])
            strips = [(max(c0 + half, 0), min(c1 - half, len(along))) for c0, c1 in zip(cuts[:-1], cuts[1:])]
    # Where canopies have closed over an alley, several strips come out as
    # one long run: cut such runs into equal parts at the usual pitch.
    if len(strips) >= 4:
        starts = np.diff([a_ for a_, _ in strips])
        pitch = float(np.median(starts))
        usual = float(np.median([b - a_ for a_, b in strips]))
        split = []
        for a_, b in strips:
            n = int(round((b - a_ + (pitch - usual)) / pitch))
            if n <= 1:
                split.append((a_, b))
            else:
                step = (b - a_ + (pitch - usual)) / n
                split += [(int(a_ + i * step), int(a_ + i * step + usual)) for i in range(n)]
        strips = split
    if not strips:
        raise ValueError("no tiers found along the field")
    found = len(strips)
    note = ""
    if border_tiers is None and found == tiers + 1:
        # One strip too many: the shorter end one is a border or the flight's edge cutting a strip.
        cut = 0 if strips[0][1] - strips[0][0] < strips[-1][1] - strips[-1][0] else -1
        strips = strips[1:] if cut == 0 else strips[:-1]
        note = f"{found} strips found; the shorter one at the {'first' if cut == 0 else 'last'} end left out"
        found -= 1
    if border_tiers is None:
        border_tiers = (found - tiers) // 2 if found > tiers and (found - tiers) % 2 == 0 else 0
    if found - 2 * border_tiers == tiers:
        used = strips[border_tiers: found - border_tiers] if border_tiers else strips
        if border_tiers:
            note = f"{found} strips found; the first and last {border_tiers} taken as border, not plots"
    elif tier_pitch_m:
        used = _tiers_at_pitch(along, strips, tiers, tier_pitch_m / m)
        note = (f"{found} strips found, the design has {tiers} tiers: placed at the given spacing "
                f"({tier_pitch_m:.2f} m) where the alleys fit, centred on the planted strips")
    else:
        # Counts do not match the design: fall back to even spacing between the outermost strips.
        lo, hi = strips[0][0], strips[-1][1]
        step = (hi - lo) / tiers
        used = [(int(lo + i * step), int(lo + (i + 1) * step)) for i in range(tiers)]
        note = (f"WARNING: {found} strips found but the design has {tiers} tiers "
                f"(with border_tiers={border_tiers}); evenly spaced cells were used instead - check the overlay")
    return used, found, note


def _tiers_at_pitch(along, strips: list, tiers: int, pitch: float) -> list:
    """`tiers` cells at a known spacing: centred on the planted strips, then slid by up
    to half a spacing to where the cells hold the most canopy (alleys between them)."""
    import numpy as np

    lo, hi = strips[0][0], strips[-1][1]
    centre = (lo + hi) / 2 - tiers * pitch / 2
    cell = 0.65 * pitch
    best, best_score = centre, -1.0
    for off in np.arange(centre - pitch / 2, centre + pitch / 2, max(1.0, pitch / 40)):
        score = 0.0
        for i in range(tiers):
            a_ = int(off + i * pitch + (pitch - cell) / 2)
            b_ = int(a_ + cell)
            if a_ < 0 or b_ > len(along):
                score = -1.0
                break
            score += float(along[a_:b_].mean())
        if score > best_score:
            best, best_score = off, score
    return [(int(best + i * pitch + (pitch - cell) / 2), int(best + i * pitch + (pitch + cell) / 2))
            for i in range(tiers)]


# Space left between two plots along a bed when nobody gave the plot length (metres).
ALLEY_M = 1.0


def _even_tiers(used: list, m: float, plot_length_m: Optional[float]) -> tuple[list, str]:
    """Every tier the same length, evenly spaced: plants grow to fill their plot, so
    a box should not end where today's canopy ends. Centres follow a straight line
    through the strips found (unless the field's spacing is irregular); the length
    is the plot length given, else the longest of what the canopy shows and the
    spacing less an alley."""
    import numpy as np

    if len(used) < 2:
        return used, ""
    centres = np.array([(a_ + b) / 2 for a_, b in used], dtype=float)
    idx = np.arange(len(used))
    slope, icept = np.polyfit(idx, centres, 1)
    fitted = icept + slope * idx
    regular = float(np.max(np.abs(fitted - centres))) < 0.25 * abs(slope)
    if regular:
        centres = fitted
    pitch = abs(float(np.median(np.diff(centres))))
    seen = float(np.median([b - a_ for a_, b in used]))
    length = plot_length_m / m if plot_length_m else max(seen, pitch - ALLEY_M / m)
    length = min(length, 0.97 * pitch)
    out = [(int(round(c - length / 2)), int(round(c + length / 2))) for c in centres]
    return out, (f"plots drawn {length * m:.2f} m long every {pitch * m:.2f} m"
                 + ("" if regular else " (spacing irregular: centres kept where the strips were)"))


def _plot_length(facts_value: Any, crop: Optional[str]) -> Optional[float]:
    """A plot length given for the whole field (a number) or per crop ({"Sorghum": 3.0, ...})."""
    if isinstance(facts_value, (int, float)):
        return float(facts_value)
    if isinstance(facts_value, dict) and crop:
        for k, v in facts_value.items():
            if str(k).lower() == str(crop).lower() and isinstance(v, (int, float)):
                return float(v)
    return None


def _bed_crops(design: dict, beds: list[int]) -> list[Optional[str]]:
    """The crop of each bed (the most common one among its plots)."""
    from collections import Counter

    out = []
    for b in beds:
        c = Counter(r.get("_crop") for r in design["rows"] if r["_col"] == b and r.get("_crop"))
        out.append(c.most_common(1)[0][0] if c else None)
    return out


def crop_tiers(ortho: "Ortho", lay: dict, design: dict, beds: list[int], bed_first_at: str,
               plot_length: Any = None) -> tuple[list[list], list[str]]:
    """Tiers for each bed position, worked out per crop: crops on one field can have
    plots of different lengths (sorghum beside cowpea), so each crop's beds get their
    own strips and their own even size. A crop whose strips do not match the design
    keeps the field's tiers. Returns (tiers per bed position, notes)."""
    v, m = lay["_veg"], ortho.metres_per_px
    u0, bw = lay["block"][0], lay["bed_width_px"]
    order = beds if bed_first_at in ("west", "north") else beds[::-1]
    crops = _bed_crops(design, order)
    per_bed: list[list] = [lay["tiers"]] * len(order)
    notes: list[str] = []
    named = sorted({c for c in crops if c})
    if len(named) < 2 and not isinstance(plot_length, dict):
        return per_bed, notes
    for crop in named:
        cols = [i for i, c in enumerate(crops) if c == crop]
        a, b = int(u0 + min(cols) * bw), int(u0 + (max(cols) + 1) * bw)
        along = _smooth(v[:, a:b].mean(axis=1), 0.25 / m)
        try:
            used, found, note = _tier_strips(along, m, len(lay["tiers"]), None)
        except ValueError:
            continue
        field_pitch = (lay["tiers"][-1][0] - lay["tiers"][0][0]) / max(1, len(lay["tiers"]) - 1)
        own_pitch = (used[-1][0] - used[0][0]) / max(1, len(used) - 1)
        if note.startswith("WARNING") or len(cols) < 3 or abs(own_pitch - field_pitch) > 0.15 * field_pitch:
            # Too few beds to tell, or strips that do not match the design: the field's tiers.
            used = [tuple(t) for t in lay["tiers"]]
        used, even = _even_tiers(used, m, _plot_length(plot_length, crop))
        for i in cols:
            per_bed[i] = [list(map(int, t)) for t in used]
        notes.append(f"{crop}: {even}")
    return per_bed, notes


# ── field design ─────────────────────────────────────────────────────────────

ALIASES = {"row": ("tier", "row", "range", "row_num"), "col": ("bed", "col", "column", "col_num"),
           "plot": ("field plot #", "plot", "plot_id", "plot_no", "plot_number", "plotid"),
           "accession": ("genotype", "accession", "entry", "variety", "line", "name")}


def read_design(path: str, scope: Optional[dict] = None) -> dict:
    """A field design in any of the shapes breeders keep (see field_layout):
    one row per plot with its tier (row), bed (column), plot label, genotype
    and crop. Only plots with a position are returned. `scope` (year,
    location, experiment): keep that field's rows of a master sheet."""
    from .field_layout import read_for_field

    p = Path(path).expanduser()
    if not p.exists():
        # Facts recorded on another computer name its folders: the same file
        # in this agent's own field_layouts folder is the one meant.
        from .client import AGENT_DIR

        here = AGENT_DIR / "work" / "field_layouts" / Path(str(path).replace("\\", "/")).name
        if not here.exists():
            raise ValueError(f"field design not found: {path}")
        p = here
    # A master sheet of several fields: the run's field (year, site, experiment).
    sc = scope or {}
    layout, _, _ = read_for_field(str(p), year=sc.get("year"), location=sc.get("location"),
                                  experiment=sc.get("experiment"))
    rows = []
    for q in layout["plots"]:
        if q.get("border") or q.get("tier") is None or q.get("bed") is None:
            continue
        rec = dict(q.get("columns") or {})
        rec.update({"_row": int(q["tier"]), "_col": int(q["bed"]),
                    "_plot": q.get("plot") or f"{q['tier']}-{q['bed']}", "_accession": q.get("genotype") or "",
                    "_crop": q.get("crop") or "", "_trial": q.get("trial") or "", "_bed_span": q.get("bed_span") or 1})
        rows.append(rec)
    if not rows:
        raise ValueError("the design gives no plot positions (tier and bed). It has "
                         f"{len(layout['plots'])} plots; a map or a table with tier/row and bed columns is needed "
                         "(field_layout with this and another file joins them by plot number)")
    columns = sorted({k for r in rows for k in r if not k.startswith("_")})
    return {"rows": rows, "beds": sorted({r["_col"] for r in rows}), "tiers": sorted({r["_row"] for r in rows}),
            "columns": columns, "crops": sorted({r["_crop"] for r in rows if r["_crop"]})}


def field_design(args: dict) -> dict:
    d = read_design(args["path"])
    beds, tiers = d["beds"], d["tiers"]
    groups, start = [], beds[0]
    for a_, b in zip(beds, beds[1:] + [None]):
        if b is None or b != a_ + 1:
            groups.append([start, a_])
            start = b
    grid = {(r["_row"], r["_col"]): r["_plot"] for r in d["rows"]}
    corners = {f"tier {t}, bed {b}": grid.get((t, b)) for t in (tiers[0], tiers[-1]) for b in (beds[0], beds[-1])}
    return {"result": {"plots": len(d["rows"]), "beds": beds, "tiers": [tiers[0], tiers[-1]], "tier_count": len(tiers),
                       "bed_blocks": groups, "columns": d["columns"], "corner_plots": corners,
                       "genotypes": len({r["_accession"] for r in d["rows"]}),
                       "crops": d.get("crops") or None,
                       "note": "bed_blocks = runs of consecutive bed numbers; a gap between runs is usually an "
                               "alley or a different treatment block, often flown and mapped separately"}}


# ── boundaries ───────────────────────────────────────────────────────────────

def numeric_plot(label: str, seen: dict) -> int:
    """The app stores plot numbers as integers. A design label that is not a
    number (check plots such as KW7, KD12) gets a stable numeric alias —
    9000 + 100 per distinct prefix + its own number: KW7 -> 9107, KD12 -> 9212 —
    and keeps its label in `plot_label`."""
    try:
        return int(float(label))
    except (TypeError, ValueError):
        pass
    m = re.match(r"^(.*?)(\d+)$", str(label).strip())
    prefix, n = (m.group(1), int(m.group(2))) if m else (str(label), 0)
    if prefix not in seen:
        seen[prefix] = 9000 + 100 * (len(seen) + 1)
    return seen[prefix] + n


def _cells(ortho: Ortho, lay: dict, design: dict, beds: list[int], tier_first_at: str, bed_first_at: str,
           shrink_m: float) -> list[dict]:
    """One polygon per (tier, bed), labelled from the design."""
    tiers = design["tiers"]
    by = {(r["_row"], r["_col"]): r for r in design["rows"]}
    long_rows = lay["long_is_rows"]
    u0 = lay["block"][0]
    bw = lay["bed_width_px"]
    pad = shrink_m / ortho.metres_per_px
    # Position order along the field (index 0 = top of image = north) and across it (0 = left = west).
    tier_order = tiers if tier_first_at in ("north", "west") else tiers[::-1]
    bed_order = beds if bed_first_at in ("west", "north") else beds[::-1]
    feats = []
    aliases: dict = {}
    for r in sorted(design["rows"], key=lambda r: (r["_col"], r["_row"])):   # same alias whichever flight
        numeric_plot(r["_plot"], aliases)
    per_bed = lay.get("tiers_by_bed") or [lay["tiers"]] * len(beds)
    for ti in range(len(lay["tiers"])):
        for bi in range(len(beds)):
            s0, s1 = per_bed[bi][ti]
            a0, a1 = s0 + pad, s1 - pad
            edges = lay.get("bed_edges")
            if edges and len(edges) == len(beds) + 1:
                # Each bed between its two furrows, kept just off them.
                gap = 0.04 * (edges[bi + 1] - edges[bi])
                c0, c1 = edges[bi] + gap + pad, edges[bi + 1] - gap - pad
            else:
                c0, c1 = u0 + bi * bw + pad, u0 + (bi + 1) * bw - pad
            # Beds not quite parallel to the image: the edges follow the furrows.
            slope, ref = float(lay.get("bed_slope") or 0.0), float(lay.get("bed_ref") or 0.0)
            d0, d1 = slope * (a0 - ref), slope * (a1 - ref)
            pts = [(c0 + d0, a0), (c1 + d0, a0), (c1 + d1, a1), (c0 + d1, a1)]
            box = pts if long_rows else [(a, c) for c, a in pts]
            ring = [ortho.lonlat(x, y) for x, y in box]
            tier, bed = tier_order[ti], bed_order[bi]
            rec = by.get((tier, bed))
            label = rec["_plot"] if rec else f"{tier}-{bed}"
            props: dict[str, Any] = {"row": tier, "col": bed, "plot": numeric_plot(label, aliases) if rec else tier * 1000 + bed,
                                     "plot_label": label, "accession": rec["_accession"] if rec else "",
                                     **({"crop": rec["_crop"]} if rec and rec.get("_crop") else {}),
                                     "_px": [[round(x, 1), round(y, 1)] for x, y in box]}
            if rec:
                props.update({k: v for k, v in rec.items() if not k.startswith("_")})
            feats.append({"type": "Feature", "properties": props,
                          "geometry": {"type": "Polygon", "coordinates": [ring + [ring[0]]]}})
    return feats


def _overlay(ortho: Ortho, feats: list[dict], name: str, lay: dict) -> Path:
    from PIL import Image, ImageDraw, ImageFont

    img = ortho.image.convert("RGB")
    k = min(3.0, 2600 / max(img.size))
    if lay["long_is_rows"]:                    # lay the field on its side so it fits a screen
        img = img.rotate(90, expand=True)
    img = img.resize((round(img.width * k), round(img.height * k)))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=max(11, int(0.5 / ortho.metres_per_px * k)))
    except TypeError:
        font = ImageFont.load_default()

    def pt(x: float, y: float) -> tuple[float, float]:
        return (y * k, (ortho.w - x) * k) if lay["long_is_rows"] else (x * k, y * k)

    for f in feats:
        ring = [pt(x, y) for x, y in f["properties"]["_px"]]
        d.polygon(ring, outline=(255, 0, 255))
        cx, cy = sum(p[0] for p in ring) / 4, sum(p[1] for p in ring) / 4
        label = str(f["properties"].get("plot_label") or f["properties"]["plot"])
        box = d.textbbox((cx, cy), label, font=font, anchor="mm")
        d.rectangle(box, fill=(0, 0, 0))
        d.text((cx, cy), label, fill=(255, 255, 0), font=font, anchor="mm")
    compass = "north is LEFT, east is UP" if lay["long_is_rows"] else "north is UP, east is RIGHT"
    d.rectangle((0, 0, 330, 24), fill=(0, 0, 0))
    d.text((6, 4), compass, fill=(255, 255, 255))
    out = WORK / f"boundaries_{name}.png"
    img.save(out)
    return out


# ── the same boundaries on another date ──────────────────────────────────────

def _cells_of(snapshot: dict, crops: Optional[list[str]] = None) -> list[dict]:
    """The plot cells of a saved boundary version (not the drawn outlines), of some crops only if asked."""
    want = {str(c).lower() for c in crops or []}
    out = []
    for f in (snapshot.get("boundaries") or {}).get("features") or []:
        p = f.get("properties") or {}
        if p.get("role") == "outer" or (f.get("geometry") or {}).get("type") != "Polygon":
            continue
        # A plot added by hand (no crop of its own) comes along whatever crops are asked for.
        if want and str(p.get("crop") or "").lower() not in want and not (p.get("added") and not p.get("crop")):
            continue
        out.append(f)
    return out


def _ortho_in(directory: str) -> str:
    """The orthomosaic of a Processed/... folder (the newest, if it was rebuilt)."""
    page = client().list_page(directory.rstrip("/") + "/odm_orthophoto", 50, 0)
    # (…-Pyramid.tif is the map-tile copy in web-map coordinates, not the orthomosaic.)
    tifs = [f for f in page.get("files") or [] if str(f["object_name"]).lower().endswith((".tif", ".tiff"))
            and "pyramid" not in str(f["object_name"]).lower()]
    if not tifs:
        raise ValueError(f"no orthomosaic in {directory}")
    return max(tifs, key=lambda f: f.get("last_modified") or "")["object_name"]


def _measure_shift(prev: "Ortho", new: "Ortho", cells: list[dict], max_m: float = 8.0) -> dict:
    """How far the field moved between two orthomosaics (GPS drift between flights):
    phase correlation of their green-cover images over the plots, within max_m.
    Returns dx/dy in metres (east, north) and the match strength (0-1)."""
    import numpy as np

    if prev.zone != new.zone or (prev.zone and prev.north != new.north):
        raise ValueError("the two orthomosaics are in different map zones")
    pts = [prev.proj(lon, lat) for f in cells for lon, lat in f["geometry"]["coordinates"][0]]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    pad = max_m + 2.0
    x0 = max(min(xs) - pad, prev.x0, new.x0)
    x1 = min(max(xs) + pad, prev.x0 + prev.w * prev.px_x, new.x0 + new.w * new.px_x)
    y1 = min(max(ys) + pad, prev.y0, new.y0)
    y0 = max(min(ys) - pad, prev.y0 - prev.h * prev.px_y, new.y0 - new.h * new.px_y)
    if x1 <= x0 or y1 <= y0:
        raise ValueError("the two orthomosaics do not overlap where the plots are")
    res = max(prev.px_x, new.px_x, 0.05) if prev.zone else max(prev.px_x, new.px_x)
    while (x1 - x0) / res > 3000 or (y1 - y0) / res > 3000:
        res *= 1.5
    w, h = int((x1 - x0) / res), int((y1 - y0) / res)

    def grab(o: "Ortho"):
        box = ((x0 - o.x0) / o.px_x, (o.y0 - y1) / o.px_y, (x1 - o.x0) / o.px_x, (o.y0 - y0) / o.px_y)
        a = np.asarray(o.image.crop(tuple(int(round(b)) for b in box)).resize((w, h)), dtype=np.float32)
        rgb, alpha = a[..., :3] / 255.0, a[..., 3] > 0
        g = (2 * rgb[..., 1] - rgb[..., 0] - rgb[..., 2]) / (rgb.sum(axis=2) + 1e-6)
        g[~alpha] = float(g[alpha].mean()) if alpha.any() else 0.0
        g = (g - g.mean()) / (g.std() + 1e-6)
        return g * np.outer(np.hanning(h), np.hanning(w))

    a, b = grab(prev), grab(new)
    cross = np.fft.fft2(b) * np.conj(np.fft.fft2(a))
    r = np.real(np.fft.ifft2(cross / (np.abs(cross) + 1e-9)))
    lim = int(max_m / (res if prev.zone else res * 111_320))
    dr = np.r_[0:lim + 1, h - lim:h] if h > 2 * lim else np.arange(h)
    dc = np.r_[0:lim + 1, w - lim:w] if w > 2 * lim else np.arange(w)
    win = r[np.ix_(dr, dc)]
    i, j = np.unravel_index(int(np.argmax(win)), win.shape)
    row, col = int(dr[i]), int(dc[j])
    row, col = (row - h if row > h // 2 else row), (col - w if col > w // 2 else col)
    peak = float(win[i, j])
    return {"dx": col * res, "dy": -row * res, "match": round(peak, 3),
            "unit": "m" if prev.zone else "degrees"}


def shift_boundaries(args: dict) -> dict:
    """Boundaries saved for one date, moved onto another date's orthomosaic of the
    same field: each plot keeps its label, crop and genotype from the design;
    only its position moves (by how far the maps differ). Some crops only, if asked."""
    c = client()
    src = str(args["from_directory"]).rstrip("/") + "/"
    snap = c.load_version(src, args.get("from_version")).get("state_snapshot") or {}
    cells = _cells_of(snap, args.get("crops"))
    if not cells:
        raise ValueError("no plots to bring over" + (f" for {args.get('crops')}" if args.get("crops") else ""))
    to_path = args.get("orthomosaic_path") or _ortho_in(str(args["to_directory"]))
    new = Ortho(to_path)
    shift = {"dx": 0.0, "dy": 0.0, "match": None, "unit": "m"}
    if args.get("align", True):
        prev = Ortho(_ortho_in(src))
        shift = _measure_shift(prev, new, cells, float(args.get("max_shift_m") or 8.0))
        if shift.get("match") is not None and shift["match"] < 0.05:
            # No real match: flights of one field (RTK) agree to centimetres, so the plots stay put
            # rather than move by a guess; the result says so.
            shift = {**shift, "dx": 0.0, "dy": 0.0, "not_applied": True}
    moved = []
    for f in cells:
        ring = []
        for lon, lat in f["geometry"]["coordinates"][0]:
            x, y = new.proj(lon, lat)
            ring.append(new.unproj(x + shift["dx"], y + shift["dy"]))
        props = {k: v for k, v in (f.get("properties") or {}).items() if k not in ("cellId", "blockId", "block")}
        moved.append({"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": [ring]}})
    crops = sorted({str(f["properties"].get("crop")) for f in moved if f["properties"].get("crop")})
    snapshot = {"boundaries": {"type": "FeatureCollection", "features": moved},
                "grid": snap.get("grid") or {}, "created_from": "import",
                "field_design": snap.get("field_design"),
                "imported_from": {"directory": src, "version": args.get("from_version"),
                                  "shift_m": [round(shift["dx"], 2), round(shift["dy"], 2)], "match": shift["match"]}}
    weak = shift["match"] is not None and shift["match"] < 0.05
    return {"result": {"plots": len(moved), "crops": crops, "shift": {k: (round(v, 2) if isinstance(v, float) else v)
                                                                      for k, v in shift.items()},
                       "check": ("the maps could not be lined up (weak match): the plots were kept where they "
                                 "were saved; look closely at the overlay, they may need moving by hand"
                                 if weak else "look at the overlay before saving"),
                       "state_snapshot": snapshot, "_ortho": new}}


def _earlier_boundaries(scope: dict, design_name: str) -> Optional[dict]:
    """The earliest date of the same field and season (same year, experiment, site,
    population, platform and sensor) with active boundaries made from the same
    field design, if it is earlier than this date."""
    try:
        versions = client().get_json("/api/plot_geometry/versions/all") or []
    except Exception:
        return None
    keys = ("year", "experiment", "location", "population", "date", "platform", "sensor")
    best = None
    for v in versions:
        parts = str(v["directory"]).strip("/").split("/")
        if len(parts) != 8 or parts[0] != "Processed" or not v.get("is_active"):
            continue
        other = dict(zip(keys, parts[1:]))
        if any(str(other[k]) != str(scope[k]) for k in keys if k != "date") or other["date"] >= str(scope["date"]):
            continue
        if best is None or other["date"] < best["date"]:
            best = {"date": other["date"], "directory": v["directory"], "version": v["version"]}
    if best is None:
        return None
    snap = client().load_version(best["directory"], best["version"]).get("state_snapshot") or {}
    source = str((snap.get("field_design") or {}).get("source") or "")
    if source and design_name and source != design_name:
        return {**best, "design_differs": source}
    return best


FIELD_FACTS = AGENT_DIR / "work" / "field_facts.json"


def _field_key(scope: dict, beds: list) -> str:
    """One field (and block of beds) across a season's dates."""
    return "/".join(str(scope[k]) for k in ("year", "experiment", "location", "population", "platform")) + \
        f"/beds {beds[0]}-{beds[-1]}"


def _bed_pitch(scope: dict, beds: list) -> Optional[dict]:
    try:
        return json.loads(FIELD_FACTS.read_text()).get(_field_key(scope, beds), {}).get("bed_pitch")
    except Exception:
        return None


def _keep_bed_pitch(scope: dict, beds: list, pitch_m: float, source: str) -> None:
    """The spacing read from the earliest date (least canopy) is kept."""
    try:
        facts = json.loads(FIELD_FACTS.read_text())
    except Exception:
        facts = {}
    key = _field_key(scope, beds)
    old = facts.get(key, {}).get("bed_pitch")
    if old and str(old.get("date", "")) <= str(scope["date"]):
        return
    facts.setdefault(key, {})["bed_pitch"] = {"m": pitch_m, "date": str(scope["date"]), "from": source}
    FIELD_FACTS.parent.mkdir(parents=True, exist_ok=True)
    FIELD_FACTS.write_text(json.dumps(facts, indent=1))


def plot_boundaries(args: dict) -> dict:
    """Find the plots on an orthomosaic, label them from the design, and
    (unless preview) save + activate them as the scope's plot boundaries."""
    path = args["orthomosaic_path"]
    scope = scope_from_path(path)
    if scope is None:
        raise ValueError("orthomosaic_path must be under Processed/{year}/{experiment}/{site}/{population}/{date}/…")
    design = read_design(args["design_path"], scope)
    crops = [str(c) for c in (args.get("crops") or [])]
    beds = [int(b) for b in args["beds"]] if args.get("beds") else design["beds"]
    if crops and not args.get("beds"):
        # A flight of some crops only: the beds of those crops.
        bc = _bed_crops(design, beds)
        beds = [b for b, c in zip(beds, bc) if c and c.lower() in {x.lower() for x in crops}] or beds
    name = re.sub(r"[^A-Za-z0-9]+", "_", "_".join(str(scope[k]) for k in ("location", "population", "date"))
                  + "_" + "-".join(map(str, (beds[0], beds[-1]))))
    earlier = None if args.get("fresh") else _earlier_boundaries(scope, Path(args["design_path"]).name)
    if earlier and not earlier.get("design_differs"):
        # The field was drawn on an earlier date (before the canopy closed): the same plots, moved.
        got = shift_boundaries({"from_directory": earlier["directory"], "from_version": earlier["version"],
                                "orthomosaic_path": path, "crops": crops or None})["result"]
        ortho = got.pop("_ortho")
        feats = got["state_snapshot"]["boundaries"]["features"]
        for f in feats:
            f["properties"]["_px"] = [list(ortho.pixel(*pt)) for pt in f["geometry"]["coordinates"][0][:4]]
        image = _overlay(ortho, feats, name, {"long_is_rows": ortho.h >= ortho.w})
        result = {"plots": len(feats), "reused_from": earlier["date"], "shift_m": got["shift"], "crops": got["crops"],
                  "check": got["check"],
                  "how": "the boundaries of the earliest date of this field and season, moved to this map; "
                         "fresh=true draws this date on its own instead"}
        if args.get("preview"):
            result["saved"] = False
            return {"result": result, "images": [str(image)]}
        return _save_boundaries(args, scope, feats, result, image,
                                {"source": Path(args["design_path"]).name, "by": "agent",
                                 "moved_from": earlier["directory"]}, None)
    ortho = Ortho(path)
    # The elevation model beside the orthomosaic (ODM writes both) shows the furrows.
    dsm_file = None
    dsm = args.get("dsm_path") or (path.replace("odm_orthophoto-", "odm_dsm-") if "odm_orthophoto-" in path else None)
    if dsm:
        try:
            dsm_file = _raster_copy(dsm, 5000)
        except Exception:
            dsm_file = None
    # Bed spacing: given, else measured on an earlier date of this field
    # (furrows show before the canopy closes), else read from this image.
    known = _bed_pitch(scope, beds)
    pitch_m = args.get("bed_pitch_m") or (known["m"] if known and str(known["date"]) < str(scope["date"]) else None)
    lay = find_layout(ortho, len(beds), len(design["tiers"]), border_tiers=args.get("border_tiers"),
                      block=int(args.get("block") or 0),
                      plot_length_m=_plot_length(args.get("plot_length_m"), None),
                      bed_pitch_m=float(pitch_m) if pitch_m else None,
                      border_beds=args.get("border_beds"), border_beds_at=args.get("border_beds_at"),
                      dsm_file=dsm_file,
                      tier_pitch_m=float(args["tier_pitch_m"]) if args.get("tier_pitch_m") else None,
                      tier_shift_m=float(args.get("tier_shift_m") or 0.0))
    if lay.get("bed_source") in ("furrows at the field's ends", "furrows in the elevation model") \
            and not args.get("bed_pitch_m"):
        _keep_bed_pitch(scope, beds, lay["bed_pitch_m"], lay["bed_source"])
    lay["tiers_by_bed"], crop_notes = crop_tiers(ortho, lay, design, beds, str(args.get("first_bed_at") or "west"),
                                                 args.get("plot_length_m"))
    feats = _cells(ortho, lay, design, beds, str(args.get("first_tier_at") or "south"),
                   str(args.get("first_bed_at") or "west"), float(args.get("shrink_m") or 0.0))
    corners = {f"{ns}-{ew}": None for ns in ("north", "south") for ew in ("west", "east")}
    t, b = lay["tiers"], len(beds)
    idx = {"north-west": 0, "north-east": b - 1, "south-west": (len(t) - 1) * b, "south-east": len(t) * b - 1}
    if not lay["long_is_rows"]:
        idx = {"north-west": 0, "south-west": b - 1, "north-east": (len(t) - 1) * b, "south-east": len(t) * b - 1}
    for kname, i in idx.items():
        corners[kname] = feats[i]["properties"]["plot_label"]
    if args.get("design_plots_only"):
        # Grid positions the design lists no plot for (a short bed, an unplanted corner): left out.
        feats = [f for f in feats if f["properties"].get("plot_label") != f"{f['properties']['row']}-{f['properties']['col']}"]
    image = _overlay(ortho, feats, name, lay)
    result: dict[str, Any] = {
        "plots": len(feats), "beds": beds, "tiers": len(t), "layout": {k: lay[k] for k in (
            "strips_found", "blocks_found", "block_width_m", "field_length_m", "tier_length_m", "note")},
        "bed_width_m": round(lay["bed_width_px"] * ortho.metres_per_px, 2),
        "bed_spacing": ("given" if args.get("bed_pitch_m") else
                        f"measured on {known['date']}" if pitch_m else
                        f"fitted to the furrows on this image ({lay.get('bed_source')})" if lay.get("bed_fit") == "furrows" else
                        "even split of the block (no furrows found)"),
        "plots_at_corners": corners,
        # Where each tier's centre landed along the field, in the map's coordinates (northing when
        # beds run north-south, easting otherwise): for checking against a field map's distances.
        "tier_centres": [round((ortho.y0 - (a_ + b) / 2 * ortho.px_y) if lay["long_is_rows"]
                               else (ortho.x0 + (a_ + b) / 2 * ortho.px_x), 2) for a_, b in t],
        "assumed": {"first_tier_at": args.get("first_tier_at") or "south (default - confirm with the person)",
                    "first_bed_at": args.get("first_bed_at") or "west (default)"},
        **({"sizes_by_crop": crop_notes} if crop_notes else {}),
        **({"earlier_date_not_used": f"{earlier['date']} was drawn from another design ({earlier['design_differs']})"}
           if earlier else {}),
    }
    if args.get("preview"):
        result["saved"] = False
        return {"result": result, "images": [str(image)]}
    return _save_boundaries(args, scope, feats, result, image,
                            {"source": Path(args["design_path"]).name, "by": "agent"},
                            {"rows": len(t), "cols": b, "spacing_m": 0, "angle_deg": 0, "row_offset": 0,
                             "col_offset": 0, "fill_pattern": "row-major"})


def _save_boundaries(args: dict, scope: dict, feats: list[dict], result: dict, image: Path, field_design: dict,
                     grid: Optional[dict]) -> dict:
    c = client()
    directory = "Processed/" + "/".join(str(scope[k]) for k in ("year", "experiment", "location", "population", "date",
                                                                "platform", "sensor")) + "/"
    existing: list[dict] = []
    if args.get("add_to_active"):
        try:
            snap = c.load_version(directory).get("state_snapshot") or {}
            keep = {(f["properties"]["row"], f["properties"]["col"]) for f in feats}
            existing = [f for f in (snap.get("boundaries") or {}).get("features") or []
                        if (f["properties"].get("row"), f["properties"].get("col")) not in keep]
        except Exception:
            existing = []
    clean = [{**f, "properties": {k: v for k, v in f["properties"].items() if k != "_px"}} for f in feats]
    snapshot = {"boundaries": {"type": "FeatureCollection", "features": existing + clean},
                "grid": grid or {}, "created_from": "grid" if grid else "import", "field_design": field_design}
    v = c.save_version(directory, snapshot, args.get("name") or f"agent: {len(existing) + len(clean)} plots")
    c.post_json("/api/plot_geometry/versions/activate", {"directory": directory, "version": v["version"]})

    def update(pr):
        run = pr.ensure_run(scope)
        pr.set_step(run, "plot_boundary_prep", "completed",
                    outputs={"activeVersion": v["version"], "activeVersionName": v.get("name")})
        return pr.describe(run)

    result.update({"saved": True, "version": v["version"], "directory": directory,
                   "total_plots_in_version": len(existing) + len(clean), "process_tab": process_tab(update)})
    return {"result": result, "images": [str(image)]}


def _folder_of(path: str) -> tuple[dict, str]:
    scope = scope_from_path(path)
    if scope is None:
        raise ValueError("path must be under Processed/… (or Raw/…)")
    folder = "Processed/" + "/".join(str(scope[k]) for k in ("year", "experiment", "location", "population", "date",
                                                             "platform", "sensor")) + "/"
    return scope, folder


def split_plots(args: dict) -> dict:
    """SPLIT_ORTHOMOSAIC: cut the orthomosaics into one image per plot of the
    active boundaries. With several orthomosaics in the folder (one flight per
    treatment), each plot is cut from the one whose centre it is nearest."""
    from . import multiortho

    scope, directory = _folder_of(args.get("orthomosaic_path") or args["path"])
    c = client()
    snap = c.load_version(directory).get("state_snapshot") or {}
    boundaries = snap.get("boundaries") or {}
    if not boundaries.get("features"):
        raise ValueError("no active plot boundaries for this scope: run plot_boundaries first")
    orthos = multiortho.orthos_in(c, directory)
    exp = next((e for e in c.entities("experiments") if e.get("experiment_name") == scope["experiment"]), None)
    jobs = []
    if args.get("source") == "frames":
        # Each plot's best raw frames, picked by the ODM run's camera positions: one job for the
        # run's own orthomosaics (one per treatment flown apart), never another run's of that day
        # (a diurnal flight): their frames are of another time.
        mine, run = _frames_orthos(orthos, args.get("orthomosaic_path"), scope)
        label = str(((run or {}).get("uploadScope") or {}).get("batchLabel") or "")
        params = {**{k: scope[k] for k in ("year", "experiment", "location", "population", "date", "platform", "sensor")},
                  "boundaries": boundaries, "source": "frames", "orthomosaic_path": mine[0],
                  "orthomosaic_paths": mine, "frames_per_plot": int(args.get("frames_per_plot") or 3),
                  **({"run_key": frames_run_key(label), "run_label": label} if label else {}),
                  **({"companions": False} if args.get("companions") is False else {})}
        job = c.submit_job("SPLIT_ORTHOMOSAIC", params, str(exp["id"]) if exp else None)
        ids = ((run or {}).get("uploadScope") or {}).get("datasetShortIds") or []
        on_run = {**scope, **({"datasetShortIds": list(ids)} if ids else {}), **({"batchLabel": label} if label else {})}
        process_tab(lambda pr: pr.record_job(on_run, job))
        out_dir = directory + "PlotFrames/" + (frames_run_key(label) + "/" if label else "")
        return {"result": {"jobs": [{"job_id": job.get("id"), "orthomosaics": mine,
                                     "plots": len(boundaries["features"])}],
                           "plots": len(boundaries["features"]), "output": out_dir,
                           **({"run": label} if label else {})}}
    if args.get("orthomosaic_path"):
        chosen = [o for o in orthos if o["path"] == args["orthomosaic_path"]] or [{"path": args["orthomosaic_path"]}]
        groups = multiortho.assign(boundaries["features"], orthos, _coverage_check()).get(args["orthomosaic_path"]) \
            if len(orthos) > 1 else boundaries["features"]
        plan = {chosen[0]["path"]: groups or []}
    else:
        if not orthos:
            raise ValueError(f"no orthomosaic in {directory}")
        plan = multiortho.assign(boundaries["features"], orthos, _coverage_check())
    for path, feats in plan.items():
        if not feats:
            continue
        params = {**{k: scope[k] for k in ("year", "experiment", "location", "population", "date", "platform", "sensor")},
                  "boundaries": {**boundaries, "features": feats}, "orthomosaic_path": path}
        job = c.submit_job("SPLIT_ORTHOMOSAIC", params, str(exp["id"]) if exp else None)
        jobs.append({"job_id": job.get("id"), "orthomosaic": path, "plots": len(feats)})

        def update(pr, job=job):
            return pr.record_job(scope, job)

        process_tab(update)
    return {"result": {"jobs": jobs, "plots": sum(j["plots"] for j in jobs), "output": directory + "PlotImages/",
                       "note": "one job per orthomosaic, each plot from the one whose centre it is nearest"
                       if len(jobs) > 1 else None}}


def frames_run_key(label: str) -> str:
    """The folder a labelled run's raw-frame plot images go in ("run 12:54 · drought" →
    "run-12-54-drought"); the app names it the same way."""
    return re.sub(r"[^A-Za-z0-9]+", "-", label).strip("-").lower()


def _frames_orthos(orthos: list[dict], chosen: Optional[str], scope: dict) -> tuple[list[str], Optional[dict]]:
    """The orthomosaics of one run (by the upload batches they were built from) and that
    run: the run holding ``chosen``'s batches, else the only run there is. Several runs and
    none chosen: which one is asked for."""
    if not orthos:
        raise ValueError("no orthomosaic built here in this folder (raw frames need one built from them)")
    runs = process_tab(lambda pr: [r for r in pr.state()["runs"]
                                   if all(str((r.get("uploadScope") or {}).get(k)) == str(scope[k])
                                          for k in ("experiment", "location", "population", "date", "platform",
                                                    "sensor"))])
    def batches(r):
        return set((r.get("uploadScope") or {}).get("datasetShortIds") or [])
    target = next((o for o in orthos if o["path"] == chosen), None) if chosen else None
    if target is None and chosen:
        target = {"path": chosen, "uploads": []}
    labelled = [r for r in runs if (r.get("uploadScope") or {}).get("batchLabel")]
    if target is None and len(labelled) > 0 and len(runs) > 1:
        raise ValueError("this date has several runs (" + ", ".join(
            sorted(str(r["uploadScope"]["batchLabel"]) for r in labelled)) + ", …): give orthomosaic_path, the "
            "orthomosaic of the run to cut")
    run = None
    if target is not None and target.get("uploads"):
        run = next((r for r in runs if batches(r) & set(target["uploads"])), None)
    elif len(runs) == 1:
        run = runs[0]
    if run is not None and batches(run):
        mine = [o["path"] for o in orthos if set(o.get("uploads") or []) & batches(run)] or \
            ([target["path"]] if target else [])
    else:
        mine = [target["path"]] if target else [o["path"] for o in orthos]
    return mine, run


def extract_traits(args: dict) -> dict:
    """EXTRACT_TRAITS for a date's orthomosaics with the active boundaries:
    vegetation fraction per plot, and plant height (95th percentile canopy top
    above ground) from the orthomosaic's elevation model when ODM made one.
    Several orthomosaics: each plot measured from the one whose centre it is
    nearest."""
    import json as _json

    from . import multiortho

    scope, directory = _folder_of(args["path"])
    c = client()
    v = c.load_version(directory)
    boundaries = (v.get("state_snapshot") or {}).get("boundaries") or {}
    if not boundaries.get("features"):
        raise ValueError("no active plot boundaries for this scope: run plot_boundaries first")
    orthos = multiortho.orthos_in(c, directory)
    if not orthos:
        raise ValueError(f"no orthomosaic in {directory}")
    plan = multiortho.assign(boundaries["features"], orthos, _coverage_check())
    exp = next((e for e in c.entities("experiments") if e.get("experiment_name") == scope["experiment"]), None)
    jobs, no_height = [], []
    for o in orthos:
        feats = plan.get(o["path"]) or []
        if not feats:
            continue
        tag = o["job_id"][:8]
        bpath = f"{directory}traits/boundaries-v{v.get('version')}-{tag}.geojson"
        blob = _json.dumps({**boundaries, "features": feats}).encode()
        c.upload_chunk(blob, 0, 1, f"agent:{bpath}:{len(blob)}", bpath, str(exp["id"]) if exp else None)
        params = {"orthomosaic_path": o["path"], "boundary_geojson_path": bpath,
                  "output_traits_geojson_path": f"{directory}traits/traits-v{v.get('version')}-{tag}.geojson"}
        if len(orthos) > 1:
            # One dataset per flight (its uploads): this block's re-run replaces
            # its own earlier records, not the other block's.
            params["dataset_label"] = "flight " + "+".join(sorted(o.get("uploads") or [tag]))
        if o.get("dsm"):
            params["dem_path"] = o["dsm"]
        else:
            no_height.append(o["path"])
        job = c.submit_job("EXTRACT_TRAITS", params, str(exp["id"]) if exp else None)
        jobs.append({"job_id": job.get("id"), "orthomosaic": o["path"], "plots": len(feats),
                     "height": bool(o.get("dsm"))})

        def update(pr, job=job):
            return pr.record_job(scope, job)

        process_tab(update)
    return {"result": {"jobs": jobs, "plots": sum(j["plots"] for j in jobs),
                       "traits": "Vegetation_Fraction, Height_95p_meters (where an elevation model exists)",
                       "no_elevation_model": no_height or None}}


def boundaries_geojson(args: dict) -> dict:
    """The active plot boundaries of a scope (what run_inference needs as `boundaries`)."""
    scope = scope_from_path(args["path"])
    if scope is None:
        raise ValueError("path must be under Raw/ or Processed/ …")
    directory = "Processed/" + "/".join(str(scope[k]) for k in ("year", "experiment", "location", "population", "date",
                                                                "platform", "sensor")) + "/"
    v = client().load_version(directory)
    feats = ((v.get("state_snapshot") or {}).get("boundaries") or {}).get("features") or []
    return {"result": {"directory": directory, "version": v.get("version"), "plots": len(feats),
                       "sample": [f["properties"] for f in feats[:3]]}}


def _field(fn, description: str, props: dict, required: list[str]) -> None:
    _tool(fn, description, props, required, track=False, group="aerial")


def field_layout(args: dict) -> dict:
    """Any field design or plot list (a table, a drawn map, several sheets or
    files): plots with tier, bed, genotype and crop, summarised per crop, and
    saved as one clean CSV the other tools take as `design_path`."""
    from .client import AGENT_DIR
    from .field_layout import crop_of, read_layout, summarize, write_csv

    paths = args.get("paths") or args.get("path")
    if not paths:
        raise ValueError("give `paths`: the field design file(s) on this computer")
    if isinstance(paths, str):
        paths = [paths]
    layout = read_layout(paths, args.get("sheet") or None)
    summary = summarize(layout)
    want = str(args.get("crop") or "").strip()
    if want:
        crop = crop_of(want) or want
        kept = [p for p in layout["plots"] if p.get("crop") == crop or str(p.get("trial", "")).lower() == want.lower()]
        if not kept:
            raise ValueError(f"no plots of {want!r}; crops here: " + ", ".join(c["crop"] for c in summary["crops"]))
        layout = {**layout, "plots": kept}
        summary = summarize(layout)
    stem = "_".join(__import__("pathlib").Path(p).stem for p in paths)[:60]
    out = write_csv(layout, AGENT_DIR / "work" / "field_layouts" / f"{stem}{'_' + want.replace(' ', '-') if want else ''}.csv")
    several = len([c for c in summary["crops"] if c["crop"] != "(no crop given)"]) > 1
    return {"result": {**summary, "saved_as": str(out),
                       "how_to_use": (
                           "Pass saved_as as `design_path` to plot_boundaries, ground_plot_boundaries or "
                           "plots_from_images. row = tier, col = bed. "
                           + ("This field has SEVERAL CROPS: a flight or a folder of rover logs over it covers more "
                              "than one. Each plot keeps its crop, so results are stored per crop (as that crop's "
                              "population) automatically. To work on one crop's beds only, call again with `crop`. "
                              if several else "")
                           + ("Plots without a position come from a plot list only: add the field map file too, "
                              "they are joined by plot number. " if summary["without_position"] else "")),
                       "tell_the_person": "; ".join(f"{c['crop']}: {c['plots']} plots on beds {c['beds'] or '?'}, "
                                                    f"tiers {c['tiers'] or '?'}" for c in summary["crops"][:6])}}


_field(field_layout, "Read field designs and plot lists in any shape breeders keep (one row per plot with any column "
       "names; a drawn field map with tiers and beds; several sheets or files joined by plot number) into plots with "
       "tier, bed, genotype and CROP. Says which crop is on which beds, so a flight or rover dump covering several "
       "crops can be sorted, and saves one clean CSV to use as design_path. `crop` keeps one crop's plots only. "
       "Given several files it also CHECKS WHETHER THEY AGREE: position_conflicts lists plots placed differently "
       "(bed_tier_swapped when one file has bed and tier the other way round). Reads files on this computer; "
       "nothing is uploaded.",
       {"paths": {"type": "array", "items": _str, "description": "the file(s) on this computer (.xlsx / .csv)"},
        "sheet": _str, "crop": {**_str, "description": "keep only this crop (or trial label)"}}, ["paths"])
# Columns that identify or place a plot, not traits measured on it.
_ID_COLUMNS = re.compile(r"^(project|year|season|location|site|loc|environment|experiment|crop|population.*|species|"
                         r"genotype|line ?id|line|entry.*|codes?|variety.*|accession|plots?|plot.*|field ?plot.*|rep.*|"
                         r"block|bed|tier|row|col|column|range|check.*|experimental|locyearcropplot|.*number|.*id|"
                         r"order.*|work ?req|.*sample.*|notes?|comments?)$", re.I)


def plot_tables(args: dict) -> dict:
    """Plot-level measurement tables (lab sheets, master tables of several
    seasons, sites and crops) split into one table per season, site and crop,
    with the traits each has; optionally uploaded as reference data to compare
    with what the pipelines measure."""
    import csv as _csv

    from .client import AGENT_DIR
    from .field_layout import _norm, _num, read_layout

    paths = args.get("paths") or args.get("path")
    if isinstance(paths, str):
        paths = [paths]
    if not paths:
        raise ValueError("give `paths`: the table file(s) on this computer")
    layout = read_layout(paths, args.get("sheet") or None, year=args.get("year"), location=args.get("location"))
    want_crop = str(args.get("crop") or "").strip().lower()
    groups: dict[tuple, list[dict]] = {}
    for p in layout["plots"]:
        if p.get("border") or not p.get("columns"):
            continue
        if want_crop and want_crop not in str(p.get("crop") or "").lower():
            continue
        groups.setdefault((p.get("year") or "", p.get("location") or "", p.get("crop") or ""), []).append(p)
    if not groups:
        raise ValueError("no plot rows with measurements" + (f" for {want_crop!r}" if want_crop else ""))
    out_dir = AGENT_DIR / "work" / "plot_tables"
    out_dir.mkdir(parents=True, exist_ok=True)
    report, uploads = [], []
    for (year, loc, crop), rows in sorted(groups.items()):
        cols: dict[str, int] = {}
        for r in rows:
            for k, v in (r.get("columns") or {}).items():
                if _num(v) is not None and not _ID_COLUMNS.match(_norm(k)):
                    cols[k] = cols.get(k, 0) + 1
        traits = [k for k, n in cols.items() if n >= max(3, len(rows) * 0.1)]
        name = "_".join(x for x in (loc, year, crop) if x).replace(" ", "-").replace("/", "-") or "table"
        out = out_dir / f"{name}.csv"
        with open(out, "w", newline="", encoding="utf-8") as f:
            w = _csv.writer(f)
            w.writerow(["plot", "row", "col", "accession", *traits])
            for r in rows:
                c = r.get("columns") or {}
                w.writerow([r.get("plot") or "", r.get("tier") if r.get("tier") is not None else "",
                            r.get("bed") if r.get("bed") is not None else "", r.get("genotype") or "",
                            *[c.get(t, "") for t in traits]])
        entry = {"season": year, "site": loc, "crop": crop, "plots": len(rows), "traits": traits[:30],
                 "more_traits": max(0, len(traits) - 30) or None, "saved_as": str(out)}
        if args.get("upload") and traits:
            from .app_tools import reference_upload

            mapping = {"plot": "plot_id", "accession": "accession", **{t: t for t in traits}}
            if any(r.get("tier") is not None for r in rows):
                mapping.update({"row": "row", "col": "col"})
            got = reference_upload({"path": str(out), "mapping": mapping, "name": f"{name} (lab / measured)",
                                    "experiment": args.get("experiment"), "location": loc or args.get("location"),
                                    "population": crop or args.get("population"), "date": args.get("date")})
            entry["uploaded"] = {k: got["result"].get(k) for k in ("id", "plot_count", "match_report")}
            uploads.append(name)
        report.append(entry)
    return {"result": {"tables": report, "groups": len(report),
                       "how_to_use": "Each table is one season, site and crop. To compare with the pipelines' "
                                     "results, upload it as reference data (upload=true with `experiment`), then "
                                     "Analyze shows both per plot. Report the match numbers of each upload.",
                       "tell_the_person": "; ".join(f"{e['site']} {e['season']} {e['crop']}: {e['plots']} plots, "
                                                    f"{len(e['traits'])} traits" for e in report[:8])}}


_field(plot_tables, "Measurement tables per plot (lab sheets like cook time or protein, master tables covering several "
       "seasons, sites and crops): which traits each season, site and crop has, one clean table per group, and with "
       "upload=true each uploaded as reference data for comparing with pipeline results. Filters: year, location, "
       "crop.", {"paths": {"type": "array", "items": _str}, "sheet": _str, "year": _str, "location": _str,
                 "crop": _str, "upload": _bool, "experiment": _str, "date": _str}, ["paths"])
_field(field_design, "Read a field design file (.xlsx / .csv) on this computer: plots, beds, tiers, bed blocks, "
       "which plot is at each corner of the design.", {"path": _str}, ["path"])
_field(plot_boundaries, "Find the plots on an orthomosaic from its vegetation (tier strips along the field, beds "
       "across), label them from the field design, and return an overlay picture. With preview=false it saves and "
       "activates them as the scope's plot boundaries (the Process tab's Plot Boundary Prep step).",
       {"orthomosaic_path": _str, "design_path": {**_str, "description": "field design file on this computer"},
        "beds": {"type": "array", "items": _int, "description": "the design's bed numbers that are on THIS "
                 "orthomosaic, west to east in the design's numbering (default: all beds)"},
        "first_tier_at": {**_str, "description": "south | north: which end of the field the lowest tier number is at"},
        "first_bed_at": {**_str, "description": "west | east: which side the lowest of these bed numbers is on"},
        "border_tiers": {**_int, "description": "unplanned strips at each end to ignore (default: worked out)"},
        "block": {**_int, "description": "0 = widest planted block (default), 1 = next widest"},
        "shrink_m": {**_num, "description": "shrink each plot by this margin on every side"},
        "border_beds": {"type": "array", "items": _int, "description": "planted beds beside the design's beds "
                        "that are not plots, [west, east] (or [north, south] when beds run east-west). Default: "
                        "worked out from the planted beds between the furrows"},
        "border_beds_at": {**_str, "description": "west | east | north | south: the side the border beds are on "
                           "(the block's outer edge, e.g. away from another treatment's block); the design's beds "
                           "then run to the planted beds' other edge"},
        "dsm_path": {**_str, "description": "elevation model for the furrows (default: ODM's odm_dsm-… beside "
                     "the orthomosaic)"},
        "bed_pitch_m": {**_num, "description": "bed spacing (centre to centre) in metres. Default: measured from "
                        "the furrows on this field's earliest date already done, else from this image"},
        "tier_shift_m": {**_num, "description": "move the tiers along the field by this many metres (+ south when "
                         "beds run north-south, + east otherwise), after checking `tier_centres` against the map"},
        "tier_pitch_m": {**_num, "description": "tier spacing along the beds (plot plus alley) in metres, from the "
                         "field map, e.g. 10 ft plots with 5 ft alleys = 4.572. Places the design's tiers at that "
                         "spacing when the strips seen do not match the design (border rows, gaps)"},
        "add_to_active": {**_bool, "description": "keep the other plots of the active version (second flight of the same field)"},
        "crops": {"type": "array", "items": _str, "description": "only the plots of these crops (a flight of one crop)"},
        "plot_length_m": {"description": "plot length without the alley, metres: one number, or per crop "
                          "{\"Sorghum\": 3.0, \"Cowpea\": 3.5} (default: worked out; boxes are the same size within a crop)"},
        "fresh": {**_bool, "description": "draw this date on its own instead of moving the earliest date's boundaries"},
        "design_plots_only": {**_bool, "description": "leave out grid positions the design lists no plot for "
                              "(e.g. a bed shorter than the others); default keeps them, labelled tier-bed"},
        "preview": _bool, "name": _str}, ["orthomosaic_path", "design_path"])


def move_boundaries(args: dict) -> dict:
    out = shift_boundaries(args)["result"]
    out.pop("_ortho", None)
    snap = out.pop("state_snapshot")
    if args.get("save"):
        scope = scope_from_path(str(args.get("orthomosaic_path") or "")) or {}
        if not scope:
            raise ValueError("save needs orthomosaic_path (under Processed/...)")
        c = client()
        directory = "Processed/" + "/".join(str(scope[k]) for k in ("year", "experiment", "location", "population",
                                                                    "date", "platform", "sensor")) + "/"
        v = c.save_version(directory, snap, args.get("name") or f"moved from {args['from_directory']}")
        c.post_json("/api/plot_geometry/versions/activate", {"directory": directory, "version": v["version"]})
        out["saved"] = {"directory": directory, "version": v["version"]}
    return {"result": out}


_field(move_boundaries, "Bring plot boundaries saved for another date of the same field onto this date's orthomosaic: "
       "the plots keep their labels, crops and genotypes; the whole set moves by how far the two maps differ "
       "(measured from the images). plot_boundaries does this by itself from the earliest date.",
       {"from_directory": {**_str, "description": "Processed/... folder of the date whose boundaries to use"},
        "from_version": _int, "orthomosaic_path": _str, "to_directory": _str,
        "crops": {"type": "array", "items": _str, "description": "only these crops' plots"},
        "align": {**_bool, "description": "measure and apply the shift (default true)"},
        "max_shift_m": _num, "save": {**_bool, "description": "save and activate for this date (default: report only)"},
        "name": _str}, ["from_directory"])
_field(split_plots, "Cut a date's orthomosaics into one image per plot using the active plot boundaries "
       "(SPLIT_ORTHOMOSAIC; needs the geo worker). path: any path in the date's folder (all its orthomosaics; "
       "with several, e.g. one per treatment, each plot from the one whose centre it is nearest), or "
       "orthomosaic_path for one. source='frames': each plot's best raw frames instead (picked by the ODM "
       "run's camera positions; needs an orthomosaic built with them kept, e.g. the Quick preset), "
       "frames_per_plot of them (default 3). With frames, the flight's other cameras uploaded for the same date "
       "and platform (a Thermal sensor) are matched by capture time and cut per plot too, and a thermal camera's "
       "°C frames give each plot's canopy temperature (trait Temp_veg_avg_C); companions: false leaves them out.",
       {"path": _str, "orthomosaic_path": _str, "source": {"type": "string", "enum": ["orthomosaic", "frames"]},
        "frames_per_plot": _num, "companions": {"type": "boolean"}}, [])
_field(extract_traits, "Per-plot traits for a date's orthomosaics and active plot boundaries (EXTRACT_TRAITS): "
       "vegetation fraction and plant height from each orthomosaic's elevation model (ODM's DSM) when present. "
       "Several orthomosaics: each plot from the nearest one. path: any path in the date's folder.",
       {"path": _str}, ["path"])
_field(boundaries_geojson, "Which plot-boundary version is active for a scope, and how many plots it has.",
       {"path": _str}, ["path"])


# ── ground (rover) plots ─────────────────────────────────────────────────────

def mock_field_design(args: dict) -> dict:
    """A stand-in field design for a rover track that has none yet: bed =
    pass, tier = position within the bed counted from one end of the field,
    placeholder genotype names. For trying the pipeline; replace it with the
    real design when there is one."""
    from .ground import Markings
    from .tools import _track

    track = _track(args)
    m = Markings(track)
    if not m.plots:
        raise ValueError("no plot markings for this track yet")
    passes = track.passes()
    genotypes = int(args.get("genotypes") or 40)
    rows = []
    for p in passes:
        mine = [pl for pl in m.plots if pl["start"] is not None and p["first"] <= pl["start"] <= p["last"]]
        mine.sort(key=lambda pl: pl["start"])
        if p["heading"] in ("South", "West"):          # tier 1 at the south/west end whatever the driving direction
            mine = mine[::-1]
        for k, pl in enumerate(mine, 1):
            rows.append({"plot": pl["plot_id"], "bed": p["pass"], "tier": k,
                         "genotype": f"MOCK-{(pl['plot_id'] * 7 + p['pass'] * 3) % genotypes + 1:03d}"})
    given = str(args.get("save_as") or "")
    # A name that is not a file to write (the word "stand-in", say) is not a place to save to.
    out = Path(given) if given.lower().endswith((".csv", ".txt")) else track.cache / "mock_field_design.csv"
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["plot", "bed", "tier", "genotype"])
        w.writeheader()
        w.writerows(rows)
    return {"result": {"file": str(out), "plots": len(rows), "beds": len({r["bed"] for r in rows}),
                       "tiers": max(r["tier"] for r in rows), "mock": True,
                       "note": "genotype names are placeholders; bed = rover pass, tier counted from the south end"}}


def ground_plot_boundaries(args: dict) -> dict:
    """Plot boundaries for a rover track from a stitch run: each stitched
    plot's georeferenced footprint, labelled from the field design. Saved and
    activated like the aerial ones (the ground run's Plot Boundary Prep)."""
    prefix = args["stitch_prefix"].rstrip("/") + "/"
    scope = scope_from_path(prefix)
    if scope is None:
        raise ValueError("stitch_prefix must be Processed/…/AgRowStitch_v{N}/")
    c = client()
    manifest = json.loads(c.download(prefix + "stitch_manifest.json"))
    # Footprints where the saved GPS placement puts them (if any).
    corrected = _placed_footprints(c, prefix, manifest)
    design = read_design(args["design_path"])
    by_plot = {str(r["_plot"]): r for r in design["rows"]}
    feats, missing = [], 0
    for pid, info in (manifest.get("plots") or {}).items():
        ring = corrected.get(str(pid)) or info.get("footprint")
        rec = by_plot.get(str(pid))
        if not ring or rec is None:
            missing += 1
            continue
        feats.append({"type": "Feature",
                      "properties": {"plot": int(pid), "row": rec["_row"], "col": rec["_col"],
                                     "accession": rec["_accession"],
                                     **({"crop": rec["_crop"]} if rec.get("_crop") else {})},
                      "geometry": {"type": "Polygon", "coordinates": [ring]}})
    if not feats:
        raise ValueError("no stitched plot matched a row of the design (do the plot numbers agree?)")
    directory = "Processed/" + "/".join(str(scope[k]) for k in ("year", "experiment", "location", "population", "date",
                                                                "platform", "sensor")) + "/"
    v = c.save_version(directory, {"boundaries": {"type": "FeatureCollection", "features": feats},
                                   "grid": {"rows": len(design["tiers"]), "cols": len(design["beds"]), "spacing_m": 0,
                                            "angle_deg": 0, "row_offset": 0, "col_offset": 0,
                                            "fill_pattern": "row-major"},
                                   "created_from": "grid",
                                   "field_design": {"source": Path(args["design_path"]).name, "by": "agent"}},
                       args.get("name") or f"agent: {len(feats)} stitched plots")
    c.post_json("/api/plot_geometry/versions/activate", {"directory": directory, "version": v["version"]})

    def update(pr):
        run = pr.ensure_run(scope, "ground")
        pr.set_step(run, "plot_boundary_prep", "completed",
                    outputs={"activeVersion": v["version"], "activeVersionName": v.get("name")})
        return pr.describe(run)

    return {"result": {"plots": len(feats), "not_matched": missing, "version": v["version"], "directory": directory,
                       "process_tab": process_tab(update)}}


def _saved_placement(c, prefix: str) -> dict:
    """The active GPS placement saved for a stitch version, or {}."""
    from . import placement

    try:
        return (c.load_version(placement.directory(prefix)).get("state_snapshot") or {})
    except Exception:
        return {}


def _placed_footprints(c, prefix: str, manifest: dict) -> dict:
    from . import placement

    saved = _saved_placement(c, prefix)
    rings = {str(k): v["footprint"] for k, v in (manifest.get("plots") or {}).items() if v.get("footprint")}
    if not saved:
        return rings
    return placement.apply(rings, {**saved, "plot_bed": placement.beds_of(manifest.get("plots") or {})})[0]


def gps_placement(args: dict) -> dict:
    """Correct where a stitch version's plots sit when the rover's GPS is off:
    shift everything, or one bed (straighten, rotate, shift). Saves a new
    placement version that Associate uses; the app's Plot Boundary map shows
    the same thing. Without changes, reports the beds and current placement."""
    from . import placement

    prefix = args["stitch_prefix"].rstrip("/") + "/"
    c = client()
    manifest = json.loads(c.download(prefix + "stitch_manifest.json"))
    beds = placement.beds_of(manifest.get("plots") or {})
    names = sorted(set(beds.values()))
    current = _saved_placement(c, prefix)
    changes = {k: args[k] for k in ("shift_m", "bed", "bed_shift_m", "rotate_deg", "straighten") if args.get(k) is not None}
    if not changes:
        return {"result": {"beds": {b: sum(1 for v in beds.values() if v == b) for b in names},
                           "placement": {k: v for k, v in current.items() if k != "plot_bed"}}}
    new = {**current}
    if "shift_m" in changes:
        new["shift_m"] = [float(x) for x in changes["shift_m"]][:2]
    if any(k in changes for k in ("bed_shift_m", "rotate_deg", "straighten")):
        bed = changes.get("bed")
        if bed not in names:
            raise ValueError(f"bed must be one of: {', '.join(names)}")
        spec = dict((new.get("beds") or {}).get(bed) or {})
        if "bed_shift_m" in changes:
            spec["shift_m"] = [float(x) for x in changes["bed_shift_m"]][:2]
        if "rotate_deg" in changes:
            spec["rotate_deg"] = float(changes["rotate_deg"])
        if "straighten" in changes:
            spec["straighten"] = bool(changes["straighten"])
        new["beds"] = {**(new.get("beds") or {}), bed: spec}
    new["plot_bed"] = beds
    saved = c.save_version(placement.directory(prefix), new, "GPS placement (agent)", None)
    return {"result": {"saved_version": saved.get("version"),
                       "placement": {k: v for k, v in new.items() if k != "plot_bed"},
                       "note": "Associate (associate_plots) applies this; ground_plot_boundaries uses it too."}}


def associate_plots(args: dict) -> dict:
    """ASSOCIATE_BOUNDARIES: file each stitched plot mosaic under its plot
    (PlotImages/plot_{n}_accession_{a}.png), using the active boundaries."""
    prefix = args["stitch_prefix"].rstrip("/") + "/"
    scope = scope_from_path(prefix)
    if scope is None:
        raise ValueError("stitch_prefix must be Processed/…/AgRowStitch_v{N}/")
    c = client()
    directory = "Processed/" + "/".join(str(scope[k]) for k in ("year", "experiment", "location", "population", "date",
                                                                "platform", "sensor")) + "/"
    v = c.load_version(directory)
    boundaries = (v.get("state_snapshot") or {}).get("boundaries") or {}
    if not boundaries.get("features"):
        raise ValueError("no active plot boundaries: run ground_plot_boundaries first")
    exp = next((e for e in c.entities("experiments") if e.get("experiment_name") == scope["experiment"]), None)
    params = {"stitch_prefix": prefix, "boundaries": boundaries, "plot_images_prefix": directory + "PlotImages/",
              "boundary_version": v.get("version")}
    placement_saved = _saved_placement(c, prefix)
    if placement_saved:
        params["corrections"] = placement_saved
    job = c.submit_job("ASSOCIATE_BOUNDARIES", params, str(exp["id"]) if exp else None)

    def update(pr):
        return pr.record_job(scope, job, kind="ground")

    return {"result": {"job_id": job.get("id"), "status": job.get("status"), "plots": len(boundaries["features"]),
                       "output": directory + "PlotImages/", "process_tab": process_tab(update)}}


_tool(mock_field_design, "Write a stand-in field design (CSV) for a rover track that has none: bed = pass, tier = "
      "position in the bed, placeholder genotypes. For trying the pipeline only.",
      {"genotypes": _int, "save_as": _str}, [], track=True, group="ground")
_tool(ground_plot_boundaries, "Rover: make plot boundaries from a stitch run's georeferenced plot footprints, labelled "
      "from a field design; saves and activates them (the ground run's Plot Boundary Prep).",
      {"stitch_prefix": _str, "design_path": _str, "name": _str}, ["stitch_prefix", "design_path"],
      track=False, group="ground")
_tool(gps_placement, "Rover: correct where a stitch version's plots sit when GPS is off, saved for Associate and the "
      "app's Plot Boundary map. shift_m [east, north] moves everything; bed + bed_shift_m / rotate_deg (clockwise) "
      "/ straighten fix one bed (one lane of one pass). No changes: lists the beds and the current placement.",
      {"stitch_prefix": _str, "shift_m": {"type": "array", "items": {"type": "number"}}, "bed": _str,
       "bed_shift_m": {"type": "array", "items": {"type": "number"}}, "rotate_deg": {"type": "number"},
       "straighten": _bool}, ["stitch_prefix"], track=False, group="ground")
_tool(associate_plots, "Rover: file each stitched mosaic under its plot using the active boundaries "
      "(ASSOCIATE_BOUNDARIES; needs the stitch worker). Output: …/PlotImages/.",
      {"stitch_prefix": _str}, ["stitch_prefix"], track=False, group="ground")
