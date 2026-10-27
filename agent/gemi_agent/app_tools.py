"""App-wide tools: what is in the stack, uploads, jobs and the pipeline's
job types. Registered into tools.TOOLS, so the CLI, the MCP server and the
agent runner all get them.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any, Optional

from . import uploads
from .client import AGENT_DIR, SKILLS_DIR, ApiError
from .process_runs import JOB_STEP, SCOPE_KEYS, scope_from_path
from .tools import TOOLS, _bool, _int, _ints, _str, _tool, client, process_tab

_ = AGENT_DIR
# What read_skill returns by default: "quick" = the steps only, "full" = the whole skill.
SKILL_DETAIL = "quick"
_strs = {"type": "array", "items": _str}
_obj = {"type": "object"}
JOB_KEEP = ("id", "job_type", "status", "progress", "progress_detail", "error_message", "worker_id",
            "created_at", "started_at", "completed_at")


def _slim(job: dict, with_result: bool = False) -> dict:
    out = {k: job.get(k) for k in JOB_KEEP}
    if with_result:
        out["result"] = job.get("result")
        out["parameters"] = job.get("parameters")
    return out


# ── skills ───────────────────────────────────────────────────────────────────

def _skill_meta(path: Path) -> dict:
    name, desc = path.parent.name, ""
    text = path.read_text(encoding="utf-8")
    if text.startswith("---"):
        for line in text.split("---", 2)[1].splitlines():
            if line.startswith("description:"):
                desc = line.split(":", 1)[1].strip()
    return {"name": name, "description": desc}


def skills(args: dict) -> dict:
    return {"result": [_skill_meta(p) for p in sorted(SKILLS_DIR.glob("*/SKILL.md"))]}


def read_skill(args: dict) -> dict:
    path = SKILLS_DIR / str(args["name"]) / "SKILL.md"
    if not path.exists():
        names = ", ".join(sorted(p.parent.name for p in SKILLS_DIR.glob("*/SKILL.md")))
        raise ValueError(f"no skill {args['name']!r}. Skills: {names}")
    text = path.read_text(encoding="utf-8")
    if text.startswith("---"):
        text = text.split("---", 2)[2].lstrip()
    if args.get("full") or "## Quick path" not in text or SKILL_DETAIL == "full":
        return {"result": text}
    # The steps, in order, first: enough to do the stage. The rest (why, tuning,
    # what to do when it goes wrong) is one more call away.
    a = text.index("## Quick path")
    b = text.find("\n## ", a + 5)
    steps = text[a:b if b > 0 else len(text)].strip()
    more = [line[3:].strip() for line in text[b:].splitlines() if line.startswith("## ")] if b > 0 else []
    title = text[:a].strip().splitlines()[0] if text[:a].strip() else ""
    return {"result": f"{title}\n\n{steps}\n\nMore in this skill (read_skill with \"full\": true): " + "; ".join(more) + "."}


# ── what is there ────────────────────────────────────────────────────────────

def status(args: dict) -> dict:
    """One look at the whole stack."""
    c = client()
    jobs = sorted(c.jobs(limit=1000), key=lambda j: j.get("created_at") or "", reverse=True)[:200]
    counts: dict[str, int] = {}
    for j in jobs:
        counts[j["status"]] = counts.get(j["status"], 0) + 1
    active = [_slim(j) for j in jobs if j["status"] in ("PENDING", "RUNNING")]
    workers = sorted({j["worker_id"] for j in jobs if j["status"] == "RUNNING" and j.get("worker_id")})
    waiting = sorted({j["job_type"] for j in jobs if j["status"] == "PENDING"})
    return {"result": {
        "api": c.base, "user": c.me().get("email"),
        # Names only, and few of them: a long list is read on every call and slows a small model down.
        "experiments": (lambda names: names[:8] + ([f"… and {len(names) - 8} more (entities lists them)"] if len(names) > 8 else []))(
            [str(e.get("experiment_name"))[:60] for e in c.entities("experiments")]),
        "jobs_recent": counts, "jobs_active": active[:30], "workers_busy": workers,
        "pending_job_types": waiting,
        "note": ("PENDING jobs with no worker for their type stay pending — start that worker"
                 if waiting else None),
        "uploads": [t for t in uploads.list_tasks() if t["status"] in ("running", "stalled")],
        "process_runs": process_tab(lambda pr: _runs_view(pr, 10)),
    }}


def entities(args: dict) -> dict:
    kind = str(args.get("kind") or "experiments").strip().lower()
    c = client()
    if kind not in c.ENTITY_NAME_KEY and kind + "s" in c.ENTITY_NAME_KEY:
        kind += "s"                                           # "experiment" for "experiments"
    if kind not in c.ENTITY_NAME_KEY:
        raise ValueError(f"kind must be one of {', '.join(c.ENTITY_NAME_KEY)}")
    key = c.ENTITY_NAME_KEY[kind]
    return {"result": [{"id": e.get("id"), "name": e.get(key)} for e in c.entities(kind)]}


def datasets(args: dict) -> dict:
    """Upload batches (datasets) of an experiment and where their files are."""
    c = client()
    exp = next((e for e in c.entities("experiments") if e.get("experiment_name") == args["experiment"]), None)
    if exp is None:
        raise ValueError(f"no experiment {args['experiment']!r}")
    out = []
    for d in c.get_json(f"/api/experiments/id/{exp['id']}/datasets") or []:
        row: dict[str, Any] = {"id": d.get("id"), "name": d.get("dataset_name"),
                               "type": (d.get("dataset_info") or {}).get("data_type_label")}
        try:
            row["location"] = c.get_json(f"/api/datasets/id/{d['id']}/location")
        except ApiError:
            row["location"] = None
        out.append(row)
    return {"result": {"experiment_id": exp["id"], "datasets": out}}


def browse(args: dict) -> dict:
    """Objects under a storage prefix (one page; the listing is recursive)."""
    limit = int(args.get("limit") or 50)
    page = client().list_page(args["prefix"], limit, int(args.get("offset") or 0))
    files = page.get("files") or []
    out: dict[str, Any] = {"total": page.get("total_count"), "shown": len(files),
                           "objects": [{"name": f["object_name"], "size": f.get("size")} for f in files]}
    # A listing shows that a file exists, not what is in it: name the tool that reads it.
    names = [f["object_name"] for f in files]
    if not files:
        prefix = str(args["prefix"])
        if re.match(r"^([A-Za-z]:[\\/]|/|~|\\\\)", prefix) or not prefix.startswith(("Raw/", "Processed/", "Models/", "Reference")):
            out["note"] = ("browse lists the app's own storage (Raw/…, Processed/…), not folders on this computer. "
                           "To bring files from this computer in: upload. To find a run's data: use the `run` words "
                           "the pipeline tools take; do not guess prefixes.")
        else:
            out["note"] = ("nothing under this prefix. Do not guess prefixes: process_runs lists the runs, and the "
                           "pipeline tools find a run's data from `run` words (site and date).")
    found = next((n for n in names if "/predictions/" in n and n.endswith(".json")), None)
    if found:
        out["next"] = f"to see what a predictions file holds: inference_stats with predictions_path {found}"
    elif any(n.endswith("stitch_manifest.json") for n in names):
        out["next"] = "to see how a stitch went: stitch_stats"
    return {"result": out}


def reference_datasets(args: dict) -> dict:
    rows = client().get_json("/api/reference_data/") or []
    keep = ("id", "name", "experiment", "location", "population", "dataset_date", "trait_columns", "plot_count")
    return {"result": [{k: r.get(k) for k in keep} for r in rows]}


# ── uploads ──────────────────────────────────────────────────────────────────

def existing_names(args: dict) -> dict:
    """Labels as the app already knows them. "sorghum trial" when the app has a
    population "Sorghum", or "davis" for "Davis": the existing name is used, so
    one field does not end up under two spellings. Returns what was changed."""
    kinds = {"experiment": ("experiments", "experiment_name"), "site": ("sites", "site_name"),
             "population": ("populations", "population_name")}
    filler = {"trial", "experiment", "field", "site", "population", "the", "plots", "nursery", "study", "farm"}
    changed = {}
    for key, (kind, name_key) in kinds.items():
        said = str(args.get(key) or "").strip()
        if not said:
            continue
        try:
            names = [str(e.get(name_key)) for e in client().entities(kind) if e.get(name_key)]
        except Exception:
            continue
        exact = [n for n in names if n.lower() == said.lower()]
        if exact:
            hit = exact[0]
        else:
            core = " ".join(w for w in said.lower().split() if w not in filler)
            near = [n for n in names if n.lower() == core] if core else []
            hit = near[0] if len(near) == 1 else None
        if hit and hit != said:
            changed[key] = {"said": said, "used": hit}
            args[key] = hit
    return changed


def check_platform(args: dict) -> None:
    """Rover logs are Amiga data. For images the platform must be said: filing
    drone photos as rover data (the old default) puts them in the wrong pipeline."""
    if args.get("data_type") == "amiga_bin":
        args.setdefault("platform", "Amiga")
    elif not args.get("platform"):
        raise ValueError("platform is needed for images: Drone for drone photos, or the rover's name (e.g. Amiga). "
                         "Add platform and call upload again.")


def data_type_files(kind: dict) -> str:
    return "/".join(kind["ext"]) + " files"


def local_path(given: str) -> Path:
    """A path as a person or a small model writes it: quotes, ~, a path
    relative to the home folder. Not found: the error names what is there."""
    raw = str(given).strip().strip("'\"").strip()
    path = Path(raw).expanduser()
    if not path.is_absolute() and not path.exists():
        path = Path.home() / raw
    if path.exists():
        return path
    parent = path.parent
    while not parent.exists() and parent != parent.parent:
        parent = parent.parent
    near = []
    if parent.exists() and parent.is_dir():
        import difflib

        want = path.name.lower() if parent == path.parent else ""
        names = sorted(c.name + ("/" if c.is_dir() else "") for c in parent.iterdir() if not c.name.startswith("."))
        by_lower = {n.lower().rstrip("/"): n for n in names}
        close = difflib.get_close_matches(want, list(by_lower), n=5, cutoff=0.6) if want else []
        near = [by_lower[c] for c in close] or names[:15]
    raise ValueError(f"not found: {raw}. The nearest folder that exists is {parent}"
                     + (f"; it holds: {', '.join(near)}" if near else "")
                     + ". Ask the person for the exact path (or call look_at_folder on that folder).")


_KIND_OF = {**{e: "images" for e in (".jpg", ".jpeg", ".png")}, ".bin": "amiga_bin",
            ".tif": "tif", ".tiff": "tif"}


def look_at_folder(args: dict) -> dict:
    """What a folder on this computer holds, before uploading it: files per
    sub-folder by kind, and the upload call that fits."""
    root = local_path(args["path"])
    if root.is_file():
        return {"result": {"path": str(root), "is_file": True, "kind": _KIND_OF.get(root.suffix.lower(), "other")}}
    max_depth = int(args.get("depth") or 4)
    rows: list[dict] = []
    other: dict[str, int] = {}

    def walk(d: Path, depth: int) -> None:
        counts: dict[str, int] = {}
        size = 0
        try:
            entries = sorted(d.iterdir())
        except PermissionError:
            return
        for f in entries:
            if f.name.startswith("."):
                continue
            if f.is_file():
                k = _KIND_OF.get(f.suffix.lower())
                if k:
                    counts[k] = counts.get(k, 0) + 1
                    size += f.stat().st_size
                else:
                    other[f.suffix.lower() or "(no extension)"] = other.get(f.suffix.lower() or "(no extension)", 0) + 1
        if counts:
            rows.append({"folder": str(d.relative_to(root)) if d != root else ".", "files": counts,
                         "mb": round(size / 1e6, 1)})
        if depth < max_depth:
            for sub in entries:
                if sub.is_dir() and not sub.name.startswith("."):
                    walk(sub, depth + 1)

    walk(root, 0)
    kinds = sorted({k for r in rows for k in r["files"]})
    out: dict = {"path": str(root), "folders_with_data": rows[:60],
                 **({"more_folders": len(rows) - 60} if len(rows) > 60 else {}),
                 "totals": {k: sum(r["files"].get(k, 0) for r in rows) for k in kinds},
                 **({"other_files": dict(sorted(other.items(), key=lambda x: -x[1])[:10])} if other else {})}
    advice = []
    if len(kinds) > 1:
        advice.append("this folder mixes kinds of data (" + ", ".join(kinds) + "): upload each kind as its own "
                      "call, with its own data_type and paths (the folders listed for it)")
    for k in kinds:
        dt = {"images": "images", "amiga_bin": "amiga_bin",
              "tif": "orthomosaic (a stitched map) or images (single photos): ask the person"}[k]
        where = [r["folder"] for r in rows if k in r["files"]]
        advice.append(f"{k}: data_type {dt}; in {len(where)} folder(s): {', '.join(where[:8])}"
                      + (" …" if len(where) > 8 else ""))
    sib = [r for r in rows if r["folder"] != "." and "/" not in r["folder"]]
    if len(sib) > 1:
        advice.append(f"{len(sib)} sub-folders hold data ({', '.join(r['folder'] for r in sib[:6])}): ask the person "
                      "whether they are runs of the same day, treatments, separate dates, or one batch; then "
                      "upload with folders_are (runs | treatments | one), or one upload per date")
    if any("/" in r["folder"] for r in rows):
        advice.append("data sits more than one folder deep: give upload the deepest folders that hold the files "
                      "(or this folder, which upload now searches all the way down)")
    out["advice"] = advice or ["no images, .bin logs or .tif files here"]
    out["next"] = ("tell the person what is here in a sentence, ask what is not clear (experiment, site, population, "
                   "date, what sub-folders stand for), then upload with dry_run first")
    return {"result": out}


def upload(args: dict) -> dict:
    """Start a background upload batch."""
    kind = uploads.DATA_TYPES.get(args.get("data_type", ""))
    if kind is None:
        raise ValueError(f"data_type must be one of {', '.join(uploads.DATA_TYPES)}")
    check_platform(args)
    renamed = existing_names(args)
    files: list[Path] = []
    folders: dict[str, list[Path]] = {}          # sub-folder (as given) -> its files, when a folder holds folders

    skipped: dict[str, int] = {}

    def matching(d: Path, deep: bool = False) -> list[Path]:
        """The files of this data type in d (and below it, when deep)."""
        found = []
        for f in (d.rglob("*") if deep else d.iterdir()):
            if not f.is_file() or any(part.startswith(".") for part in f.relative_to(d).parts):
                continue
            if f.suffix.lower() in kind["ext"]:
                found.append(f)
            else:
                skipped[f.suffix.lower() or "(no extension)"] = skipped.get(f.suffix.lower() or "(no extension)", 0) + 1
        return sorted(found)

    given = args["paths"] if isinstance(args["paths"], list) else [args["paths"]]
    for p in given:
        path = local_path(p)
        if path.is_dir():
            here = matching(path)
            files += here
            # Each sub-folder with everything below it: data is often a
            # folder or two deeper (date/run/images).
            subs = {d.name: matching(d, deep=True) for d in sorted(path.iterdir())
                    if d.is_dir() and not d.name.startswith(".")}
            subs = {k: v for k, v in subs.items() if v}
            if len(given) > 1 and here:
                folders[path.name] = here            # several folders named: each is a part
            elif subs and not here:
                folders.update(subs)                 # one folder of folders
                files += [f for v in subs.values() for f in v]
        else:
            files.append(path)
    if not files:
        raise ValueError(f"no {data_type_files(kind)} in {', '.join(map(str, given))}"
                         + (f" (other files there: {', '.join(f'{v} {k}' for k, v in skipped.items())})" if skipped else "")
                         + ". Call look_at_folder on it to see what it holds and which data_type fits.")
    if args.get("name_contains"):
        files = [f for f in files if str(args["name_contains"]) in f.name]
        folders = {k: [f for f in v if str(args["name_contains"]) in f.name] for k, v in folders.items()}
    run_of_day, treatment = str(args.get("run_of_day") or "").strip(), str(args.get("treatment") or "").strip()
    meaning = str(args.get("folders_are") or "").strip().lower()
    meaning = {"run": "runs", "runs of the day": "runs", "diurnal": "runs", "treatment": "treatments",
               "one batch": "one", "nothing": "one", "ignore": "one"}.get(meaning, meaning)
    parts: list[dict] = []
    if len(folders) > 1 and meaning in ("runs", "treatments"):
        for name, fs in folders.items():
            m = re.match(r"^(?:run|flight|pass|rep|r)[\s_-]*0*(\d+)$", name, re.I)
            parts.append({"folder": name, "files": fs,
                          "run_of_day": (m.group(1) if m else name) if meaning == "runs" else run_of_day,
                          "treatment": name if meaning == "treatments" else treatment})
    elif len(folders) > 1 and meaning != "one":
        # Several folders and nobody has said what they stand for: that is the person's to say.
        return {"result": {"uploaded": 0, "state": "needs the person",
                           "folders": {k: len(v) for k, v in folders.items()},
                           "ask_person": ["what the folders stand for: different runs of the same day (diurnal data), "
                                          "different treatments, or nothing (upload everything as one batch)"],
                           "then": "call upload again with folders_are = runs, treatments or one",
                           "tell_the_person": f"There are {len(folders)} folders ({', '.join(list(folders)[:6])}). Are they "
                                              "runs of the same day, treatments, or should everything go in as one batch?"}}
    else:
        parts = [{"folder": "", "files": files, "run_of_day": run_of_day, "treatment": treatment}]
    labels = [uploads.batch_label(p["run_of_day"], p["treatment"]) for p in parts]
    if len(parts) > 1 and len(set(labels)) < len(labels):
        raise ValueError("two folders would get the same labels: " + ", ".join(sorted({x for x in labels if labels.count(x) > 1})))
    if args.get("dry_run"):
        out = {"would_upload": len(files), "bytes": sum(f.stat().st_size for f in files),
               "first": [f.name for f in files[:5]],
               "filed_under": {k: args.get(k) for k in ("experiment", "site", "population", "date")},
               **({"existing_names_used": renamed} if renamed else {}),
               "next": "tell the person this count, then call upload again with the same arguments "
                       "but without dry_run"}
        if skipped:
            out["not_uploaded"] = {"files": dict(sorted(skipped.items(), key=lambda x: -x[1])[:8]),
                                   "why": f"not {data_type_files(kind)}; another kind needs its own upload "
                                          "with its data_type"}
        if len(parts) > 1 or labels[0]:
            out["batches"] = [{"folder": p["folder"] or None, "files": len(p["files"]), "label": lab or None}
                              for p, lab in zip(parts, labels)]
            out["note"] = "each batch is kept as its own upload and gets its own pipeline run"
        return {"result": out}
    started_all = []
    for p in parts:
        if not p["files"]:
            continue
        started_all.append(uploads.start(
            client(), p["files"], experiment=args["experiment"], site=args["site"], population=args["population"],
            date=args["date"], platform=args.get("platform") or "Amiga", sensor=args.get("sensor") or "RGB",
            data_type=args["data_type"], parallel=int(args.get("parallel") or 3),
            dataset_id=args.get("dataset_id") if len(parts) == 1 else None, extract=args.get("extract"),
            run_of_day=p["run_of_day"], treatment=p["treatment"], source_folder=p["folder"]))
    if len(started_all) == 1:
        started = started_all[0]
        return {"result": {**started, **({"label": labels[0]} if labels[0] else {}),
                           "next": f"wait_task with task_id {started.get('task_id')}; then report files done and failed"}}
    return {"result": {"batches": [{"task_id": s.get("task_id"), "label": lab, "files": len(p["files"]), "target": s.get("target")}
                                   for s, p, lab in zip(started_all, [p for p in parts if p["files"]], labels)],
                       "next": "wait_task for each task_id in turn; then report files done and failed per batch"}}


def tasks(args: dict) -> dict:
    if args.get("task_id"):
        return {"result": uploads.summary(uploads.read(args["task_id"]))}
    return {"result": uploads.list_tasks()[: int(args.get("limit") or 10)]}


def _task_id(args: dict) -> str:
    """The task named, or the newest upload when none is: there is rarely more than one."""
    latest = uploads.list_tasks()
    given = str(args.get("task_id") or "")
    if given and any(str(t.get("task_id")) == given for t in latest):
        return given
    if given and given.lower() not in ("latest", "last", "current", "newest"):
        # Not an id that exists: models make ids up when no upload was started.
        raise ValueError(f"there is no upload task {given!r}. Task ids come from the upload call's result. "
                         + ("Known tasks: " + ", ".join(str(t.get("task_id")) for t in latest[:5]) if latest else
                            "No upload has been started: nothing has been uploaded. Call upload first."))
    if not latest:
        raise ValueError("no upload has been started yet, so nothing has been uploaded: call upload first")
    return str(max(latest, key=lambda t: t.get("created") or t.get("started") or 0)["task_id"])


def wait_task(args: dict) -> dict:
    """Block until an upload finishes, or the timeout passes."""
    deadline = time.time() + min(int(args.get("timeout_s") or 300), 3600)
    while True:
        s = uploads.summary(uploads.read(_task_id(args)))
        if s["status"] != "running" or time.time() >= deadline:
            return {"result": s}
        time.sleep(5)


def cancel_task(args: dict) -> dict:
    return {"result": uploads.cancel(args["task_id"])}


# ── jobs ─────────────────────────────────────────────────────────────────────

def jobs(args: dict) -> dict:
    # The API pages from the oldest job; ask for plenty, then keep the newest.
    rows = client().jobs(args.get("status"), args.get("job_type"), 1000)
    rows.sort(key=lambda j: j.get("created_at") or "", reverse=True)
    return {"result": [_slim(j) for j in rows[: int(args.get("limit") or 30)]]}


def _scope_of(params: dict) -> Optional[dict]:
    """The run scope a job's parameters point at, if it can be told."""
    if all(params.get(k) for k in ("experiment", "location", "population", "date", "platform", "sensor")):
        scope = {"year": str(params.get("year") or str(params["date"])[:4]),
                 **{k: params[k] for k in SCOPE_KEYS if k != "year"}}
        if params.get("dataset_short_ids"):
            scope["datasetShortIds"] = list(params["dataset_short_ids"])
        return scope
    for key in ("images_prefix", "output_prefix", "orthomosaic_path", "output_traits_geojson_path",
                "output_predictions_path", "image_path", "stitch_prefix"):
        if isinstance(params.get(key), str):
            scope = scope_from_path(params[key])
            if scope:
                return scope
    return None


