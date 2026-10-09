"""App-wide tools: what is in the stack, uploads, jobs and the pipeline's
job types. Registered into tools.TOOLS, so the CLI, the MCP server and the
agent runner all get them.
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Optional

from . import uploads
from .client import AGENT_DIR, SKILLS_DIR, ApiError
from .process_runs import JOB_STEP, SCOPE_KEYS, scope_from_path
from .tools import TOOLS, _bool, _int, _ints, _str, _tool, client, process_tab

_ = AGENT_DIR
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
    return {"result": text}


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
        "experiments": [e.get("experiment_name") for e in c.entities("experiments")],
        "jobs_recent": counts, "jobs_active": active[:30], "workers_busy": workers,
        "pending_job_types": waiting,
        "note": ("PENDING jobs with no worker for their type stay pending — start that worker"
                 if waiting else None),
        "uploads": [t for t in uploads.list_tasks() if t["status"] in ("running", "stalled")],
        "process_runs": process_tab(lambda pr: _runs_view(pr, 10)),
    }}


def entities(args: dict) -> dict:
    kind = args["kind"]
    c = client()
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
    return {"result": {"total": page.get("total_count"), "shown": len(files),
                       "objects": [{"name": f["object_name"], "size": f.get("size")} for f in files]}}


def reference_datasets(args: dict) -> dict:
    rows = client().get_json("/api/reference_data/") or []
    keep = ("id", "name", "experiment", "location", "population", "dataset_date", "trait_columns", "plot_count")
    return {"result": [{k: r.get(k) for k in keep} for r in rows]}


# ── uploads ──────────────────────────────────────────────────────────────────

def upload(args: dict) -> dict:
    """Start a background upload batch."""
    kind = uploads.DATA_TYPES.get(args.get("data_type", ""))
    if kind is None:
        raise ValueError(f"data_type must be one of {', '.join(uploads.DATA_TYPES)}")
    files: list[Path] = []
    for p in args["paths"] if isinstance(args["paths"], list) else [args["paths"]]:
        path = Path(p).expanduser()
        if path.is_dir():
            files += sorted(f for f in path.iterdir() if f.is_file() and f.suffix.lower() in kind["ext"])
        elif path.is_file():
            files.append(path)
        else:
            raise ValueError(f"not found: {p}")
    if args.get("name_contains"):
        files = [f for f in files if str(args["name_contains"]) in f.name]
    if args.get("dry_run"):
        return {"result": {"would_upload": len(files), "bytes": sum(f.stat().st_size for f in files),
                           "first": [f.name for f in files[:5]]}}
    return {"result": uploads.start(
        client(), files, experiment=args["experiment"], site=args["site"], population=args["population"],
        date=args["date"], platform=args.get("platform") or "Amiga", sensor=args.get("sensor") or "RGB",
        data_type=args["data_type"], parallel=int(args.get("parallel") or 3),
        dataset_id=args.get("dataset_id"), extract=args.get("extract"))}


def tasks(args: dict) -> dict:
    if args.get("task_id"):
        return {"result": uploads.summary(uploads.read(args["task_id"]))}
    return {"result": uploads.list_tasks()[: int(args.get("limit") or 10)]}


def wait_task(args: dict) -> dict:
    """Block until an upload finishes, or the timeout passes."""
    deadline = time.time() + min(int(args.get("timeout_s") or 300), 3600)
    while True:
        s = uploads.summary(uploads.read(args["task_id"]))
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
    jobs = [j for j in client().jobs(limit=1000)
            if str(j.get("job_type")) in JOB_STEP and str(j.get("id")) not in known]
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
    ids = [str(i) for i in args["job_ids"]]
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
    return {"result": _slim(client().job(args["job_id"]), with_result=True)}


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


def run_inference(args: dict) -> dict:
    """LOCATE_PLANTS: a detection / segmentation / classification model over images."""
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
    return {"result": {**_slim(job), "process_tab": _record(job, params)}}


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
_app(read_skill, "Read one skill. Do this before starting a stage you have not done in this session.",
     {"name": _str}, ["name"], "skills")
_app(status, "Overview of the stack: experiments, recent job counts, active jobs, busy workers, running uploads.",
     {}, [], "status")
_app(process_runs, "Runs on the app's Process tab with every step's state (pending, running, completed, failed, "
     "skipped), the next step, and the page to open. Work done with the pipeline tools is recorded there "
     "automatically.", {"limit": _int}, [], "status")
_app(entities, "List experiments, sites, populations, seasons, sensor_platforms, sensors or datasets.",
     {"kind": _str}, ["kind"], "status")
_app(datasets, "An experiment's upload batches (datasets) with their storage location.",
     {"experiment": _str}, ["experiment"], "status")
_app(browse, "List objects under a storage prefix (paged; listing is recursive, so use a narrow prefix).",
     {"prefix": _str, "limit": _int, "offset": _int}, ["prefix"], "status")
_app(reference_datasets, "Reference data loaded in the app (field designs, hand-measured traits per plot).",
     {}, [], "status")
_app(upload, "Start a background upload of local files or folders into the app; returns a task id to poll with "
     "`tasks`. Creates the experiment/site/population/season/platform/sensor if missing. data_type: amiga_bin "
     "(rover .bin logs; extraction is queued per file), images, orthomosaic.",
     {"paths": _strs, "experiment": _str, "site": _str, "population": _str,
      "date": {**_str, "description": "collection date, YYYY-MM-DD"}, "platform": _str, "sensor": _str,
      "data_type": _str, "parallel": {**_int, "description": "files in flight at once, 1-8 (default 3)"},
      "name_contains": _str, "dataset_id": {**_str, "description": "add to this existing batch instead of a new one"},
      "extract": _bool, "dry_run": _bool},
     ["paths", "experiment", "site", "population", "date", "data_type"], "upload")
_app(tasks, "Progress of background uploads: one task (task_id) or the latest ones.",
     {"task_id": _str, "limit": _int}, [], "upload")
_app(wait_task, "Wait for a background upload: returns when it finishes or after timeout_s (default 300, max "
     "3600) with its progress. Use this instead of calling `tasks` repeatedly.",
     {"task_id": _str, "timeout_s": _int}, ["task_id"], "upload")
_app(cancel_task, "Stop a background upload after the parts in flight.", {"task_id": _str}, ["task_id"], "upload")
_app(jobs, "List jobs, newest first; filter by status (PENDING, RUNNING, COMPLETED, FAILED, CANCELLED) or job_type.",
     {"status": _str, "job_type": _str, "limit": _int}, [], "jobs")
_app(job_detail, "One job with its parameters and result.", {"job_id": _str}, ["job_id"], "jobs")
_app(wait_jobs, "Wait until the listed jobs finish (max 1 h per call); returns counts and failures.",
     {"job_ids": _strs, "timeout_s": _int}, ["job_ids"], "jobs")
_app(cancel_job, "Cancel a pending or running job.", {"job_id": _str}, ["job_id"], "jobs")
_app(submit_job, "Submit any job type with raw parameters (see the pipeline skills for each type's parameters).",
     {"job_type": _str, "parameters": _obj, "experiment_id": _str}, ["job_type", "parameters"], "jobs")
_app(run_orthomosaic, "Aerial: build the orthomosaic (RUN_ODM) for one scope.",
     {"experiment": _str, "location": _str, "population": _str, "date": _str, "platform": _str, "sensor": _str,
      "dataset_short_ids": _strs, "reconstruction_quality": _str, "custom_options": _str, "skip_gcps": _bool,
      "experiment_id": _str}, ["experiment", "location", "population", "date", "platform", "sensor"], "aerial")
_app(run_inference, "Run a model over one image (image_path) or a folder (images_prefix); model = "
     "{source: roboflow|huggingface|local_weights, task_type, …} (keys in the inference skill). per_plot=true "
     "on a PlotImages folder also stores each plot's count as a trait.",
     {"image_path": _str, "images_prefix": _str, "output_predictions_path": _str, "model": _obj, "per_plot": _bool,
      "count_label": _str, "confidence_threshold": {"type": "number"}, "iou_threshold": {"type": "number"},
      "experiment_id": _str}, ["output_predictions_path", "model"], "inference")
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
