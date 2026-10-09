"""Slit-scan panorama of one pass: the whole row in one picture.

Each frame contributes the strip of ground that newly entered the view since
the previous frame, so a pass of hundreds of frames becomes one long image
(wrapped into rows) on which plots, gaps and stakes are visible at a glance.
The x axis is ground position in pixels ("ground x"); `frame_at` converts a
ground x to the frame in which that spot sits at the entry edge, the centre
or the exit edge of the image.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Optional

import numpy as np

from .ground import Track, _label


def _gray(img, width: int) -> np.ndarray:
    small = img.resize((width, max(1, round(img.height * width / img.width))))
    return np.log1p(np.asarray(small.convert("L"), dtype=np.float32))


def estimate_shifts(grays: list[np.ndarray], gps_step_m: np.ndarray,
                    max_frac: float = 0.3) -> tuple[np.ndarray, bool]:
    """Ground motion along the image x axis between consecutive frames, in
    pixels of the given arrays (positive = scene moves right).

    Image correlation alone is not enough: the rig's shadow and the
    operator's boots are fixed in the image and pin it to zero motion over
    bare soil. So an expected shift is worked out first and the correlation
    only refines it within a narrow window. Also returns whether GPS was
    usable for that expectation.
    """
    stack = np.stack(grays)
    flat = stack - np.median(stack[:: max(1, len(grays) // 60)], axis=0)
    flat -= flat.mean(axis=(1, 2), keepdims=True)
    h, w = flat.shape[1:]
    win = np.outer(np.hanning(h), np.hanning(w)).astype(np.float32)
    F = np.fft.rfft2(flat * win)
    max_dx = max(3, int(w * max_frac))
    n = len(grays)
    curves = np.zeros((n, 2 * max_dx + 1), dtype=np.float32)
    for i in range(1, n):
        cross = F[i] * np.conj(F[i - 1])
        corr = np.fft.irfft2(cross / (np.abs(cross) + 1e-6), s=(h, w))
        band = np.concatenate([corr[-2:], corr[:3]], axis=0)  # dy in -2..2
        curves[i] = np.concatenate([band[:, -max_dx:], band[:, : max_dx + 1]], axis=1).max(axis=0)
    dx = np.arange(-max_dx, max_dx + 1)
    # Best non-zero lag per frame, and how far its peak stands out.
    nz = np.abs(dx) >= 2
    raw = np.array([dx[nz][np.argmax(c[nz])] for c in curves], dtype=np.float32)
    strength = np.array([c[nz].max() / (np.median(np.abs(c)) + 1e-9) for c in curves])
    sure = strength > 6
    sure[0] = False
    if sure.sum() < 5:
        sure = strength >= np.percentile(strength[1:], 50)
        sure[0] = False
    sign = 1.0 if np.median(raw[sure]) >= 0 else -1.0
    mag = raw * sign
    sure &= mag > 0

    # Expected shift per frame. GPS, when it tracks the image motion on the
    # frames that matched clearly; otherwise (rover GPS is unreliable on some
    # passes) the running median of those clear matches, i.e. steady travel.
    idx = np.arange(n)
    steady = np.interp(idx, idx[sure], mag[sure]) if sure.any() else np.zeros(n)
    k = 15
    padded = np.pad(steady, k, mode="edge")
    steady = np.array([np.median(padded[i : i + 2 * k + 1]) for i in range(n)])
    gps_ok = False
    pred = steady
    moving = sure & (gps_step_m > 0.03)
    if moving.sum() >= max(10, 0.5 * sure.sum()):
        scale = float(np.median(mag[moving] / gps_step_m[moving]))
        gps_pred = gps_step_m * scale
        err = np.abs(gps_pred[sure] - mag[sure]) / np.maximum(mag[sure], 1.0)
        gps_ok = bool(np.median(err) < 0.2 and np.percentile(err, 90) < 0.6)
        if gps_ok:
            pred = gps_pred
    out = np.zeros(n, dtype=np.float32)
    for i in range(1, n):
        if pred[i] < 1.5:
            out[i] = pred[i]
            continue
        tol = max(2.0, 0.3 * pred[i])
        ok = np.abs(dx * sign - pred[i]) <= tol
        c = curves[i]
        best = int(np.argmax(np.where(ok, c, -np.inf)))
        # A weak peak (no texture) -> keep the expected shift.
        out[i] = dx[best] * sign if c[best] > 3 * np.median(np.abs(c)) else pred[i]
    return out * sign, gps_ok


class Panorama:
    def __init__(self, track: Track, first: int, last: int, size: int = 480):
        self.track, self.first, self.last, self.size = track, first, last, size
        self.meta_path = track.cache / "views" / f"pano_{first:06d}_{last:06d}_{size}.json"
        self.meta_path.parent.mkdir(exist_ok=True)
        self.raw_path = self.meta_path.with_suffix(".jpg")
        if not (self.meta_path.exists() and self.raw_path.exists()):
            self._build()
        m = json.loads(self.meta_path.read_text())
        self.shifts = np.array(m["shifts"], dtype=np.float32)
        self.width, self.height, self.total = m["width"], m["height"], m["total"]
        # True when the scene moves right in the frames (camera moves left).
        self.scene_moves_right = bool(m["scene_moves_right"])
        # False: this pass's GPS did not match the image motion and was ignored.
        self.gps_ok = bool(m.get("gps_ok", True))
        # Ground x of each frame's image centre.
        self.centre = np.cumsum(np.abs(self.shifts)) + self.width / 2

    @property
    def camera_direction(self) -> str:
        """Camera movement relative to the image: AgRowStitch's stitching direction."""
        return "left" if self.scene_moves_right else "right"

    def _build(self) -> None:
        from PIL import Image

        indices = list(range(self.first, self.last + 1))
        imgs = self.track.thumbs(indices, self.size)
        width, height = imgs[0].size
        gw = 160
        shifts, gps_ok = estimate_shifts([_gray(im, gw) for im in imgs], self._gps_steps())
        shifts = shifts * (width / gw)
        mag = np.abs(shifts)
        right = float(np.median(shifts[1:])) >= 0
        total = int(math.ceil(mag.sum())) + width
        pano = Image.new("RGB", (total, height))
        # Ground x grows in the direction of travel. Frames are mirrored when
        # the scene moves right, so travel always reads left-to-right and the
        # frame's entry edge (where new ground appears) is on its right.
        # Each frame contributes one narrow strip; the next frame covers the
        # rest. The strip is taken where the rig's own shadow (the part of
        # the picture that never changes) is weakest, so the panorama shows
        # sunlit ground instead of a comb of shadow stripes.
        frames = [im.transpose(Image.FLIP_LEFT_RIGHT) if right else im for im in imgs]
        sample = np.stack([np.asarray(f.convert("L"), dtype=np.float32) for f in frames[:: max(1, len(frames) // 40)]])
        static = np.median(sample, axis=0)[: height // 2]          # upper half: the bed in a top-down rig
        strip_w = int(np.percentile(mag, 95)) + 2
        cols = static.mean(axis=0)
        windows = np.convolve(cols, np.ones(strip_w) / strip_w, mode="valid")
        slit = int(np.argmax(windows[: max(1, width - strip_w)]))
        x = 0.0
        for n, (frame, d) in enumerate(zip(frames, mag)):
            x += float(d)
            if n == 0:
                pano.paste(frame, (int(round(x)), 0))
            else:
                pano.paste(frame.crop((slit, 0, width, height)), (int(round(x)) + slit, 0))
        pano.save(self.raw_path, quality=90)
        self.meta_path.write_text(json.dumps({
            "first": self.first, "last": self.last, "width": width, "height": height, "total": total,
            "scene_moves_right": right, "gps_ok": gps_ok, "shifts": [round(float(v), 2) for v in shifts],
        }))

    def bed_half(self) -> int:
        """0 if the crop bed is in the upper half of the frame, 1 if in the
        lower half: the half with more green (plants and weeds grow on the
        bed, not in the wheel path)."""
        from PIL import Image

        a = np.asarray(Image.open(self.raw_path), dtype=np.float32) / 255.0
        exg = (2 * a[..., 1] - a[..., 0] - a[..., 2]) / (a.sum(axis=2) + 1e-6)
        green = (exg > 0.06) & (a[..., 1] > 0.12)
        h = self.height // 2
        return int(green[h:].sum() > green[:h].sum())

    def render(self, band: tuple[float, float] = (0.0, 1.0), zoom: float = 1.0,
               row_px: int = 1900, x0: int = 0, x1: int = 0,
               marks: list[tuple[int, str]] | None = None) -> Path:
        """The panorama (or its x0..x1 part) wrapped into rows, with a ground-x
        ruler above each row. `band` keeps only a horizontal slice of the
        frame height (e.g. the crop bed), `zoom` enlarges it; `marks` draws
        labelled vertical lines at ground x positions."""
        from PIL import Image, ImageDraw

        raw = Image.open(self.raw_path)
        x1 = x1 or self.total
        top, bottom = int(self.height * band[0]), int(self.height * band[1])
        strip = raw.crop((x0, top, x1, bottom))
        if zoom != 1.0:
            strip = strip.resize((round(strip.width * zoom), round(strip.height * zoom)))
        per_row = int(row_px / zoom)            # ground px per row
        rows = math.ceil((x1 - x0) / per_row)
        tick_h = 22
        sheet = Image.new("RGB", (row_px, rows * (strip.height + tick_h)), (0, 0, 0))
        d = ImageDraw.Draw(sheet)
        for r in range(rows):
            y = r * (strip.height + tick_h)
            a = r * per_row
            sheet.paste(strip.crop((round(a * zoom), 0, round(min(x1 - x0, a + per_row) * zoom), strip.height)),
                        (0, y + tick_h))
            g0 = x0 + a
            for gx in range((g0 // 100 + 1) * 100, min(x1, g0 + per_row), 100):
                px = round((gx - g0) * zoom)
                d.line((px, y + tick_h - 6, px, y + tick_h), fill=(255, 255, 0))
                if gx % 200 == 0:
                    d.text((px + 2, y + 2), str(gx), fill=(255, 255, 0))
            for gx, text in marks or []:
                if g0 <= gx < g0 + per_row:
                    px = round((gx - g0) * zoom)
                    d.line((px, y + tick_h, px, y + tick_h + strip.height), fill=(255, 0, 255), width=2)
                    d.text((px + 3, y + tick_h + 2), text, fill=(255, 0, 255))
        out = self.meta_path.with_name(
            f"pano_{self.first:06d}_x{x0}_{x1}_b{int(band[0]*100)}_{int(band[1]*100)}_z{int(zoom*100)}"
            f"{'_m' if marks else ''}.png")
        sheet.save(out)
        return out

    def _gps_steps(self) -> np.ndarray:
        """Metres travelled between consecutive frames, smoothed."""
        fs = self.track.frames[self.first : self.last + 1]
        lat = np.array([f.lat if f.lat is not None else np.nan for f in fs])
        lon = np.array([f.lon if f.lon is not None else np.nan for f in fs])
        if np.isnan(lat).all():
            return np.zeros(len(fs), dtype=np.float32)
        k = 111_320.0
        y = (lat - np.nanmean(lat)) * k
        x = (lon - np.nanmean(lon)) * k * math.cos(math.radians(float(np.nanmean(lat))))
        idx = np.arange(len(fs))
        good = ~np.isnan(x)
        x, y = np.interp(idx, idx[good], x[good]), np.interp(idx, idx[good], y[good])
        kernel = np.ones(15) / 15
        pad = lambda a: np.convolve(np.pad(a, 7, mode="edge"), kernel, mode="valid")
        x, y = pad(x), pad(y)
        step = np.hypot(np.diff(x, prepend=x[0]), np.diff(y, prepend=y[0]))
        return step.astype(np.float32)

    def frame_at(self, ground_x: float, where: str) -> int:
        """Frame in which ground_x sits at the image's 'entry' edge (just came
        into view), 'centre', or 'exit' edge (about to leave)."""
        offset = {"entry": self.width / 2, "centre": 0.0, "exit": -self.width / 2}[where]
        # centre[f] is the ground x at frame f's centre; the entry edge is
        # half a width ahead of it, the exit edge half a width behind.
        target = ground_x - offset
        i = int(np.argmin(np.abs(self.centre - target)))
        return self.first + i


# ── plot boundaries from the panorama ───────────────────────────────────────

def detect_stakes(pano: Panorama, band: tuple[float, float] = (0.0, 0.5)) -> list[dict]:
    """Ground x of plot stakes: tan/yellow wood stands out from grey-brown
    soil as warm, bright pixels. Detections are then fitted to the regular
    plot spacing, and stakes the colour test missed are filled in as
    `inferred` — those are the ones to check by eye."""
    from PIL import Image

    a = np.asarray(Image.open(pano.raw_path)).astype(np.float32)
    a = a[int(pano.height * band[0]) : int(pano.height * band[1])]
    # The colour test below is tuned for a bed of medium brightness; a bed
    # lying in the rig's shadow is brought up to that first.
    gain = float(np.clip(119.0 / (np.median(a.mean(axis=2)) + 1e-6), 1.0, 4.0))
    a = np.clip(a * gain, 0, 255)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    warm = ((r - b) > 40) & (r > 150) & (g > 110)
    col = np.convolve(warm.sum(axis=0), np.ones(30), mode="same")
    found: list[float] = []
    x = 0
    while x < len(col):
        if col[x] > 60:
            x2 = x
            while x2 < len(col) and col[x2] > 60:
                x2 += 1
            found.append((x + x2) / 2)
            x = x2
        x += 1
    if len(found) < 3:
        return [{"x": int(v), "inferred": False} for v in found]
    gaps = np.diff(found)
    spacing = float(np.median(gaps[gaps < 1.5 * np.median(gaps)]))
    if len(found) < 6 or spacing < 0.5 * pano.width:
        # Not a row of stakes (soil in full sun passes the colour test in
        # patches): no proposal is better than a made-up one. Read two stakes
        # off the panorama and use grid_boundaries instead.
        return []
    out = [{"x": int(found[0]), "inferred": False}]
    for prev, cur in zip(found, found[1:]):
        n = max(1, round((cur - prev) / spacing))
        for k in range(1, n):
            out.append({"x": int(prev + (cur - prev) * k / n), "inferred": True})
        out.append({"x": int(cur), "inferred": False})
    # Outwards to both ends of the pass, while a whole plot still fits; a
    # recording that starts or stops inside a plot keeps it if most of it
    # (60 %) was captured. Whether those end stretches are plots, borders or
    # headland cannot be seen from spacing alone — they need a look.
    lo, hi = 0.0, float(pano.total - 1)
    x = found[0] - spacing
    while x >= lo:
        out.insert(0, {"x": int(x), "inferred": True})
        x -= spacing
    if out[0]["x"] - lo >= 0.6 * spacing:
        out.insert(0, {"x": int(lo), "inferred": True})
    x = found[-1] + spacing
    while x <= hi:
        out.append({"x": int(x), "inferred": True})
        x += spacing
    if hi - out[-1]["x"] >= 0.6 * spacing:
        out.append({"x": int(hi), "inferred": True})
    return out


def plant_extent(pano: Panorama, x0: int, x1: int, band: tuple[float, float] = (0.0, 0.5)) -> tuple[int, int] | None:
    """Ground x of the first and last green (plant) pixels between x0 and x1,
    or None when the stretch has no clear vegetation."""
    from PIL import Image

    a = np.asarray(Image.open(pano.raw_path).crop(
        (x0, int(pano.height * band[0]), x1, int(pano.height * band[1]))), dtype=np.float32) / 255.0
    s = a.sum(axis=2) + 1e-6
    exg = (2 * a[..., 1] - a[..., 0] - a[..., 2]) / s
    green = (exg > 0.08) & (a[..., 1] > 0.25)
    cols = np.convolve(green.sum(axis=0), np.ones(9), mode="same")
    xs = np.where(cols >= 12)[0]
    if len(xs) < 15:
        return None
    return x0 + int(xs[0]), x0 + int(xs[-1])


def planted_side(pano: Panorama, xs: list[int], band: tuple[float, float] = (0.0, 0.5)) -> str:
    """Whether the plants of each stake-to-stake stretch sit in its first half
    ("start", right after the stake in travel order) or its second ("end"):
    the half with more green over the whole pass."""
    from PIL import Image

    a = np.asarray(Image.open(pano.raw_path), dtype=np.float32) / 255.0
    a = a[int(pano.height * band[0]) : int(pano.height * band[1])]
    exg = (2 * a[..., 1] - a[..., 0] - a[..., 2]) / (a.sum(axis=2) + 1e-6)
    col = ((exg > 0.06) & (a[..., 1] > 0.12)).sum(axis=0)
    first = second = 0
    xs = sorted(xs)
    for lo, hi in zip(xs, xs[1:]):
        mid = (lo + hi) // 2
        first += int(col[lo:mid].sum())
        second += int(col[mid:hi].sum())
    return "start" if first >= second else "end"


def plots_from_boundaries(pano: Panorama, xs: list[int], tight: bool = False, min_frames: int = 4,
                          end_margin: int = 20, planted_fraction: float = 1.0, planted_at: str = "start",
                          pad: int = 30) -> list[dict]:
    """One plot between each pair of consecutive boundaries (stakes).

    The start frame is the one in which the plot's first ground is at the
    exit edge of the image (about to leave); the end frame the one in which
    its last ground is at the entry edge (just came into view) — so the
    frames in between cover the plot and nothing of its neighbours. With
    `tight`, the first and last *plants* are used instead of the stakes
    wherever plants are detected.
    """
    out = []
    xs = sorted(xs)
    for a, b in zip(xs, xs[1:]):
        lo, hi, basis = a, b, "stakes"
        if planted_fraction < 1.0:
            # Only the planted part of the stretch: the rest is bare alley,
            # which adds nothing and stitches badly.
            length = int((b - a) * planted_fraction)
            lo, hi = (a - pad, a + length + pad) if planted_at == "start" else (b - length - pad, b + pad)
            lo, hi, basis = max(0, lo), min(pano.total - 1, hi), f"planted {planted_at}"
        if tight:
            ext = plant_extent(pano, a + 25, b - 25)
            if ext:
                lo, hi, basis = max(a, ext[0] - 15), min(b, ext[1] + 15), "plants"
        # The end stops `end_margin` px short of the boundary: the next
        # plot's first plant can stand right behind the stake.
        margin = end_margin if planted_fraction >= 1.0 else 0
        start, end = pano.frame_at(lo, "exit"), pano.frame_at(hi - margin, "entry")
        if end - start + 1 < min_frames:      # shorter than the view: centre a minimal run on it
            mid = pano.frame_at((lo + hi) / 2, "centre")
            start, end = mid - min_frames // 2, mid + (min_frames - 1) // 2
        out.append({"x0": a, "x1": b, "start": max(pano.first, start), "end": min(pano.last, end), "basis": basis})
    return out


def stake_score(pano: Panorama, band: tuple[float, float] = (0.0, 0.5)) -> np.ndarray:
    """Per ground-x column: how stake-like it is (warmer and brighter than the
    soil around it). Weaker than detect_stakes' test, so it also responds to
    stakes in full sun; used to snap an approximate position onto the stake."""
    from PIL import Image

    a = np.asarray(Image.open(pano.raw_path)).astype(np.float32)
    a = a[int(pano.height * band[0]) : int(pano.height * band[1])]
    warm, bright = a[..., 0] - a[..., 2], a.mean(axis=2)
    k = 301

    def local_mean(x: np.ndarray) -> np.ndarray:
        c = np.cumsum(np.pad(x, ((0, 0), (k // 2 + 1, k // 2)), mode="edge"), axis=1)
        return (c[:, k:] - c[:, :-k]) / k

    wa, ba = warm - local_mean(warm), bright - local_mean(bright)
    sw, sb = np.median(np.abs(wa)) * 1.48 + 1e-6, np.median(np.abs(ba)) * 1.48 + 1e-6
    hit = (wa > 2.2 * sw) & (ba > 1.2 * sb)
    return np.convolve(hit.sum(axis=0).astype(np.float32), np.ones(31), mode="same")


def grid_boundaries(pano: Panorama, x_first: int, x_last: int, intervals: int, before: int = 0,
                    after: int = 0, snap: int = 45, band: tuple[float, float] = (0.0, 0.5)) -> list[dict]:
    """Boundaries from two stakes read off the panorama and the number of
    plots between them: evenly spaced, then each moved onto the strongest
    stake response within `snap` px (the spacing is only roughly even).
    `before` / `after` add that many boundaries outside the two anchors."""
    score = stake_score(pano, band)
    step = (x_last - x_first) / intervals
    floor = float(np.percentile(score, 90))
    out = []
    for i in range(-before, intervals + after + 1):
        x = int(round(x_first + i * step))
        if not 0 <= x < pano.total:
            continue
        if i in (0, intervals):
            out.append({"x": x, "inferred": False})
            continue
        lo, hi = max(0, x - snap), min(len(score), x + snap + 1)
        j = lo + int(np.argmax(score[lo:hi]))
        found = score[j] > max(floor, 20.0)
        out.append({"x": j if found else x, "inferred": not found})
    return out


def lattice_boundaries(pano: Panorama, spacing_range: tuple[int, int],
                       band: tuple[float, float] = (0.0, 0.5), snap: int = 30) -> list[dict]:
    """Proposal for passes where single stakes are too faint to detect: the
    evenly spaced row of positions (spacing within `spacing_range`, known
    from other beds) that collects the most stake response, each then moved
    onto its local maximum. It gets the positions right but not the extent —
    lines continue over borders and headland — so all are returned as
    inferred and the caller has to say which are real stakes."""
    score = stake_score(pano, band)
    n = len(score)
    pad = np.pad(score, snap)
    local = np.max(np.stack([pad[i : i + n] for i in range(0, 2 * snap + 1, 2)]), axis=0)
    local = np.minimum(local, np.percentile(score, 99.7))   # one bright patch must not decide it
    best = (-1.0, 0, 0)
    for sp in range(spacing_range[0], spacing_range[1] + 1, 3):
        for x0 in range(0, sp, 6):
            v = float(local[np.arange(x0, n, sp)].mean())
            if v > best[0]:
                best = (v, x0, sp)
    _, x0, sp = best
    out = []
    for x in range(x0, n, sp):
        lo = max(0, x - snap)
        out.append({"x": lo + int(np.argmax(score[lo : x + snap + 1])), "inferred": True})
    return out


# ── carrying boundaries from bed to bed by GPS ──────────────────────────────

def along_track_m(track: Track) -> np.ndarray:
    """Each frame's position along the field's row direction, in metres. The
    row direction is the one the rover drives within a pass (median over the
    passes), not the main axis of all points — a field can be wider than its
    rows are long. NaN where a frame has no fix."""
    lat = np.array([f.lat if f.lat is not None else np.nan for f in track.frames])
    lon = np.array([f.lon if f.lon is not None else np.nan for f in track.frames])
    y = (lat - np.nanmean(lat)) * 111_320.0
    x = (lon - np.nanmean(lon)) * 111_320.0 * math.cos(math.radians(float(np.nanmean(lat))))
    dirs = []
    for p in track.passes():
        a, b = p["first"], p["last"]
        q = max(1, (b - a) // 10)                     # skip the ends, where the rover turns
        d = np.array([np.nanmedian(x[b - 2 * q : b - q]) - np.nanmedian(x[a + q : a + 2 * q]),
                      np.nanmedian(y[b - 2 * q : b - q]) - np.nanmedian(y[a + q : a + 2 * q])])
        n = float(np.hypot(*d))
        if n > 1.0:
            d = d / n
            ref = dirs[0] if dirs else d
            dirs.append(d if float(d @ ref) >= 0 else -d)
    axis = np.median(np.array(dirs), axis=0) if dirs else np.array([0.0, 1.0])
    axis = axis / (np.hypot(*axis) + 1e-9)
    return x * axis[0] + y * axis[1]


def boundary_positions_m(pano: Panorama, xs: list[int], t: np.ndarray) -> list[float]:
    """Along-track position (m) of ground x values: where the rover was when
    each was at the centre of the image."""
    return [float(t[pano.frame_at(x, "centre")]) for x in xs]


def texture_edge(pano: Panorama, band: tuple[float, float] = (0.0, 0.5), half: int = 100) -> np.ndarray:
    """Per ground x: change in soil roughness across it (roughness of the
    `half` px after minus the `half` px before). Planted stretches are rough
    (tilled, plants, shadows), alleys smooth, so plot ends show as strong
    positive or negative steps even where a stake is too faint to see."""
    from PIL import Image

    a = np.asarray(Image.open(pano.raw_path).convert("L"), dtype=np.float32)
    a = a[int(pano.height * band[0]) : int(pano.height * band[1])]
    rough = np.abs(np.diff(a, axis=0)).mean(axis=0)       # vertical gradient: blind to the panorama's strip seams
    c = np.cumsum(np.concatenate([[0.0], rough]))
    n = len(rough)
    x = np.arange(half, n - half)
    d = np.zeros(n, dtype=np.float32)
    d[x] = (c[x + half] - c[x]) / half - (c[x] - c[x - half]) / half
    return d / (float(np.std(d)) + 1e-6)


def paint_score(pano: Panorama, band: tuple[float, float] = (0.0, 0.5)) -> np.ndarray:
    """Per ground-x column: amount of near-white, clearly-brighter-than-the-
    soil pixels. Plot stakes are often set with a dab or a line of marking
    paint, which shows up in full sun where the stake itself does not."""
    from PIL import Image

    a = np.asarray(Image.open(pano.raw_path)).astype(np.float32)
    a = a[int(pano.height * band[0]) : int(pano.height * band[1])]
    bright, sat = a.mean(axis=2), a.max(axis=2) - a.min(axis=2)
    k = 201
    c = np.cumsum(np.pad(bright, ((0, 0), (k // 2 + 1, k // 2)), mode="edge"), axis=1)
    rel = bright - (c[:, k:] - c[:, :-k]) / k
    hit = (rel > 1.6 * (float(np.std(rel)) + 1e-6)) & (sat < 0.16 * bright + 8)
    return np.convolve(hit.sum(axis=0).astype(np.float32), np.ones(21), mode="same")


def boundaries_from_positions(pano: Panorama, positions_m: list[float], t: np.ndarray,
                              band: tuple[float, float], reach: int = 160) -> list[dict]:
    """Boundaries of this pass at given along-track positions (taken from
    beds already marked — plots line up across beds).

    GPS puts them within a few decimetres; the error changes only slowly
    along a pass. So: every boundary with a clear paint mark within `reach`
    px is moved onto it; those tell how far off GPS is at that point of the
    pass, and the boundaries without a mark are shifted by the offset of
    their marked neighbours. `inferred` is set on the latter. Positions the
    pass never reached are skipped.
    """
    seg = t[pano.first : pano.last + 1]
    if np.isnan(seg).all():
        return []
    idx = np.arange(len(seg))
    good = ~np.isnan(seg)
    seg = np.interp(idx, idx[good], seg[good])
    k = 15
    seg = np.convolve(np.pad(seg, k, mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), mode="valid")
    lo_t, hi_t = float(seg.min()), float(seg.max())
    guess = [int(pano.centre[int(np.argmin(np.abs(seg - pos)))]) for pos in positions_m if lo_t <= pos <= hi_t]
    guess.sort()
    paint = paint_score(pano, band)
    floor = 3 * float(np.median(paint)) + 15
    offsets: list[Optional[float]] = []
    for x in guess:
        a, b = max(0, x - reach), min(len(paint), x + reach + 1)
        j = a + int(np.argmax(paint[a:b]))
        offsets.append(float(j - x) if paint[j] > floor else None)
    # A mark that disagrees with its marked neighbours is something else
    # that is white (a stone, a label): drop it.
    known = [(i, o) for i, o in enumerate(offsets) if o is not None]
    for n, (i, o) in enumerate(known):
        near = [v for m, (_, v) in enumerate(known) if m != n and abs(m - n) <= 2]
        if near and abs(o - float(np.median(near))) > 40:
            offsets[i] = None
    known = [(i, o) for i, o in enumerate(offsets) if o is not None]
    out = []
    for i, x in enumerate(guess):
        if offsets[i] is not None:
            out.append({"x": int(x + offsets[i]), "inferred": False})
        elif known:
            shift = float(np.interp(i, [k_ for k_, _ in known], [o for _, o in known]))
            out.append({"x": int(x + shift), "inferred": True})
        else:
            out.append({"x": x, "inferred": True})
    return out


def boundary_sheet(pano: Panorama, xs: list[int], band: tuple[float, float], reach: int = 150,
                   zoom: float = 1.6, columns: int = 4) -> Path:
    """Close-ups of the ground around each boundary, one tile per boundary,
    for placing it exactly. Each tile spans `reach` px either side; the
    ruler on top is the offset from the current position (0 = where the
    boundary is now), so a correction is read off directly: a stake under
    "+60" means shift that boundary by +60."""
    from PIL import Image, ImageDraw

    raw = Image.open(pano.raw_path)
    top, bottom = int(pano.height * band[0]), int(pano.height * band[1])
    tw, th, head = int(2 * reach * zoom), int((bottom - top) * zoom), 20
    rows = math.ceil(len(xs) / columns)
    sheet = Image.new("RGB", (columns * (tw + 6), rows * (th + head + 6)), (0, 0, 0))
    d = ImageDraw.Draw(sheet)
    for n, x in enumerate(xs):
        tile = Image.new("RGB", (2 * reach, bottom - top))
        a, b = max(0, x - reach), min(pano.total, x + reach)
        tile.paste(raw.crop((a, top, b, bottom)), (a - (x - reach), 0))
        tile = tile.resize((tw, th))
        ox, oy = (n % columns) * (tw + 6), (n // columns) * (th + head + 6)
        sheet.paste(tile, (ox, oy + head))
        for off in range(-reach + reach % 50, reach, 50):
            px = ox + int((off + reach) * zoom)
            d.line((px, oy + head - 5, px, oy + head), fill=(255, 255, 0))
            if off % 100 == 0 and off:
                d.text((px - 12, oy + 3), f"{off:+d}", fill=(255, 255, 0))
        cx = ox + int(reach * zoom)
        d.line((cx, oy + head - 8, cx, oy + head + 10), fill=(255, 0, 255), width=2)
        d.line((cx, oy + head + th - 10, cx, oy + head + th), fill=(255, 0, 255), width=2)
        d.rectangle((ox, oy, ox + 62, oy + head - 2), fill=(0, 0, 0))
        d.text((ox + 3, oy + 3), f"#{n} x{x}", fill=(255, 0, 255))
    out = pano.meta_path.with_name(f"pano_{pano.first:06d}_boundaries.png")
    sheet.save(out)
    return out


def boundary_tile(pano: Panorama, x: int, index: int, band: tuple[float, float], reach: int = 160,
                  zoom: int = 5) -> Path:
    """One boundary, large: the ground `reach` px either side of x, with an
    offset ruler on top and guide lines every 50 px. Reading one of these at
    a time is far more accurate for a vision model than a sheet of many."""
    from PIL import Image, ImageDraw

    raw = Image.open(pano.raw_path)
    top, bottom = int(pano.height * band[0]), int(pano.height * band[1])
    strip = Image.new("RGB", (2 * reach, bottom - top))
    a, b = max(0, x - reach), min(pano.total, x + reach)
    strip.paste(raw.crop((a, top, b, bottom)), (a - (x - reach), 0))
    strip = strip.resize((2 * reach * zoom, (bottom - top) * zoom), Image.LANCZOS)
    head = 40
    out = Image.new("RGB", (strip.width, strip.height + head), (0, 0, 0))
    out.paste(strip, (0, head))
    d = ImageDraw.Draw(out)
    for off in range(-reach + reach % 25, reach, 25):
        px = (off + reach) * zoom
        d.line((px, head - 14, px, head), fill=(255, 255, 0), width=2)
        if off % 50 == 0:
            d.line((px, head, px, out.height), fill=(255, 255, 0), width=1)
            d.text((px - 14, 4), f"{off:+d}" if off else "0", fill=(255, 255, 0), font_size=18)
    d.text((6, head + 4), f"boundary #{index}", fill=(255, 0, 255), font_size=18)
    path = pano.meta_path.with_name(f"pano_{pano.first:06d}_boundary_{index:02d}.png")
    out.save(path)
    return path


def gap_boundaries(pano: Panorama, bands: list[tuple[float, float]] | None = None) -> list[dict]:
    """Boundaries for beds without stakes, where plots are blocks of canopy
    separated by bare alleys: one boundary in the middle of every alley.

    The plot pitch is taken from the canopy's own rhythm; boundaries are then
    tracked one pitch at a time, each settling in the emptiest stretch near
    where it is expected — so a missing or thin plot does not shift the
    numbering, and uneven driving speed is followed. `bands` are the slices
    of the frame height that hold crop rows (two when the rover straddles
    two rows)."""
    from PIL import Image

    a = np.asarray(Image.open(pano.raw_path), dtype=np.float32) / 255.0
    exg = (2 * a[..., 1] - a[..., 0] - a[..., 2]) / (a.sum(axis=2) + 1e-6)
    green = (exg > 0.06) & (a[..., 1] > 0.15)
    h = pano.height
    prof = np.zeros(pano.total, dtype=np.float32)
    for b0, b1 in bands or [(0.0, 1.0)]:
        prof = np.maximum(prof, green[int(h * b0): int(h * b1)].mean(axis=0)[: pano.total])
    sm = np.convolve(np.pad(prof, 30, mode="edge"), np.ones(61) / 61, mode="valid")
    on = sm > 0.12
    runs, s = [], None
    for i, v in enumerate(list(on) + [False]):
        if v and s is None:
            s = i
        elif not v and s is not None:
            runs.append((s, i))
            s = None
    big = [b - a_ for a_, b in runs if b - a_ > 300]
    if len(big) < 3:
        return []
    ref = float(np.median(big))                      # a typical plot; merged or thin runs are left out
    long_runs = [r for r in runs if 0.6 * ref <= r[1] - r[0] <= 1.4 * ref]
    if len(long_runs) < 3:
        return []
    plot_len = float(np.median([b - a_ for a_, b in long_runs]))
    starts = np.array([r[0] for r in long_runs], dtype=np.float32)
    steps = np.diff(starts)
    steps = steps[(steps > plot_len) & (steps < 1.6 * plot_len)]
    pitch = float(np.median(steps)) if len(steps) else plot_len * 1.15
    gap = max(40.0, pitch - plot_len)
    # Emptiness: mean canopy over a window as wide as an alley.
    k = int(gap) | 1
    empty = np.convolve(np.pad(sm, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
    first = max(0.0, runs[0][0] - gap / 2)
    last_green = runs[-1][1]
    out = [{"x": int(first), "inferred": False}]
    x = first
    while True:
        exp = x + pitch
        if exp > last_green + gap:
            if last_green - x > 0.5 * pitch:        # the last plot: close it just past its canopy
                out.append({"x": int(min(last_green + gap / 2, pano.total - 1)), "inferred": False})
            break
        lo, hi = int(max(0, exp - 0.22 * pitch)), int(min(pano.total - 1, exp + 0.22 * pitch))
        if hi <= lo:
            break
        j = lo + int(np.argmin(empty[lo:hi + 1]))
        clear = empty[j] < 0.08                    # a real alley, not just the thinnest canopy
        x = float(j if clear else exp)
        out.append({"x": int(min(x, pano.total - 1)), "inferred": not clear})
    return out