def _record(job: dict, params: dict, skipped: tuple = ()) -> Any:
    """Show a submitted pipeline job on the Process tab (its run and step)."""
    if str(job.get("job_type")) not in JOB_STEP:
        return None
    scope = _scope_of(params)
    if scope is None:
        return {"not_updated": "could not tell which run this job belongs to"}

    def update(pr):
        run = pr.ensure_run(scope)
        if (run["steps"].get("data_sync") or {}).get("status") != "completed":
            pr.set_step(run, "data_sync", "completed")
        return pr.record_job(scope, job, skipped=skipped)

    return process_tab(update)


def _adopt(pr) -> int:
    """Attach pipeline jobs that no run knows about (submitted before this
    link existed, with `submit_job`, or by another client) to the run of their
    scope, oldest first, so the Process tab shows them too."""
    known = {j for r in pr.state()["runs"] for s in r.get("steps", {}).values() for j in s.get("jobIds") or []}
    # Labelling prompts (LOCATE_PLANTS with `prompted`) belong to no run step.
    jobs = [j for j in client().jobs(limit=1000)
            if str(j.get("job_type")) in JOB_STEP and str(j.get("id")) not in known
            and not (j.get("parameters") or {}).get("prompted")]
    adopted = 0
    for job in sorted(jobs, key=lambda j: j.get("created_at") or ""):
        params = job.get("parameters") or {}
        scope = _scope_of(params)
        if scope is None:
            continue
        run = pr.ensure_run(scope)
        if (run["steps"].get("data_sync") or {}).get("status") != "completed":
            pr.set_step(run, "data_sync", "completed")
        if job["job_type"] == "RUN_STITCH" and (run["steps"].get("plot_marking") or {}).get("status") != "completed":
            pr.set_step(run, "plot_marking", "completed", outputs=_marking_outputs(scope, params))
        if job["job_type"] == "RUN_ODM" and params.get("skip_gcps") and \
                (run["steps"].get("gcp_selection") or {}).get("status") not in ("completed", "skipped"):
            pr.set_step(run, "gcp_selection", "skipped")
        pr.set_step(run, JOB_STEP[job["job_type"]], "running", job_id=str(job["id"]))
        adopted += 1
    return adopted


