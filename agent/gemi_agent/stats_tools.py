"""Numbers and simple charts for results, shown in the conversation:
inference predictions per plot image, and a stitch run's outcome.

Charts are drawn with Pillow (no plotting library needed): one image with a
few panels, sized to read well in the chat.
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path
from typing import Any

from .client import AGENT_DIR
from .tools import _int, _str, _tool, client

OUT = AGENT_DIR / "work" / "charts"
INK, MUTED, GRID, BAR, ACCENT, BG = (30, 30, 30), (110, 110, 110), (225, 225, 225), (46, 125, 110), (200, 90, 40), (255, 255, 255)


def _font(size: int):
    from PIL import ImageFont

    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _bars(d, box: tuple[int, int, int, int], labels: list[str], values: list[float], title: str,
          horizontal: bool = False, color=BAR) -> None:
    """A bar chart in `box` = (x0, y0, x1, y1), drawn on ImageDraw `d`."""
    x0, y0, x1, y1 = box
    d.text((x0, y0), title, fill=INK, font=_font(18))
    top, left, bottom = y0 + 34, x0 + (150 if horizontal else 44), y1 - (8 if horizontal else 26)
    vmax = max(values) if values and max(values) > 0 else 1
    small = _font(13)
    if horizontal:
        n = len(values)
        h = max(8, min(26, (bottom - top) // max(1, n)))
        for i, (lab, v) in enumerate(zip(labels, values)):
            y = top + i * h
            w = int((x1 - left - 60) * v / vmax)
            d.rectangle((left, y + 3, left + w, y + h - 3), fill=color)
            d.text((x0, y + 3), lab[:20], fill=INK, font=small)
            d.text((left + w + 6, y + 3), f"{v:g}", fill=MUTED, font=small)
        return
    for frac in (0, 0.5, 1):
        y = bottom - int((bottom - top) * frac)
        d.line((left, y, x1, y), fill=GRID)
        d.text((x0, y - 7), f"{vmax * frac:g}", fill=MUTED, font=small)
    n = len(values)
    w = (x1 - left) / max(1, n)
    for i, v in enumerate(values):
        bx = left + i * w
        d.rectangle((bx + 1, bottom - int((bottom - top) * v / vmax), bx + max(2, w - 1), bottom), fill=color)
    step = max(1, n // 8)
    for i in range(0, n, step):
        d.text((left + i * w, bottom + 6), labels[i], fill=MUTED, font=small)


def _histogram(values: list[float], bins: int = 20) -> tuple[list[str], list[float]]:
    lo, hi = min(values), max(values)
    if hi == lo:
        return [f"{lo:g}"], [float(len(values))]
    integer = all(float(v).is_integer() for v in values)
    if integer and hi - lo < bins:
        counts = {int(v): 0 for v in range(int(lo), int(hi) + 1)}
        for v in values:
            counts[int(v)] += 1
        return [str(k) for k in counts], [float(c) for c in counts.values()]
    width = (hi - lo) / bins
    counts = [0] * bins
    for v in values:
        counts[min(bins - 1, int((v - lo) / width))] += 1
    return [f"{lo + i * width:.0f}" for i in range(bins)], [float(c) for c in counts]


def inference_stats(args: dict) -> dict:
    """Summary and chart of an inference run's predictions file."""
    from PIL import Image, ImageDraw

    path = args["predictions_path"]
    by_plot: dict[str, dict] = json.loads(client().download(path))
    if not by_plot:
        raise ValueError("the predictions file is empty")
    counts = {k: int(v.get("count") or 0) for k, v in by_plot.items()}
    classes: dict[str, int] = {}
    confidences: list[float] = []
    for v in by_plot.values():
        for c, n in (v.get("counts_by_class") or {}).items():
            classes[c] = classes.get(c, 0) + int(n)
        confidences += [float(p["confidence"]) for p in v.get("predictions") or [] if "confidence" in p]
    values = list(counts.values())
    ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    summary: dict[str, Any] = {
        "images": len(values), "total_detections": sum(values),
        "per_image": {"mean": round(statistics.mean(values), 2), "median": statistics.median(values),
                      "min": min(values), "max": max(values),
                      "stdev": round(statistics.pstdev(values), 2)},
        "images_with_none": sum(1 for v in values if v == 0),
        "by_class": dict(sorted(classes.items(), key=lambda kv: -kv[1])[:15]),
        "mean_confidence": round(statistics.mean(confidences), 3) if confidences else None,
        "highest": ranked[:5], "lowest": ranked[-5:],
    }
    img = Image.new("RGB", (1200, 760), BG)
    d = ImageDraw.Draw(img)
    title = str(args.get("title") or Path(path).name)
    d.text((24, 16), f"Inference results: {title}", fill=INK, font=_font(24))
    d.text((24, 50), f"{summary['images']} images, {summary['total_detections']} detections, "
                     f"mean {summary['per_image']['mean']} per image, {summary['images_with_none']} with none",
           fill=MUTED, font=_font(16))
    labels, hist = _histogram([float(v) for v in values])
    _bars(d, (24, 90, 590, 400), labels, hist, "Detections per image (how many images)")
    top = list(summary["by_class"].items())[:10]
    _bars(d, (630, 90, 1176, 400), [c for c, _ in top], [float(n) for _, n in top], "Detections by class",
          horizontal=True, color=ACCENT)
    order = sorted(counts, key=lambda k: (len(k), k))
    _bars(d, (24, 430, 1176, 740), [str(k) for k in order], [float(counts[k]) for k in order],
          "Detections per image, in plot order")
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"inference_{abs(hash(path)) % 10**8}.png"
    img.save(out)
    return {"result": summary, "images": [str(out)]}


