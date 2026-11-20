"""Labelling and training, for the agent: the same labelled sets the app's
Label & train tool keeps (versions next to the plot images, ``…/labels/<name>``
or ``…/PlotFrames/labels/<name>``), built and corrected from the terminal, and
a TRAIN_MODEL job from one or several of them (several dates of one crop make
one training set).

The loop:
  1. ``label_propose``: proposals on a few plot images, from a model's results
     (an inference job already run on the run), a model run on just those
     images, or a written description (zero-shot).
  2. ``label_view``: a picture of one image with every object numbered (kept
     green, proposed orange), cut into panels at full resolution.
  3. ``label_edit``: keep / drop by number, add missed boxes, mark it done.
  4. ``train_model``: the done images of one or more sets → TRAIN_MODEL →
     ``train_result`` with the scores and the next calls (run the model).

What the person sees in the app's labelling tool is the same set, so either
can continue where the other stopped.
"""
from __future__ import annotations

import io
import json
import random
import string
import time
from pathlib import Path
from typing import Any, Optional

from .app_tools import (SCOPE_KEYS, _app, _experiment_id, _model_spec, _str, _strs, client, pick_run,
                        plot_images_prefix)
from .process_runs import scope_from_path
from .tools import _bool, _int, _num

OUT = Path(__file__).resolve().parents[1] / "work" / "labels"
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".tif", ".tiff")
KEPT, PROPOSED = (40, 200, 90), (255, 150, 0)


# -- where things are ---------------------------------------------------------

def _run_dir(run: str) -> str:
    """``Processed/<scope>/`` of one run: a storage path, a run id, or words
    naming it (site, crop, date). Words that match several runs of one date
    (a date flown several times) pick the date's main RGB run when there is
    exactly one."""
    run = str(run or "").strip()
    if not run:
        raise ValueError("name the run: its site, crop and date (or a Processed/… path)")
    scope = scope_from_path(run)
    if scope is not None:
        return "Processed/" + "/".join(str(scope[k]) for k in SCOPE_KEYS) + "/"
    up = pick_run(run).get("uploadScope") or {}
    return "Processed/" + "/".join(str(up[k]) for k in SCOPE_KEYS) + "/"


def _images(prefix: str) -> list[str]:
    c, out, offset = client(), [], 0
    while True:
        page = c.list_page(prefix, limit=500, offset=offset)
        files = page.get("files") or []
        out += [str(f["object_name"]) for f in files
                if str(f.get("object_name", "")).lower().endswith(IMAGE_EXT)
                and str(f["object_name"])[len(prefix):].count("/") == 0]
        offset += len(files)
        if not files or offset >= int(page.get("total_count") or 0):
            return sorted(out, key=_plot_key)


def _plot_key(name: str) -> tuple:
    stem = name.rsplit("/", 1)[-1]
    tok = stem.split("_")[1] if stem.startswith("plot_") and "_" in stem else stem
    return (0, int(tok), stem) if tok.isdigit() else (1, 0, stem)


def set_directory(image_path: str, name: str = "default") -> str:
    """Where the app keeps the labelled set of these images (lib/labelSet.ts)."""
    f = image_path.rfind("/PlotFrames/")
    if f >= 0:
        return f"{image_path[:f]}/PlotFrames/labels/{name}"
    i = image_path.rfind("/PlotImages/")
    base = image_path[:i + 1] if i >= 0 else image_path[:image_path.rfind("/") + 1]
    return f"{base}labels/{name}"


def _load(directory: str) -> dict:
    try:
        snap = client().load_version(directory).get("state_snapshot")
    except Exception:  # noqa: BLE001 — no version yet
        snap = None
    snap = snap if isinstance(snap, dict) else {}
    return {"classes": list(snap.get("classes") or []), "images": dict(snap.get("images") or {})}


def _save(directory: str, lset: dict) -> None:
    done = sum(1 for i in lset["images"].values() if i.get("done"))
    client().save_version(directory, lset, name=f"labels: {done} images")


def _new_id() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=8))


def _iou(a, b) -> float:
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0.0