def _marking_outputs(scope: dict, params: dict) -> dict:
    """What the Plot Marking step records when a person saves: where the
    markings are and which version is current."""
    directory = "Processed/" + "/".join(str(scope[k]) for k in ("year", "experiment", "location", "population")) \
                + "/PlotMarkings"
    out: dict = {"directory": directory, "plots": len(params.get("plots") or [])}
    try:
        versions = client().versions(directory)
        if versions:
            out["version"] = max(int(v["version"]) for v in versions)
    except Exception:
        pass
    return out


def _runs_view(pr, limit: int) -> dict:
    adopted = _adopt(pr)
    pr.settle()
    out: dict = {"runs": pr.list()[:limit]}
    try:
        from . import guide

        runs, pipelines = guide._state(pr)
        rows = [guide._row(pr, r, pipelines) for r in runs[:limit]]
        out["next_for_each_run"] = [{"run": r["run"], "next_step": r.get("step"), "state": r.get("state"),
                                     **{k: r[k] for k in ("stitching_result", "how_a_finished_step_went",
                                                          "measurable_now_without_a_model") if r.get(k)}} for r in rows]
        def line(r: dict) -> str:
            if not r.get("step"):
                return f"{r['run']}: all steps done"
            if r.get("state") == "failed":
                why = r.get("error")
                job = ((r.get("do") or {}).get("args") or {}).get("job_id")
                if not why and job:
                    try:
                        why = client().job(job).get("error_message")
                    except Exception:
                        why = None
                return f"{r['run']}: {r['step']} FAILED" + (f" because: {why}" if why else " (job_detail gives the reason)")
            return f"{r['run']}: next step is {r['step']} ({r.get('state')})"

        out["tell_the_person"] = "; ".join(line(r) for r in rows) or "there are no runs yet"
    except Exception:
        pass                                  # the plain list is still an answer
    if adopted:
        out["jobs_newly_attached"] = adopted
    return out


