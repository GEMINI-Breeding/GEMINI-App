"""What is running, and where: the parts of the processing stack on the
cluster (core, one worker per kind of job, the agent's own model), with
start and stop for each and a choice of partition.

Used by the home page's Compute panel (through the service) and by the
`processes` / `start_process` / `stop_process` tools, so a person and the
agent see and do the same thing. Everything goes through `hpc/gemi-hpc`.

A job needs the worker of its type. When a tool submits a job and that
worker is not up, it is started automatically (unless the person turned
that off) and the tool's result says so: the agent does not have to reason
about workers at all.
"""
from __future__ import annotations

import json
import re
import threading
import time
from typing import Any, Optional

from . import client as client_mod
from .client import AGENT_DIR
from .hpc_tools import API_PORT, _conf, _connect, _gemi_hpc, _port_open, _state, active_cluster
from .tools import _bool, _str, _tool, add_note, client, use_client

PREFS = AGENT_DIR / "work" / "compute.json"
AUTO = "auto"

# name, label, what it does (for a person), job types it handles
PARTS: list[tuple[str, str, str, tuple[str, ...]]] = [
    ("core", "Core", "Database, file storage and the app's API. Everything else needs it.", ()),
    ("amiga", "Rover extraction", "Unpacks rover .bin logs into images and GPS.", ("EXTRACT_BINARY",)),
    ("stitch", "Stitching", "Stitches one image per plot; files stitched plots by boundary.",
     ("RUN_STITCH", "ASSOCIATE_BOUNDARIES")),
    ("odm", "Orthomosaic", "Builds the field map from drone photos (OpenDroneMap).", ("RUN_ODM",)),
    ("geo", "Map tiles and plot images", "Cuts one image per plot from the field map; makes map tiles.",
     ("SPLIT_ORTHOMOSAIC", "CREATE_COG")),
    ("ml", "Models and traits", "Runs detection models and trait extraction.", ("LOCATE_PLANTS", "EXTRACT_TRAITS")),
    ("llm", "Agent model", "The language model the agent thinks with, when it runs on the cluster.", ()),
]
WORKERS = ("amiga", "stitch", "odm", "geo", "ml")
WORKER_FOR = {jt: name for name, _, _, types in PARTS for jt in types}
_PLACE = re.compile(r"^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+(:[A-Za-z0-9_.:-]+)?$")

_lock = threading.Lock()
_cache: dict[str, Any] = {"t": 0.0, "data": None}
_busy: dict[str, dict] = {}        # part -> {"action", "since", "message"} while a start/stop is in flight
_last: dict[str, dict] = {}        # part -> outcome of its last action (shown once it is over)


# ── preferences ──────────────────────────────────────────────────────────────

def prefs() -> dict:
    p = {"auto_start": True, "idle_stop_minutes": 20, "where": {}}
    if PREFS.exists():
        try:
            p.update(json.loads(PREFS.read_text()))
        except json.JSONDecodeError:
            pass
    return p


def set_prefs(patch: dict) -> dict:
    p = prefs()
    if "auto_start" in patch:
        p["auto_start"] = bool(patch["auto_start"])
    if "idle_stop_minutes" in patch:
        p["idle_stop_minutes"] = max(0, min(int(patch["idle_stop_minutes"]), 24 * 60))
    for name, where in (patch.get("where") or {}).items():
        p["where"][name] = _check_where(name, where)
    PREFS.parent.mkdir(parents=True, exist_ok=True)
    PREFS.write_text(json.dumps(p, indent=1))
    return p


def _check_where(name: str, where: Optional[str]) -> str:
    where = (where or AUTO).strip()
    if where == AUTO:
        return AUTO
    cluster = active_cluster()
    options = _options(name, _conf(cluster)) if cluster else []
    if not _PLACE.match(where) or where not in options:
        # Same rule the gate enforces on the cluster: only placements the cluster's
        # launch.conf names. Adding one is a deliberate edit of that file.
        raise ValueError(f"where must be auto or one of: {', '.join(options) or '(none configured)'}. "
                         "Other partitions are added in the cluster's launch.conf (WORKER_TRY / LLM_TRY / "
                         "GEMI_EXTRA_PLACES) by the person, then `gemi-hpc sync`.")
    return where


# ── reading ──────────────────────────────────────────────────────────────────