def stitch_stats(args: dict) -> dict:
    """Outcome of a stitch version: how many plots, frames used, failures."""
    from PIL import Image, ImageDraw

    if args.get("output_prefix"):
        prefix = str(args["output_prefix"]).rstrip("/") + "/"
    else:
        # Named by its run (or track): the newest stitch of that track.
        from . import guide
        from .ground import processed_prefix
        from .tools import _track

        if not (args.get("run") or args.get("track")):
            raise ValueError("stitch_stats needs `run` (words naming the rover run) or `output_prefix`")
        track = _track({"track": args.get("track") or args.get("run")})
        prefix = guide._latest_stitch(processed_prefix(track.prefix))
        if not prefix:
            raise ValueError("this run has no stitch output yet: stitching has not run, or has not finished")
    m = json.loads(client().download(prefix + "stitch_manifest.json"))
    plots = m.get("plots") or {}
    frames = [int(p.get("frames") or 0) for p in plots.values()]
    failed = m.get("failed_plots") or {}
    summary = {"plots": m.get("plot_count", len(plots)), "succeeded": len(m.get("succeeded_plots") or []),
               "failed": len(failed), "failed_plots": dict(list(failed.items())[:20]),
               "frames_per_plot": {"mean": round(statistics.mean(frames), 1), "min": min(frames), "max": max(frames)}
               if frames else None, "settings": m.get("config")}
    img = Image.new("RGB", (1000, 420), BG)
    d = ImageDraw.Draw(img)
    d.text((24, 16), f"Stitch run: {prefix.strip('/').split('/')[-1]}", fill=INK, font=_font(24))
    d.text((24, 50), f"{summary['succeeded']} of {summary['plots']} plots stitched, {summary['failed']} failed",
           fill=MUTED, font=_font(16))
    if frames:
        labels, hist = _histogram([float(f) for f in frames])
        _bars(d, (24, 90, 976, 400), labels, hist, "Frames per plot (how many plots)")
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"stitch_{abs(hash(prefix)) % 10**8}.png"
    img.save(out)
    return {"result": summary, "images": [str(out)]}


_tool(inference_stats, "Statistics and a chart for an inference run: detections per image, by class, in plot order. "
      "Use after run_inference finishes; show the chart and state the numbers.",
      {"predictions_path": _str, "title": _str}, ["predictions_path"], track=False, group="inference")
_tool(stitch_stats, "Statistics and a chart for a stitch version (plots stitched / failed, frames per plot).",
      {"run": {**_str, "description": "words naming the rover run; its newest stitch is reported"},
       "track": _str, "output_prefix": {**_str, "description": "a particular stitch version's folder, instead of run"}},
      [], track=False, group="ground")
_ = _int