def _ann(p: dict, status: str, source: str, cls: Optional[str] = None) -> Optional[dict]:
    """The app's prediction shape (centre + size) → a box annotation."""
    if not all(isinstance(p.get(k), (int, float)) for k in ("x", "y", "width", "height")):
        return None
    x, y, w, h = float(p["x"]), float(p["y"]), float(p["width"]), float(p["height"])
    a = {"id": _new_id(), "cls": cls or str(p.get("class") or "object"),
         "box": [x - w / 2, y - h / 2, x + w / 2, y + h / 2], "status": status, "source": source}
    if isinstance(p.get("confidence"), (int, float)):
        a["confidence"] = round(float(p["confidence"]), 4)
    return a


def _image_size(name: str) -> tuple[int, int]:
    from PIL import Image

    with Image.open(io.BytesIO(client().download(name))) as im:
        return im.size


def _pick(images: list[str], args: dict) -> list[str]:
    """The images to work on: named plots or files, else `count` spread over the run."""
    want = args.get("images") or []
    if isinstance(want, str):
        want = [w.strip() for w in want.split(",") if w.strip()]
    if want:
        out = []
        for w in want:
            w = str(w)
            hit = [n for n in images if n.endswith("/" + w) or n.rsplit("/", 1)[-1].startswith(f"plot_{w}_")
                   or n.rsplit("/", 1)[-1] == f"plot_{w}.png" or n == w]
            if not hit:
                raise ValueError(f"no plot image {w!r} on this run (e.g. {images[0].rsplit('/', 1)[-1] if images else 'none'})")
            out.append(hit[0])
        return out
    n = max(1, min(int(args.get("count") or 4), 30))
    seed = int(args.get("seed") or 0)
    rng = random.Random(seed)
    return sorted(rng.sample(images, min(n, len(images))), key=_plot_key)


def _set_for(args: dict) -> tuple[str, str, dict]:
    """(images prefix, set directory, the set) for `run` and `name`."""
    prefix = args.get("images_prefix") or plot_images_prefix(_run_dir(str(args.get("run") or "")))
    images = _images(prefix)
    if not images:
        raise ValueError(f"no plot images under {prefix}")
    directory = set_directory(images[0], str(args.get("name") or "default"))
    return prefix, directory, _load(directory)


def _summary(directory: str, lset: dict) -> dict:
    done = [n for n, i in lset["images"].items() if i.get("done")]
    by_cls: dict[str, int] = {}
    for n in done:
        for a in lset["images"][n].get("annotations") or []:
            if a.get("status") == "kept":
                by_cls[a["cls"]] = by_cls.get(a["cls"], 0) + 1
    open_ = {n.rsplit("/", 1)[-1]: sum(1 for a in i.get("annotations") or [] if a.get("status") == "proposed")
             for n, i in lset["images"].items() if not i.get("done")}
    return {"set": directory, "classes": lset["classes"], "images_done": len(done),
            "objects_kept": by_cls, "images_in_progress": open_}


# -- proposals ----------------------------------------------------------------

def _job_predictions(job_ref: str) -> dict[str, list[dict]]:
    """Predictions per image object name, from a job id (or prefix) or a predictions JSON path."""
    c = client()
    if job_ref.endswith(".json"):
        path = job_ref
    else:
        job = next((j for j in c.jobs(job_type="LOCATE_PLANTS", limit=500) if str(j["id"]).startswith(job_ref)), None)
        if job is None:
            raise ValueError(f"no inference job {job_ref!r}")
        job = c.job(str(job["id"]))
        p, r = job.get("parameters") or {}, job.get("result") or {}
        path = r.get("output_predictions_path") or p.get("output_predictions_path")
        if not path:
            if p.get("image_path"):
                return {p["image_path"]: list(r.get("predictions") or [])}
            raise ValueError("that job wrote no predictions file")
    data = json.loads(c.download(path))
    out: dict[str, list[dict]] = {}
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, dict) and v.get("object_name"):
                out[str(v["object_name"])] = list(v.get("predictions") or [])
    return out


