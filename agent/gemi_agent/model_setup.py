"""Getting the agent a model before there is an agent.

The agent sets up everything else, but it cannot set up the model it thinks
with. This module does that part without one: a short list of open models,
and two ways to run one, each as a fixed sequence of steps with a time
estimate the home page can show.

- On this computer, with Ollama: download the model, point the agent at it.
- On a cluster: survey it, choose where the model runs, install the model
  server and the weights, start it on a GPU, connect.

The person starts these from the app (a click is their consent); nothing
here is an agent tool.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

from . import tools as _tools  # noqa: F401  (loads the tool modules in their one working order)

OLLAMA = "http://127.0.0.1:11434"

# Checked to exist on Hugging Face and in the Ollama library (2026-10-09). `gpu_gb`: the smallest GPU the
# cluster build is expected to fit on. `disk_gb`: rough download size for the Ollama build. Only the first
# has been run with GEMI; the rest are the same kind of model (text + pictures) and may need more care.
CATALOG: list[dict[str, Any]] = [
    {"key": "gemma4-31b", "label": "Gemma 4 31B", "by": "Google", "tested": True, "vision": True,
     "ollama": "gemma4:31b", "hf": "google/gemma-4-31B-it-qat-w4a16-ct", "gpu_gb": 40, "disk_gb": 20,
     "note": "The one GEMI has been tested with. Follows the pipeline steps reliably; reads pictures roughly."},
    {"key": "gemma4-12b", "label": "Gemma 4 12B", "by": "Google", "tested": False, "vision": True,
     "ollama": "gemma4:12b", "hf": "google/gemma-4-12B-it", "gpu_gb": 32, "disk_gb": 8,
     "note": "Smaller Gemma: fits a laptop GPU or a 16 GB Mac. Expect more mistakes on long tasks."},
    {"key": "gemma4-e4b", "label": "Gemma 4 E4B", "by": "Google", "tested": False, "vision": True,
     "ollama": "gemma4:e4b", "hf": "google/gemma-4-E4B-it", "gpu_gb": 16, "disk_gb": 5,
     "note": "Smallest useful option; fine for status questions, not for running a pipeline unattended."},
    {"key": "qwen3-vl-32b", "label": "Qwen3-VL 32B", "by": "Alibaba", "tested": False, "vision": True,
     "ollama": "qwen3-vl:32b", "hf": "Qwen/Qwen3-VL-32B-Instruct", "gpu_gb": 80, "disk_gb": 21,
     "note": "Strong at reading pictures. On a cluster it needs an 80 GB GPU."},
    {"key": "qwen3-vl-8b", "label": "Qwen3-VL 8B", "by": "Alibaba", "tested": False, "vision": True,
     "ollama": "qwen3-vl:8b", "hf": "Qwen/Qwen3-VL-8B-Instruct", "gpu_gb": 24, "disk_gb": 6,
     "note": "Small and quick, with good picture reading for its size."},
    {"key": "mistral-small-3.2", "label": "Mistral Small 3.2 (24B)", "by": "Mistral", "tested": False, "vision": True,
     "ollama": "mistral-small3.2:24b", "hf": "mistralai/Mistral-Small-3.2-24B-Instruct-2506", "gpu_gb": 80,
     "disk_gb": 15, "note": "Good at following tool instructions. On a cluster it needs an 80 GB GPU."},
    {"key": "gemma4-e2b", "label": "Gemma 4 E2B", "by": "Google", "tested": False, "vision": True,
     "ollama": "gemma4:e2b", "hf": None, "gpu_gb": None, "disk_gb": 5,
     "note": "The smallest model that carries the pipeline steps reliably in GEMI's checks, and the quickest. "
             "Fits a 6 GB graphics card. This computer only."},
    {"key": "qwen3.5-4b", "label": "Qwen3.5 4B", "by": "Alibaba", "tested": False, "vision": True,
     "ollama": "qwen3.5:4b", "hf": None, "gpu_gb": None, "disk_gb": 4,
     "note": "Small and careful: asks before acting. Fits a 6 GB graphics card. This computer only."},
]
_BY_KEY = {m["key"]: m for m in CATALOG}

_lock = threading.Lock()
_job: dict[str, Any] = {}          # the one setup in flight (or the last one): where, model, steps, state


def _step(name: str, estimate_s: int) -> dict:
    return {"name": name, "estimate_s": estimate_s, "status": "waiting", "detail": ""}


def _run(where: str, model: dict, steps: list[dict], work) -> dict:
    """Run `work(job)` in the background; it advances job["steps"]."""
    global _job
    with _lock:
        if _job.get("state") == "running":
            raise RuntimeError("a model setup is already running")
        _job = {"where": where, "model": model["key"], "label": model["label"], "steps": steps, "state": "running",
                "started": time.time(), "error": None}
    job = _job

    def go() -> None:
        try:
            work(job)
            job["state"] = "done"
        except Exception as e:
            job["state"] = "failed"
            job["error"] = str(e)[-600:]
            for s in job["steps"]:
                if s["status"] == "running":
                    s["status"] = "failed"
        job["ended"] = time.time()

    threading.Thread(target=go, daemon=True).start()
    return job


class _Steps:
    """Walks a job's step list: `with steps("name"):` marks it running, then done."""

    def __init__(self, job: dict):
        self.job = job

    def __call__(self, name: str) -> "_Steps":
        self.cur = next(s for s in self.job["steps"] if s["name"] == name)
        return self

    def __enter__(self) -> dict:
        self.cur["status"] = "running"
        self.cur["started"] = time.time()
        return self.cur

    def __exit__(self, kind, exc, tb) -> None:
        self.cur["seconds"] = round(time.time() - self.cur["started"])
        if kind is None:
            self.cur["status"] = "done" if self.cur["status"] == "running" else self.cur["status"]