def process_runs(args: dict) -> dict:
    """Runs on the app's Process tab, with each step's state."""
    return {"result": process_tab(lambda pr: _runs_view(pr, int(args.get("limit") or 20)))}


def submit_job(args: dict) -> dict:
    params = dict(args.get("parameters") or {})
    job = client().submit_job(args["job_type"], params, args.get("experiment_id"))
    return {"result": {**_slim(job), "process_tab": _record(job, params)}}


def wait_jobs(args: dict) -> dict:
    """Block until the given jobs finish (or the timeout passes)."""
    c = client()
    ids = [str(i) for i in args.get("job_ids") or []]
    if not ids:
        # "Wait for it": the jobs still open, else the one submitted last.
        rows = c.jobs(None, None, 1000)
        rows.sort(key=lambda j: j.get("created_at") or "", reverse=True)
        ids = [str(j["id"]) for j in rows if j.get("status") in ("PENDING", "RUNNING")][:20] or [str(j["id"]) for j in rows[:1]]
        if not ids:
            raise ValueError("there are no jobs to wait for")
    deadline = time.time() + min(int(args.get("timeout_s") or 600), 3600)
    while True:
        rows = [c.job(i) for i in ids]
        open_ = [j for j in rows if j["status"] in ("PENDING", "RUNNING")]
        if not open_ or time.time() >= deadline:
            process_tab(lambda pr: pr.settle())
            counts: dict[str, int] = {}
            for j in rows:
                counts[j["status"]] = counts.get(j["status"], 0) + 1
            return {"result": {"finished": not open_, "counts": counts,
                               "failed": [_slim(j) for j in rows if j["status"] == "FAILED"],
                               "still_open": [_slim(j) for j in open_][:10]}}
        time.sleep(10)


