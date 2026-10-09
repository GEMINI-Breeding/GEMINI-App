"""Rover plots from the driving pattern, without relying on GPS.

A rover covers a field bed by bed. If the person says which corner they
started from, the order in which plots were recorded gives each plot's place
in the field design: pass k is bed k (or beds 2k-1 and 2k when the camera
sees two rows), and the plots of a pass count up or down the tiers depending
on the direction of that pass. The usual pattern is serpentine (every pass
reverses); when GPS headings are usable they are checked against it.

This gives stitched plots their identity — and, with nominal plot sizes, a
schematic set of plot boundaries — before (or instead of) the GPS-based
boundary step, which is what matters when the rover's GPS is bad.
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any, Optional

from .field_tools import read_design
from .ground import Markings, next_stitch_prefix, processed_prefix
from .process_runs import scope_from_path
from .tools import _bool, _int, _str, _tool, _track, client, process_tab

_num = {"type": "number"}
CORNERS = ("south-west", "south-east", "north-west", "north-east")


def _layout_path(track) -> Path:
    return track.cache / "traversal.json"


def _load(track) -> dict:
    p = _layout_path(track)
    if not p.exists():
        raise ValueError("no traversal layout for this track yet: run traversal_layout first")
    return json.loads(p.read_text())


def traversal_layout(args: dict) -> dict:
    """Give every marked plot its bed, tier and design plot from the driving pattern."""
    track = _track(args)
    m = Markings(track)
    plots = sorted((p for p in m.plots if p["start"] is not None and p["end"] is not None), key=lambda p: p["start"])
    if not plots:
        raise ValueError("no plot markings for this track yet")
    corner = str(args.get("start_corner") or "")
    if corner not in CORNERS:
        raise ValueError(f"start_corner must be one of {', '.join(CORNERS)}")
    rpp = int(args.get("rows_per_pass") or 1)
    if rpp not in (1, 2):
        raise ValueError("rows_per_pass must be 1 or 2")
    source = str(args.get("direction_source") or "serpentine")
    passes = track.passes()
    groups = [[p for p in plots if ps["first"] <= p["start"] <= ps["last"]] for ps in passes]
    used = [(ps, g) for ps, g in zip(passes, groups) if g]
    tiers = max(len(g) for _, g in used)

    # Direction of each pass relative to the first (+1 = same way as pass 1).
    serp = [1 if k % 2 == 0 else -1 for k in range(len(used))]
    head0 = used[0][0]["heading"]
    gps = [(1 if ps["heading"] == head0 else -1) if ps["heading"] and head0 else None for ps, _ in used]
    disagree = [used[k][0]["pass"] for k in range(len(used)) if gps[k] is not None and gps[k] != serp[k]]
    dirs = serp if source == "serpentine" else [g if g is not None else s for g, s in zip(gps, serp)]

    design = read_design(args["design_path"]) if args.get("design_path") else None
    by_cell = {(r["_col"], r["_row"]): r for r in design["rows"]} if design else {}
    bed0, tier0 = int(args.get("first_bed") or 1), int(args.get("first_tier") or 1)
    top_first = args.get("top_row_first", True)
    units, warn = [], []
    for k, ((ps, g), d) in enumerate(zip(used, dirs)):
        if len(g) != tiers:
            warn.append(f"pass {ps['pass']} has {len(g)} plots, the others {tiers}: its tiers are counted from its own start")
        for j, pl in enumerate(g):
            tier = tier0 + (j if d > 0 else tiers - 1 - j)
            halves = [None] if rpp == 1 else ["top", "bottom"]
            for half in halves:
                if rpp == 1:
                    bed = bed0 + k
                else:
                    # The camera turns round with the rover: the half of the image that shows
                    # the nearer bed on an outbound pass shows the farther one on the way back.
                    near_is_top = bool(top_first) == (d > 0)
                    bed = bed0 + 2 * k + (0 if (half == "top") == near_is_top else 1)
                rec = by_cell.get((bed, tier))
                label = rec["_plot"] if rec else str(bed * 100 + tier)
                try:
                    unit = int(float(label))
                except ValueError:
                    unit = bed * 100 + tier
                units.append({"unit": unit, "label": label, "marking_plot": pl["plot_id"], "half": half, "bed": bed,
                              "tier": tier, "pass": ps["pass"], "direction": pl["direction"],
                              "genotype": rec["_accession"] if rec else f"MOCK-{(bed * 7 + tier * 3) % 24 + 1:02d}",
                              "start": pl["start"], "end": pl["end"]})
    ids = [u["unit"] for u in units]
    if len(set(ids)) != len(ids):
        raise ValueError("two plots got the same number; check first_bed / first_tier / the design file")
    layout = {"track": track.prefix, "start_corner": corner, "rows_per_pass": rpp, "direction_source": source,
              "pass_axis": args.get("pass_axis") or "north-south", "beds": sorted({u["bed"] for u in units}),
              "tiers": tiers, "units": units, "design": args.get("design_path") or "mock"}
    _layout_path(track).write_text(json.dumps(layout))
    design_file = track.cache / "traversal_field_design.csv"
    with open(design_file, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["plot", "bed", "tier", "genotype"])
        w.writeheader()
        w.writerows({"plot": u["label"], "bed": u["bed"], "tier": u["tier"], "genotype": u["genotype"]} for u in units)
    grid = {}
    for u in units:
        grid.setdefault(u["tier"], {})[u["bed"]] = u["label"]
    beds = layout["beds"]
    table = ["tier | " + " ".join(f"b{b:<4}" for b in beds)] + [
        f"{t:>4} | " + " ".join(f"{grid[t].get(b, '-'):<5}" for b in beds) for t in sorted(grid, reverse=True)]
    return {"result": {
        "plots": len(units), "beds": beds, "tiers": tiers, "passes_used": len(used),
        "pass_directions": {str(ps["pass"]): ("away from start" if d > 0 else "back towards start")
                            for (ps, _), d in zip(used, dirs)},
        "gps_disagrees_with_serpentine_on_passes": disagree,
        "note": ("GPS headings say these passes were NOT driven in serpentine order; decide which to trust "
                 "(direction_source: gps or serpentine) and tell the person" if disagree else None),
        "warnings": warn, "design": layout["design"], "design_file": str(design_file),
        "field_map (tier rows, top = far end; columns = beds)": table[:40],
    }}


def _metres_to_deg(lat: float) -> tuple[float, float]:
    return 1 / 111_320.0, 1 / (111_320.0 * math.cos(math.radians(lat)))


def traversal_boundaries(args: dict) -> dict:
    """Schematic plot boundaries from the traversal layout: a regular grid of
    nominal plot sizes placed at the start corner. Saved and activated as
    the scope's boundaries, so trait values map onto plots even with no
    usable GPS. Positions are schematic, not surveyed."""
    track = _track(args)
    lay = _load(track)
    plot_len, bed_w = float(args.get("plot_length_m") or 3.0), float(args.get("bed_width_m") or 1.0)
    if args.get("origin"):
        lat0, lon0 = (float(v) for v in args["origin"])
    else:
        located = [f for f in track.frames if f.lat is not None and f.lon is not None]
        if not located:
            raise ValueError("no GPS at all on this track: give origin [lat, lon] of the start corner")
        first = min(located, key=lambda f: f.index)
        lat0, lon0 = first.lat, first.lon
    dlat, dlon = _metres_to_deg(lat0)
    ns, ew = lay["start_corner"].split("-")
    sy, sx = (1 if ns == "south" else -1), (1 if ew == "west" else -1)      # field extends away from the corner
    along_ns = lay["pass_axis"] == "north-south"
    beds, feats = lay["beds"], []
    for u in lay["units"]:
        b, t = beds.index(u["bed"]), u["tier"] - min(x["tier"] for x in lay["units"])
        if along_ns:      # tiers run north-south, beds step east-west
            x0, x1, y0, y1 = b * bed_w, (b + 1) * bed_w, t * plot_len, (t + 1) * plot_len
        else:
            y0, y1, x0, x1 = b * bed_w, (b + 1) * bed_w, t * plot_len, (t + 1) * plot_len
        pad = 0.06
        ring = [[lon0 + sx * (x + px) * dlon, lat0 + sy * (y + py) * dlat]
                for x, px, y, py in ((x0, pad, y0, pad), (x1, -pad, y0, pad), (x1, -pad, y1, -pad), (x0, pad, y1, -pad))]
        feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring + [ring[0]]]},
                      "properties": {"plot": u["unit"], "plot_label": u["label"], "row": u["tier"], "col": u["bed"],
                                     "accession": u["genotype"], "schematic": True}})
    scope = scope_from_path(track.prefix)
    directory = processed_prefix(track.prefix)
    c = client()
    v = c.save_version(directory, {"boundaries": {"type": "FeatureCollection", "features": feats},
                                   "grid": {"rows": lay["tiers"], "cols": len(beds), "spacing_m": 0, "angle_deg": 0,
                                            "row_offset": 0, "col_offset": 0, "fill_pattern": "snake"},
                                   "created_from": "grid",
                                   "field_design": {"source": Path(str(lay["design"])).name, "by": "agent",
                                                    "placement": "schematic, from the driving pattern"}},
                       args.get("name") or f"agent: {len(feats)} plots from driving pattern (schematic)")
    c.post_json("/api/plot_geometry/versions/activate", {"directory": directory, "version": v["version"]})

    def update(pr):
        run = pr.ensure_run(scope, "ground")
        pr.set_step(run, "plot_boundary_prep", "completed",
                    outputs={"activeVersion": v["version"], "activeVersionName": v.get("name")})
        return pr.describe(run)

    return {"result": {"plots": len(feats), "version": v["version"], "directory": directory,
                       "origin": [lat0, lon0], "schematic": True, "process_tab": process_tab(update)}}


def stitch_units(args: dict) -> dict:
    """Stitch every plot of the traversal layout under its design number.
    With two rows per pass the frame is cut along its middle and each half
    stitched on its own (two jobs)."""
    track = _track(args)
    lay = _load(track)
    c = client()
    only = {int(i) for i in args["units"]} if args.get("units") else None
    settings = {"forward_limit": 4, "max_reprojection_error": 1.0, "batch_size": 10, "min_inliers": 20,
                **dict(args.get("settings") or {})}
    scope = scope_from_path(track.prefix)
    exp = next((e for e in c.entities("experiments") if e.get("experiment_name") == scope["experiment"]), None)
    height = None
    if lay["rows_per_pass"] == 2:
        from PIL import Image
        import io

        height = Image.open(io.BytesIO(c.download(track.images_prefix + track.frames[0].name))).height
    first = next_stitch_prefix(c, track.prefix)
    n = int(first.rstrip("/").rsplit("_v", 1)[1])
    jobs = []
    halves = [None] if lay["rows_per_pass"] == 1 else ["top", "bottom"]
    for i, half in enumerate(halves):
        plots = [{"plot_id": u["unit"], "start_image": track.frames[u["start"]].name,
                  "end_image": track.frames[u["end"]].name, "direction": u["direction"] or "left"}
                 for u in lay["units"] if u["half"] == half and (only is None or u["unit"] in only)]
        if not plots:
            continue
        s = dict(settings)
        if half:                               # keep one half of the frame: mask the other
            s.update({"mask_left": 0, "mask_right": 0,
                      "mask_top": 0 if half == "top" else height // 2,
                      "mask_bottom": height // 2 if half == "top" else 0})
        prefix = f"{first.rsplit('_v', 1)[0]}_v{n + i}/"
        job = c.submit_job("RUN_STITCH", {"images_prefix": track.images_prefix, "msgs_synced_path": track.msgs_path,
                                          "plots": plots, "output_prefix": prefix, "settings": s,
                                          **({"custom_options": args["custom_options"]} if args.get("custom_options") else {})},
                           str(exp["id"]) if exp else None)
        jobs.append({"job_id": job.get("id"), "half": half, "plots": len(plots), "output_prefix": prefix,
                     "mask": {k: v for k, v in s.items() if k.startswith("mask_")}})
    lay["stitch_jobs"] = jobs
    _layout_path(track).write_text(json.dumps(lay))

    def update(pr):
        run = pr.ensure_run(scope, "ground")
        for key in ("data_sync", "plot_marking"):
            if (run["steps"].get(key) or {}).get("status") != "completed":
                pr.set_step(run, key, "completed")
        for j in jobs:
            pr.set_step(run, "stitching", "running", job_id=str(j["job_id"]))
        return pr.describe(run)

    return {"result": {"jobs": jobs, "process_tab": process_tab(update)}}


def place_plot_images(args: dict) -> dict:
    """File each stitched mosaic under its plot (PlotImages/plot_{n}_accession_{g}.png)
    by its number from the traversal layout — no GPS involved."""
    track = _track(args)
    lay = _load(track)
    c = client()
    scope = scope_from_path(track.prefix)
    out_prefix = processed_prefix(track.prefix) + "PlotImages/"
    by_unit = {u["unit"]: u for u in lay["units"]}
    exp = next((e for e in c.entities("experiments") if e.get("experiment_name") == scope["experiment"]), None)
    done, missing = 0, []
    for job in lay.get("stitch_jobs") or []:
        manifest = json.loads(c.download(job["output_prefix"] + "stitch_manifest.json"))
        for pid in manifest.get("succeeded_plots") or []:
            u = by_unit.get(int(pid))
            if u is None:
                continue
            data = c.download(f"{job['output_prefix']}full_res_mosaic_temp_plot_{pid}.png")
            name = f"{out_prefix}plot_{u['unit']}_accession_{str(u['genotype']).replace(' ', '_')}.png"
            total = max(1, -(-len(data) // (8 * 1024 * 1024)))
            for i in range(total):
                c.upload_chunk(data[i * 8 * 1024 * 1024:(i + 1) * 8 * 1024 * 1024], i, total,
                               f"agent:{name}:{len(data)}", name, str(exp["id"]) if exp else None)
            done += 1
        missing += [int(p) for p in (manifest.get("failed_plots") or {})]

    def update(pr):
        run = pr.ensure_run(scope, "ground")
        pr.set_step(run, "associate_boundaries", "completed",
                    outputs={"plot_images_prefix": out_prefix, "matched": done, "method": "driving pattern"})
        return pr.describe(run)

    return {"result": {"plot_images": done, "failed_to_stitch": missing, "output": out_prefix,
                       "process_tab": process_tab(update)}}


def _t(fn, description: str, props: dict, required: list[str]) -> None:
    _tool(fn, description, props, required, track=True, group="ground")


_t(traversal_layout, "Rover: work out each marked plot's bed, tier and design plot from the driving pattern — the "
   "corner the rover started from and serpentine passes — without using GPS positions. rows_per_pass=2 when "
   "the camera sees two crop rows (each pass covers two beds; each image half is its own plot). Reports where "
   "GPS headings contradict the assumed pattern.",
   {"start_corner": {**_str, "description": "south-west | south-east | north-west | north-east"},
    "rows_per_pass": _int, "direction_source": {**_str, "description": "serpentine (default) | gps"},
    "pass_axis": {**_str, "description": "north-south (default) | east-west: the way the beds run"},
    "top_row_first": {**_bool, "description": "two rows: on the first pass the image's top half is the bed nearer the start edge (default true)"},
    "design_path": {**_str, "description": "field design file; omit to generate a mock one"},
    "first_bed": _int, "first_tier": _int}, ["start_corner"])
_t(traversal_boundaries, "Rover: save schematic plot boundaries (regular grid at the start corner) from the "
   "traversal layout, so results map onto plots without usable GPS.",
   {"plot_length_m": _num, "bed_width_m": _num, "origin": {"type": "array", "items": _num}, "name": _str}, [])
_t(stitch_units, "Rover: stitch every plot of the traversal layout under its design number; with two rows per "
   "pass, each half of the frame is stitched separately.",
   {"units": {"type": "array", "items": _int}, "settings": {"type": "object"},
    "custom_options": {**_str, "description": "AgRowStitch options as YAML, e.g. 'final_resolution: 0.5' to stitch at half resolution (about 4x faster)"}}, [])
_t(place_plot_images, "Rover: after stitch_units finishes, file each mosaic under its plot number and genotype "
   "(the association step) using the traversal layout.", {}, [])
