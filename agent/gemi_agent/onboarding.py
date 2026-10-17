"""What the first-open walkthrough needs to know: what this computer can
run, and which of the set-up questions are already answered.

Two questions, each skipped when it has an answer:

1. Where the processing runs: this computer (Docker) or a cluster.
2. Which model the agent uses, and where that runs.

For the second, the page shows which open models fit this computer, from
its memory and graphics card. The rule is deliberately simple and errs on
the side of "it will be slow": a model needs about 1.3 times its download
size in fast memory (GPU memory, or unified memory on Apple Silicon).
"""
from __future__ import annotations

import json
import os
import platform
import subprocess
import sys
import urllib.request
from typing import Any, Optional

from . import model_setup


def _run(cmd: list[str], timeout: int = 6) -> str:
    try:
        flags = 0x08000000 if os.name == "nt" else 0          # no console window
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, creationflags=flags)
        return r.stdout if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _ram_gb() -> Optional[float]:
    try:
        if os.name == "nt":
            import ctypes

            class Mem(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]

            m = Mem()
            m.dwLength = ctypes.sizeof(Mem)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return round(m.ullTotalPhys / 2**30, 1)
        if sys.platform == "darwin":
            return round(int(_run(["sysctl", "-n", "hw.memsize"]).strip()) / 2**30, 1)
        for line in open("/proc/meminfo"):
            if line.startswith("MemTotal:"):
                return round(int(line.split()[1]) / 2**20, 1)
    except (OSError, ValueError):
        pass
    return None


def _gpus() -> list[dict]:
    """Graphics cards with their memory, where that can be read reliably."""
    out = _run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
    gpus = []
    for line in out.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == 2 and parts[1].isdigit():
            gpus.append({"name": parts[0], "memory_gb": round(int(parts[1]) / 1024, 1)})
    if gpus:
        return gpus
    if os.name == "nt":         # names only: Windows does not report memory above 4 GB here
        out = _run(["powershell", "-NoProfile", "-Command",
                    "(Get-CimInstance Win32_VideoController).Name"], timeout=10)
        return [{"name": n.strip(), "memory_gb": None} for n in out.splitlines() if n.strip()]
    return []


def _docker() -> str:
    from shutil import which

    if not which("docker"):
        return "missing"
    return "running" if _run(["docker", "info", "--format", "{{.ServerVersion}}"], timeout=6).strip() else "not_running"


def system() -> dict:
    ram = _ram_gb()
    gpus = _gpus()
    apple = sys.platform == "darwin" and platform.machine() == "arm64"
    known = [g["memory_gb"] for g in gpus if g.get("memory_gb")]
    if apple and ram:
        fast, kind = round(ram * 0.7, 1), "unified memory (Apple Silicon)"       # the rest is for the system
    elif known:
        fast, kind = max(known), "graphics card memory"
    else:
        fast, kind = None, None
    name = {"win32": "Windows", "darwin": "macOS"}.get(sys.platform, "Linux")
    parts = [f"{ram:g} GB memory" if ram else None,
             "Apple Silicon" if apple else None,
             *[f"{g['name']}" + (f" ({g['memory_gb']:g} GB)" if g.get("memory_gb") else "") for g in gpus[:2]]]
    return {"os": name, "ram_gb": ram, "gpus": gpus, "apple_silicon": apple, "fast_memory_gb": fast,
            "fast_memory_kind": kind, "cpus": os.cpu_count(), "summary": ", ".join(p for p in parts if p)}


def fit(model: dict, sysinfo: dict) -> dict:
    """Whether an open model will run on this computer: yes, slow, or no, with the reason."""
    need = round(model["disk_gb"] * 1.3)
    fast, ram = sysinfo.get("fast_memory_gb"), sysinfo.get("ram_gb") or 0
    if fast and fast >= need:
        return {"fit": "yes", "why": f"needs about {need} GB of fast memory; this computer has {fast:g} GB"}
    if ram >= need * 1.25:
        if fast:
            why = f"needs about {need} GB of fast memory but the {sysinfo['fast_memory_kind']} is {fast:g} GB: " \
                  "it will run partly on the processor, several times slower"
        else:
            why = f"no graphics card memory could be read: it will run on the processor ({ram:g} GB), slowly"
        return {"fit": "slow", "why": why}
    return {"fit": "no", "why": f"needs about {need} GB of memory; this computer has {ram:g} GB"}


# Where a model server usually listens on this computer: (port, what it most likely is).
LOCAL_SERVERS = ((11434, "Ollama"), (8000, "vLLM"), (1234, "LM Studio"), (8080, "llama.cpp"), (8001, "a local model server"))


