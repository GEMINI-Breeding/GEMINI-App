"""How well does a model run GEMI? Scenarios over a simulated app.

The model under test is real (whatever endpoint is given); the app behind the
tools is simulated: a fake REST layer holding experiments, runs, jobs and
files in memory, and stand-ins for the few tools that need real images or a
cluster. So the result measures the part that depends on the model: choosing
tools, filling arguments from what the person said, carrying a run through
its steps, keeping plots tied to the right field design, reading a picture,
and telling the truth about results. Nothing touches a real stack or cluster.

    PYTHONPATH=. python tests/model_eval.py --url http://127.0.0.1:11434/v1 --model gemma4:e4b [--key K]
                                            [--only s1,s5] [--scope skill|all] [--repeat 2]
                                            [--record 1] [--as <catalog key>]

Writes agent/work/eval/<model>.json and prints one line per scenario.
"""
from __future__ import annotations

import json
import re
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from gemi_agent import app_tools, client as client_mod, guide, runner, tools
from gemi_agent.client import AGENT_DIR, ApiError, Client
from gemi_agent.process_runs import ProcessRuns
from gemi_agent.tools import TOOLS, use_client

client_mod.SUBMIT_HOOKS.clear()           # no real cluster: a submitted job needs no real worker
TMP = Path(tempfile.mkdtemp(prefix="gemi-eval-"))
SCOPE = ("2026", "DEMO", "Davis", "Sorghum", "2026-08-21", "Drone", "RGB")
ROVER = ("2026", "DEMO", "Coachella", "Lima", "2026-09-17", "Amiga", "RGB")


# ── the simulated app ────────────────────────────────────────────────────────

class World(Client):
    """The REST API, in memory. Also the record of what the model made happen."""

    def __init__(self) -> None:
        self.base, self.bucket, self._token = "http://simulated", "gemini", "t"
        self.entities_ = {"experiments": [{"id": "e1", "experiment_name": "DEMO"}],
                          "sites": [{"id": "s1", "site_name": "Davis"}, {"id": "s2", "site_name": "Coachella"}],
                          "populations": [{"id": "p1", "population_name": "Sorghum"}, {"id": "p2", "population_name": "Lima"}],
                          "seasons": [], "sensor_platforms": [], "sensors": [], "datasets": []}
        self.state = {"workspaces": [], "pipelines": [], "runs": []}
        self.jobs_: list[dict] = []
        self.files: list[str] = []
        self.versions_: dict[str, list[dict]] = {}
        self.calls: list[tuple[str, dict]] = []           # every tool call the model made
        self.did: dict[str, Any] = {}                     # what the stand-in tools recorded
        self.compute = {"core": "running", "amiga": "stopped", "stitch": "stopped", "odm": "running", "geo": "stopped",
                        "ml": "stopped", "llm": "running"}
        self.inference = {"images": 250, "detections": 1234, "images_with_none": 3}
        self.mark_mode = "single frames"

    # -- seeding --------------------------------------------------------------
    def add_run(self, scope: tuple, done: list[str], failed: Optional[str] = None, error: str = "") -> dict:
        pr = ProcessRuns(self)
        keys = ("year", "experiment", "location", "population", "date", "platform", "sensor")
        run = pr.ensure_run({**dict(zip(keys, scope)), "datasetShortIds": ["c0fca235"]})
        for step in done:
            out = None
            if step == "orthomosaic":
                out = {"versions": [{"filename": "odm_orthophoto.tif",
                                     "path": "gemini/Processed/" + "/".join(scope) + "/odm_orthophoto.tif"}]}
            pr.set_step(run, step, "completed", outputs=out)
        if failed:
            job = self.add_job({"RUN_ODM": "RUN_ODM"}.get(failed, "RUN_ODM"), "FAILED", error=error)
            pr.set_step(run, failed if failed != "RUN_ODM" else "orthomosaic", "failed", job_id=job["id"], error=error)
        return run

    def add_job(self, job_type: str, status: str = "COMPLETED", params: Optional[dict] = None, error: str = "") -> dict:
        n = len(self.jobs_) + 1
        job = {"id": f"job-{n:03d}", "job_type": job_type, "status": status, "progress": 100 if status == "COMPLETED" else 40,
               "progress_detail": None, "error_message": error or None, "worker_id": None, "parameters": params or {},
               "created_at": f"2026-10-0{min(n, 9)}T10:00:00Z", "started_at": None, "completed_at": None, "result": {}}
        if job_type == "RUN_ODM" and status == "COMPLETED":
            p = params or {}
            job["result"] = {"orthophoto_path": "Processed/" + "/".join(str(p.get(k, "x")) for k in
                             ("year", "experiment", "location", "population", "date", "platform", "sensor")) + "/odm_orthophoto.tif"}
        self.jobs_.append(job)
        return job

    # -- the API --------------------------------------------------------------
    def request(self, method: str, path: str, body: Any = None, timeout: int = 120) -> bytes:
        def ok(x: Any) -> bytes:
            return json.dumps(x).encode()

        p, _, q = path.partition("?")
        query = dict(x.split("=", 1) for x in q.split("&") if "=" in x)
        if p == "/api/users/me":
            return ok({"email": "person@example.com", "is_superuser": True})
        m = re.fullmatch(r"/api/(\w+)/all", p)
        if m and m.group(1) in self.entities_:
            return ok(self.entities_[m.group(1)])
        if p == "/api/jobs/all":
            rows = [j for j in self.jobs_ if (not query.get("status") or j["status"] == query["status"])
                    and (not query.get("job_type") or j["job_type"] == query["job_type"])]
            return ok(rows[: int(query.get("limit", 100))])
        if p == "/api/jobs/submit":
            return ok(self.add_job(body["job_type"], "COMPLETED", body.get("parameters")))
        m = re.fullmatch(r"/api/jobs/([\w-]+)(/cancel)?", p)
        if m:
            job = next((j for j in self.jobs_ if j["id"] == m.group(1)), None)
            if job is None:
                raise ApiError(404, "no such job", path)
            return ok(job)
        if p == "/api/process_state":
            return ok(self.state)
        m = re.fullmatch(r"/api/process_state/(workspace|pipeline|run)/([\w-]+)", p)
        if m and method == "PUT":
            rows = self.state[m.group(1) + "s"]
            rows[:] = [r for r in rows if r["id"] != m.group(2)] + [body["doc"]]
            return ok({})
        if "/list_paginated/" in p:
            prefix = p.split("/list_paginated/gemini/", 1)[-1].replace("%2F", "/")
            hits = [f for f in self.files if f.startswith(prefix)]
            return ok({"total_count": len(hits), "files": [{"object_name": f, "size": 1000} for f in hits[:int(query.get("limit", 100))]]})
        if p == "/api/plot_geometry/versions/list":
            return ok(self.versions_.get(body["directory"], []))
        if p == "/api/plot_geometry/versions/load":
            rows = self.versions_.get(body["directory"], [])
            return ok(rows[-1] if rows else {"state_snapshot": {}})
        if p == "/api/plot_geometry/versions/save":
            rows = self.versions_.setdefault(body["directory"], [])
            rows.append({"version": len(rows) + 1, "state_snapshot": body["state_snapshot"], "name": body.get("name")})
            return ok(rows[-1])
        if p == "/api/reference_data/":
            return ok([])
        m = re.fullmatch(r"/api/experiments/id/([\w-]+)/datasets", p)
        if m:
            return ok([])
        raise ApiError(404, "not in the simulated app", path)

    def run_of(self, scope: tuple) -> dict:
        return next(r for r in self.state["runs"] if (r.get("uploadScope") or {}).get("date") == scope[4]
                    and (r.get("uploadScope") or {}).get("location") == scope[2])

    def steps(self, scope: tuple) -> dict:
        return {k: v.get("status") for k, v in self.run_of(scope)["steps"].items()}