def _use(base_url: str, model: str, api_key: str = "") -> dict:
    """Point the agent at the model and ask it one thing."""
    from .runner import save_config, test_connection

    cfg = save_config({"base_url": base_url, "model": model, "api_key": api_key or "none", "tool_mode": "text",
                       "vision": True})
    return test_connection({**cfg, "request_timeout_s": 600})


# ── this computer (Ollama) ───────────────────────────────────────────────────

def _ollama_exe() -> Optional[str]:
    cands = [shutil.which("ollama"),
             str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe"),
             "/usr/local/bin/ollama", "/opt/homebrew/bin/ollama", "/Applications/Ollama.app/Contents/Resources/ollama"]
    return next((c for c in cands if c and Path(c).is_file()), None)


def _ollama(path: str, body: Optional[dict] = None, timeout: int = 10) -> Any:
    req = urllib.request.Request(OLLAMA + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def local_status() -> dict:
    try:
        tags = [m["name"] for m in _ollama("/api/tags").get("models", [])]
        return {"ollama": "running", "installed": tags}
    except Exception:
        return {"ollama": "installed" if _ollama_exe() else "missing", "installed": [],
                "get_it": "https://ollama.com/download"}


def _start_ollama() -> None:
    exe = _ollama_exe()
    if exe is None:
        raise RuntimeError("Ollama is not installed on this computer. Get it from https://ollama.com/download, "
                           "open it once, then try again.")
    flags = (subprocess.CREATE_NEW_PROCESS_GROUP | 0x08000000) if os.name == "nt" else 0
    subprocess.Popen([exe, "serve"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=flags, start_new_session=os.name != "nt")
    for _ in range(30):
        time.sleep(1)
        if local_status()["ollama"] == "running":
            return
    raise RuntimeError("Ollama did not start. Open the Ollama app, then try again.")


def start_local(key: str) -> dict:
    model = _BY_KEY[key]
    tag = model["ollama"]
    have = tag in local_status()["installed"]
    # Home connections vary a lot; 25 MB/s is a middling guess, replaced by the measured rate once it runs.
    steps = [_step("Start Ollama", 10), _step("Download the model", 0 if have else int(model["disk_gb"] * 1100 / 20)),
             _step("Load it and ask a test question", 60 + model["disk_gb"] * 9)]

    def work(job: dict) -> None:
        step = _Steps(job)
        with step("Start Ollama") as s:
            if local_status()["ollama"] != "running":
                _start_ollama()
            s["detail"] = "running"
        with step("Download the model") as s:
            if tag in local_status()["installed"]:
                s["detail"] = "already on this computer"
            else:
                req = urllib.request.Request(OLLAMA + "/api/pull", data=json.dumps({"model": tag, "stream": True}).encode(),
                                             headers={"Content-Type": "application/json"})
                t0, first = time.time(), None
                with urllib.request.urlopen(req, timeout=3600) as r:
                    for line in r:
                        ev = json.loads(line or b"{}")
                        if ev.get("error"):
                            raise RuntimeError(f"Ollama could not download {tag}: {ev['error']}")
                        total, done = ev.get("total") or 0, ev.get("completed") or 0
                        if total and done:
                            first = first if first is not None else done
                            rate = (done - first) / max(time.time() - t0, 1)
                            s["percent"] = round(100 * done / total)
                            s["detail"] = f"{done / 1e9:.1f} of {total / 1e9:.1f} GB"
                            if rate > 0:
                                s["detail"] += f", {rate / 1e6:.0f} MB/s"
                                s["remaining_s"] = round((total - done) / rate)
                        elif ev.get("status"):
                            s["detail"] = str(ev["status"])
                s.pop("remaining_s", None)
                s["detail"] = "downloaded"
        with step("Load it and ask a test question") as s:
            out = _use(OLLAMA + "/v1", tag)
            s["detail"] = f"answered in {out['seconds']} s"

    return _run("local", model, steps, work)


# ── a cluster ────────────────────────────────────────────────────────────────

def cluster_plan(ssh: Optional[str]) -> dict:
    """Look at the cluster (read-only) and say where the model would run and
    how long each part is expected to take. With no `ssh`, the cluster
    already configured is used."""
    from . import hpc_tools as h

    active = h.active_cluster()
    if not ssh and not active:
        raise ValueError("give the SSH command you log in to the cluster with, e.g. ssh you@login.cluster.edu")
    if not ssh:
        conf = h._conf(active)
        ready = _ready(active, None)
        return {"cluster": active, "configured": True, "host": conf.get("HPC_HOST", "").split("@")[-1],
                "llm_try": conf.get("LLM_TRY", "").split(), "data_root": conf.get("GEMI_HPC_ROOT"),
                "gpu_wait_min": None, "server_installed": ready.get("image") == "yes"}
    survey = h.hpc_probe({"ssh": ssh})["result"]
    rec = survey["recommendation"]
    if not rec.get("llm_try"):
        raise RuntimeError("this login can submit to no GPU partition, so a model cannot run on this cluster. "
                           "Use a hosted model, or one on this computer.")
    gpu = [e for e in survey["start_estimates_minutes"] if e["kind"] == "gpu" and isinstance(e["minutes"], int)]
    first = rec["llm_try"][0].split(":")[0]
    wait = next((e["minutes"] for e in gpu if e["partition"] == first), None)
    existing = survey.get("already_installed")
    root = (existing or {}).get("root") or (rec["data_root_candidates"][0].split(" ")[0].rstrip("/") + "/gemini_app"
                                            if rec.get("data_root_candidates") else None)
    if not root:
        raise RuntimeError("found no shared storage to keep the model on; set the cluster up with the agent instead")
    gres = {p["name"]: p.get("gres", "") for p in survey["partitions_i_can_use"]}
    return {"cluster": re.sub(r"[^a-z0-9]", "", survey["login"].split("@")[-1].split(".")[0].lower()) or "cluster",
            "configured": False, "ssh": ssh, "host": survey["login"].split("@")[-1], "data_root": root,
            "existing_install": bool(existing), "core": rec["core"], "workers_try": rec["workers_try"],
            "llm_try": rec["llm_try"], "gpus": {p: gres.get(p.split(":")[0], "") for p in rec["llm_try"]},
            "gpu_wait_min": wait, "containers": survey["containers"],
            "server_installed": "vllm" in ((existing or {}).get("images") or [])}


def _ready(cluster: str, hf: Optional[str]) -> dict:
    from . import hpc_tools as h

    try:
        out = h._gemi_hpc(["llm", "ready", *( [hf] if hf else [])], cluster, timeout=60)
    except Exception:
        return {}
    return dict(x.split("=", 1) for x in out.split() if "=" in x)


def _slurm_job(cluster: str, name: str) -> Optional[str]:
    from . import hpc_tools as h

    for line in h._gemi_hpc(["ps"], cluster, timeout=90).splitlines():
        f = line.split("|")
        if f[0] == "job" and len(f) > 4 and f[2] == name:
            return f[4]
    return None


def start_cluster(key: str, plan: dict) -> dict:
    from . import hpc_tools as h

    model = _BY_KEY[key]
    if not model["hf"]:
        raise ValueError(f"{model['label']} can only be set up on this computer")
    wait_s = int((plan.get("gpu_wait_min") or 5) * 60)
    have = _ready(plan["cluster"], model["hf"]) if plan.get("configured") else {}
    if have.get("image") == "yes" and have.get("weights") == "yes":
        install_s = 0
    else:
        install_s = (0 if plan.get("server_installed") or have.get("image") == "yes" else 900) + \
            int(model["disk_gb"] * 2.2 * 1000 / 40)
    steps = [_step("Write the cluster's settings", 5), _step("Copy GEMI's scripts to the cluster", 30),
             _step("Install the model server and download the model", install_s),
             _step("Wait for a GPU", wait_s), _step("Load the model", 360), _step("Connect and ask a test question", 30)]

    def work(job: dict) -> None:
        step = _Steps(job)
        with step("Write the cluster's settings") as s:
            if plan.get("configured"):
                cluster = plan["cluster"]
                s["detail"] = f"using the settings already there ({cluster})"
            else:
                core = plan["core"]
                h.hpc_configure({"name": plan["cluster"], "ssh": plan["ssh"], "data_root": plan["data_root"],
                                 "core": f"{core['partition']}:{core['account']}", "workers_try": plan["workers_try"],
                                 "llm_try": plan["llm_try"], "llm_model": model["hf"]})
                cluster = plan["cluster"]
                s["detail"] = f"{plan['host']}, data in {plan['data_root']}"
        with step("Copy GEMI's scripts to the cluster") as s:
            s["detail"] = h._gemi_hpc(["sync"], cluster, timeout=600).strip().splitlines()[-1][:120]
        with step("Install the model server and download the model") as s:
            ready = _ready(cluster, model["hf"])
            if ready.get("image") == "yes" and ready.get("weights") == "yes":
                s["detail"] = "already installed"
            else:
                if not _slurm_job(cluster, "gemi-pull-llm"):
                    h._gemi_hpc(["llm", "pull", model["hf"]], cluster, timeout=120)
                t = time.time()
                while True:
                    time.sleep(20)
                    state = _slurm_job(cluster, "gemi-pull-llm")
                    if state is None:
                        break
                    s["detail"] = ("waiting in the cluster's queue" if state == "PENDING" else "downloading") + \
                                  f" ({int((time.time() - t) / 60)} min)"
                    if time.time() - t > 3 * 3600:
                        raise RuntimeError("the install job is still not finished after 3 hours; see its log: "
                                           "gemi-hpc logs pull-llm")
                ready = _ready(cluster, model["hf"])
                if not (ready.get("image") == "yes" and ready.get("weights") == "yes"):
                    log = h._gemi_hpc(["logs", "pull-llm"], cluster, timeout=60, env={"LINES_N": "8"})
                    raise RuntimeError("the install job ended without the model in place. Its last lines: " + log[-400:])
                s["detail"] = "installed"
        with step("Wait for a GPU") as s:
            queue = "the cluster"
            if _slurm_job(cluster, "gemi-llm") is None:
                out = h._gemi_hpc(["llm", "up", model["hf"]], cluster, timeout=600)
                went = re.search(r"\(gemi-llm on ([^)]+)\)", out)
                waits = {m.group(1): int(m.group(2)) for m in re.finditer(r"^\s*(\S+) .*could start in ~(\d+) min", out, re.M)}
                if went and went.group(1) in waits:
                    s["estimate_s"] = max(waits[went.group(1)] * 60, 30)
                queue = went.group(1) if went else "the cluster"
            t = time.time()
            while True:
                state = _slurm_job(cluster, "gemi-llm")
                if state == "RUNNING":
                    break
                if state is None:
                    raise RuntimeError("the model job left the queue before it started. " +
                                       h._gemi_hpc(["logs", "llm"], cluster, timeout=60, env={"LINES_N": "6"})[-400:])
                s["detail"] = f"in the queue on {queue} " \
                              f"({int((time.time() - t) / 60)} min); Slurm's estimates move with other people's jobs"
                time.sleep(15)
        with step("Load the model") as s:
            t = time.time()
            while "LLM_IP" not in h._kv(h._gemi_hpc(["llm", "env"], cluster, timeout=60)):
                if _slurm_job(cluster, "gemi-llm") is None:
                    raise RuntimeError("the model stopped while loading (often: it does not fit the GPU). " +
                                       h._gemi_hpc(["logs", "llm"], cluster, timeout=60, env={"LINES_N": "8"})[-500:])
                if time.time() - t > 2400:
                    raise RuntimeError("the model is still loading after 40 minutes; see: gemi-hpc logs llm")
                time.sleep(15)
        with step("Connect and ask a test question") as s:
            env = h._kv(h._gemi_hpc(["llm", "env"], cluster, timeout=60))
            st = h._state()
            if st.get("llm_pid"):
                h._kill(int(st["llm_pid"]))
            port = h.LLM_PORT if not h._port_open(h.LLM_PORT) else h.LLM_PORT + 1
            st.update({"cluster": cluster, "llm_pid": h._tunnel(h._conf(cluster), port, env["LLM_IP"], env["LLM_PORT"]),
                       "llm_port": port})
            h.STATE.parent.mkdir(parents=True, exist_ok=True)
            h.STATE.write_text(json.dumps(st))
            out = _use(f"http://127.0.0.1:{port}/v1", env["LLM_MODEL_NAME"], env["LLM_KEY"])
            s["detail"] = f"{model['label']} on {env.get('LLM_NODE', 'the cluster')} answered in {out['seconds']} s"

    return _run("cluster", model, steps, work)


# ── for the page ─────────────────────────────────────────────────────────────

def catalog() -> list[dict]:
    """The models, each with how it did on GEMI's own checks (tests/model_eval.py
    writes model_results.json): `checks` is None for a model not yet run."""
    path = Path(__file__).with_name("model_results.json")
    try:
        results = json.loads(path.read_text()) if path.exists() else {}
    except json.JSONDecodeError:
        results = {}
    return [{**m, "checks": results.get(m["key"])} for m in CATALOG]


def overview() -> dict:
    from .hpc_tools import active_cluster
    from .runner import load_config

    cfg = load_config()
    job = dict(_job) if _job else None
    if job:
        job["elapsed_s"] = round((job.get("ended") or time.time()) - job["started"])
        job["estimate_s"] = sum(s["estimate_s"] for s in job["steps"])
        now = time.time()
        for s in job["steps"]:
            if s["status"] == "running":
                s["running_s"] = round(now - s.get("started", now))
    return {"models": catalog(), "local": local_status(), "cluster": active_cluster(),
            "current": {"base_url": cfg["base_url"], "model": cfg["model"]}, "job": job}