def _options(name: str, conf: dict) -> list[str]:
    if name == "llm":
        return conf.get("LLM_TRY", "").split()
    places = conf.get("WORKER_TRY", "").split()
    if name == "core":
        own = f"{conf.get('CORE_PARTITION')}:{conf.get('CORE_ACCOUNT')}"
        return [own] + [p for p in places if p != own]
    return places


def _resources(name: str, conf: dict) -> str:
    if name == "core":
        return f"{conf.get('CORE_CPUS', '?')} CPUs, {conf.get('CORE_MEM', '?')}"
    raw = conf.get("LLM_RES", "") if name == "llm" else conf.get(f"WORKER_RES_{name}", "")
    kv = dict(x.split("=", 1) for x in raw.split() if "=" in x)
    text = f"{kv.get('cpus', '?')} CPUs, {kv.get('mem', '?')}"
    if name == "llm":
        return text + ", 1 GPU"
    return text + (f", {kv['gpus']} GPU" if kv.get("gpus", "0") != "0" else "")


def _ps(cluster: str) -> tuple[dict[str, dict], set[str]]:
    jobs: dict[str, dict] = {}
    up: set[str] = set()
    for line in _gemi_hpc(["ps"], cluster, timeout=90).splitlines():
        f = line.strip().split("|")
        if f[0] == "up" and len(f) > 1:
            up.add(f[1])
        if f[0] != "job" or len(f) < 9:
            continue
        job_name = f[2]
        name = {"gemi-core": "core", "gemi-llm": "llm"}.get(job_name) or \
            (job_name[len("gemi-worker-"):] if job_name.startswith("gemi-worker-") else None)
        if name is None:
            continue
        row = {"job_id": f[1], "partition": f[3], "slurm_state": f[4], "elapsed": f[5], "time_limit": f[6],
               "node": f[7] or None, "reason": None if f[8] in ("None", "") else f[8]}
        copies = (jobs.get(name) or {}).get("copies", 0) + 1
        if name not in jobs or row["slurm_state"] == "RUNNING":       # a running one wins over a queued twin
            jobs[name] = row
        jobs[name]["copies"] = copies
    return jobs, up


def _max_copies(name: str, conf: dict) -> int:
    """How many copies of a worker the cluster's launch.conf allows at once (WORKER_MAX_<name>)."""
    try:
        return max(1, int(str(conf.get(f"WORKER_MAX_{name}", "1")).split()[0]))
    except ValueError:
        return 1


def _state_of(name: str, job: Optional[dict], up: set[str]) -> str:
    if job is None:
        return "stopped"
    s = job["slurm_state"]
    if s == "RUNNING":
        if name == "core" and "session" not in up:
            return "starting"
        if name == "llm" and "llm" not in up:
            return "starting"                 # the job runs; the model is still loading
        return "running"
    if s == "PENDING":
        return "queued"
    if s in ("COMPLETING", "CANCELLED", "STOPPED"):
        return "stopping"
    return "starting"


_watch_client: Any = None        # the last client that could read the job list (for the idle watcher)


def _job_counts() -> Optional[tuple[dict[str, int], dict[str, int]]]:
    """The app's waiting and running jobs per worker; None when the job list
    cannot be read (then nothing may be called idle)."""
    global _watch_client
    waiting: dict[str, int] = {}
    running: dict[str, int] = {}
    try:
        c = client()
        for status, into in (("PENDING", waiting), ("RUNNING", running)):
            for j in c.jobs(status, None, 500):
                w = WORKER_FOR.get(str(j.get("job_type")))
                if w:
                    into[w] = into.get(w, 0) + 1
        _watch_client = c
    except Exception:
        return None
    return waiting, running


