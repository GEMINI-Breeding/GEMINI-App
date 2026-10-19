"""Plot images that come with no position at all: a folder of photos, one (or
a few) per plot, with no GPS and no orthomosaic to cut them from.

What ties a photo to a plot is then the field design and a stated rule:

  - the design names the photo of each plot in a column (`image`, `file`,
    `photo`): the reliable way, and the one to ask the person for;
  - or the photos, sorted by file name, are in the order of the design's
    rows: only as good as the order they were taken in.

Either way the pairing is shown to the person before anything is filed, and
is recorded with the plot images, because nothing in the photos can confirm
it afterwards.
"""
from __future__ import annotations

import csv
import io
import json
import re
from pathlib import Path
from typing import Any, Optional

from .client import AGENT_DIR
from .field_tools import read_design
from .process_runs import SCOPE_KEYS, scope_from_path
from .tools import _bool, _int, _str, _tool, client, process_tab

IMAGE_COLUMNS = ("image", "file", "filename", "file name", "photo", "picture", "image_file", "image name")
EXT = (".jpg", ".jpeg", ".png", ".tif", ".tiff")


def _natural(name: str) -> list:
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def _images_of(args: dict) -> tuple[str, list[str], dict]:
    """(folder, image object names sorted by file name, scope) for a run named in words or a folder."""
    c = client()
    prefix = str(args.get("images_prefix") or "")
    if not prefix:
        from . import guide
        from .process_runs import ProcessRuns

        if not args.get("run"):
            raise ValueError("say which `run` (words naming the upload) or give `images_prefix`")
        pr = ProcessRuns(c)
        runs, pipelines = guide._state(pr)
        found = guide._match(runs, str(args["run"]))
        if len(found) != 1:
            raise ValueError(f"`run` must pick exactly one run; it matches {len(found)}: " +
                             ", ".join(guide._label(pr.describe(r, pipelines)) for r in (found or runs)[:8]))
        up = found[0].get("uploadScope") or {}
        ids = up.get("datasetShortIds") or []
        if not ids:
            raise ValueError("this run has no uploaded image set")
        prefix = "Raw/" + "/".join(str(up[k]) for k in SCOPE_KEYS) + f"/{ids[0]}/Images/"
    prefix = prefix.rstrip("/") + "/"
    scope = scope_from_path(prefix)
    if not scope:
        raise ValueError(f"not an uploaded image folder: {prefix}")
    names, offset = [], 0
    while True:
        page = c.list_page(prefix, 500, offset)
        names += [f["object_name"] for f in page.get("files") or [] if f["object_name"].lower().endswith(EXT)]
        offset += 500
        if offset >= (page.get("total_count") or 0):
            break
    names.sort(key=lambda n: _natural(n.rsplit("/", 1)[-1]))
    return prefix, names, scope