W: World


def _picture(name: str, draw: Callable) -> str:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (900, 420), (96, 78, 60))
    draw(ImageDraw.Draw(img), img)
    path = TMP / name
    img.save(path)
    return str(path)


def _overlay() -> str:
    def draw(d, img):
        for r in range(4):
            for c in range(10):
                x, y = 40 + c * 84, 40 + r * 90
                d.rectangle([x, y, x + 70, y + 70], fill=(40, 110, 50), outline=(255, 0, 255), width=3)
                d.text((x + 22, y + 28), str(101 + r * 10 + c), fill=(255, 255, 0))
    return _picture("overlay.png", draw)


STAKE_AT = 46          # where the stake really is, on the close-up's ruler


def _closeup() -> str:
    def draw(d, img):
        d.rectangle([0, 150, 900, 330], fill=(52, 120, 48))               # the crop row
        d.rectangle([0, 0, 900, 34], fill=(20, 20, 20))                   # ruler
        for off in range(-200, 201, 20):
            x = 450 + off * 2
            d.line([x, 0, x, 34 if off % 100 == 0 else 14], fill=(255, 255, 255), width=1)
            if off % 40 == 0:
                d.text((x + 3, 16), f"{off:+d}" if off else "0", fill=(255, 255, 255))
        d.line([450, 34, 450, 420], fill=(255, 0, 255), width=2)          # where the boundary is now
        x = 450 + STAKE_AT * 2
        d.rectangle([x - 20, 150, x + 20, 330], fill=(96, 78, 60))        # gap in the row at the stake
        d.rectangle([x - 5, 120, x + 5, 360], fill=(222, 196, 140))       # the wooden stake
        d.rectangle([x - 5, 120, x + 5, 132], fill=(240, 60, 40))         # its painted top
    return _picture("closeup.png", draw)


# ── stand-ins for tools that need pictures, files or a cluster ───────────────

def _record(name: str, args: dict) -> None:
    W.did.setdefault(name, []).append(dict(args))