def _wait_predictions(job_id: str, timeout_s: int = 900) -> list[dict]:
    c, start = client(), time.time()
    while time.time() - start < timeout_s:
        j = c.job(job_id)
        if j.get("status") == "COMPLETED":
            return list((j.get("result") or {}).get("predictions") or [])
        if j.get("status") in ("FAILED", "CANCELLED"):
            raise RuntimeError(f"job {job_id[:8]} {str(j.get('status')).lower()}: {j.get('error_message')}")
        time.sleep(3)
    raise TimeoutError(f"job {job_id[:8]} gave no answer in {timeout_s} s: is an ML worker running?")


def label_propose(args: dict) -> dict:
    """Proposals on some plot images of a run, into its labelled set."""
    prefix, directory, lset = _set_for(args)
    images = _pick(_images(prefix), args)
    thr = float(args.get("confidence_threshold") if args.get("confidence_threshold") is not None else 0.25)
    cls = args.get("cls")
    exp = _experiment_id((scope_from_path(prefix) or {}).get("experiment", ""))
    from_job = _job_predictions(str(args["from_job"])) if args.get("from_job") else None
    # A model or a description: one job per image, all submitted before waiting
    # (the worker takes them in turn; nobody waits for each round trip).
    c = client()
    jobs: dict[str, str] = {}
    if from_job is None:
        for name in images:
            if args.get("model"):
                spec = _model_spec(args["model"], "detection")
                params = {"image_path": name, "confidence_threshold": min(thr, 0.25), **spec}
            elif args.get("describe"):
                text = str(args["describe"])
                params = {"image_path": name, "prompted": {
                    "mode": "describe", "prompt": text if ":" in text else f"{cls or 'object'}: {text}",
                    "model": str(args.get("zero_shot") or "owlv2"), "conf": min(thr, 0.1)}}
            else:
                raise ValueError("give from_job (an inference job or predictions file), model, or describe")
            jobs[name] = str(c.submit_job("LOCATE_PLANTS", params, exp)["id"])
    added: dict[str, int] = {}
    failed: dict[str, str] = {}
    for name in images:
        source = "model"
        if from_job is not None:
            preds = from_job.get(name, [])
        else:
            try:
                preds = _wait_predictions(jobs[name], timeout_s=1800)
            except (RuntimeError, TimeoutError) as e:
                failed[name.rsplit("/", 1)[-1]] = str(e)[:200]
                continue
        new = [a for a in (_ann(p, "proposed", source, cls) for p in preds
                           if float(p.get("confidence", 1.0)) >= thr) if a]
        img = lset["images"].get(name)
        if img is None:
            w, h = _image_size(name)
            img = {"width": w, "height": h, "annotations": [], "done": False}
        have = img["annotations"]
        new = [a for a in new if not any(_iou(a["box"], e["box"]) > 0.5 for e in have)]
        img["annotations"] = have + new
        lset["images"][name] = img
        for a in new:
            if a["cls"] not in lset["classes"]:
                lset["classes"].append(a["cls"])
        added[name.rsplit("/", 1)[-1]] = len(new)
    if cls and cls not in lset["classes"]:
        lset["classes"].append(cls)
    _save(directory, lset)
    return {"result": {"proposed": added, **({"failed": failed} if failed else {}), **_summary(directory, lset),
                       "next": "label_view each image, then label_edit (keep / drop by number, add missed boxes, "
                               "done=true)"}}


# -- looking and correcting ---------------------------------------------------

def _numbered(lset: dict, name: str) -> list[dict]:
    """The image's annotations in a stable reading order (top to bottom), numbered from 1."""
    anns = lset["images"].get(name, {}).get("annotations") or []
    return sorted(anns, key=lambda a: (round(a["box"][1] / 40), a["box"][0]))