def compare_predictions(args: dict) -> dict:
    """Two models on the same images: agreement of their per-plot counts."""
    from PIL import Image, ImageDraw

    a = json.loads(client().download(args["predictions_a"]))
    b = json.loads(client().download(args["predictions_b"]))
    keys = sorted(set(a) & set(b), key=lambda k: (len(k), k))
    if len(keys) < 2:
        raise ValueError(f"the two files share {len(keys)} images; they must be runs over the same images")
    xa = [float(a[k].get("count") or 0) for k in keys]
    xb = [float(b[k].get("count") or 0) for k in keys]
    ma, mb = statistics.mean(xa), statistics.mean(xb)
    sa, sb = statistics.pstdev(xa), statistics.pstdev(xb)
    r = (sum((p - ma) * (q - mb) for p, q in zip(xa, xb)) / (len(keys) * sa * sb)) if sa > 0 and sb > 0 else None
    diffs = sorted(((k, p, q) for k, p, q in zip(keys, xa, xb)), key=lambda t: -abs(t[1] - t[2]))
    la, lb = str(args.get("label_a") or "model A"), str(args.get("label_b") or "model B")
    summary = {"images_compared": len(keys), la: {"mean": round(ma, 2), "total": int(sum(xa)), "zero_images": xa.count(0.0)},
               lb: {"mean": round(mb, 2), "total": int(sum(xb)), "zero_images": xb.count(0.0)},
               "correlation": round(r, 3) if r is not None else None,
               "mean_difference_a_minus_b": round(ma - mb, 2),
               "largest_disagreements": [{"image": k, la: p, lb: q} for k, p, q in diffs[:8]]}
    img = Image.new("RGB", (760, 760), BG)
    d = ImageDraw.Draw(img)
    d.text((24, 14), f"Per-plot counts: {la} vs {lb}", fill=INK, font=_font(22))
    d.text((24, 44), f"{len(keys)} plots, correlation {summary['correlation']}", fill=MUTED, font=_font(16))
    x0, y0, x1, y1 = 80, 90, 720, 700
    vmax = max(max(xa), max(xb), 1.0)
    d.rectangle((x0, y0, x1, y1), outline=GRID)
    d.line((x0, y1, x1, y0), fill=GRID)                      # equal counts
    for p, q in zip(xa, xb):
        px, py = x0 + (x1 - x0) * p / vmax, y1 - (y1 - y0) * q / vmax
        d.ellipse((px - 4, py - 4, px + 4, py + 4), fill=BAR)
    small = _font(14)
    for frac in (0, 0.5, 1):
        d.text((x0 + (x1 - x0) * frac - 10, y1 + 8), f"{vmax * frac:g}", fill=MUTED, font=small)
        d.text((x0 - 46, y1 - (y1 - y0) * frac - 8), f"{vmax * frac:g}", fill=MUTED, font=small)
    d.text(((x0 + x1) // 2 - 60, y1 + 30), la, fill=INK, font=small)
    d.text((8, y0 - 22), lb + " (vertical)", fill=INK, font=small)
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"compare_{abs(hash(args['predictions_a'] + args['predictions_b'])) % 10**8}.png"
    img.save(out)
    return {"result": summary, "images": [str(out)]}


_tool(compare_predictions, "Compare two inference runs over the same plot images: correlation of per-plot counts, "
      "mean difference, largest disagreements, and a scatter chart.",
      {"predictions_a": _str, "predictions_b": _str, "label_a": _str, "label_b": _str},
      ["predictions_a", "predictions_b"], track=False, group="inference")


# ── values per plot, written as traits ───────────────────────────────────────

def _write_trait(scope: dict, trait: str, units: str, values: dict, label: str) -> dict:
    """Store one number per plot as a trait (as the pipeline's own analyses
    do), so it appears in Analyze and on the map. Plots come from the scope's
    active boundaries."""
    import time as _time

    c = client()
    keys = ("year", "experiment", "location", "population", "date", "platform", "sensor")
    directory = "Processed/" + "/".join(str(scope[k]) for k in keys) + "/"
    feats = ((c.load_version(directory).get("state_snapshot") or {}).get("boundaries") or {}).get("features") or []
    by_plot = {str(f["properties"].get("plot")): f["properties"] for f in feats}
    records = []
    for plot, value in values.items():
        p = by_plot.get(str(plot))
        if p is None or value is None:
            continue
        acc = p.get("accession")
        records.append({"plot_number": int(p["plot"]), "plot_row_number": int(p["row"]),
                        "plot_column_number": int(p["col"]), "trait_value": float(value),
                        "accession_name": None, "record_info": {"source": "agent", "accession_label": acc},
                        "timestamp": _time.strftime("%Y-%m-%dT%H:%M:%S")})
    if not records:
        raise ValueError("none of the plots matched the scope's active plot boundaries")
    dataset = f"AGENT · {scope['experiment']} · {scope['year']}/{scope['location']}/{scope['population']} · " \
              f"{scope['date']} {scope['platform']}/{scope['sensor']} · {label}"[:250]
    try:
        c.post_json("/api/datasets", {"dataset_name": dataset, "experiment_name": scope["experiment"],
                                      "dataset_type_id": 2, "collection_date": f"{scope['date']}T00:00:00",
                                      "dataset_info": {"source": "agent"}})
    except Exception:
        pass                                    # exists already
    try:
        # A new experiment has no season until something makes one, and a trait record needs it.
        c.post_json("/api/seasons", {"season_name": str(scope["year"]), "experiment_name": scope["experiment"]})
    except Exception:
        pass                                    # exists already
    from urllib.parse import quote

    found = c.get_json("/api/traits?trait_name=" + quote(trait)) or []
    row = next((t for t in found if t.get("trait_name") == trait), None)
    if row is None:
        row = c.post_json("/api/traits", {"trait_name": trait, "trait_units": units or None, "trait_level_id": 2,
                                          "experiment_name": scope["experiment"]})
    res = c.post_json(f"/api/traits/id/{row['id']}/records/bulk", {
        "records": records, "experiment_name": scope["experiment"], "season_name": str(scope["year"]),
        "site_name": scope["location"], "population_name": scope["population"], "dataset_name": dataset,
        "collection_date": f"{scope['date']}T00:00:00"})
    return {"trait": trait, "records": len(records), "dataset": dataset,
            "inserted": (res or {}).get("inserted_count", len(records))}


def canopy_cover(args: dict) -> dict:
    """Green cover (fraction of the image that is plant) for every plot image
    under a prefix; optionally stored as a trait."""
    if not args.get("images_prefix"):
        # Named by its run: the plot images of that run.
        from . import guide
        from .process_runs import ProcessRuns

        if not args.get("run"):
            raise ValueError("canopy_cover needs `run` (words naming the run) or `images_prefix`")
        pr = ProcessRuns(client())
        runs, pipelines = guide._state(pr)
        found = guide._match(runs, str(args["run"]))
        if len(found) != 1:
            raise ValueError(f"`run` must pick exactly one run; it matches {len(found)}: " +
                             ", ".join(guide._label(pr.describe(r, pipelines)) for r in (found or runs)[:8]))
        up = found[0].get("uploadScope") or {}
        args = {**args, "images_prefix": "Processed/" + "/".join(str(up[k]) for k in guide.SCOPE_KEYS) + "/PlotImages/"}
    from concurrent.futures import ThreadPoolExecutor
    import io

    import numpy as np
    from PIL import Image

    from .process_runs import scope_from_path

    prefix = args["images_prefix"]
    scope = scope_from_path(prefix)
    c = client()
    names, offset = [], 0
    while True:
        page = c.list_page(prefix, 500, offset)
        got = [f["object_name"] for f in page.get("files") or [] if f["object_name"].lower().endswith(".png")]
        names += got
        offset += 500
        if offset >= (page.get("total_count") or 0) or len(names) >= int(args.get("limit") or 2000):
            break

    def one(name: str):
        import re as _re

        m = _re.search(r"plot_(\d+)[_.]", name.rsplit("/", 1)[-1])
        if not m:
            return None
        img = Image.open(io.BytesIO(c.thumbnail(name, 400))).convert("RGBA")
        a = np.asarray(img, dtype=np.float32) / 255.0
        valid = (a[..., 3] > 0) & (a[..., :3].sum(axis=2) > 0.05)
        exg = (2 * a[..., 1] - a[..., 0] - a[..., 2]) / (a[..., :3].sum(axis=2) + 1e-6)
        green = (exg > 0.08) & valid
        return m.group(1), round(float(green.sum()) / max(1, int(valid.sum())), 4)

    with ThreadPoolExecutor(8) as pool:
        values = dict(v for v in pool.map(one, names) if v)
    vals = list(values.values())
    out: dict[str, Any] = {"plots": len(vals), "mean": round(statistics.mean(vals), 3), "min": min(vals),
                           "max": max(vals), "lowest": sorted(values.items(), key=lambda kv: kv[1])[:5],
                           "highest": sorted(values.items(), key=lambda kv: -kv[1])[:5]}
    if args.get("values"):
        out["values"] = values
    if args.get("save_as_trait", True) and scope:
        try:
            out["stored"] = _write_trait(scope, str(args.get("trait_name") or "canopy cover"), "fraction", values,
                                         "canopy cover")
        except Exception as e:
            # The measurement is made; only keeping it in the app failed. Say so, and give the numbers.
            out["stored"] = False
            out["not_stored_because"] = str(e)[-300:]
            out["tell_the_person"] = (f"Mean green canopy cover is {out['mean']} over {out['plots']} plots (from "
                                      f"{out['min']} to {out['max']}). The values could not be saved in the app as a "
                                      "trait, so they are not in Analyze or on the map.")
    return {"result": out}


_tool(canopy_cover, "Canopy cover (0-1): the fraction of each plot image that is green vegetation (excess green "
      "> 0.08), for every plot image under a PlotImages prefix; stored as the trait 'canopy cover'. For plot "
      "photos and rover plots. Drone runs: use extract_traits instead (vegetation fraction and plant height).",
      {"run": {**_str, "description": "words naming the run whose plot images to measure"},
       "images_prefix": {**_str, "description": "a PlotImages folder, instead of run"},
       "trait_name": _str, "save_as_trait": {"type": "boolean"}, "limit": _int,
       "values": {"type": "boolean", "description": "also return the value of every plot"}},
      [], track=False, group="inference")