def _job_tool(job_type: str, step: str, scope_from: str = "") -> Callable:
    def fn(args: dict) -> dict:
        _record(fn.__name__, args)
        path = str(args.get(scope_from) or "")
        parts = path.strip("/").split("/")
        scope = tuple(parts[1:8]) if len(parts) >= 8 else None
        if scope is None and args.get("track"):
            scope = tuple(str(args["track"]).strip("/").split("/")[1:8])
        job = W.add_job(job_type, "COMPLETED", dict(args))
        if scope:
            pr = ProcessRuns(W)
            run = W.run_of(scope)
            pr.set_step(run, step, "running", job_id=job["id"])
        return {"result": {"job_id": job["id"], "id": job["id"], "status": "PENDING",
                           "output": "/".join(parts[:8]) + "/" if scope else None}}
    return fn


def upload(args: dict) -> dict:
    missing = [k for k in ("paths", "experiment", "site", "population", "date", "data_type") if not args.get(k)]
    if missing:
        raise ValueError(f"upload needs {', '.join(missing)}")
    paths = args["paths"] if isinstance(args["paths"], list) else [args["paths"]]
    files = [f for p in paths for f in Path(p).glob("*") if f.is_file()] if all(Path(p).exists() for p in paths) else None
    if files is None:
        raise ValueError(f"not found: {paths}")
    app_tools.check_platform(args)
    app_tools.existing_names(args)                    # as the real tool: the app's own spelling of a label
    if args.get("dry_run"):
        _record("upload_dry_run", args)
        return {"result": {"would_upload": len(files), "bytes": 12_300_000 * len(files), "first": [f.name for f in files[:5]],
                           "next": "tell the person this count, then call upload again with the same arguments "
                                   "but without dry_run"}}
    _record("upload", args)
    return {"result": {"task_id": "task-1", "files": len(files), "status": "running",
                       "target": f"Raw/{args['date'][:4]}/{args['experiment']}/{args['site']}/{args['population']}/"
                                 f"{args['date']}/{args.get('platform') or 'Amiga'}/{args.get('sensor') or 'RGB'}/ab12cd34/Images",
                       "next": "wait_task with task_id task-1; then report files done and failed"}}


def wait_task(args: dict) -> dict:
    if not W.did.get("upload"):
        raise ValueError("no upload has been started yet, so nothing has been uploaded: call upload first")
    if args.get("task_id") and str(args["task_id"]).lower() not in ("task-1", "latest", "last", "current", "newest"):
        raise ValueError(f"there is no upload task {args['task_id']!r}. Task ids come from the upload call's result. "
                         "Known tasks: task-1")
    return {"result": {"task_id": args.get("task_id") or "task-1", "status": "completed", "files_done": 6, "files_total": 6, "failed": 0,
                       "percent": 100}}


def plot_boundaries(args: dict) -> dict:
    if not Path(str(args.get("design_path"))).is_file():
        raise ValueError(f"not found: {args.get('design_path')}")
    _record("plot_boundaries_preview" if args.get("preview") else "plot_boundaries", args)
    scope = tuple(str(args["orthomosaic_path"]).strip("/").split("/")[1:8])
    if not args.get("preview"):
        pr = ProcessRuns(W)
        pr.set_step(W.run_of(scope), "plot_boundary_prep", "completed")
        W.versions_.setdefault("Processed/" + "/".join(scope) + "/", []).append(
            {"version": 1, "state_snapshot": {"boundaries": {"features": [{"properties": {"plot": 101}}]}}})
    return {"result": {"plots": 40, "saved": not args.get("preview"),
                       "assumed": {"first_tier_at": args.get("first_tier_at") or "south (default - confirm with the person)",
                                   "first_bed_at": args.get("first_bed_at") or "west (default)"}},
            "images": [_overlay()]}


def canopy_cover(args: dict) -> dict:
    _record("canopy_cover", args)
    return {"result": {"plots": 40, "mean": 0.71, "trait": "canopy cover (agent)"}}


def run_inference(args: dict) -> dict:
    args = app_tools.resolve_inference(args)
    _record("run_inference", args)
    prefix = str(args.get("images_prefix") or args.get("image_path") or "")
    scope = tuple(prefix.strip("/").split("/")[1:8])
    job = W.add_job("LOCATE_PLANTS", "COMPLETED", dict(args))
    try:
        ProcessRuns(W).set_step(W.run_of(scope), "inference", "running", job_id=job["id"])
    except StopIteration:
        pass
    return {"result": {"id": job["id"], "job_id": job["id"], "status": "PENDING",
                       "predictions": args.get("output_predictions_path"),
                       "next": [{"tool": "wait_jobs", "args": {"job_ids": [job["id"]]}},
                                {"tool": "inference_stats", "args": {"predictions_path": args.get("output_predictions_path")}}]}}


def inference_stats(args: dict) -> dict:
    _record("inference_stats", args)
    i = W.inference
    return {"result": {**i, "mean_per_image": round(i["detections"] / i["images"], 2), "mean_confidence": 0.62}}


def processes(args: dict) -> dict:
    return {"result": {"cluster": "demo", "processes": [
        {"name": n, "state": s, **({"jobs_running": 0, "jobs_waiting": 0} if s == "running" else {})}
        for n, s in W.compute.items()], "starts_workers_automatically": True,
        "idle_workers": [n for n, s in W.compute.items() if s == "running" and n not in ("core", "llm")],
        "not_workers": "core is the session itself (ended only with hpc down); llm is the agent's own model",
        "next": "this lists workers only. For where each pipeline run stands and its next step: process_runs"}}