def found_models() -> list[dict]:
    """Models that are already there to be used: installed in Ollama, or served
    by a model server on this computer (vLLM, LM Studio, llama.cpp: anything
    that answers /v1/models). Asked in parallel with a short wait, so a first
    open is not held up by ports where nothing listens."""
    from concurrent.futures import ThreadPoolExecutor

    def get(url: str) -> dict:
        req = urllib.request.Request(url, headers={"User-Agent": "gemi-agent/0.1"})
        with urllib.request.urlopen(req, timeout=1.5) as r:
            return json.loads(r.read().decode("utf-8", "replace"))

    def probe(entry: tuple[int, str]) -> list[dict]:
        port, server = entry
        base = f"http://127.0.0.1:{port}"
        try:
            if port == 11434:
                names = [m["name"] for m in get(base + "/api/tags").get("models", [])]
                try:
                    loaded = {m["name"] for m in get(base + "/api/ps").get("models", [])}
                except Exception:
                    loaded = set()
            else:
                data = get(base + "/v1/models").get("data", [])
                names = [m["id"] for m in data if m.get("id")]
                if any(m.get("owned_by") == "vllm" for m in data):
                    server = "vLLM"
                loaded = set(names)                    # a server lists what it is serving
        except Exception:
            return []
        return [{"server": server, "base_url": base + "/v1", "model": n, "loaded": n in loaded}
                for n in names if "embed" not in n.lower()]

    with ThreadPoolExecutor(max_workers=len(LOCAL_SERVERS)) as pool:
        rows = [r for part in pool.map(probe, LOCAL_SERVERS) for r in part]
    by_name = {}
    for m in model_setup.catalog():
        for name in (m["ollama"], m.get("hf")):
            if name:
                by_name[name.lower()] = m
    for r in rows:
        known = by_name.get(r["model"].lower())
        r["label"] = known["label"] if known else r["model"]
        r["key"] = known["key"] if known else None
        r["checks"] = known.get("checks") if known else None
        r["vision"] = bool(known["vision"]) if known else None
    rows.sort(key=lambda r: (not r["loaded"], -((r["checks"] or {}).get("passed") or 0), r["model"]))
    return rows


def _model_state() -> dict:
    """Is a model set, and does its endpoint answer (a cheap check, not a question to the model)?"""
    from .runner import CONFIG_PATH, load_config

    cfg = load_config()
    configured = CONFIG_PATH.exists() or bool(os.environ.get("GEMI_LLM_URL"))
    reachable = False
    if configured:
        try:
            req = urllib.request.Request(cfg["base_url"].rstrip("/") + "/models",
                                         headers={"User-Agent": "gemi-agent/0.1",
                                                  **({"Authorization": f"Bearer {cfg['api_key']}"} if cfg.get("api_key") else {})})
            with urllib.request.urlopen(req, timeout=4) as r:
                reachable = r.status == 200
        except Exception:
            reachable = False
    hosted = "127.0.0.1" not in cfg["base_url"] and "localhost" not in cfg["base_url"]
    return {"configured": configured, "reachable": reachable, "model": cfg["model"] if configured else None,
            "where": ("hosted" if hosted else "this computer or a tunnel") if configured else None}


def overview(stack_reachable: bool) -> dict:
    from .hpc_tools import active_cluster

    s = system()
    models = []
    for m in model_setup.catalog():
        models.append({**m, **fit(m, s)})
    order = {"yes": 0, "slow": 1, "no": 2}
    best = min((m for m in models if m["fit"] != "no"), key=lambda m: (order[m["fit"]], -m["disk_gb"]), default=None)
    if best is None:
        advice = "None of the open models fits this computer's memory. Run one on a cluster, or use a hosted model."
    elif best["fit"] == "yes":
        advice = f"{best['label']} is the largest open model that will run well here."
    else:
        advice = (f"Open models will run here only slowly ({best['label']} is the most that fits). "
                  "A cluster or a hosted model will be much quicker.")
    cluster = active_cluster()
    docker = _docker()
    model = _model_state()
    return {
        "system": s, "docker": docker, "models": models, "recommended": best["key"] if best else None,
        "advice": advice, "ollama": model_setup.local_status()["ollama"], "found": found_models(),
        "processing": {"answered": bool(stack_reachable or cluster), "stack_reachable": stack_reachable,
                       "cluster": cluster},
        "model": {"answered": model["configured"] and model["reachable"], **model},
    }


if __name__ == "__main__":
    print(json.dumps(overview(False), indent=1))