def _experiment_id(name: str) -> Optional[str]:
    exp = next((e for e in client().entities("experiments") if e.get("experiment_name") == name), None)
    return str(exp["id"]) if exp else None


def job_detail(args: dict) -> dict:
    process_tab(lambda pr: pr.settle())
    try:
        return {"result": _slim(client().job(args["job_id"]), with_result=True)}
    except Exception as e:
        # Not a job id (models tend to build one from a run id and a step name). Job ids come
        # from `jobs` or a run's steps: show the jobs this was most likely about.
        rows = client().jobs(None, None, 1000)
        rows.sort(key=lambda j: j.get("created_at") or "", reverse=True)
        words = [w for w in re.split(r"[^a-z]+", str(args["job_id"]).lower()) if len(w) > 3]
        near = [j for j in rows if any(w in str(j.get("job_type") or "").lower().replace("odm", "odm orthomosaic") for w in words)]
        failed = [j for j in (near or rows) if j.get("status") == "FAILED"]
        pick = (failed or near or rows)[:5]
        if len(failed) == 1:
            return {"result": {**_slim(client().job(failed[0]["id"]), with_result=True),
                               "note": f"{args['job_id']!r} is not a job id; this is the one failed job it could mean"}}
        raise ValueError(f"{args['job_id']!r} is not a job id ({type(e).__name__}). Job ids look like the `id` values here; "
                         "call job_detail with one of them: " + json.dumps([_slim(j) for j in pick])[:1500])


def cancel_job(args: dict) -> dict:
    return {"result": _slim(client().cancel_job(args["job_id"]))}


def run_orthomosaic(args: dict) -> dict:
    """RUN_ODM for one aerial scope (experiment/site/population/date/platform/sensor)."""
    scope = {k: args[k] for k in ("experiment", "location", "population", "date", "platform", "sensor")}
    params: dict[str, Any] = {"year": args["date"][:4], **scope}
    for k in ("dataset_short_ids", "reconstruction_quality", "custom_options", "skip_gcps"):
        if args.get(k) is not None:
            params[k] = args[k]
    job = client().submit_job("RUN_ODM", params, args.get("experiment_id") or _experiment_id(args["experiment"]))
    skipped = ("gcp_selection",) if args.get("skip_gcps") else ()
    return {"result": {**_slim(job), "process_tab": _record(job, params, skipped)}}