def mock_plot_design(args: dict) -> dict:
    """A made-up field design for a set of plots: plot number, bed, tier, genotype."""
    plots = int(args["plots"])
    if not 1 <= plots <= 5000:
        raise ValueError("plots must be between 1 and 5000")
    beds = int(args.get("beds") or max(1, round(plots ** 0.5)))
    genotypes = int(args.get("genotypes") or max(2, plots // 2))
    out = Path(args.get("save_as") or (AGENT_DIR / "work" / "mock" / f"mock_design_{plots}_plots.csv"))
    out.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for i in range(plots):
        bed, tier = i // (-(-plots // beds)) + 1, i % (-(-plots // beds)) + 1
        rows.append({"plot": 101 + i, "bed": bed, "tier": tier, "genotype": f"MOCK-{i % genotypes + 1:03d}"})
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["plot", "bed", "tier", "genotype"])
        w.writeheader()
        w.writerows(rows)
    return {"result": {"file": str(out), "plots": plots, "beds": beds, "genotypes": genotypes, "made_up": True,
                       "note": "plot numbers, layout and genotype names are placeholders; each genotype appears "
                               f"about {max(1, plots // genotypes)} time(s)",
                       "next": "plots_from_images with run and design_path"}}


def _pairs(names: list[str], design: dict) -> tuple[list[tuple[str, dict]], str, list[str]]:
    """Each photo with its design row, the rule used, and problems found."""
    rows = design["rows"]
    col = next((c for c in design["columns"] if c.lower() in IMAGE_COLUMNS), None)
    problems: list[str] = []
    if col:
        by_file = {n.rsplit("/", 1)[-1].lower(): n for n in names}
        by_stem = {Path(k).stem: v for k, v in by_file.items()}
        pairs = []
        for r in rows:
            want = str(r.get(col) or "").strip().lower()
            hit = by_file.get(want) or by_stem.get(Path(want).stem)
            if not want:
                problems.append(f"plot {r['_plot']} has no photo named in the design")
            elif not hit:
                problems.append(f"plot {r['_plot']}: photo {r.get(col)!r} is not among the uploaded files")
            else:
                pairs.append((hit, r))
        used = {p[0] for p in pairs}
        extra = [n for n in names if n not in used]
        if extra:
            problems.append(f"{len(extra)} uploaded photo(s) are not named in the design (e.g. {extra[0].rsplit('/', 1)[-1]})")
        return pairs, f"each plot's photo is named in the design's `{col}` column", problems
    if len(names) != len(rows):
        problems.append(f"{len(names)} photos but {len(rows)} plots in the design: they cannot be paired one to one "
                        "by order. Add an `image` column to the design naming each plot's photo.")
    pairs = list(zip(names, rows))
    return pairs, ("the photos sorted by file name, in the order of the design's rows (photo 1 = the design's first "
                   "plot). This is right only if the photos were taken in that order"), problems


def _sheet(pairs: list[tuple[str, dict]], path: Path) -> str:
    """The first and last photos with the plot and genotype each would get."""
    from PIL import Image, ImageDraw

    c = client()
    pick = pairs[:6] + (pairs[-6:] if len(pairs) > 12 else pairs[6:12])
    tile = 300
    sheet = Image.new("RGB", (tile * 6, (tile + 34) * -(-len(pick) // 6)), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for i, (name, row) in enumerate(pick):
        try:
            im = Image.open(io.BytesIO(c.thumbnail(name, tile))).convert("RGB")
        except Exception:
            im = Image.open(io.BytesIO(c.download(name))).convert("RGB")
        im.thumbnail((tile, tile))
        x, y = (i % 6) * tile, (i // 6) * (tile + 34)
        sheet.paste(im, (x, y + 34))
        d.text((x + 4, y + 2), name.rsplit("/", 1)[-1][:34], fill=(255, 255, 0))
        d.text((x + 4, y + 17), f"plot {row['_plot']}  {row['_accession']}"[:38], fill=(255, 255, 255))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, quality=88)
    return str(path)


def plots_from_images(args: dict) -> dict:
    """File a set of photos as plot images using the field design, when there
    is no GPS: shown first, filed on confirmation."""
    from PIL import Image

    c = client()
    prefix, names, scope = _images_of(args)
    if not names:
        raise ValueError(f"no images under {prefix}")
    design_path = str(args.get("design_path") or "")
    if not design_path:
        raise ValueError("design_path is needed: the field design file. With none yet, make a stand-in with "
                         f"mock_plot_design (plots: {len(names)}) and tell the person it is made up.")
    design = read_design(design_path)
    pairs, rule, problems = _pairs(names, design)
    table = [{"photo": n.rsplit("/", 1)[-1], "plot": r["_plot"], "genotype": r["_accession"]} for n, r in pairs]
    processed = "Processed/" + "/".join(str(scope[k]) for k in SCOPE_KEYS) + "/"
    out_prefix = processed + "PlotImages/"
    summary: dict[str, Any] = {"photos": len(names), "plots_in_design": len(design["rows"]), "paired": len(pairs),
                               "pairing_rule": rule, "first": table[:4], "last": table[-3:], "problems": problems or None}
    if problems and not args.get("allow_problems"):
        return {"result": {**summary, "filed": 0, "state": "needs the person",
                           "tell_the_person": "The photos and the field design do not pair up cleanly: " + "; ".join(problems[:3]),
                           "next": "ask the person; nothing was filed"}}
    from .tools import confirmable, forget_shown, mark_shown

    key = "pairing:" + prefix + ":" + json.dumps(table, sort_keys=True)[:4000]
    if args.get("confirmed") and not confirmable(key):
        args = {**args, "confirmed": False}        # not shown to the person before they last spoke: show it now
    if not args.get("confirmed"):
        mark_shown(key)
        img = _sheet(pairs, AGENT_DIR / "work" / "views" / f"pairing_{abs(hash(prefix)) % 10 ** 8}.jpg")
        return {"result": {**summary, "filed": 0, "state": "needs the person",
                           "tell_the_person": f"{len(pairs)} photos would be filed as plot images. Rule: {rule}. For example "
                                              f"{table[0]['photo']} = plot {table[0]['plot']} ({table[0]['genotype']}), "
                                              f"{table[-1]['photo']} = plot {table[-1]['plot']} ({table[-1]['genotype']}). "
                                              "There is no GPS in these photos, so nothing can check this pairing later: "
                                              "is it right?",
                           "next": "show the person the pairing and ask. On their yes, call plots_from_images again with "
                                   "the same arguments and confirmed=true"},
                "images": [img]}
    forget_shown(key)
    exp = next((e for e in c.entities("experiments") if e.get("experiment_name") == scope["experiment"]), None)
    done = 0
    for name, r in pairs:
        im = Image.open(io.BytesIO(c.download(name))).convert("RGB")
        buf = io.BytesIO()
        im.save(buf, "PNG")
        data = buf.getvalue()
        m = re.sub(r"\D", "", str(r["_plot"])) or str(done + 1)
        target = f"{out_prefix}plot_{m}_accession_{str(r['_accession'] or 'unknown').replace(' ', '_')}.png"
        total = max(1, -(-len(data) // (8 * 1024 * 1024)))
        for i in range(total):
            c.upload_chunk(data[i * 8 * 1024 * 1024:(i + 1) * 8 * 1024 * 1024], i, total,
                           f"agent:{target}:{len(data)}", target, str(exp["id"]) if exp else None)
        done += 1
    # Plot boundaries on a nominal grid (bed by tier), so that per-plot results have plots to attach to.
    lat0, lon0 = [float(v) for v in (args.get("origin") or [0.0, 0.0])]
    step = 0.00003
    feats = []
    for _, r in pairs:
        x, y = r["_col"] - 1, r["_row"] - 1
        ring = [[lon0 + (x + a) * step, lat0 + (y + b) * step] for a, b in ((0.05, 0.05), (0.95, 0.05), (0.95, 0.95), (0.05, 0.95))]
        m = re.sub(r"\D", "", str(r["_plot"]))
        feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring + [ring[0]]]},
                      "properties": {"plot": int(m) if m else r["_plot"], "plot_label": str(r["_plot"]), "row": r["_row"],
                                     "col": r["_col"], "accession": r["_accession"], "schematic": True,
                                     **({"crop": r["_crop"]} if r.get("_crop") else {})}})
    v = c.save_version(processed, {"boundaries": {"type": "FeatureCollection", "features": feats},
                                   "created_from": "grid",
                                   "field_design": {"source": Path(design_path).name, "by": "agent",
                                                    "placement": "schematic: photos paired with the design, no GPS",
                                                    "pairing_rule": rule}},
                       args.get("name") or f"agent: {len(feats)} plots from photos (schematic)")
    c.post_json("/api/plot_geometry/versions/activate", {"directory": processed, "version": v["version"]})
    record = {"rule": rule, "design": Path(design_path).name, "pairs": table}
    blob = json.dumps(record, indent=1).encode()
    c.upload_chunk(blob, 0, 1, f"agent:{out_prefix}pairing.json:{len(blob)}", out_prefix + "pairing.json",
                   str(exp["id"]) if exp else None)

    def update(pr):
        from .process_runs import AERIAL_STEPS, GROUND_STEPS, pipeline_type

        run = pr.ensure_run(scope)
        steps = GROUND_STEPS if pipeline_type(scope) == "ground" else AERIAL_STEPS
        done_how = {"method": "photos paired with the field design (no GPS)", "plot_images_prefix": out_prefix, "plots": done}
        for key in steps:
            if key in ("image_review", "gcp_selection", "orthomosaic", "plot_marking", "stitching"):
                pr.set_step(run, key, "skipped")           # nothing to build: the photos are the plot images
            elif key in ("data_sync", "plot_boundary_prep", "split_orthomosaic", "associate_boundaries"):
                pr.set_step(run, key, "completed", outputs=done_how)
        return pr.describe(run)

    return {"result": {"filed": done, "output": out_prefix, "boundaries_version": v["version"], "pairing_rule": rule,
                       "pairing_recorded_in": out_prefix + "pairing.json",
                       "tell_the_person": f"{done} photos are filed as plot images, one per plot, paired by this rule: {rule}. "
                                          "The plots sit on a schematic grid, not at their real positions.",
                       "next": "measure them: canopy_cover with run, or continue_run with model for a detector",
                       "process_tab": process_tab(update)}}


_tool(mock_plot_design, "Make a made-up field design (plot, bed, tier, genotype) for a number of plots, for trying a "
      "set of plot photos before the real design exists. Placeholder names; say so to the person.",
      {"plots": {**_int, "description": "how many plots (usually the number of photos)"}, "beds": _int,
       "genotypes": _int, "save_as": _str}, ["plots"], track=False, group="plot_photos")
_tool(plots_from_images, "File a set of uploaded photos as plot images, one per plot, when there is NO GPS and no "
      "orthomosaic: each photo is paired with a plot of the field design (by an `image` column in the design, or "
      "by file-name order). Called without confirmed it only shows the pairing; the person must confirm it.",
      {"run": {**_str, "description": "words naming the uploaded image set"},
       "design_path": {**_str, "description": "the field design file on this computer"},
       "confirmed": {**_bool, "description": "true only after the person has seen the pairing and said it is right"},
       "images_prefix": {**_str, "description": "an image folder in the app, instead of run"}},
      ["design_path"], track=False, group="plot_photos")
_ = Optional