def overview(fresh: bool = False, with_jobs: bool = True) -> dict:
    """Every part with its state. The cluster is asked at most every 8 s."""
    cluster = active_cluster()
    if not cluster:
        return {"cluster": None, "parts": [], "auto_start": prefs()["auto_start"],
                "note": "No cluster is configured. With the Docker stack on this computer, the workers start and stop "
                        "with the stack. To use a cluster, give the agent your SSH login."}
    conf = _conf(cluster)
    with _lock:
        if fresh or time.time() - _cache["t"] > 8 or (_cache["data"] or {}).get("cluster") != cluster:
            try:
                jobs, up = _ps(cluster)
                _cache["data"] = {"cluster": cluster, "jobs": jobs, "up": up, "error": None}
            except Exception as e:
                _cache["data"] = {"cluster": cluster, "jobs": {}, "up": set(), "error": str(e)[-300:]}
            _cache["t"] = time.time()
        snap = _cache["data"]
    counts = _job_counts() if with_jobs else None
    waiting, running = counts or ({}, {})
    p = prefs()
    st = _state()
    parts = []
    for name, label, does, types in PARTS:
        job = snap["jobs"].get(name)
        row = {"name": name, "label": label, "does": does, "job_types": list(types),
               "state": "unknown" if snap["error"] else _state_of(name, job, snap["up"]),
               "where": p["where"].get(name, AUTO), "options": _options(name, conf),
               "resources": _resources(name, conf), "jobs_waiting": waiting.get(name, 0),
               "jobs_running": running.get(name, 0), "busy": _busy.get(name), "last": _last.get(name),
               "copies": 0, **(job or {})}
        if name in WORKERS:
            row["max_copies"] = _max_copies(name, conf)
        if name in WORKERS and counts is None:
            row["idle_minutes"] = None        # job list unreadable: unknown, never acted on
        elif name in WORKERS and row["state"] == "running":
            if row["jobs_waiting"] or row["jobs_running"]:
                _idle_since.pop(name, None)
            else:
                row["idle_minutes"] = int((time.time() - _idle_since.setdefault(name, time.time())) / 60)
        elif name in WORKERS and row["state"] != "running":
            _idle_since.pop(name, None)
        parts.append(row)
    return {"cluster": cluster, "host": conf.get("HPC_HOST", "").split("@")[-1], "parts": parts,
            "auto_start": p["auto_start"], "idle_stop_minutes": p["idle_stop_minutes"], "error": snap["error"], "checked": round(_cache["t"]),
            "connection": {"api": _port_open(API_PORT) and st.get("api_pid") is not None,
                           "model": bool(st.get("llm_pid")) and _port_open(int(st.get("llm_port") or 0) or 1)}}


def _part(name: str) -> dict:
    row = next((p for p in overview(fresh=True, with_jobs=False)["parts"] if p["name"] == name), None)
    if row is None:
        raise ValueError(f"name must be one of {', '.join(n for n, *_ in PARTS)}")
    return row


_idle_since: dict[str, float] = {}      # worker -> when it was last seen with nothing to do
_scaled: dict[str, float] = {}          # worker -> when another copy was last asked for


def watch(period_s: int = 45) -> None:
    """Runs in the agent service, for work nobody is watching.

    - A job is waiting and its worker is not up: start the worker (when
      "start workers for jobs" is on). This covers jobs submitted by hand on
      the Process page, which never pass through the agent's tools.
    - A worker has had no job waiting or running for `idle_stop_minutes`:
      stop it, so nothing started for a job is left holding cluster
      allocation after the work is over (Heliades' "nothing runs detached",
      for long-lived workers). 0 switches that off.

    The model and the core are never started or stopped here. Nothing is
    done on a guess: without a readable job list (no one signed in since the
    service started, or an expired session) this does nothing."""
    while True:
        time.sleep(period_s)
        try:
            p = prefs()
            if not active_cluster() or not _port_open(API_PORT) or _watch_client is None:
                continue
            use_client(_watch_client)
            ov = overview()
            if ov.get("error"):
                continue
            core_up = any(r["name"] == "core" and r["state"] == "running" for r in ov["parts"])
            for row in ov["parts"]:
                if row["name"] not in WORKERS or row["busy"] or row.get("idle_minutes", 0) is None:
                    continue
                if p["auto_start"] and core_up and row["state"] == "stopped" and row["jobs_waiting"]:
                    out = start(row["name"], background=False)
                    _last[row["name"]] = {**out, "message": (f"started for {row['jobs_waiting']} waiting job(s)"
                                                              if out["ok"] else out["message"])}
                elif (p["auto_start"] and core_up and row["state"] == "running" and row["jobs_waiting"]
                      and row.get("copies", 1) < row.get("max_copies", 1)
                      and time.time() - _scaled.get(row["name"], 0) > 300):
                    # Jobs wait behind a busy worker and the cluster allows more copies: ask for one
                    # more. The gate submits it only if the cluster can start it now.
                    _scaled[row["name"]] = time.time()
                    out = start(row["name"], background=False)
                    _last[row["name"]] = {**out, "message": (out.get("message") or "")[:200]}
                elif p["idle_stop_minutes"] and (row.get("idle_minutes") or 0) >= p["idle_stop_minutes"]:
                    out = stop(row["name"], background=False)
                    _last[row["name"]] = {**out, "message": f"stopped after {p['idle_stop_minutes']} min with no jobs"}
        except Exception:
            pass