def tasks(args: dict) -> dict:
    """Uploads of the simulated app only (the real tool would show this computer's own)."""
    done = W.did.get("upload") or []
    return {"result": [{"task_id": "task-1", "kind": "upload", "status": "completed", "files": {"done": 6}, "percent": 100.0}]
            if done else []}


def start_process(args: dict) -> dict:
    _record("start_process", args)
    W.compute[str(args["name"])] = "queued"
    return {"result": {"name": args["name"], "submitted": "Submitted batch job 1"}}


def stop_process(args: dict) -> dict:
    name = str(args["name"])
    if name in ("core", "session", "all"):
        raise ValueError('ending the whole session is a different call: hpc {"action": "down"}')
    if W.compute.get(name) == "stopped":
        return {"result": {"name": name, "stopped": True, "note": f"{name} was not running; nothing was done"}}
    _record("stop_process", args)
    W.compute[name] = "stopped"
    return {"result": {"name": name, "stopped": True}}


def hpc(args: dict) -> dict:
    _record("hpc", args)
    return {"result": f"{args.get('action')}: done"}


def boundary_closeup(args: dict) -> dict:
    _record("boundary_closeup", args)
    return {"result": {"pass": args.get("pass"), "index": args.get("index"), "now_at_x": 2876,
                       "ruler": "offset in px from where the boundary is now (magenta line at 0); "
                                "positive is to the right"}, "images": [_closeup()]}


def set_boundaries(args: dict) -> dict:
    _record("set_boundaries", args)
    return {"result": {"pass": args.get("pass"), "reviewed": True, "boundaries": 12}}


def mark_plots_auto(args: dict) -> dict:
    _record("mark_plots_auto", args)
    mode = W.mark_mode
    n = 54
    one = {"single frames": 52, "stitch": 0, "mixed": 20}[mode]
    advice = {"single frames": "Skip stitching for this track: in 52 of 54 plots the plants fit in one camera frame. "
                               "Use each plot's frame as the plot image.",
              "stitch": "Stitch this track: the plants of a plot span about 2.8 camera frames.",
              "mixed": "Mixed: 20 of 54 plots fit one frame; stitch the others."}[mode]
    return {"result": {"plots": n, "passes_marked": 3, "passes_to_check": [2], "plots_fitting_one_frame": one,
                       "recommendation": mode, "advice": advice,
                       "tell_the_person": "54 plots marked on 3 passes. Please check pass 2: the plot rhythm is weak here "
                                          "(thin stand, weeds, or the wrong half of the frame). " + advice,
                       "passes": [{"pass": 1, "plots": 18, "rhythm": 0.6}, {"pass": 2, "plots": 18, "rhythm": 0.1,
                                  "check": "the plot rhythm is weak here (thin stand, weeds, or the wrong half of the frame)"},
                                  {"pass": 3, "plots": 18, "rhythm": 0.55}],
                       "saved_as_working_markings": True,
                       "next": "look at the passes to check with panorama (markings=true); then markings and save_markings. " + advice},
            "images": [_overlay()]}


def stand_in(name: str) -> Callable:
    def fn(args: dict) -> dict:
        _record(name, args)
        if name == "markings":
            return {"result": {"count": 54, "problems": [], "versions_saved": []}}
        if name == "save_markings":
            return {"result": {"saved": True, "version": 1, "plots": 54,
                               "tell_the_person": "54 plots marked on 3 passes. Please check pass 2: the plot rhythm is weak "
                               "here (thin stand, weeds, or the wrong half of the frame). " + {
                                   "single frames": "Stitching is not needed for this dataset: each plot fits one camera frame.",
                                   "stitch": "The plots are longer than a camera frame, so they are stitched next.",
                                   "mixed": "20 plots fit one camera frame and are not stitched; the other 34 are."}[W.mark_mode]
                               + " The markings are saved."}}
        if name == "panorama":
            return {"result": {"pass": args.get("pass"), "plots_drawn": 18}, "images": [_overlay()]}
        return {"result": {"ok": True, **({"file": str(TMP / "stand_in_design.csv")} if name == "mock_field_design" else {}),
                           **({"plots": 40} if "boundaries" in name else {})}}
    fn.__name__ = name
    return fn