def _weights_in_app(ref: str) -> str:
    """Where a weights file is in the app. A file on this computer is copied in
    first (Models/weights/<its name>); a bare file name means that folder."""
    local = Path(ref).expanduser()
    if local.is_file():
        target = f"Models/weights/{local.name}"
        c = client()
        data = local.read_bytes()
        part = 8 * 1024 * 1024
        total = max(1, -(-len(data) // part))
        for i in range(total):
            c.upload_chunk(data[i * part:(i + 1) * part], i, total, f"agent:{target}:{len(data)}", target)
        return target
    if "/" not in ref and "\\" not in ref:
        return f"Models/weights/{ref}"
    return ref


def _model_spec(model: Any, task: Optional[str]) -> dict:
    """The model as the worker wants it. Accepts the full object, or the short
    form a person would say: "huggingface:facebook/detr-resnet-50",
    "roboflow:plants-x1y2/3", "weights:Models/weights/cowpea.pt"."""
    if isinstance(model, dict):
        spec = dict(model)
        if "source" not in spec and spec.get("model_source"):
            spec["source"] = spec.pop("model_source")
    elif isinstance(model, str) and ":" in model:
        kind, ref = model.split(":", 1)
        kind, ref = kind.strip().lower(), ref.strip()
        if kind in ("huggingface", "hf"):
            spec = {"source": "huggingface", "hf_model_id": ref}
        elif kind == "roboflow":
            spec = {"source": "roboflow", "model_id": ref}
        elif kind in ("weights", "local_weights", "local"):
            spec = {"source": "local_weights", "weights_path": _weights_in_app(ref)}
        elif kind and ref and kind.replace("_", "").replace("-", "").isalnum():
            # Another provider: passed on as named; the worker says if it cannot run it.
            spec = {"source": kind, "model_id": ref}
        else:
            raise ValueError(f"model {model!r}: use huggingface:<id>, roboflow:<id>, weights:<path> or <provider>:<id>")
    else:
        raise ValueError('model: an object with "source", or short form like "huggingface:facebook/detr-resnet-50"')
    if spec.get("source") in ("huggingface", "local_weights"):
        spec.setdefault("task_type", task or "detection")
    return spec


def resolve_inference(args: dict) -> dict:
    """Fill in what follows from the rest: `run` (words naming one pipeline run)
    gives the plot-images folder and where the predictions go; the model may
    be given in short form."""
    args = dict(args)
    args["model"] = _model_spec(args.get("model"), args.pop("task", None))
    one = str(args.get("image_path") or "")
    if one and not one.startswith(("Processed/", "Raw/")):
        # "Davis 2026-08-21 plot images" is a description, not an image: the run words say the same.
        args.pop("image_path")
        if not args.get("run") and not args.get("images_prefix"):
            args["run"] = " ".join(w for w in one.replace("/", " ").split() if w.lower() not in ("plot", "images", "plotimages"))
    given = str(args.get("images_prefix") or "")
    if given and not given.startswith(("Processed/", "Raw/")):
        # Not a storage path: words naming the run ("Davis 2026-08-21/PlotImages") - use them as such.
        args["run"] = " ".join(w for w in given.replace("/", " ").split() if w.lower() != "plotimages")
        args.pop("images_prefix")
    if args.get("run") and not (args.get("images_prefix") or args.get("image_path")):
        from . import guide
        from .process_runs import ProcessRuns

        pr = ProcessRuns(client())
        runs, pipelines = guide._state(pr)
        found = guide._match(runs, str(args["run"]))
        if len(found) != 1:
            raise ValueError(f"`run` must pick exactly one run; it matches {len(found)}: " +
                             ", ".join(guide._label(pr.describe(r, pipelines)) for r in (found or runs)[:8]))
        up = found[0].get("uploadScope") or {}
        args["images_prefix"] = "Processed/" + "/".join(str(up[k]) for k in SCOPE_KEYS) + "/PlotImages/"
        args.setdefault("per_plot", True)
    args.pop("run", None)
    prefix = args.get("images_prefix") or ""
    if not args.get("output_predictions_path") and prefix:
        m = args["model"]
        name = str(args.get("count_label") or m.get("hf_model_id") or m.get("model_id") or m.get("weights_path") or "model")
        name = "".join(c if c.isalnum() else "-" for c in name.split("/")[-1].rsplit(".", 1)[0]).strip("-").lower()
        base = prefix.rstrip("/").rsplit("/", 1)[0] if prefix.rstrip("/").endswith(("PlotImages",)) or "AgRowStitch_v" in prefix \
            else prefix.rstrip("/")
        args["output_predictions_path"] = f"{base}/predictions/{name}-v1.json"
        args.setdefault("count_label", name)
    return args


def run_inference(args: dict) -> dict:
    """LOCATE_PLANTS: a detection / segmentation / classification model over images."""
    args = resolve_inference(args)
    if bool(args.get("image_path")) == bool(args.get("images_prefix")):
        raise ValueError("give exactly one of image_path or images_prefix")
    params = {k: args[k] for k in ("image_path", "images_prefix", "output_predictions_path", "count_label",
                                   "confidence_threshold", "iou_threshold") if args.get(k) is not None}
    params.update(args.get("model") or {})
    if args.get("per_plot") and params.get("images_prefix"):
        # Plot images + the scope's active boundaries: the worker then writes
        # each plot's count to the trait records (Analyze and map views).
        scope = scope_from_path(params["images_prefix"])
        if scope is None:
            raise ValueError("per_plot needs images_prefix under Processed/…/PlotImages/")
        directory = "Processed/" + "/".join(str(scope[k]) for k in SCOPE_KEYS) + "/"
        snap = client().load_version(directory).get("state_snapshot") or {}
        if not (snap.get("boundaries") or {}).get("features"):
            raise ValueError("no active plot boundaries for this scope (run plot_boundaries first)")
        params["boundaries"] = snap["boundaries"]
    job = client().submit_job("LOCATE_PLANTS", params, args.get("experiment_id") or
                              _experiment_id((scope_from_path(params.get("images_prefix") or params.get("image_path") or "")
                                              or {}).get("experiment", "")))
    return {"result": {**_slim(job), "predictions": params.get("output_predictions_path"),
                       "process_tab": _record(job, params),
                       "next": [{"tool": "wait_jobs", "args": {"job_ids": [str(job.get("id"))]}},
                                {"tool": "inference_stats", "args": {"predictions_path": params.get("output_predictions_path")}}]}}


def run_trait_extraction(args: dict) -> dict:
    """EXTRACT_TRAITS: per-plot traits from an orthomosaic and plot boundaries."""
    params = {k: args[k] for k in ("orthomosaic_path", "boundary_geojson_path", "output_traits_geojson_path",
                                   "dem_path", "thermal_path", "exg_threshold") if args.get(k) is not None}
    job = client().submit_job("EXTRACT_TRAITS", params, args.get("experiment_id"))
    return {"result": {**_slim(job), "process_tab": _record(job, params)}}


# ── destructive ──────────────────────────────────────────────────────────────

def delete_files(args: dict) -> dict:
    c = client()
    names = [str(n) for n in args["object_names"]]
    for n in names:
        c.delete_object(n)
    return {"result": {"deleted": len(names)}}


def delete_job(args: dict) -> dict:
    client().request("DELETE", f"/api/jobs/{args['job_id']}")
    return {"result": {"deleted": args["job_id"]}}


def _app(fn, description: str, props: dict, required: list[str], group: str, destructive: bool = False) -> None:
    _tool(fn, description, props, required, track=False, destructive=destructive, group=group)


_app(skills, "List the skills (written procedures for each stage of the app).", {}, [], "skills")
_app(read_skill, "Read one skill: the steps for a stage, in order. Do this before starting a stage you have not done "
     "in this session. full=true adds the background (why, tuning, what to do when it fails).",
     {"name": _str, "full": _bool}, ["name"], "skills")
_app(status, "Overview of the stack: experiments, recent job counts, active jobs, busy workers, running uploads.",
     {}, [], "status")
_app(process_runs, "Runs on the app's Process tab with every step's state (pending, running, completed, failed, "
     "skipped), the next step, and the page to open. Work done with the pipeline tools is recorded there "
     "automatically.", {"limit": _int}, [], "status")
def regroup_runs(args: dict) -> dict:
    from .process_runs import ProcessRuns

    moved = ProcessRuns(client()).regroup(dry_run=bool(args.get("dry_run")))
    return {"result": {"moved": moved, "dry_run": bool(args.get("dry_run")),
                       "note": "only the Process tab's folders change; jobs and data are untouched"}}


def register_models(args: dict) -> dict:
    from .process_runs import ProcessRuns

    pr = ProcessRuns(client())
    added = []
    for run in pr.state()["runs"]:
        for m in pr.register_models_from_jobs(run):
            added.append({"run": run.get("name"), "model": m.get("label") or m.get("hf_model_id")
                          or m.get("roboflow_model_id") or m.get("weights_path") or m.get("source"),
                          "source": m.get("source")})
    return {"result": {"added": added, "note": "each model a run's inference jobs used is now in that run's "
                                               "pipeline list (Inference tool), so it can be run again by hand"}}


_app(regroup_runs, "Move runs out of the old 'Agent runs' workspace into their experiment's workspace on the "
     "Process tab (agent runs keep a small agent icon). dry_run=true only lists the moves.",
     {"dry_run": _bool}, [], "status")
_app(register_models, "Add every model already run on a Process-tab run (its inference jobs) to that run's pipeline "
     "model list, for runs where they are missing. New inference calls do this by themselves.", {}, [], "status")
_app(entities, "List experiments (the default), sites, populations, seasons, sensor_platforms, sensors or datasets.",
     {"kind": {**_str, "description": "experiments | sites | populations | seasons | sensor_platforms | sensors | datasets"}},
     [], "status")
_app(datasets, "An experiment's upload batches (datasets) with their storage location.",
     {"experiment": _str}, ["experiment"], "status")
_app(browse, "List objects under a storage prefix (paged; listing is recursive, so use a narrow prefix).",
     {"prefix": _str, "limit": _int, "offset": _int}, ["prefix"], "status")
_app(reference_datasets, "Reference data loaded in the app (field designs, hand-measured traits per plot).",
     {}, [], "status")
_app(upload, "Start a background upload of local files or folders into the app; returns a task id to poll with "
     "`tasks`. Creates the experiment/site/population/season/platform/sensor if missing. data_type: amiga_bin "
     "(rover .bin logs; extraction is queued per file), images, orthomosaic.",
     {"paths": {**_strs, "description": "folders or files on this computer"},
      "experiment": {**_str, "description": "the experiment / project name"},
      "site": {**_str, "description": "where the field is (the location)"},
      "population": {**_str, "description": "the trial or crop: which set of plots, e.g. Sorghum"},
      "date": {**_str, "description": "collection date, YYYY-MM-DD"}, "platform": _str, "sensor": _str,
      "data_type": _str, "parallel": {**_int, "description": "files in flight at once, 1-8 (default 3)"},
      "run_of_day": {**_str, "description": "only for diurnal data (the field covered more than once that day): "
                                            "which run this is, e.g. 1, 2, morning"},
      "treatment": {**_str, "description": "only if the data was collected separately per treatment: which one"},
      "folders_are": {**_str, "description": "when the path holds several folders, what they stand for: runs "
                                             "(of the same day) | treatments | one (ignore folders, one batch)"},
      "name_contains": _str, "dataset_id": {**_str, "description": "add to this existing batch instead of a new one"},
      "extract": _bool, "dry_run": _bool},
     ["paths", "experiment", "site", "population", "date", "data_type"], "upload")
_app(look_at_folder, "Look at a folder on this computer before uploading it: which sub-folders hold images, rover "
     ".bin logs or .tif maps (counts and size per folder), other files, and advice on the upload calls that fit. "
     "Use it whenever the person names a folder; a wrong path returns what is there instead.",
     {"path": {**_str, "description": "the folder (or file) as the person gave it"},
      "depth": {**_int, "description": "how many folder levels down to look (default 4)"}}, ["path"], "upload")
def online_storage(args: dict) -> dict:
    """Online storage (Box, Google Drive, S3, …) copied to where the stack runs, then uploaded."""
    from . import cloud
    from .hpc_tools import active_cluster

    cluster = active_cluster()
    where = "cluster" if cluster else "local"
    action = str(args.get("action") or "list")
    if action == "list":
        out = cloud.remotes(where, cluster)
        if not out["remotes"]:
            out["next"] = ("no connection yet: the person adds one on the Files page (Upload > Copy from online "
                           "storage > Connect), signing in in their browser")
        return {"result": out}
    if action == "browse":
        return {"result": cloud.browse(str(args.get("name") or ""), str(args.get("path") or ""), where, cluster)}
    if action == "copy":
        c = client()
        settings = {k: args.get(k) for k in ("experiment", "site", "population", "date", "platform", "sensor",
                                             "data_type", "name_ends", "run_of_day", "treatment") if args.get(k)}
        out = cloud.fetch(str(args.get("name") or ""), str(args.get("path") or ""), where=where, cluster=cluster,
                          settings=settings or None, keep=bool(args.get("keep")), token=c.token(), api=c.base)
        return {"result": out, "next": "follow it with online_storage action=state id=" + str(out["id"])}
    if action == "state":
        fid = str(args.get("id") or "")
        return {"result": cloud.fetch_state(fid, where, cluster) if fid else cloud.fetches(where, cluster)}
    raise ValueError("action: list | browse | copy | state")


_app(online_storage, "Data in online storage (Box, Google Drive, Dropbox, S3, WebDAV, a web folder, SFTP) that the "
     "person connected on the Files page. action=list: the connections. browse: one folder (name, path). copy: "
     "copy a folder or file (name, path) to where the stack runs (a cluster job when the stack is on a cluster, "
     "never through this computer) and, with the run's settings, upload it as one batch (asks first). state: a "
     "copy's progress (id), or the recent ones.",
     {"action": {**_str, "description": "list | browse | copy | state"},
      "name": {**_str, "description": "the connection's name"},
      "path": {**_str, "description": "folder or file inside the connection, e.g. Kearney 2022/orthos"},
      "id": _str, "keep": {**_bool, "description": "keep the copy after uploading (default: remove it)"},
      "experiment": _str, "site": _str, "population": _str, "date": {**_str, "description": "YYYY-MM-DD"},
      "platform": _str, "sensor": _str,
      "data_type": {**_str, "description": "images | amiga_bin | orthomosaic"},
      "name_ends": {**_str, "description": "keep only files whose names end so, comma separated"},
      "run_of_day": _str, "treatment": _str}, ["action"], "upload")
_app(tasks, "Progress of background uploads: one task (task_id) or the latest ones.",
     {"task_id": _str, "limit": _int}, [], "upload")
_app(wait_task, "Wait for a background upload: returns when it finishes or after timeout_s (default 300, max "
     "3600) with its progress. Use this instead of calling `tasks` repeatedly.",
     {"task_id": {**_str, "description": "omit for the upload started last"}, "timeout_s": _int}, [], "upload")
_app(cancel_task, "Stop a background upload after the parts in flight.", {"task_id": _str}, ["task_id"], "upload")
_app(jobs, "List jobs, newest first; filter by status (PENDING, RUNNING, COMPLETED, FAILED, CANCELLED) or job_type.",
     {"status": _str, "job_type": _str, "limit": _int}, [], "jobs")
_app(job_detail, "One job with its parameters and result.", {"job_id": _str}, ["job_id"], "jobs")
_app(wait_jobs, "Wait until the listed jobs finish (max 1 h per call); returns counts and failures. Without "
     "job_ids: the jobs still open, else the one submitted last.",
     {"job_ids": _strs, "timeout_s": _int}, [], "jobs")
_app(cancel_job, "Cancel a pending or running job.", {"job_id": _str}, ["job_id"], "jobs")
_app(submit_job, "Submit any job type with raw parameters (see the pipeline skills for each type's parameters).",
     {"job_type": _str, "parameters": _obj, "experiment_id": _str}, ["job_type", "parameters"], "jobs")
_app(run_orthomosaic, "Aerial: build the orthomosaic (RUN_ODM) for one scope.",
     {"experiment": _str, "location": _str, "population": _str, "date": _str, "platform": _str, "sensor": _str,
      "dataset_short_ids": _strs, "reconstruction_quality": _str, "custom_options": _str, "skip_gcps": _bool,
      "experiment_id": _str}, ["experiment", "location", "population", "date", "platform", "sensor"], "aerial")
_app(run_inference, "Run a detection / segmentation / classification model on plot images. Simplest: run = words "
     "naming the pipeline run (its plot images are used, each plot's count is stored, the output path is chosen) "
     "and model = 'huggingface:<model id>' | 'roboflow:<model id>' | 'weights:<path>'. Returns the job id and "
     "the two calls to make next. Other images: image_path or images_prefix.",
     {"run": {**_str, "description": "words that pick one run: its site and date as the person said them"},
      "model": {"description": "'huggingface:<id>', 'roboflow:<id>', 'weights:<path>', or the full object from the skill"},
      "task": {**_str, "description": "detection (default), segmentation or classification"},
      "image_path": _str, "images_prefix": _str, "output_predictions_path": _str, "per_plot": _bool,
      "count_label": _str, "confidence_threshold": {"type": "number"}, "iou_threshold": {"type": "number"},
      "experiment_id": _str}, ["model"], "inference")
_app(run_trait_extraction, "Per-plot traits from an orthomosaic + plot boundaries (EXTRACT_TRAITS).",
     {"orthomosaic_path": _str, "boundary_geojson_path": _str, "output_traits_geojson_path": _str,
      "dem_path": _str, "thermal_path": _str, "exg_threshold": {"type": "number"}, "experiment_id": _str},
     ["orthomosaic_path", "boundary_geojson_path", "output_traits_geojson_path"], "aerial")
_app(delete_files, "Delete objects from storage. Cannot be undone.", {"object_names": _strs}, ["object_names"],
     "status", destructive=True)
_app(delete_job, "Delete a job record. Cannot be undone.", {"job_id": _str}, ["job_id"], "jobs", destructive=True)
_ = _ints  # re-exported for symmetry with tools.py


def reference_upload(args: dict) -> dict:
    """Upload a reference table (field design / hand measurements) with a column mapping."""
    import json as _json
    import os as _os
    import urllib.error
    import urllib.parse
    import urllib.request

    path = Path(args["path"]).expanduser()
    if not path.is_file():
        raise ValueError(f"not found: {path}")
    mapping = dict(args["mapping"])
    if "plot_id" not in mapping.values() and not ({"row", "col"} <= set(mapping.values())):
        raise ValueError("the mapping must send one column to plot_id (or two columns to row and col)")
    c = client()
    q = {"name": args.get("name") or path.stem, "column_mapping_json": _json.dumps(mapping)}
    for k in ("experiment", "location", "population", "date"):
        if args.get(k):
            q[k] = args[k]
    boundary = "----gemiagent" + _os.urandom(8).hex()
    crlf = chr(13) + chr(10)
    head = (f'--{boundary}{crlf}Content-Disposition: form-data; name="file"; filename="{path.name}"{crlf}'
            f"Content-Type: application/octet-stream{crlf}{crlf}").encode()
    body = head + path.read_bytes() + f"{crlf}--{boundary}--{crlf}".encode()
    req = urllib.request.Request(c.base + "/api/reference_data/upload?" + urllib.parse.urlencode(q), data=body,
                                 method="POST", headers={"Authorization": f"Bearer {c.token()}",
                                                         "Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            out = _json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"upload refused (HTTP {e.code}): {e.read().decode('utf-8', 'replace')[:400]}") from None
    return {"result": {k: out.get(k) for k in ("id", "name", "experiment", "location", "population", "trait_columns",
                                               "plot_count", "match_report")}}


_app(reference_upload, "Upload a reference table (.csv / .xlsx on this computer). mapping = {file column: role}; roles "
     "are plot_id, row, col, accession, a trait name (to keep that column as a trait), or __ignore__. Returns how "
     "many rows matched existing plots. Always report the match numbers.",
     {"path": _str, "mapping": _obj, "name": _str, "experiment": _str, "location": _str, "population": _str,
      "date": _str}, ["path", "mapping"], "status")