# ── start / stop ─────────────────────────────────────────────────────────────

def _do_start(name: str, where: str) -> str:
    cluster = active_cluster()
    if name in WORKERS:
        env = {} if where == AUTO else {"GEMI_WORKER_TRY": where}
        return _gemi_hpc(["worker", name], cluster, timeout=600, env=env)
    if name == "llm":
        env = {} if where == AUTO else {"GEMI_LLM_TRY": where}
        return _gemi_hpc(["llm", "up"], cluster, timeout=600, env=env)
    out = _gemi_hpc(["up"], cluster, timeout=2000, env={} if where == AUTO else {"CORE_PLACE": where})
    _connect(cluster, _conf(cluster), False)          # the core is on a new node: reopen the tunnels
    return out.strip().splitlines()[-1] if out.strip() else "core is up"


def _do_stop(name: str) -> str:
    cluster = active_cluster()
    if name in WORKERS:
        return _gemi_hpc(["stop", name], cluster, timeout=120)
    if name == "llm":
        return _gemi_hpc(["llm", "down"], cluster, timeout=120)
    return _gemi_hpc(["down"], cluster, timeout=900)   # the core: workers first, then a clean shutdown


def _run(name: str, action: str, fn, background: bool) -> dict:
    if name in _busy:
        raise RuntimeError(f"{name} is already {_busy[name]['action']}")
    _busy[name] = {"action": action, "since": round(time.time())}

    def work() -> dict:
        try:
            text = fn()
            _last[name] = {"action": action, "ok": True, "at": round(time.time()),
                           "message": text.strip().splitlines()[-1][:200] if text.strip() else ""}
        except Exception as e:
            _last[name] = {"action": action, "ok": False, "at": round(time.time()), "message": str(e)[-300:]}
        finally:
            _busy.pop(name, None)
            _cache["t"] = 0.0
        return _last[name]

    if background:
        threading.Thread(target=work, daemon=True).start()
        return {"name": name, "action": action, "started": True}
    return work()


def start(name: str, where: Optional[str] = None, background: bool = True) -> dict:
    if name not in [n for n, *_ in PARTS]:
        raise ValueError(f"name must be one of {', '.join(n for n, *_ in PARTS)}")
    if not active_cluster():
        raise RuntimeError("no cluster is configured")
    if where is not None:
        set_prefs({"where": {name: where}})
    place = prefs()["where"].get(name, AUTO)
    return _run(name, "starting", lambda: _do_start(name, place), background)


def stop(name: str, background: bool = True) -> dict:
    if name not in [n for n, *_ in PARTS]:
        raise ValueError(f"name must be one of {', '.join(n for n, *_ in PARTS)}")
    return _run(name, "stopping", lambda: _do_stop(name), background)


def reconnect(use_model: bool = False) -> dict:
    cluster = active_cluster()
    if not cluster:
        raise RuntimeError("no cluster is configured")
    out = _connect(cluster, _conf(cluster), use_model)
    out.pop("app_login", None)
    return out


# ── a job needs its worker ───────────────────────────────────────────────────

def ensure_worker(job_type: str) -> Optional[dict]:
    """Called for every job the tools submit. Makes sure the worker for it is
    up (or says what to do), and leaves a note in the tool's result."""
    name = WORKER_FOR.get(str(job_type))
    if name is None or not active_cluster():
        return None
    try:
        parts = overview(with_jobs=False)["parts"]
        core = next((p for p in parts if p["name"] == "core"), None)
        if core is None or core["state"] != "running":
            # A cluster is configured, but the stack this job went to is not running there (Docker on
            # this computer, say): its own workers take the job. Starting a cluster worker would hold a
            # cluster slot for a job it can never see.
            return None
        row = next(p for p in parts if p["name"] == name)
        if row["state"] in ("running", "starting", "queued") or row["busy"]:
            note = {"worker": name, "state": "starting" if row["busy"] else row["state"]}
            if note["state"] != "running":
                note["meaning"] = "the job waits until this worker is running; no action needed"
        elif prefs()["auto_start"]:
            out = start(name, background=False)
            note = {"worker": name, "state": "started for this job" if out["ok"] else "could not be started",
                    "detail": out["message"]}
        else:
            note = {"worker": name, "state": row["state"],
                    "do": f'the job stays PENDING until you call start_process {{"name": "{name}"}}'}
    except Exception as e:
        note = {"worker": name, "state": "unknown", "detail": str(e)[-200:]}
    add_note(note)
    return note