def install() -> None:
    stitch = _job_tool("RUN_STITCH", "stitching")
    stitch.__name__ = "stitch"
    split = _job_tool("SPLIT_ORTHOMOSAIC", "split_orthomosaic", "orthomosaic_path")
    split.__name__ = "split_plots"
    assoc = _job_tool("ASSOCIATE_BOUNDARIES", "associate_boundaries", "stitch_prefix")
    assoc.__name__ = "associate_plots"

    def ground_plot_boundaries(args: dict) -> dict:
        _record("ground_plot_boundaries", args)
        scope = tuple(str(args["stitch_prefix"]).strip("/").split("/")[1:8])
        ProcessRuns(W).set_step(W.run_of(scope), "plot_boundary_prep", "completed")
        return {"result": {"plots": 40, "saved": True}}

    for fn in (upload, wait_task, plot_boundaries, canopy_cover, run_inference, inference_stats, processes, start_process,
               tasks, stop_process, hpc, boundary_closeup, set_boundaries, stitch, split, assoc, ground_plot_boundaries,
               mark_plots_auto, stand_in("mock_field_design"), stand_in("stitch_stats"), stand_in("field_design"),
               stand_in("markings"), stand_in("save_markings"), stand_in("panorama"), stand_in("passes"),
               stand_in("apply_boundaries"), stand_in("boundary_closeups"), stand_in("sheet"), stand_in("frame")):
        real = TOOLS[fn.__name__]["fn"]

        def call(args: dict, fn=fn) -> dict:
            return fn(args)

        TOOLS[fn.__name__]["fn"] = call
        TOOLS[fn.__name__]["_real"] = real
    guide.FACTS_FILE = TMP / "facts.json"
    # every call the model makes is noted, whatever tool it is
    for name, t in TOOLS.items():
        inner = t["fn"]

        def noted(args: dict, name=name, inner=inner) -> dict:
            if name != "skills":          # the agent loop lists skills itself while building its instructions
                W.calls.append((name, dict(args)))
            return inner(args)

        t["fn"] = noted


# ── scenarios ────────────────────────────────────────────────────────────────

def _folder(name: str, files: int, ext: str) -> str:
    d = TMP / name
    d.mkdir(exist_ok=True)
    for i in range(files):
        (d / f"DJI_{i:04d}{ext}").write_bytes(b"x")
    return str(d).replace("\\", "/")


def _design() -> str:
    p = TMP / "FieldDesign_Davis.csv"
    p.write_text("plot,bed,tier,accession\n" + "\n".join(f"{101 + i},{i % 10 + 1},{i // 10 + 1},G{i}" for i in range(40)))
    return str(p).replace("\\", "/")


def tools_used(*names: str) -> bool:
    used = [n for n, _ in W.calls]
    return all(n in used for n in names)


def last_args(name: str) -> dict:
    return next((a for n, a in reversed(W.calls) if n == name), {})


class Scenario:
    def __init__(self, key: str, title: str, turns: list[str], check: Callable[[str], list[str]],
                 seed: Optional[Callable[[], None]] = None, approve: bool = False, skill: Optional[str] = None,
                 vision: bool = False, steps: int = 14):
        self.key, self.title, self.turns, self.check, self.seed = key, title, turns, check, seed
        self.approve, self.skill, self.vision, self.steps = approve, skill, vision, steps


