"""Ground (rover) track tools for agents: frames, passes, contact sheets,
vegetation profile, plot markings and stitching.

A *track* is one extracted dataset folder, e.g.
``Raw/2026/EXP/SITE/POP/2026-09-17/Amiga/RGB/c0fca235/``. Its frames are
``RGB/Images/top/*.jpg`` and its ``RGB/Metadata/msgs_synced.csv`` gives each
frame's GPS fix and direction of travel. Frames are addressed by *index*:
position in capture order (file-name order), the order the app steps through.
"""
from __future__ import annotations

import csv
import io
import json
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .client import AGENT_DIR, Client

WORK = AGENT_DIR / "work"
# A pause longer than this between consecutive frames starts a new pass
# (the rover's recording was stopped and restarted).
PASS_GAP_S = 3.0


@dataclass
class Frame:
    index: int
    name: str           # rgb-<stamp>.jpg
    stamp_s: float      # camera clock, seconds
    lat: Optional[float]
    lon: Optional[float]
    direction: str      # North / East / South / West ("" if unknown)


class Track:
    def __init__(self, client: Client, prefix: str):
        self.client = client
        self.prefix = prefix.rstrip("/") + "/"
        self.images_prefix = f"{self.prefix}RGB/Images/top/"
        self.msgs_path = f"{self.prefix}RGB/Metadata/msgs_synced.csv"
        self.cache = WORK / self.prefix.strip("/").replace("/", "_")
        self.cache.mkdir(parents=True, exist_ok=True)
        self.frames = self._load()

    # -- frames -------------------------------------------------------------
    def _load(self) -> list[Frame]:
        cached = self.cache / "msgs_synced.csv"
        if not cached.exists():
            try:
                data = self.client.download(self.msgs_path)
            except Exception as e:
                if "404" in str(e) or "not found" in str(e).lower():
                    raise RuntimeError(
                        "this track has no extracted images yet: the rover log is still being extracted, or extraction "
                        "failed. Check with next_step for the run (or jobs with job_type EXTRACT_BINARY) and wait for "
                        "it to finish before marking plots.") from None
                raise
            cached.write_bytes(data)
        rows = list(csv.DictReader(io.StringIO(cached.read_text())))
        if not rows:
            raise RuntimeError(f"{self.msgs_path} is empty")
        col = next((c for c in rows[0] if "top" in c.lower() and "file" in c.lower()), None)
        if col is None:
            raise RuntimeError("msgs_synced.csv has no top-camera file column")

        def num(v: Optional[str]) -> Optional[float]:
            try:
                f = float(v)  # type: ignore[arg-type]
                return f if math.isfinite(f) else None
            except (TypeError, ValueError):
                return None

        seen: dict[str, Frame] = {}
        for r in rows:
            name = (r.get(col) or "").replace("\\", "/").split("/")[-1]
            if not name or name in seen:
                continue
            digits = "".join(ch for ch in name if ch.isdigit())
            seen[name] = Frame(0, name, int(digits) / 1e6 if digits else 0.0,
                               num(r.get("lat")), num(r.get("lon")), r.get("direction") or "")
        frames = sorted(seen.values(), key=lambda f: f.name)
        for i, f in enumerate(frames):
            f.index = i
        return frames

    def refresh(self) -> None:
        (self.cache / "msgs_synced.csv").unlink(missing_ok=True)
        self.frames = self._load()

    def index_of(self, name: str) -> int:
        for f in self.frames:
            if f.name == name:
                return f.index
        raise KeyError(name)

    # -- passes -------------------------------------------------------------
    def passes(self) -> list[dict]:
        """Continuous recordings, split where the camera clock jumps."""
        out: list[dict] = []
        start = 0
        for i in range(1, len(self.frames) + 1):
            if i == len(self.frames) or self.frames[i].stamp_s - self.frames[i - 1].stamp_s > PASS_GAP_S:
                out.append(self._describe_pass(len(out) + 1, start, i - 1))
                start = i
        return out

    def _describe_pass(self, n: int, a: int, b: int) -> dict:
        fs = self.frames[a:b + 1]
        located = [f for f in fs if f.lat is not None and f.lon is not None]
        dist = 0.0
        for p, q in zip(located, located[1:]):
            dist += metres(p.lat, p.lon, q.lat, q.lon)  # type: ignore[arg-type]
        dirs: dict[str, int] = {}
        for f in fs:
            if f.direction:
                dirs[f.direction] = dirs.get(f.direction, 0) + 1
        return {
            "pass": n,
            "first": a,
            "last": b,
            "frames": b - a + 1,
            "seconds": round(fs[-1].stamp_s - fs[0].stamp_s, 1),
            "metres": round(dist, 1),
            "heading": max(dirs, key=dirs.get) if dirs else "",  # type: ignore[arg-type]
            "start_latlon": [located[0].lat, located[0].lon] if located else None,
            "end_latlon": [located[-1].lat, located[-1].lon] if located else None,
        }

    # -- images -------------------------------------------------------------
    def thumb(self, index: int, size: int):
        """Frame thumbnail as a PIL image (disk-cached)."""
        from PIL import Image

        f = self.frames[index]
        path = self.cache / f"t{size}" / (f.name.rsplit(".", 1)[0] + ".webp")
        if not path.exists():
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(self.client.thumbnail(self.images_prefix + f.name, size))
        return Image.open(path).convert("RGB")

    def thumbs(self, indices: list[int], size: int) -> list:
        with ThreadPoolExecutor(max_workers=8) as pool:
            return list(pool.map(lambda i: self.thumb(i, size), indices))

    def frame_image(self, index: int, size: int = 800) -> Path:
        """One frame, large, with its index and heading burnt in."""
        img = _label(self.thumb(index, size), self._caption(index))
        out = self.cache / "views" / f"frame_{index:06d}_{size}.png"
        out.parent.mkdir(exist_ok=True)
        img.save(out)
        return out

    def _caption(self, index: int) -> str:
        f = self.frames[index]
        return f"{index}" + (f" {f.direction[:1]}" if f.direction else "")

    def sheet(self, first: int, last: int, step: int = 1, size: int = 256,
              columns: int = 0, rotate: int = 0) -> Path:
        """Contact sheet of frames first..last (every `step`-th), in reading
        order, each labelled with its frame index."""
        from PIL import Image

        first, last = max(0, first), min(len(self.frames) - 1, last)
        indices = list(range(first, last + 1, max(1, step)))
        if len(indices) > 64:
            raise ValueError(f"{len(indices)} frames is too many for one sheet (max 64); raise step")
        tiles = [_label(_rot(t, rotate), self._caption(i)) for i, t in zip(indices, self.thumbs(indices, size))]
        columns = columns or min(len(tiles), 8 if size <= 200 else 6 if size <= 300 else 4)
        w, h = tiles[0].size
        rows = math.ceil(len(tiles) / columns)
        sheet = Image.new("RGB", (columns * w, rows * h), (20, 20, 20))
        for n, t in enumerate(tiles):
            sheet.paste(t, ((n % columns) * w, (n // columns) * h))
        out = self.cache / "views" / f"sheet_{first:06d}_{last:06d}_s{step}_{size}_r{rotate}.png"
        out.parent.mkdir(exist_ok=True)
        sheet.save(out)
        return out

    # -- vegetation profile ---------------------------------------------------
    def profile(self, first: int, last: int, step: int = 5, bands: int = 5) -> list[dict]:
        """Green cover per frame (excess-green index), whole frame and in
        `bands` strips across the image's long axis. Gaps between plots show
        as dips; use it to find where to look, not as the answer."""
        import numpy as np

        first, last = max(0, first), min(len(self.frames) - 1, last)
        indices = list(range(first, last + 1, max(1, step)))
        out = []
        for i, img in zip(indices, self.thumbs(indices, 128)):
            a = np.asarray(img, dtype=np.float32) / 255.0
            s = a.sum(axis=2) + 1e-6
            exg = (2 * a[..., 1] - a[..., 0] - a[..., 2]) / s
            veg = exg > 0.10
            long_axis = 1 if a.shape[1] >= a.shape[0] else 0
            strips = np.array_split(veg, bands, axis=long_axis)
            out.append({
                "index": i,
                "green": round(float(veg.mean()), 3),
                "bands": [round(float(x.mean()), 2) for x in strips],
            })
        return out


def metres(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    k = 111_320.0
    dy = (a_lat - b_lat) * k
    dx = (a_lon - b_lon) * k * math.cos(math.radians(a_lat))
    return math.hypot(dx, dy)


def _rot(img, rotate: int):
    return img.rotate(-rotate, expand=True) if rotate % 360 else img


def _label(img, text: str):
    from PIL import ImageDraw, ImageFont

    img = img.copy()
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=max(14, img.width // 14))
    except TypeError:
        font = ImageFont.load_default()
    box = d.textbbox((4, 2), text, font=font)
    d.rectangle((box[0] - 4, box[1] - 2, box[2] + 4, box[3] + 3), fill=(0, 0, 0))
    d.text((4, 2), text, fill=(255, 255, 0), font=font)
    d.rectangle((0, 0, img.width - 1, img.height - 1), outline=(20, 20, 20))
    return img


# ── plot markings ───────────────────────────────────────────────────────────

DIRECTIONS = ("up", "down", "left", "right")


class Markings:
    """Working copy of a track's plot markings (a local JSON file) and its
    saved versions in the app (the same store Plot Marking uses)."""

    def __init__(self, track: Track):
        self.track = track
        self.path = track.cache / "markings.json"
        self.plots: list[dict] = json.loads(self.path.read_text()) if self.path.exists() else []
        # Plots per frame: {"lanes": N, "split": "top_bottom" | "left_right"}.
        # Each marked stretch is stitched as N plots, one per band of the
        # frames (frontend lib/groundTrack.lanePlots, same numbering).
        self.layout_path = track.cache / "layout.json"
        self.layout: dict = (json.loads(self.layout_path.read_text()) if self.layout_path.exists()
                             else {"lanes": 1, "split": "top_bottom"})

    def set_layout(self, lanes: Optional[int], split: Optional[str]) -> dict:
        if lanes is not None:
            if not 1 <= int(lanes) <= 6:
                raise ValueError("plots_per_frame must be 1 to 6")
            self.layout["lanes"] = int(lanes)
        if split is not None:
            if split not in ("top_bottom", "left_right"):
                raise ValueError("split must be top_bottom or left_right")
            self.layout["split"] = split
        self.layout_path.write_text(json.dumps(self.layout))
        return self.layout

    def lane_plots(self) -> list[dict]:
        """The plots to stitch: one per marked stretch per lane. Stretch n of
        an N-lane track is plots (n-1)*N+1 … n*N, lane 1 first (top / left)."""
        lanes = int(self.layout.get("lanes") or 1)
        out = []
        for s in self.selections():
            base = {k: s[k] for k in ("start_image", "end_image", "direction")}
            if lanes <= 1:
                out.append({"plot_id": s["plot_id"], **base})
                continue
            for k in range(1, lanes + 1):
                out.append({"plot_id": (s["plot_id"] - 1) * lanes + k, **base, "lane": k,
                            "lanes": lanes, "split": self.layout.get("split") or "top_bottom"})
        return out

    @property
    def directory(self) -> str:
        # Raw/{year}/{experiment}/{location}/{population}/… → the population's
        # PlotMarkings store (frontend lib/groundTrack.plotMarkingsDirectory).
        parts = self.track.prefix.strip("/").split("/")
        if len(parts) < 5 or parts[0] != "Raw":
            raise RuntimeError(f"cannot derive the population from {self.track.prefix}")
        return "Processed/" + "/".join(parts[1:5]) + "/PlotMarkings"

    def _write(self) -> None:
        self.plots.sort(key=lambda p: p["plot_id"])
        self.path.write_text(json.dumps(self.plots, indent=1))

    def mark(self, plot_id: int, start: Optional[int], end: Optional[int],
             direction: Optional[str], note: Optional[str] = None) -> dict:
        n = len(self.track.frames)
        for v in (start, end):
            if v is not None and not 0 <= v < n:
                raise ValueError(f"frame index {v} is outside 0..{n - 1}")
        if direction is not None and direction not in DIRECTIONS:
            raise ValueError(f"direction must be one of {', '.join(DIRECTIONS)}")
        p = next((p for p in self.plots if p["plot_id"] == plot_id), None)
        if p is None:
            p = {"plot_id": plot_id, "start": None, "end": None, "direction": "", "note": ""}
            self.plots.append(p)
        if start is not None:
            p["start"] = start
        if end is not None:
            p["end"] = end
        if direction is not None:
            p["direction"] = direction
        if note is not None:
            p["note"] = note
        self._write()
        return p

    def delete(self, plot_id: int) -> None:
        self.plots = [p for p in self.plots if p["plot_id"] != plot_id]
        self._write()

    def problems(self) -> list[str]:
        out = []
        done = [p for p in self.plots if p["start"] is not None and p["end"] is not None]
        for p in self.plots:
            if p["start"] is None or p["end"] is None:
                out.append(f"plot {p['plot_id']}: start or end not marked")
            elif p["end"] <= p["start"]:
                out.append(f"plot {p['plot_id']}: end {p['end']} is not after start {p['start']}")
            if not p["direction"]:
                out.append(f"plot {p['plot_id']}: no stitching direction")
        spans = sorted(done, key=lambda p: p["start"])
        for a, b in zip(spans, spans[1:]):
            if b["start"] <= a["end"]:
                out.append(f"plots {a['plot_id']} and {b['plot_id']} overlap "
                           f"({a['start']}-{a['end']} / {b['start']}-{b['end']})")
        return out

    def selections(self) -> list[dict]:
        """Markings in the app's stored shape (frame names + GPS)."""
        fs = self.track.frames
        out = []
        for p in self.plots:
            if p["start"] is None or p["end"] is None:
                continue
            a, b = fs[p["start"]], fs[p["end"]]
            out.append({
                "plot_id": p["plot_id"], "start_image": a.name, "end_image": b.name,
                "direction": p["direction"],
                "start_lat": a.lat, "start_lon": a.lon, "end_lat": b.lat, "end_lon": b.lon,
            })
        return out

    def save(self, name: Optional[str], overwrite: Optional[int]) -> dict:
        problems = self.problems()
        if problems:
            raise RuntimeError("fix before saving:\n  " + "\n  ".join(problems))
        snapshot = {
            "selections": self.selections(),
            "track": {"imagesPrefix": self.track.images_prefix, "msgsSyncedPath": self.track.msgs_path},
        }
        if int(self.layout.get("lanes") or 1) > 1:
            snapshot["layout"] = self.layout
        return self.track.client.save_version(self.directory, snapshot, name, overwrite)

    def pull(self, version: Optional[int]) -> int:
        """Replace the working copy with a saved version."""
        res = self.track.client.load_version(self.directory, version)
        layout = (res.get("state_snapshot") or {}).get("layout")
        self.layout = dict(layout) if layout else {"lanes": 1, "split": "top_bottom"}
        self.layout_path.write_text(json.dumps(self.layout))
        index = {f.name: f.index for f in self.track.frames}
        self.plots = []
        for s in (res.get("state_snapshot") or {}).get("selections") or []:
            self.plots.append({
                "plot_id": s["plot_id"],
                "start": index.get(s.get("start_image") or ""),
                "end": index.get(s.get("end_image") or ""),
                "direction": s.get("direction") or "", "note": "",
            })
        self._write()
        return res["version"]


# ── stitching ───────────────────────────────────────────────────────────────

# The app's Amiga defaults (frontend ProcessingPipeline).
STITCH_DEFAULTS = {"forward_limit": 4, "max_reprojection_error": 1.0, "batch_size": 10, "min_inliers": 20}


def processed_prefix(track_prefix: str) -> str:
    """Raw/…/{date}/{platform}/{sensor}/{dataset}/ → Processed/…/{sensor}/"""
    parts = track_prefix.strip("/").split("/")
    return "Processed/" + "/".join(parts[1:8]) + "/"


def next_stitch_prefix(client: Client, track_prefix: str) -> str:
    base = processed_prefix(track_prefix)
    versions = [0]
    try:
        for f in client.list_dir(base):
            rest = (f.get("object_name") or "")[len(base):]
            if rest.startswith("AgRowStitch_v"):
                head = rest.split("/")[0][len("AgRowStitch_v"):]
                if head.isdigit():
                    versions.append(int(head))
    except Exception:
        pass  # nothing processed yet
    return f"{base}AgRowStitch_v{max(versions) + 1}/"


def submit_stitch(markings: Markings, plot_ids: Optional[list[int]], settings: dict,
                  custom_options: Optional[str], device: Optional[str],
                  experiment_id: Optional[str], output_prefix: Optional[str]) -> dict:
    track = markings.track
    # plot_ids are stitched plot numbers (with several plots per frame, each
    # marked stretch is several plots; see Markings.lane_plots).
    plots = [p for p in markings.lane_plots() if not plot_ids or p["plot_id"] in plot_ids]
    if not plots:
        raise RuntimeError("no marked plots to stitch")
    out = output_prefix or next_stitch_prefix(track.client, track.prefix)
    params: dict = {
        "images_prefix": track.images_prefix,
        "msgs_synced_path": track.msgs_path,
        "plots": plots,
        "output_prefix": out,
        "settings": {**STITCH_DEFAULTS, **settings},
    }
    if custom_options:
        params["custom_options"] = custom_options
    if device:
        params["device"] = device
    job = track.client.submit_job("RUN_STITCH", params, experiment_id)
    return {"job_id": job.get("id"), "output_prefix": out, "plots": len(plots), "settings": params["settings"]}