client_mod.SUBMIT_HOOKS.append(ensure_worker)


# ── tools ────────────────────────────────────────────────────────────────────

def processes(args: dict) -> dict:
    ov = overview(fresh=bool(args.get("fresh")))
    if not ov["cluster"]:
        return {"result": ov}
    keep = ("name", "state", "partition", "node", "elapsed", "time_limit", "reason", "jobs_waiting", "jobs_running")
    rows = []
    for p in ov["parts"]:
        row = {k: p[k] for k in keep if p.get(k) not in (None, 0, "")}
        row["handles"] = p["job_types"] or p["does"]
        rows.append(row)
    need = [p["name"] for p in ov["parts"] if p["jobs_waiting"] and p["state"] == "stopped"]
    # Workers that hold a cluster slot and have nothing to do. The core and the agent's own
    # model are not workers: they are what the session and this conversation run on.
    idle = [p["name"] for p in ov["parts"] if p["name"] in WORKERS and p["state"] == "running"
            and not p["jobs_running"] and not p["jobs_waiting"]]
    return {"result": {"cluster": ov["cluster"], "processes": rows, "error": ov["error"],
                       "idle_workers": idle,
                       "not_workers": "core is the session itself (ended only with hpc down); llm is the agent's own model",
                       "next": "this lists workers only. For where each pipeline run stands and its next step: process_runs",
                       "starts_workers_automatically": ov["auto_start"],
                       "needs_starting": need or None}}


def start_process(args: dict) -> dict:
    name = str(args["name"])
    if name == "core":
        raise ValueError('the core is started with hpc {"action": "up"} (see the hpc-session skill)')
    out = start(name, args.get("where"), background=False)
    if not out["ok"]:
        raise RuntimeError(out["message"])
    return {"result": {"name": name, "submitted": out["message"],
                       "next": "it is a cluster job: check with processes until its state is running"}}


def stop_process(args: dict) -> dict:
    name = str(args["name"])
    if name in ("core", "session", "all"):
        raise ValueError('ending the whole session is a different call: hpc {"action": "down"} (it asks the person '
                         "first). stop_process is for one worker or the model.")
    row = next(p for p in overview(fresh=True)["parts"] if p["name"] == name) if name in WORKERS or name == "llm" else None
    if row is None:
        raise ValueError(f"name must be one of {', '.join(WORKERS)}, llm")
    if row["state"] == "stopped":
        return {"result": {"name": name, "stopped": True, "note": f"{name} was not running; nothing was done"}}
    if row["jobs_running"] and not args.get("force"):
        raise RuntimeError(f"{name} is working on {row['jobs_running']} job(s); stopping it now interrupts them. "
                           "Ask the person, then repeat with force=true.")
    out = stop(name, background=False)
    if not out["ok"]:
        raise RuntimeError(out["message"])
    return {"result": {"name": name, "stopped": True}}


_names = "amiga (rover logs), stitch, odm (orthomosaic), geo (plot images, map tiles), ml (models, traits), llm (agent model)"
_tool(processes, "What is running on the cluster: core, each worker and the agent model, with state (running, "
      "queued, starting, stopped), where, and how many app jobs wait for each.",
      {"fresh": _bool}, [], track=False, group="compute")
_tool(start_process, f"Start a worker or the agent model on the cluster. name: {_names}. Usually not needed: "
      "submitting a job starts its worker.",
      {"name": _str, "where": {**_str, "description": "optional: auto (default) or partition:account"}},
      ["name"], track=False, group="compute")
_tool(stop_process, "Stop ONE worker (amiga, stitch, odm, geo, ml) or the agent model (llm) on the cluster to free "
      "its allocation. Refuses while the worker has running jobs unless force=true. To shut the whole session "
      'down, call hpc {"action": "down"} instead.',
      {"name": _str, "force": _bool}, ["name"], track=False, group="compute")