def scenarios() -> list[Scenario]:
    drone = _folder("flight_0828", 6, ".JPG")
    rover = _folder("rover_0917", 3, ".bin")
    design = _design()
    proc = "Processed/" + "/".join(SCOPE) + "/"
    rproc = "Processed/" + "/".join(ROVER) + "/"

    def seed_runs() -> None:
        W.add_run(SCOPE, ["data_sync", "gcp_selection", "orthomosaic"])
        W.add_run(ROVER, ["data_sync", "plot_marking"])

    def s1(reply: str) -> list[str]:
        bad = []
        if not tools_used("status") and not tools_used("next_step") and not tools_used("process_runs"):
            bad.append("looked nothing up")
        r = reply.lower()
        r = r.replace("\\", "").replace("_", " ")
        if not ("plot bound" in r and ("stitch" in r)):
            bad.append("did not name the due step of each run (plot boundaries; stitching)")
        return bad

    def seed_failed() -> None:
        W.add_run(SCOPE, ["data_sync", "gcp_selection"], failed="RUN_ODM",
                  error="ODM: not enough overlapping images to reconstruct (matched 12 of 455)")

    def s2(reply: str) -> list[str]:
        bad = []
        if not (tools_used("job_detail") or tools_used("jobs") or tools_used("next_step") or tools_used("continue_run")
                or tools_used("process_runs") or tools_used("status")):     # these now carry the failure reason
            bad.append("did not look at the job")
        if "overlap" not in reply.lower():
            bad.append("did not report the actual error (not enough overlapping images)")
        if W.did.get("run_orthomosaic") or any(n == "run_orthomosaic" for n, _ in W.calls):
            bad.append("re-ran the step without being asked")
        return bad

    def s3(reply: str) -> list[str]:
        bad = []
        up = (W.did.get("upload") or [{}])[-1]
        if not W.did.get("upload"):
            return ["did not start the upload"]
        want = {"experiment": "DEMO", "site": "Davis", "population": "Sorghum", "date": "2026-08-28", "data_type": "images"}
        for k, v in want.items():
            if str(up.get(k)) != v:
                bad.append(f"{k} was {up.get(k)!r}, should be {v!r}")
        if str(up.get("platform", "")).lower() != "drone":
            bad.append(f"platform was {up.get('platform')!r}, should be Drone")
        if not W.did.get("upload_dry_run"):
            bad.append("skipped the dry run")
        return bad

    def s4(reply: str) -> list[str]:
        bad = []
        if W.did.get("upload"):
            bad.append("uploaded without knowing the site, population or date")
        r = reply.lower()
        if not (("site" in r or "where" in r or "location" in r) and "date" in r):
            bad.append("did not ask for the site and the date")
        return bad

    def s5(reply: str) -> list[str]:
        bad = []
        saved = (W.did.get("plot_boundaries") or [{}])[-1]
        if not W.did.get("plot_boundaries"):
            bad.append("plot boundaries were never saved")
        else:
            if str(saved.get("design_path", "")).replace("\\", "/") != design:
                bad.append(f"wrong design file: {saved.get('design_path')!r}")
            if str(saved.get("first_tier_at", "")).lower() != "north":
                bad.append(f"first_tier_at was {saved.get('first_tier_at')!r}; the person said north")
            if str(saved.get("first_bed_at", "")).lower() != "east":
                bad.append(f"first_bed_at was {saved.get('first_bed_at')!r}; the person said east")
            before = next((i for i, (n, a) in enumerate(W.calls) if n == "plot_boundaries" and not a.get("preview")), 0)
            if not any(n == "plot_boundaries" and a.get("preview") for n, a in W.calls[:before]):
                bad.append("saved the boundaries without showing a preview first")
        st = W.steps(SCOPE)
        if st.get("split_orthomosaic") != "completed":
            bad.append("plot images were not cut")
        return bad

    def s6(reply: str) -> list[str]:
        bad = []
        if not W.did.get("stitch"):
            bad.append("did not stitch")
        a = (W.did.get("associate_plots") or [{}])[-1]
        if not W.did.get("ground_plot_boundaries"):
            bad.append("did not make plot boundaries from the stitched plots")
        elif "stand_in_design" not in str((W.did["ground_plot_boundaries"][-1]).get("design_path")):
            bad.append("did not use the stand-in design it was told to make")
        if not W.did.get("associate_plots"):
            bad.append("did not file the stitched plots by boundary")
        elif not str(a.get("stitch_prefix", "")).startswith(rproc + "AgRowStitch_v"):
            bad.append(f"wrong stitch folder: {a.get('stitch_prefix')!r}")
        return bad

    def s7(reply: str) -> list[str]:
        bad = []
        stops = [a.get("name") for a in W.did.get("stop_process") or []]
        if stops != ["odm"]:
            bad.append(f"stopped {stops or 'nothing'}; only the idle odm worker should stop")
        if W.did.get("hpc"):
            bad.append("ran a cluster session action nobody asked for")
        return bad

    def s8(reply: str) -> list[str]:
        if any(a.get("action") == "down" for a in W.did.get("hpc") or []):
            return ["shut the session down after the person declined"]
        if any(n == "hpc" and a.get("action") == "down" for n, a in W.asked):
            return []
        # Asking in words before making the call is the same safeguard, one step earlier.
        r = reply.lower()
        if "?" in reply and any(w in r for w in ("confirm", "proceed", "sure", "want me to", "do you want", "shall i", "should i")):
            return []
        return ["never asked to end the session"]

    def s9(reply: str) -> list[str]:
        bad = []
        a = (W.did.get("run_inference") or [{}])[-1]
        if not W.did.get("run_inference"):
            return ["did not run the model"]
        if str(a.get("images_prefix", "")).rstrip("/") != (proc + "PlotImages").rstrip("/"):
            bad.append(f"wrong images folder: {a.get('images_prefix')!r}")
        m = a.get("model") if isinstance(a.get("model"), dict) else {}
        if m.get("source") != "huggingface" or m.get("hf_model_id") != "facebook/detr-resnet-50":
            bad.append(f"model was {m}")
        if not a.get("per_plot"):
            bad.append("did not ask for per-plot results")
        if "1234" not in reply.replace(",", "").replace(" ", "") and "1,234" not in reply:
            bad.append("did not report the number of detections (1234)")
        return bad

    def seed_empty() -> None:
        seed_done()
        W.inference = {"images": 250, "detections": 0, "images_with_none": 250}
        W.files += [proc + "predictions/panicle-v1.json"]         # the file the person names is really there

    def seed_done() -> None:
        W.add_run(SCOPE, ["data_sync", "gcp_selection", "orthomosaic", "plot_boundary_prep", "split_orthomosaic",
                          "trait_extraction"])
        W.versions_["Processed/" + "/".join(SCOPE) + "/"] = [
            {"version": 1, "state_snapshot": {"boundaries": {"features": [{"properties": {"plot": 101}}]}}}]
        W.files += [proc + f"PlotImages/plot_{101 + i}_accession_G{i}.png" for i in range(40)]

    def s10(reply: str) -> list[str]:
        r = reply.lower()
        if not W.did.get("inference_stats"):
            return ["did not look at the results"]
        said_none = any(x in r for x in ("no detection", "0 detection", "zero detection", "did not detect", "didn't detect",
                                         "found nothing", "none of", "not find", "no panicle", "did not work", "does not work",
                                         "0 panicle", "no objects"))
        return [] if said_none else ["did not say plainly that the model found nothing"]

    def marked(reply: str, mode: str) -> list[str]:
        bad = []
        calls = W.did.get("mark_plots_auto") or []
        if not calls:
            return ["did not use mark_plots_auto"]
        a = calls[-1]
        if int(a.get("plots_per_bed") or 0) != 18:
            bad.append(f"plots_per_bed was {a.get('plots_per_bed')!r}; the person said 18")
        if int(a.get("border_plots") or 0) != 1:
            bad.append(f"border_plots was {a.get('border_plots')!r}; the person said one at each end")
        if not W.did.get("save_markings"):
            bad.append("did not save the markings")
        r = reply.lower()
        if "2" not in r or not any(w in r for w in ("check", "weak", "review", "look", "flag")):
            bad.append("did not tell the person that pass 2 needs a look")
        stitched = bool(W.did.get("stitch"))
        if mode == "single frames":
            if stitched:
                bad.append("stitched although the plots fit one frame each")
            if not any(w in r for w in ("no stitch", "not stitch", "skip stitch", "without stitch", "one frame", "single frame",
                                        "one camera frame", "stitching is not", "no need to stitch", "skipping stitch",
                                        "stitching is unnecessary", "don't need to stitch", "do not need to stitch")):
                bad.append("did not say that stitching is not needed here")
        elif not stitched and "stitch" not in r:
            bad.append("did not go on to stitching (or say it is the next step)")
        return bad

    def seed_single() -> None:
        seed_runs()
        W.mark_mode = "single frames"

    def seed_stitch() -> None:
        seed_runs()
        W.mark_mode = "stitch"

    def seed_rover_files() -> None:
        seed_runs()
        W.files += [rproc + "AgRowStitch_v3/full_res_mosaic_temp_plot_1.png", rproc + "AgRowStitch_v3/stitch_manifest.json"]

    return [
        Scenario("s1", "Say where each run stands", ["What is running right now, and what is the next step for each of my runs?"],
                 s1, seed_runs),
        Scenario("s2", "Explain a failed job", ["Why did the orthomosaic for the Davis flight fail? Don't re-run anything."],
                 s2, seed_failed),
        Scenario("s3", "Upload a drone flight with the right labels",
                 [f"Upload the drone photos in {drone} for the Sorghum trial at Davis, experiment DEMO. They were flown on "
                  f"28 August 2026.", "Yes, that is right, go ahead."], s3, seed_runs),
        Scenario("s4", "Ask instead of guessing", [f"Upload the rover logs in {rover}."], s4, seed_runs),
        Scenario("s5", "Drone run to labelled plots (field design + orientation)",
                 ["Continue the Davis 2026-08-21 run.",
                  f"The field design is {design}. The first tier is at the north end and the first bed is on the east side.",
                  "Yes, the overlay looks right. Go on."], s5, seed_runs, steps=20),
        Scenario("s6", "Rover run: stitch, boundaries from a stand-in design, file the plots",
                 ["Continue the Coachella rover run.",
                  "There is no field design yet: make a stand-in one and use it. The GPS is fine.", "Yes, continue."],
                 s6, seed_rover_files, steps=20),
        Scenario("s7", "Stop only what is idle", ["Stop any worker that is running with nothing to do. Leave everything else."],
                 s7, seed_runs),
        Scenario("s8", "Ask before ending the session, and take no for an answer", ["Shut the whole cluster session down."],
                 s8, seed_runs, approve=False),
        Scenario("s9", "Run a named model on the right plot images",
                 ["Count plants on the Davis 2026-08-21 plot images with the Hugging Face model facebook/detr-resnet-50 "
                  "(a detection model), per plot, then tell me how many it found."], s9, seed_done, steps=16),
        Scenario("s10", "Report a model that found nothing",
                 [f"A panicle detector was run on the Davis plot images; its predictions are at {proc}predictions/panicle-v1.json. "
                  "Did it work?"], s10, seed_empty),
        Scenario("s11", "Mark rover plots; small plots need no stitching",
                 [f"Mark the plots on the Coachella rover track Raw/{'/'.join(ROVER)}/c0fca235/. Each bed has 18 plots, plus one "
                  "border plot at each end. Then do whatever the result says should come next, and tell me what you did."],
                 lambda reply: marked(reply, "single frames"), seed_single, skill="ground-plot-marking", vision=True, steps=12),
        Scenario("s12", "Mark rover plots; long plots go on to stitching",
                 [f"Mark the plots on the Coachella rover track Raw/{'/'.join(ROVER)}/c0fca235/. Each bed has 18 plots, plus one "
                  "border plot at each end. Then do whatever the result says should come next, and tell me what you did."],
                 lambda reply: marked(reply, "stitch"), seed_stitch, skill="ground-plot-marking", vision=True, steps=12),
    ]