def label_view(args: dict) -> dict:
    """One image of the set: every object numbered (green kept, orange proposed),
    in full-resolution panels; plus an optional close-up region."""
    from PIL import Image, ImageDraw, ImageFont

    prefix, directory, lset = _set_for(args)
    name = _pick(_images(prefix), {"images": [args["image"]]})[0]
    im = Image.open(io.BytesIO(client().download(name))).convert("RGB")
    anns = _numbered(lset, name)
    if args.get("gallery"):
        return _gallery(name, im, anns, int(args.get("tile") or 112))
    region = args.get("region")
    scale = 1.0
    if region:
        x0, y0, x1, y1 = (int(v) for v in region)
        im = im.crop((x0, y0, x1, y1))
        scale = max(1.0, min(3.0, 900 / max(1, im.width)))
        im = im.resize((int(im.width * scale), int(im.height * scale)))
        off = (x0, y0)
    else:
        off = (0, 0)
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 15)
    except OSError:
        font = ImageFont.load_default()
    for i, a in enumerate(anns, 1):
        x1, y1, x2, y2 = ((a["box"][0] - off[0]) * scale, (a["box"][1] - off[1]) * scale,
                          (a["box"][2] - off[0]) * scale, (a["box"][3] - off[1]) * scale)
        if x2 < 0 or y2 < 0 or x1 > im.width or y1 > im.height:
            continue
        col = KEPT if a.get("status") == "kept" else PROPOSED
        d.rectangle([x1, y1, x2, y2], outline=col, width=2)
        d.text((x1 + 1, max(0, y1 - 15)), str(i), fill=col, font=font, stroke_width=2, stroke_fill=(0, 0, 0))
    # Tall plot images: side-by-side panels so the details stay readable.
    panel_h = int(args.get("panel_height") or 900)
    if not region and im.height > panel_h * 1.3:
        n = -(-im.height // panel_h)
        out = Image.new("RGB", (n * im.width + (n - 1) * 8, panel_h), (20, 20, 20))
        for k in range(n):
            part = im.crop((0, k * panel_h, im.width, min(im.height, (k + 1) * panel_h)))
            out.paste(part, (k * (im.width + 8), 0))
            ImageDraw.Draw(out).text((k * (im.width + 8) + 4, 4), f"y {k * panel_h}–{min(im.height, (k + 1) * panel_h)}",
                                     fill=(255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
        im = out
    OUT.mkdir(parents=True, exist_ok=True)
    f = OUT / f"{name.rsplit('/', 1)[-1].rsplit('.', 1)[0]}{'-region' if region else ''}.jpg"
    im.save(f, quality=88)
    kept = sum(1 for a in anns if a.get("status") == "kept")
    return {"result": {"image": name.rsplit("/", 1)[-1], "objects": len(anns), "kept": kept,
                       "proposed": len(anns) - kept, "done": bool(lset["images"].get(name, {}).get("done")),
                       "size": lset["images"].get(name, {}).get("width") and
                       [lset["images"][name]["width"], lset["images"][name]["height"]],
                       "numbers": {str(i): {"cls": a["cls"], "box": [round(v) for v in a["box"]],
                                            "status": a.get("status"), "conf": a.get("confidence")}
                                   for i, a in enumerate(anns, 1)} if args.get("list") else None},
            "images": [str(f)]}


def _gallery(name: str, im: Any, anns: list[dict], tile: int) -> dict:
    """Every object of the image as a numbered close-up (3x its box, at least
    48 px of context), for deciding keep / drop quickly without hunting."""
    from PIL import Image, ImageDraw, ImageFont

    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 14)
    except OSError:
        font = ImageFont.load_default()
    cols = 8
    rows = max(1, -(-len(anns) // cols))
    sheet = Image.new("RGB", (cols * (tile + 4), rows * (tile + 4)), (25, 25, 25))
    for i, a in enumerate(anns):
        x1, y1, x2, y2 = a["box"]
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        half = max(24.0, 1.5 * max(x2 - x1, y2 - y1))
        crop = im.crop((int(cx - half), int(cy - half), int(cx + half), int(cy + half))).resize((tile, tile))
        d = ImageDraw.Draw(crop)
        k = tile / (2 * half)
        col = KEPT if a.get("status") == "kept" else PROPOSED
        d.rectangle([(x1 - cx + half) * k, (y1 - cy + half) * k, (x2 - cx + half) * k, (y2 - cy + half) * k],
                    outline=col, width=1)
        d.text((3, 2), str(i + 1), fill=(255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
        sheet.paste(crop, ((i % cols) * (tile + 4), (i // cols) * (tile + 4)))
    OUT.mkdir(parents=True, exist_ok=True)
    f = OUT / f"{name.rsplit('/', 1)[-1].rsplit('.', 1)[0]}-gallery.jpg"
    sheet.save(f, quality=90)
    return {"result": {"image": name.rsplit("/", 1)[-1], "objects": len(anns),
                       "how": "number = the object's number for label_edit; box drawn in each close-up"},
            "images": [str(f)]}


def _ids(v: Any) -> list[int]:
    """[3, 5, "7-9"] or "3,5,7-9" → [3, 5, 7, 8, 9]."""
    if v in (None, "", []):
        return []
    parts = v if isinstance(v, list) else str(v).split(",")
    out: list[int] = []
    for p in parts:
        p = str(p).strip()
        if "-" in p:
            a, b = p.split("-", 1)
            out += list(range(int(a), int(b) + 1))
        elif p:
            out.append(int(p))
    return out


def label_edit(args: dict) -> dict:
    """Correct one image: keep / drop objects by their number in label_view, add boxes, mark it done."""
    prefix, directory, lset = _set_for(args)
    name = _pick(_images(prefix), {"images": [args["image"]]})[0]
    img = lset["images"].get(name)
    if img is None:
        w, h = _image_size(name)
        img = lset["images"][name] = {"width": w, "height": h, "annotations": [], "done": False}
    anns = _numbered(lset, name)
    n = len(anns)
    keep_all = str(args.get("keep") or "").strip().lower() == "all"
    keep = set(range(1, n + 1)) if keep_all else set(_ids(args.get("keep")))
    drop = set(_ids(args.get("drop")))
    bad = sorted(i for i in keep | drop if i < 1 or i > n)
    if bad:
        raise ValueError(f"no object number {bad} on this image (1–{n}); label_view shows the numbers")
    if args.get("drop_rest"):
        drop |= set(range(1, n + 1)) - keep
    cls = args.get("cls")
    out = []
    for i, a in enumerate(anns, 1):
        if i in drop:
            continue
        if i in keep:
            a = {**a, "status": "kept"}
        if cls and i in keep and args.get("relabel"):
            a = {**a, "cls": cls}
        out.append(a)
    for b in args.get("add") or []:
        x1, y1, x2, y2 = (float(v) for v in b[:4])
        c = str(b[4]) if len(b) > 4 else (cls or (lset["classes"][0] if lset["classes"] else "object"))
        out.append({"id": _new_id(), "cls": c, "box": [min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)],
                    "status": "kept", "source": "hand"})
        if c not in lset["classes"]:
            lset["classes"].append(c)
    img["annotations"] = out
    if args.get("done") is not None:
        img["done"] = bool(args["done"])
    still = sum(1 for a in out if a.get("status") == "proposed")
    if img.get("done") and still:
        # Done means looked at: proposals nobody kept are not objects.
        img["annotations"] = [a for a in out if a.get("status") == "kept"]
    lset["images"][name] = img
    _save(directory, lset)
    return {"result": {"image": name.rsplit("/", 1)[-1], "kept": sum(1 for a in img["annotations"] if a["status"] == "kept"),
                       "proposed_left": sum(1 for a in img["annotations"] if a["status"] == "proposed"),
                       "done": bool(img.get("done")), **_summary(directory, lset)}}


def label_set(args: dict) -> dict:
    """What a run's labelled set holds."""
    _, directory, lset = _set_for(args)
    return {"result": _summary(directory, lset)}


# -- training -----------------------------------------------------------------

def _coco(sets: list[dict], classes: list[str]) -> dict:
    cat = {c: i + 1 for i, c in enumerate(classes)}
    images, annotations, iid, aid = [], [], 0, 0
    for lset in sets:
        for path, img in lset["images"].items():
            if not img.get("done"):
                continue
            iid += 1
            images.append({"id": iid, "file_name": path, "width": img.get("width") or 0, "height": img.get("height") or 0})
            for a in img.get("annotations") or []:
                if a.get("status") != "kept" or a.get("cls") not in cat:
                    continue
                aid += 1
                x1, y1, x2, y2 = a["box"]
                annotations.append({"id": aid, "image_id": iid, "category_id": cat[a["cls"]],
                                    "bbox": [x1, y1, x2 - x1, y2 - y1], "area": (x2 - x1) * (y2 - y1), "iscrowd": 0,
                                    "segmentation": [sum(a["points"], [])] if a.get("points") else []})
    return {"images": images, "annotations": annotations,
            "categories": [{"id": i, "name": c} for c, i in cat.items()]}


def train_model(args: dict) -> dict:
    """TRAIN_MODEL from the done images of one or more runs' labelled sets."""
    runs = args.get("runs") or ([args["run"]] if args.get("run") else [])
    if isinstance(runs, str):
        runs = [r.strip() for r in runs.split(";") if r.strip()]
    if not runs:
        raise ValueError("runs: the runs whose labelled sets to train on (one or several dates)")
    sets, where, exp = [], [], None
    for r in runs:
        prefix, directory, lset = _set_for({"run": r, "name": args.get("set") or "default"})
        sets.append(lset)
        where.append(directory)
        exp = exp or _experiment_id((scope_from_path(prefix) or {}).get("experiment", ""))
    classes = args.get("classes") or sorted({a["cls"] for s in sets for i in s["images"].values() if i.get("done")
                                             for a in i.get("annotations") or [] if a.get("status") == "kept"})
    if isinstance(classes, str):
        classes = [c.strip() for c in classes.split(",") if c.strip()]
    coco = _coco(sets, list(classes))
    if not coco["images"]:
        raise ValueError("no images marked done in those sets: label_edit … done=true first")
    name = str(args.get("name") or "-".join(classes) or "model")
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in name).strip("_") or "labels"
    obj = f"Models/training/sets/{int(time.time() * 1000)}-{safe}.json"
    data = json.dumps(coco).encode()
    client().upload_chunk(data, 0, 1, f"agent:{obj}:{len(data)}", obj)
    params: dict[str, Any] = {"coco_path": obj, "name": name,
                              "preset": args.get("preset") or ("few" if len(coco["images"]) < 30 else "standard")}
    base = str(args.get("base") or "yolo11s")
    if base.startswith(("Models/", "weights:")) or base.endswith(".pt"):
        params["base_weights_path"] = _model_spec(base if ":" in base else f"weights:{base}", "detection")["weights_path"]
    else:
        params["base"] = base
    for k in ("epochs", "imgsz", "freeze"):
        if args.get(k) is not None:
            params[k] = int(args[k])
    if args.get("val_fraction") is not None:
        params["val_fraction"] = float(args["val_fraction"])
    job = client().submit_job("TRAIN_MODEL", params, exp)
    return {"result": {"job_id": str(job.get("id")), "images": len(coco["images"]),
                       "objects": len(coco["annotations"]), "classes": list(classes), "sets": where,
                       "params": {k: v for k, v in params.items() if k != "coco_path"}, "coco_path": obj,
                       "next": [{"tool": "wait_jobs", "args": {"job_ids": [str(job.get("id"))], "timeout_s": 3600}},
                                {"tool": "train_result", "args": {"job_id": str(job.get("id"))}}]}}


def train_result(args: dict) -> dict:
    """A training job's outcome: scores, the weights, and how to run it."""
    c = client()
    jid = str(args["job_id"])
    if len(jid) < 36:
        jid = next((str(j["id"]) for j in c.jobs(job_type="TRAIN_MODEL", limit=200) if str(j["id"]).startswith(jid)), jid)
    j = c.job(jid)
    r = j.get("result") or {}
    out: dict[str, Any] = {"status": j.get("status"), "error": j.get("error_message"),
                           "progress": j.get("progress"), "detail": j.get("progress_detail")}
    if j.get("status") == "COMPLETED":
        out = {"status": "COMPLETED", **{k: r.get(k) for k in (
            "name", "weights_path", "base", "preset", "epochs_run", "device", "metrics", "images_train", "images_val",
            "tiles_train", "objects", "classes", "validation_is_training")}}
        out["next"] = {"tool": "run_inference", "args": {"run": "<site crop date>", "model": f"weights:{r.get('weights_path')}",
                                                        "count_label": r.get("name")}}
        if r.get("validation_is_training"):
            out["note"] = "fewer than 5 images: the scores are on the training images and flatter the model"
    return {"result": out}


_app(label_set, "What a run's labelled set holds (the same set the app's Label & train tool shows): images done, "
     "objects kept per class, images still with proposals.",
     {"run": {**_str, "description": "site, crop and date of the run (or a Processed/… path, or a run id)"},
      "name": {**_str, "description": "the set's name (default: default)"}}, ["run"], "inference")
_app(label_propose, "Add proposals to a few plot images of a run's labelled set, to correct with label_view / "
     "label_edit: from_job = an inference job (id) already run on the run, or model = a model run on just these "
     "images ('weights:<path>', 'huggingface:<id>'), or describe = a written description (zero-shot, OWLv2 unless "
     "zero_shot=sam3). images = plot numbers or file names; else count images spread over the run.",
     {"run": _str, "name": _str, "images": _strs, "count": _int, "seed": _int,
      "from_job": {**_str, "description": "inference job id (or prefix) or predictions .json"},
      "model": {"description": "'weights:<path>' | 'huggingface:<id>' | 'roboflow:<id>'"},
      "describe": {**_str, "description": "e.g. 'flower: a single pale purple cowpea flower, not a leaf'"},
      "zero_shot": {**_str, "description": "owlv2 (default) | sam3 (needs a Hugging Face token)"},
      "cls": {**_str, "description": "class name for these proposals (default: the model's)"},
      "confidence_threshold": _num}, ["run"], "inference")
_app(label_view, "One image of a run's labelled set as a picture: each object numbered (green kept, orange "
     "proposed), tall images cut into full-resolution panels (each panel names its y range). region = [x0,y0,x1,y1] "
     "in image pixels for a close-up (to find missed objects). gallery=true: every object as a numbered close-up "
     "(quickest way to decide keep / drop). list=true adds each number's box.",
     {"run": _str, "name": _str, "image": {**_str, "description": "plot number or file name"},
      "region": {"type": "array", "items": _num}, "panel_height": _int, "list": _bool, "gallery": _bool,
      "tile": _int}, ["run", "image"], "inference")
_app(label_edit, "Correct one image of a run's labelled set: keep = numbers (or 'all') to keep, drop = numbers to "
     "remove (ranges like '7-9' work), drop_rest = drop every number not kept, add = boxes [x1,y1,x2,y2(,class)] "
     "in image pixels for missed objects, done = true when the image is fully labelled (its unkept proposals are "
     "then dropped). Numbers are those label_view shows.",
     {"run": _str, "name": _str, "image": _str, "keep": {"description": "numbers, '3,5,7-9', or 'all'"},
      "drop": {"description": "numbers or '3,5,7-9'"}, "drop_rest": _bool,
      "add": {"type": "array", "items": {"type": "array"}}, "cls": _str, "relabel": _bool, "done": _bool},
     ["run", "image"], "inference")
_app(train_model, "Train a detector (TRAIN_MODEL on the ML worker) from the done images of the labelled sets of "
     "one or more runs (several dates of one crop make one training set). base = yolo11n | yolo11s (default) | "
     "yolo11m, or weights to fine-tune ('weights:<path>', e.g. an earlier model of the same object). preset = few "
     "(< 30 images) | standard | quick. Returns the job and the next calls.",
     {"runs": {**_strs, "description": "the runs (site crop date each)"}, "run": _str,
      "set": {**_str, "description": "the sets' name (default: default)"}, "name": {**_str, "description":
      "the model's name (also the trait name)"}, "classes": _strs, "base": _str, "preset": _str, "epochs": _int,
      "imgsz": _int, "freeze": _int, "val_fraction": _num}, [], "inference")
_app(train_result, "A training job's outcome: precision, recall and mAP on the held-out images, the weights path, "
     "and the run_inference call that uses them.", {"job_id": _str}, ["job_id"], "inference")