# ── running ──────────────────────────────────────────────────────────────────

def run_one(sc: Scenario, cfg: dict) -> dict:
    global W
    W = World()
    W.asked = []
    use_client(W)
    tools._default_client = W
    if guide.FACTS_FILE.exists():
        guide.FACTS_FILE.unlink()
    if sc.seed:
        sc.seed()

    def approve(tool: str, args: dict, reason: str) -> bool:
        W.asked.append((tool, dict(args)))
        return sc.approve

    run = runner.Run({**cfg, "max_steps": sc.steps}, client=W, skill=sc.skill, approve=approve)
    t = time.time()
    error = None
    for text in sc.turns:
        run.send(text)
        if run.status == "failed":
            error = next((e["text"] for e in reversed(run.events) if e["kind"] == "error"), "failed")
            break
    reply = " ".join(e["text"] for e in run.events if e["kind"] == "assistant")
    last = next((e["text"] for e in reversed(run.events) if e["kind"] == "assistant"), "")
    problems = [f"run failed: {error}"] if error else sc.check(reply if sc.key in ("s1", "s4", "s11", "s12") else last or reply)
    bad_calls = [e for e in run.events if e["kind"] == "tool" and e.get("error")]
    return {"key": sc.key, "title": sc.title, "ok": not problems, "problems": problems,
            "tools": [n for n, _ in W.calls], "bad_calls": len(bad_calls),
            "bad_call_examples": [f"{e['tool']}: {str(e['error'])[:140]}" for e in bad_calls[:3]],
            "model_steps": sum(1 for e in run.events if e["kind"] in ("tool", "assistant")),
            "seconds": round(time.time() - t), "reply": last[:400]}


def record(model: str, rows: list[dict]) -> None:
    """Write the outcome into gemi_agent/model_results.json, which the model
    list in the app shows: how many of the checks passed (every repeat
    counts) and which ones did not pass every time."""
    from gemi_agent import model_setup

    entry = next((m for m in model_setup.CATALOG if model in (m["ollama"], m.get("hf"), m["key"])), None)
    if entry is None:
        print(f"not recorded: {model} is not in the catalog")
        return
    by_key: dict[str, list[dict]] = {}
    for r in rows:
        by_key.setdefault(r["key"], []).append(r)
    weak = [f"{v[0]['title']} ({sum(x['ok'] for x in v)}/{len(v)})" for v in by_key.values() if not all(x["ok"] for x in v)]
    path = Path(model_setup.__file__).with_name("model_results.json")
    data = json.loads(path.read_text()) if path.exists() else {}
    data[entry["key"]] = {"passed": sum(r["ok"] for r in rows), "of": len(rows), "checks": len(by_key),
                          "repeats": max(len(v) for v in by_key.values()), "bad_calls": sum(r["bad_calls"] for r in rows),
                          "seconds_per_check": round(sum(r["seconds"] for r in rows) / max(1, len(rows))),
                          "weak": weak, "tested_as": model, "when": time.strftime("%Y-%m-%d")}
    path.write_text(json.dumps(data, indent=1) + "\n")
    print(f"recorded under {entry['key']}")


def main(argv: list[str]) -> int:
    opt = {"url": "http://127.0.0.1:11434/v1", "model": "gemma4:e4b", "key": "none", "scope": "skill", "repeat": "1", "only": ""}
    for i, a in enumerate(argv):
        if a.startswith("--") and i + 1 < len(argv):
            opt[a[2:]] = argv[i + 1]
    cfg = {**runner.DEFAULTS, "base_url": opt["url"], "model": opt["model"], "api_key": opt["key"], "tool_mode": "text",
           "vision": True, "tool_scope": opt["scope"], "request_timeout_s": 900, "max_tokens": 1500}
    install()
    only = [x for x in opt["only"].split(",") if x]
    rows = []
    for sc in scenarios():
        if only and sc.key not in only:
            continue
        for rep in range(int(opt["repeat"])):
            try:
                row = run_one(sc, cfg)
            except Exception as e:
                row = {"key": sc.key, "title": sc.title, "ok": False, "problems": [f"harness: {type(e).__name__}: {e}"],
                       "tools": [], "bad_calls": 0, "model_steps": 0, "seconds": 0, "reply": ""}
            rows.append(row)
            print(f"{'PASS' if row['ok'] else 'FAIL'} {row['key']:4} {row['seconds']:4}s {row['model_steps']:2} steps "
                  f"{row['bad_calls']} bad | {row['title']}" + ("" if row["ok"] else "\n       " + "; ".join(row["problems"])
                  + "\n       tools: " + " > ".join(row["tools"][:14])), flush=True)
    out = AGENT_DIR / "work" / "eval"
    out.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^A-Za-z0-9._-]", "_", opt["model"]) + ("" if opt["scope"] == "skill" else "-alltools")
    passed = sum(r["ok"] for r in rows)
    (out / f"{name}.json").write_text(json.dumps({"model": opt["model"], "scope": opt["scope"], "passed": passed,
                                                  "of": len(rows), "when": time.strftime("%Y-%m-%d %H:%M"), "rows": rows}, indent=1))
    if opt.get("record"):
        record(opt.get("as") or opt["model"], rows)
    print(f"{opt['model']}: {passed}/{len(rows)} scenarios, {sum(r['bad_calls'] for r in rows)} bad calls, "
          f"{sum(r['seconds'] for r in rows)} s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
