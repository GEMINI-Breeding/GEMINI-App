"""Tools for connecting the app to a Slurm cluster from this computer:
survey the cluster, choose where each part should run, write the cluster
configuration, and drive `hpc/gemi-hpc` (start, workers, model, tunnels,
shut down).

These run on the person's computer and use their SSH access; they are the
only tools that work before any stack exists. Nothing here runs arbitrary
commands on the cluster: the survey is a fixed read-only script, and
everything else goes through `gemi-hpc`'s own subcommands.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import time
from pathlib import Path
from typing import Any, Optional

from .client import AGENT_DIR, RESOURCES
from .tools import _bool, _int, _str, _tool

# Source checkout: the repository. Packaged app: scripts and backend source ship
# read-only with the app, and the clusters' settings live with the person's data.
REPO = AGENT_DIR.parent if RESOURCES is None else RESOURCES
HPC = REPO / "hpc"
CLUSTERS = (HPC / "clusters") if RESOURCES is None else (AGENT_DIR / "clusters")
STATE = AGENT_DIR / "work" / "hpc.json"          # tunnels opened by this computer
API_PORT, LLM_PORT = 7777, 8000                  # where the app and the agent expect them
TILES_PORT = 8091                                # the session's TiTiler (map tiles), where the desktop app looks
_strs = {"type": "array", "items": _str}


# ── plumbing ─────────────────────────────────────────────────────────────────

# Platform and sensor come from a fixed list (uploads.check_kit): they choose the processing.
_PLATFORM = {"type": "string", "description": "Drone | Rover | Handheld (chooses the pipeline: aerial or ground)"}
_SENSOR = {"type": "string", "description": "RGB | Thermal; another camera of that type than the platform's own: "
                                           "<type>-<camera>, e.g. RGB-SonyA7R"}

def _home() -> Path:
    return Path(os.environ.get("USERPROFILE") or Path.home())


def _bash() -> str:
    # On Windows, Git for Windows' bash first: a bare `bash` on PATH can be WSL's
    # launcher (System32 or the WindowsApps alias), which sees neither /c/… paths
    # nor this computer's ssh keys.
    # (%LOCALAPPDATA%\Programs\Git is where the app's own installer puts it, for this user only.)
    local = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Git"
    git = [r"C:\Program Files\Git\bin\bash.exe", r"C:\Program Files\Git\usr\bin\bash.exe",
           str(local / "bin" / "bash.exe"), str(local / "usr" / "bin" / "bash.exe")] if os.name == "nt" else []
    for cand in (*git, shutil.which("bash")):
        if cand and Path(cand).exists() and "System32" not in cand and "WindowsApps" not in cand:
            return cand
    raise RuntimeError("bash not found. On Windows the cluster tools need Git for Windows: install it from the app "
                       "(the walkthrough's cluster choice, or Settings > Compute), or from https://git-scm.com.")


def _posix(p: Path) -> str:
    """C:\\Users\\me\\.ssh\\id_rsa -> /c/Users/me/.ssh/id_rsa (what Git Bash's ssh and gemi-hpc want)."""
    s = str(p).replace("\\", "/")
    m = re.match(r"^([A-Za-z]):/(.*)$", s)
    return f"/{m.group(1).lower()}/{m.group(2)}" if m else s


def parse_ssh(command: str) -> dict:
    """`ssh [-i key] [-p port] user@host` (or just user@host) -> its parts."""
    words = shlex.split(command.strip(), posix=True)
    if words and words[0] == "ssh":
        words = words[1:]
    out: dict[str, Any] = {"key": None, "port": None, "target": None}
    i = 0
    while i < len(words):
        w = words[i]
        if w == "-i" and i + 1 < len(words):
            out["key"] = words[i + 1]
            i += 2
        elif w == "-p" and i + 1 < len(words):
            out["port"] = int(words[i + 1])
            i += 2
        elif w.startswith("-"):
            i += 2 if w in ("-o", "-l", "-J") else 1
        else:
            out["target"] = w
            break
    if not out["target"] or not re.match(r"^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$", out["target"]):
        raise ValueError("give the SSH login as `ssh user@host` (optionally with -i keyfile, -p port)")
    return out


def _ssh_args(target: str, key: Optional[str], port: Optional[int]) -> list[str]:
    known = _home() / ".ssh" / "known_hosts"
    args = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-o", "StrictHostKeyChecking=accept-new",
            "-o", f"UserKnownHostsFile={_posix(known)}"]
    if key:
        args += ["-i", _posix(Path(key).expanduser()), "-o", "IdentitiesOnly=yes"]
    if port:
        args += ["-p", str(port)]
    return args + [target]


def _find_key(target: str, key: Optional[str], port: Optional[int]) -> Optional[str]:
    """The key that logs in without a password: the one given, the agent's
    default, or the first of the usual files that works."""
    candidates: list[Optional[str]] = [key] if key else [None]
    if not key:
        candidates += [str(p) for p in ((_home() / ".ssh" / n) for n in ("id_ed25519", "id_rsa", "id_ecdsa")) if p.exists()]
    last = ""
    for k in candidates:
        r = subprocess.run(_ssh_args(target, k, port) + ["echo ok"], capture_output=True, text=True, timeout=60)
        if r.returncode == 0 and "ok" in r.stdout:
            return k or ""
        last = (r.stderr or r.stdout).strip().splitlines()[-1:] or [""]
        last = last[0]
    raise RuntimeError(f"could not log in to {target} with a key (no password prompt is possible here): {last}. "
                       "Set up key-based SSH login first: ssh-keygen, then ssh-copy-id.")


def _gemi_hpc(args: list[str], cluster: Optional[str] = None, timeout: int = 600, env: Optional[dict] = None) -> str:
    e = dict(os.environ, **(env or {}))
    if cluster:
        e["GEMI_CLUSTER"] = cluster
    e["GEMI_CLUSTERS_DIR"] = _posix(CLUSTERS)
    e["GEMI_AUDIT_LOG"] = _posix(AGENT_DIR / "work" / "hpc-audit.log")
    e["GEMI_BACKEND_DIR"] = _posix(REPO / "backend")
    if (REPO / "backend.tgz").exists():       # the packaged app ships the backend source as one archive
        e["GEMI_BACKEND_TGZ"] = _posix(REPO / "backend.tgz")
    e["COPYFILE_DISABLE"] = "1"          # macOS tar: no AppleDouble files in what is sent to the cluster
    r = subprocess.run([_bash(), _posix(HPC / "gemi-hpc"), *args], capture_output=True, text=True, timeout=timeout,
                       env=e, cwd=str(REPO))
    out = (r.stdout + ("\n" + r.stderr if r.returncode else "")).strip()
    if r.returncode:
        raise RuntimeError(f"gemi-hpc {' '.join(args)} failed: {out[-800:]}")
    return out


def active_cluster() -> Optional[str]:
    f = CLUSTERS / "active"
    name = f.read_text().strip() if f.exists() else ""
    return name or None


def _conf(cluster: str) -> dict:
    path = CLUSTERS / cluster / "launch.conf"
    if not path.exists():
        raise ValueError(f"no cluster named {cluster!r}; run hpc_configure first")
    out = {}
    for line in path.read_text().splitlines():
        m = re.match(r'^([A-Z_a-z0-9]+)=(.*?)(\s+#.*)?$', line)
        if m:
            v = m.group(2).strip().strip('"').strip("'")
            d = re.match(r"^\$\{[A-Z_]+:-(.*)\}$", v)
            out[m.group(1)] = d.group(1) if d else v
    return out


def set_ssh_key(key: str, cluster: Optional[str] = None) -> dict:
    """Use another SSH identity file for the cluster's login (this computer's
    launch.conf, HPC_KEY), after checking it logs in without a password."""
    cluster = cluster or active_cluster()
    if not cluster:
        raise ValueError("no cluster is configured")
    text = str(key).strip()
    m = re.match(r"^/([A-Za-z])/(.*)$", text)
    if os.name == "nt" and m:                 # Git Bash's /c/Users/… as Windows reads it
        text = f"{m.group(1).upper()}:/{m.group(2)}"
    path = Path(text).expanduser()
    if not text or not path.is_file():
        raise ValueError(f"no key file at {key!r}")
    conf = _conf(cluster)
    _find_key(conf["HPC_HOST"], str(path), None)          # raises with ssh's reason if it cannot log in
    file = CLUSTERS / cluster / "launch.conf"
    lines = file.read_text().splitlines()
    new = f"HPC_KEY={_posix(path)}"
    lines = [new if re.match(r"^HPC_KEY=", ln) else ln for ln in lines]
    if new not in lines:
        lines.insert(0, new)
    file.write_text("\n".join(lines) + "\n", newline="\n")
    return {"cluster": cluster, "ssh_key": _posix(path), "login": conf["HPC_HOST"]}


def _state() -> dict:
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def _port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", port)) == 0


# ── survey ───────────────────────────────────────────────────────────────────

def _recommend(parts: list[dict], assoc: list[dict], est: list[dict], storage: list[dict], preempt: dict) -> dict:
    def soon(kind: str) -> list[dict]:
        rows = [e for e in est if e["kind"] == kind and isinstance(e["minutes"], int)]
        # Soonest first; among equals prefer partitions that are not preemptible.
        return sorted(rows, key=lambda e: (e["minutes"] // 10, preempt.get(e["partition"], "OFF") != "OFF"))

    core, work, gpu = soon("core"), soon("worker"), soon("gpu")
    gres = {p["name"]: p["gres"] for p in parts}

    def big_gpu(e: dict) -> int:      # prefer cards that fit the 31B model (>= 40 GB)
        g = gres.get(e["partition"], "")
        return 0 if re.search(r"a100|h100|a6000|6000_ada|l40|a40|v100s?-32|rtx8000", g) else 1

    gpu = sorted(gpu, key=lambda e: (big_gpu(e), e["minutes"] // 10))
    roots = sorted((s for s in storage if s["writable"] and not s["path"].startswith("/home")),
                   key=lambda s: -_size_gb(s["free"]))
    return {
        "core": core[0] if core else None,
        "workers_try": [f"{e['partition']}:{e['account']}" for e in work[:4]],
        "llm_try": [f"{e['partition']}:{e['account']}:gpu:1" for e in gpu[:4]],
        "data_root_candidates": [f"{s['path']} ({s['free']} free)" for s in roots[:4]],
        "why": "core and workers: the partition/account that can start soonest, non-preemptible first. "
               "LLM: GPUs with 40 GB or more first (the 31B model), then soonest. "
               "Data root: writable shared storage with the most free space, never the home directory.",
    }


def _size_gb(text: str) -> float:
    m = re.match(r"^([0-9.]+)([KMGTP])", text or "")
    return float(m.group(1)) * {"K": 1e-6, "M": 1e-3, "G": 1, "T": 1e3, "P": 1e6}[m.group(2)] if m else 0.0


def hpc_probe(args: dict) -> dict:
    """Log in and survey the cluster (read-only)."""
    ssh = parse_ssh(args["ssh"])
    key = _find_key(ssh["target"], ssh["key"], ssh["port"])
    script = (HPC / "tools" / "probe.sh").read_text().replace("\r\n", "\n")
    root = args.get("data_root") or ""
    # Bytes, not text: on Windows text mode would turn the script's line ends into CRLF.
    r = subprocess.run(_ssh_args(ssh["target"], key or None, ssh["port"]) +
                       [f"GEMI_PROBE_ROOT={shlex.quote(root)} bash -ls"],
                       input=script.encode(), capture_output=True, timeout=300)
    stdout, stderr = r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace")
    body = stdout.split("@@probe", 1)[-1].split("@@end", 1)[0]
    rows = [line.split("|") for line in body.splitlines() if "|" in line]
    err = next((x[1] for x in rows if x[0] == "error"), None)
    if err or not rows:
        raise RuntimeError(err or f"the survey returned nothing: {(stderr or stdout)[-300:]}")
    merged: dict[str, dict] = {}        # sinfo prints one row per node type; one entry per partition here
    for x in rows:
        if x[0] != "partition":
            continue
        p = merged.setdefault(x[1], {"name": x[1], "available": x[2], "time_limit": x[3], "nodes": 0,
                                     "node_types": [], "gres": "", "idle_or_partly_free_nodes": int(x[8])})
        p["nodes"] += int(x[4])
        gpu = "" if x[7] in ("(null)", "") else re.sub(r"\(.*?\)", "", x[7])
        p["node_types"].append(f"{x[4]}x {x[5]} cpu, {round(int(x[6].rstrip('+')) / 1024)} GB" + (f", {gpu}" if gpu else ""))
        if gpu and gpu not in p["gres"]:
            p["gres"] = (p["gres"] + " " + gpu).strip()
    parts = list(merged.values())
    preempt = {x[1]: x[2] for x in rows if x[0] == "preempt"}
    assoc = [{"account": x[1], "partition": x[2], "qos": x[3] if len(x) > 3 else ""} for x in rows if x[0] == "assoc"]
    est = []
    for x in rows:
        if x[0] == "estimate":
            est.append({"kind": x[1], "partition": x[2], "account": x[3], "gres": x[4],
                        "minutes": int(x[5]) if re.match(r"^-?\d+$", x[5]) else x[5]})
    storage = [{"path": x[1], "size": x[2], "free": x[3], "writable": x[4] == "yes"} for x in rows if x[0] == "storage"]
    mine = {a["partition"] for a in assoc}
    host = next((x for x in rows if x[0] == "host"), ["", "", "", "", ""])
    container = next((x for x in rows if x[0] == "container"), ["", "none"])
    existing = next((x for x in rows if x[0] == "existing"), None)
    result = {
        "login": ssh["target"], "ssh_key": key or "(default key)", "login_node": host[1], "user": host[3],
        "slurm": next((x[1] for x in rows if x[0] == "slurm"), ""),
        "containers": " ".join(container[1:]) if container[1] != "none" else
                      "NOT FOUND - the stack needs Apptainer or Singularity",
        "internet_from_login_node": {x[1]: x[2] for x in rows if x[0] == "internet"},
        "my_accounts": assoc,
        "partitions_i_can_use": [{**p, "preemptible": preempt.get(p["name"], "OFF") != "OFF"}
                                 for p in parts if p["name"] in mine],
        "other_partitions": sorted(p["name"] for p in parts if p["name"] not in mine),
        "start_estimates_minutes": est,
        "storage": storage,
        "already_installed": ({"root": existing[1], "images": existing[2].split(), "data_folders": existing[3].split()}
                              if existing else None),
        "recommendation": _recommend(parts, assoc, est, storage, preempt),
    }
    return {"result": result}


# ── configuration ────────────────────────────────────────────────────────────

CONF_TEMPLATE = """# Launch settings for {name}, written by the agent's hpc_configure from a
# survey of the cluster ({when}). Sourced by hpc/gemi-hpc and the remote scripts.

HPC_HOST={login}
HPC_KEY={key}
HPC_KNOWN_HOSTS={known}
GEMI_HPC_ROOT={root}

# Published stack the images come from; current source is mounted over it.
GEMI_IMAGE_REGISTRY=ghcr.io/gemini-breeding
GEMI_IMAGE_VERSION={version}

# Core job (database, storage, API): small, long-running.
CORE_PARTITION=${{CORE_PARTITION:-{core_partition}}}
CORE_ACCOUNT=${{CORE_ACCOUNT:-{core_account}}}
CORE_CPUS=4
CORE_MEM=16G
CORE_TIME=2-00:00:00

# Worker jobs: "partition:account" tried in order; first that can start soon wins.
WORKER_TRY="{worker_try}"
WORKER_TIME=1-00:00:00
WORKER_RES_amiga="cpus=8 mem=32G gpus=0"
WORKER_RES_stitch="cpus=16 mem=56G gpus=0"
WORKER_RES_odm="cpus=16 mem=56G gpus=0"
WORKER_RES_geo="cpus=4 mem=16G gpus=0"
WORKER_RES_ml="cpus=8 mem=32G gpus={ml_gpus}"

LOCAL_API_PORT=auto

# Local LLM for the agent (vLLM, OpenAI-compatible API).
LLM_IMAGE=vllm/vllm-openai:latest
LLM_MODEL={llm_model}
LLM_NAME=gemma4
LLM_TRY="{llm_try}"
LLM_RES="cpus=8 mem=48G"
LLM_TIME=0-12:00:00
LLM_ARGS='--max-model-len 32768 --gpu-memory-utilization 0.92'
LLM_PULL_PARTITION={pull_partition}
LLM_PULL_ACCOUNT={pull_account}
"""


def hpc_configure(args: dict) -> dict:
    """Write (or replace) a cluster's launch.conf and make it the active one."""
    name = re.sub(r"[^a-z0-9_-]", "", str(args["name"]).lower())
    if not name:
        raise ValueError("name: letters, digits, - and _ only")
    ssh = parse_ssh(args["ssh"])
    key = _find_key(ssh["target"], ssh["key"], ssh["port"])
    key_path = Path(key).expanduser() if key else next(
        (p for p in ((_home() / ".ssh" / n) for n in ("id_ed25519", "id_rsa")) if p.exists()), _home() / ".ssh" / "id_rsa")
    worker_try = args["workers_try"] if isinstance(args["workers_try"], list) else str(args["workers_try"]).split()
    llm_try = args.get("llm_try") or []
    llm_try = llm_try if isinstance(llm_try, list) else str(llm_try).split()
    for entry in worker_try:
        if entry.count(":") != 1:
            raise ValueError(f"workers_try entries are partition:account, got {entry!r}")
    core_partition, core_account = str(args["core"]).split(":")
    version = (REPO / "frontend" / "src-tauri" / "stack-version") if RESOURCES is None else (REPO / "stack-version")
    folder = CLUSTERS / name
    folder.mkdir(parents=True, exist_ok=True)
    conf = CONF_TEMPLATE.format(
        name=name, when=time.strftime("%Y-%m-%d"), login=ssh["target"], key=_posix(key_path),
        known=_posix(_home() / ".ssh" / "known_hosts"), root=str(args["data_root"]).rstrip("/"),
        version=version.read_text().strip() if version.exists() else "latest",
        core_partition=core_partition, core_account=core_account, worker_try=" ".join(worker_try),
        ml_gpus=1 if args.get("ml_gpu") else 0,
        llm_model=args.get("llm_model") or "google/gemma-4-31B-it-qat-w4a16-ct", llm_try=" ".join(llm_try),
        pull_partition=worker_try[0].split(":")[0], pull_account=worker_try[0].split(":")[1])
    (folder / "launch.conf").write_text(conf, newline="\n")
    (CLUSTERS / "active").write_text(name + "\n", newline="\n")
    return {"result": {"cluster": name, "file": str(folder / "launch.conf"), "active": True,
                       "next": "hpc action=sync, then action=pull if images are not installed yet, then action=up"}}


# ── first-run setup (the app's welcome page) ─────────────────────────────────
# The person types their SSH command and key file; the page checks the login with the
# read-only survey and, on their say-so, writes the settings from its recommendation.
# Installing and starting (sync, pull, up) stay with the agent or Settings → Compute.

def ssh_command(ssh: str, key: str = "") -> str:
    """The SSH command with the key file given beside it (``-i``), checked to exist."""
    ssh = str(ssh or "").strip()
    if ssh and not ssh.startswith("ssh "):
        ssh = "ssh " + ssh
    parsed = parse_ssh(ssh)                    # raises with how to write it
    key = str(key or "").strip()
    m = re.match(r"^/([A-Za-z])/(.*)$", key)
    if os.name == "nt" and m:
        key = f"{m.group(1).upper()}:/{m.group(2)}"
    if key:
        if parsed["key"]:
            raise ValueError("give the key file once: in the SSH command (-i) or in the key file box")
        if not Path(key).expanduser().is_file():
            raise ValueError(f"no key file at {key}")
        ssh = f"ssh -i {shlex.quote(key)} " + ssh[len("ssh "):]
    elif parsed["key"] and not Path(parsed["key"]).expanduser().is_file():
        raise ValueError(f"no key file at {parsed['key']}")
    return ssh


def cluster_name(target: str) -> str:
    """A short name for the cluster from its login host: jdoe@login.hive.edu → hive."""
    labels = [x for x in target.split("@")[-1].lower().split(".") if x]
    for x in labels:
        if not re.fullmatch(r"(login|ssh|gateway|hpc|head)\d*", x):
            return re.sub(r"[^a-z0-9_-]", "", x) or "cluster"
    return re.sub(r"[^a-z0-9_-]", "", labels[0]) if labels else "cluster"


def cluster_check(ssh: str, key: str = "", data_root: str = "") -> dict:
    """Check the login and survey the cluster (read-only): what the welcome page shows."""
    command = ssh_command(ssh, key)
    survey = hpc_probe({"ssh": command, "data_root": data_root.strip()})["result"]
    rec = survey["recommendation"]
    existing = survey["already_installed"]
    roots = [c.split(" (")[0] for c in rec["data_root_candidates"]]
    folder = existing["root"] if existing else (f"{roots[0].rstrip('/')}/gemini_app" if roots else "")
    core = rec["core"]
    return {
        "ssh": command, "name": cluster_name(parse_ssh(command)["target"]),
        "login": survey["login"], "ssh_key": survey["ssh_key"], "user": survey["user"],
        "slurm": survey["slurm"], "containers": survey["containers"],
        "containers_ok": not survey["containers"].startswith("NOT FOUND"),
        "core": f"{core['partition']}:{core['account']}" if core else None,
        "core_wait_minutes": core["minutes"] if core else None,
        "workers_try": rec["workers_try"], "llm_try": rec["llm_try"],
        "data_root": folder, "data_root_candidates": rec["data_root_candidates"],
        "already_installed": existing,
        "internet": survey["internet_from_login_node"],
    }


def cluster_use(args: dict) -> dict:
    """Write the settings the welcome page agreed on and make the cluster the active one."""
    command = ssh_command(str(args.get("ssh") or ""), str(args.get("key") or ""))
    root = str(args.get("data_root") or "").strip()
    if not root.startswith("/"):
        raise ValueError("the GEMI folder on the cluster: a full path, e.g. /group/mylab/gemini_app")
    if not args.get("core") or not args.get("workers_try"):
        raise ValueError("no partition to run on: check the login first")
    name = str(args.get("name") or "") or cluster_name(parse_ssh(command)["target"])
    out = hpc_configure({"name": name, "ssh": command, "data_root": root, "core": args["core"],
                         "workers_try": args["workers_try"], "llm_try": args.get("llm_try") or []})
    return out["result"]


# ── running it ───────────────────────────────────────────────────────────────

ACTIONS = ("status", "sync", "pull", "pull_llm", "pull_ml_deps", "up", "worker", "llm_up", "llm_status", "llm_down",
           "connect", "disconnect", "logs", "down")


def _tunnel(conf: dict, local: int, remote_ip: str, remote_port: str) -> int:
    known = conf.get("HPC_KNOWN_HOSTS", "")
    cmd = ["ssh", "-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30",
           "-o", f"UserKnownHostsFile={known}", "-i", conf["HPC_KEY"], "-o", "IdentitiesOnly=yes",
           "-L", f"127.0.0.1:{local}:{remote_ip}:{remote_port}", conf["HPC_HOST"]]
    flags = (subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "DETACHED_PROCESS", 0)) if os.name == "nt" else 0
    p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         creationflags=flags, start_new_session=os.name != "nt")
    for _ in range(40):
        if _port_open(local):
            return p.pid
        if p.poll() is not None:
            break
        time.sleep(0.5)
    raise RuntimeError(f"could not open the tunnel on localhost:{local} (is the port in use?)")


def _kill(pid: int) -> None:
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
        else:
            os.kill(pid, 15)
    except OSError:
        pass


def _kv(text: str) -> dict:
    return dict(line.split("=", 1) for line in text.splitlines() if re.match(r"^[A-Z_]+=", line))


# ── the cluster administrators' rules ────────────────────────────────────────
# Clusters can publish rules for AI agents as skills: which partitions and accounts to
# use, limits, what not to run on login nodes. The gate lists and reads them (read-only). They are
# read before any cluster action, and they win over this agent's own defaults.

def _rules_dir(cluster: str) -> Path:
    return AGENT_DIR / "work" / "site-skills" / cluster


def site_rules(cluster: Optional[str] = None, fresh: bool = False) -> Optional[list[dict]]:
    """The cluster's published agent rules (name, description), cached for a day.
    None when they cannot be listed (gate too old, cluster unreachable)."""
    cluster = cluster or active_cluster()
    if not cluster:
        return None
    index = _rules_dir(cluster) / "index.json"
    if not fresh and index.exists() and time.time() - index.stat().st_mtime < 86400:
        return json.loads(index.read_text())
    try:
        out = _gemi_hpc(["site-skills"], cluster, timeout=90)
    except Exception:
        return json.loads(index.read_text()) if index.exists() else None
    rows = []
    for line in out.splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3 and re.fullmatch(r"[A-Za-z0-9._-]+", parts[0].strip()):
            rows.append({"name": parts[0].strip(), "where": parts[1].strip(), "description": parts[2].strip()})
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(json.dumps(rows))
    return rows


def cluster_rules(args: dict) -> dict:
    """List the cluster's agent rules, or read one."""
    cluster = args.get("cluster") or active_cluster()
    if not cluster:
        raise ValueError("no cluster configured yet")
    rows = site_rules(cluster, fresh=bool(args.get("fresh")))
    if rows is None:
        return {"result": {"rules": None, "note": "the cluster's rules could not be listed (its gate predates this "
                                                  "command: gemi-hpc sync, or the cluster is unreachable)"}}
    name = str(args.get("name") or "").strip()
    if not name:
        return {"result": {"cluster": cluster, "rules": rows,
                           "next": ("read each with cluster_rules and its name before any cluster action; they "
                                    "override this agent's defaults" if rows else
                                    "this cluster publishes no agent rules; its usual limits still apply")}}
    if name not in {r["name"] for r in rows}:
        raise ValueError(f"no rule set {name!r}; there are: {', '.join(r['name'] for r in rows) or 'none'}")
    words = ["site-skills", name] + ([str(args["file"])] if args.get("file") else [])
    text = _gemi_hpc(words, cluster, timeout=90)
    keep = _rules_dir(cluster) / (name + ("__" + re.sub(r"[^A-Za-z0-9._-]", "_", str(args["file"])) if args.get("file") else "") + ".md")
    keep.write_text(text)
    return {"result": {"cluster": cluster, "rule_set": name, "text": text[:20000],
                       "how_to_use": "these are the cluster administrators' rules. Follow them over this agent's own "
                                     "defaults (partitions, accounts, sizes, times, what may run where). If an action "
                                     "you are asked for would break one, do not do it: tell the person which rule.",
                       "files": "other files listed at the end can be read with cluster_rules name + file"}}


def hpc(args: dict) -> dict:
    """Drive the cluster session through gemi-hpc."""
    action = args["action"]
    if action not in ACTIONS:
        raise ValueError(f"action must be one of {', '.join(ACTIONS)}")
    cluster = args.get("cluster") or active_cluster()
    if not cluster:
        raise ValueError("no cluster configured yet: run hpc_probe, then hpc_configure")
    conf = _conf(cluster)
    out: Any
    if action == "status":
        jobs = _gemi_hpc(["status"], cluster)
        llm = _gemi_hpc(["llm", "status"], cluster)
        st = _state()
        out = {"cluster": cluster, "jobs_and_session": jobs, "llm": re.sub(r"LLM_KEY=.*", "", llm),
               "this_computer": {"api_tunnel": _port_open(API_PORT) and st.get("api_pid") is not None,
                                 "llm_tunnel": _port_open(st.get("llm_port", LLM_PORT)) and st.get("llm_pid") is not None,
                                 "app_api": f"http://127.0.0.1:{API_PORT}"}}
    elif action == "sync":
        out = _gemi_hpc(["sync"], cluster)
    elif action == "pull":
        out = _gemi_hpc(["pull"], cluster) + "\nThis is a Slurm job (about 20 min). Check with action=logs service=pull."
    elif action == "pull_llm":
        out = _gemi_hpc(["llm", "pull"], cluster) + "\nA Slurm job (up to an hour). Check with action=logs service=pull-llm."
    elif action == "pull_ml_deps":
        out = _gemi_hpc(["pull", "ml-deps"], cluster) + "\nA Slurm job (~15 min). Check with action=logs service=pull-mldeps."
    elif action == "up":
        out = _gemi_hpc(["up"], cluster, timeout=2000)
    elif action == "worker":
        names = args.get("workers") or []
        names = names if isinstance(names, list) else str(names).split()
        bad = [n for n in names if n not in ("amiga", "stitch", "geo", "ml", "odm")]
        if bad or not names:
            raise ValueError("workers: one or more of amiga, stitch, geo, ml, odm")
        out = _gemi_hpc(["worker", *names], cluster, timeout=600)
    elif action == "llm_up":
        out = _gemi_hpc(["llm", "up"], cluster, timeout=600)
    elif action == "llm_status":
        out = re.sub(r"LLM_KEY=.*", "", _gemi_hpc(["llm", "status"], cluster))
    elif action == "llm_down":
        out = _gemi_hpc(["llm", "down"], cluster)
    elif action == "logs":
        service = re.sub(r"[^a-z0-9-]", "", str(args.get("service") or "core"))
        out = _gemi_hpc(["logs", service], cluster, env={"LINES_N": str(int(args.get("lines") or 25))})[-3500:]
    elif action == "down":
        hpc({"action": "disconnect", "cluster": cluster})
        out = _gemi_hpc(["down"], cluster, timeout=900)
    elif action == "disconnect":
        st = _state()
        for k in ("api_pid", "llm_pid", "tiles_pid"):
            if st.get(k):
                _kill(int(st[k]))
        STATE.unlink(missing_ok=True)
        out = "tunnels closed"
    else:  # connect
        out = _connect(cluster, conf, bool(args.get("use_cluster_model")))
    return {"result": out}


def _connect(cluster: str, conf: dict, use_model: bool) -> dict:
    """Open the tunnels the app needs on this computer: the API on its usual
    port (so the app works unchanged), and the cluster's model if it is up."""
    session = _kv(_gemi_hpc(["status"], cluster))
    if "CORE_IP" not in session:
        raise RuntimeError("the core is not up yet: hpc action=up first")
    st = _state()
    for k in ("api_pid", "llm_pid", "tiles_pid"):
        if st.get(k):
            _kill(int(st[k]))
    if _port_open(API_PORT):
        raise RuntimeError(f"localhost:{API_PORT} is already in use (a local Docker stack?). Stop it, or use that stack.")
    st = {"cluster": cluster, "api_pid": _tunnel(conf, API_PORT, session["CORE_IP"], session["API_PORT"])}
    result: dict[str, Any] = {"app_api": f"http://127.0.0.1:{API_PORT}", "core_node": session.get("CORE_NODE")}
    if session.get("TITILER_PORT") and not _port_open(TILES_PORT):
        # Map tiles (orthomosaic previews, rover mosaics) from the session's own TiTiler.
        st["tiles_pid"] = _tunnel(conf, TILES_PORT, session["CORE_IP"], session["TITILER_PORT"])
        result["map_tiles"] = f"http://127.0.0.1:{TILES_PORT}"
    elif not session.get("TITILER_PORT"):
        result["map_tiles"] = "none: this session has no tile server (it is started from the next session on)"
    llm = _kv(_gemi_hpc(["llm", "env"], cluster))
    if "LLM_IP" in llm:
        port = LLM_PORT if not _port_open(LLM_PORT) else LLM_PORT + 1
        st["llm_pid"], st["llm_port"] = _tunnel(conf, port, llm["LLM_IP"], llm["LLM_PORT"]), port
        result["model"] = {"base_url": f"http://127.0.0.1:{port}/v1", "model": llm["LLM_MODEL_NAME"]}
        if use_model:
            from .runner import save_config

            save_config({"base_url": result["model"]["base_url"], "model": llm["LLM_MODEL_NAME"],
                         "api_key": llm["LLM_KEY"], "tool_mode": "text", "vision": True})
            result["model"]["agent_now_uses_it"] = True
    else:
        result["model"] = "not running on the cluster (hpc action=llm_up)"
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st))
    login = _kv(_gemi_hpc(["login"], cluster))
    result["app_login"] = {"email": login.get("GEMINI_FIRST_SUPERUSER_EMAIL"),
                           "password": login.get("GEMINI_FIRST_SUPERUSER_PASSWORD"),
                           "note": "the stack's administrator account; show it to the person so they can sign in"}
    return result


def _hpc(fn, description: str, props: dict, required: list[str]) -> None:
    _tool(fn, description, props, required, track=False, group="hpc")


_hpc(hpc_probe, "Log in to a Slurm cluster and survey it (read-only): partitions and GPUs you may use, accounts, "
     "estimated wait per partition for the core / a worker / a GPU job, container runtime, storage, and a "
     "recommended placement. Needs key-based SSH login.",
     {"ssh": {**_str, "description": "the person's SSH command, e.g. `ssh jdoe@login.cluster.edu`"},
      "data_root": {**_str, "description": "optional: an existing GEMI directory on the cluster to check"}}, ["ssh"])
_hpc(hpc_configure, "Write the cluster's settings (launch.conf) from the choices made after hpc_probe and make it "
     "the active cluster.",
     {"name": {**_str, "description": "short name for the cluster, e.g. mycluster"}, "ssh": _str,
      "data_root": {**_str, "description": "directory on the cluster's shared storage for images and data"},
      "core": {**_str, "description": "partition:account for the core job"},
      "workers_try": {**_strs, "description": "partition:account list, best first"},
      "llm_try": {**_strs, "description": "partition:account:gres list for the model, best first"},
      "llm_model": _str, "ml_gpu": _bool}, ["name", "ssh", "data_root", "core", "workers_try"])
_hpc(hpc, "Run the cluster session: action = status | sync (copy code) | pull (container images, once) | pull_llm "
     "(model image + weights, once) | pull_ml_deps (model backends for inference, once) | up (start core) | worker "
     "(workers: amiga stitch geo ml odm) | llm_up | llm_status | llm_down | connect (open tunnels so the app on "
     "this computer reaches the cluster; returns the app login) | disconnect | logs (service) | down (stop all).",
     {"action": _str, "workers": _strs, "service": _str, "lines": _int, "cluster": _str,
      "use_cluster_model": {**_bool, "description": "with connect: make the agent use the cluster's model"}},
     ["action"])
_INGEST_KEYS = ("experiment", "site", "population", "date", "platform", "sensor", "data_type", "name_ends",
                "run_of_day", "treatment")


def cluster_folder(args: dict) -> dict:
    """Data already on the cluster, in a folder the person named: look at it,
    or upload it into the session from a cluster job (nothing is copied to
    this computer). The folder is never searched for."""
    folder = str(args.get("folder") or "").strip()
    if not folder.startswith("/"):
        raise ValueError("give the folder's full path on the cluster, as the person named it "
                         "(the agent does not search the cluster's storage)")
    cluster = args.get("cluster") or active_cluster()
    if not cluster:
        raise ValueError("no cluster configured yet")
    if not args.get("upload"):
        out = _gemi_hpc(["folder-peek", folder], cluster, timeout=120)
        result: dict[str, Any] = {"result": out,
                                  "next": "to upload it: cluster_folder upload=true with experiment, site, population, "
                                          "date, platform, sensor, data_type (and name_ends to keep only some files)"}
        try:
            same = same_flight_folders(folder, out, cluster)
        except Exception:
            same = []                                # a look at the neighbours is extra, never in the way
        if same:
            result["same_flight"] = same
            result["next"] += ("; same_flight lists the flight's other cameras beside this folder (frames taken "
                               "at the same moments): upload each as its own sensor (e.g. Thermal) with the same "
                               "experiment, site, population, date, platform, treatment and run_of_day, and the "
                               "plot images step cuts them per plot with the RGB frames (a thermal camera also "
                               "gives canopy temperature)")
        return result
    from .uploads import check_kit, encode_setting

    args = dict(args)
    args["platform"], args["sensor"] = check_kit(args.get("platform", ""), args.get("sensor", ""))
    words = []
    for k in _INGEST_KEYS:
        v = str(args.get(k) or "").strip()
        if v:
            if len(v) > 120 or "\n" in v:
                raise ValueError(f"{k}={v!r}: at most 120 characters, one line")
            words.append(f"{k}={encode_setting(v)}")   # names with spaces go encoded
    missing = [k for k in _INGEST_KEYS[:7] if not args.get(k)]
    if missing:
        raise ValueError(f"missing {', '.join(missing)}")
    out = _gemi_hpc(["ingest", folder, *words], cluster, timeout=180)
    return {"result": out, "next": "a cluster job uploads the folder; follow it with hpc action=logs service=upload, "
                                   "then the run appears on the Process tab"}


_FRAME_NAME = re.compile(r"^(.*?)(\d{14})_(\d{3,5})(_[A-Za-z0-9]+)?(\.[A-Za-z0-9]+)$")


def _listing(peek: str) -> tuple[list[str], int]:
    """The entries a folder-peek shows (names, before the type summary) and its entry count."""
    lines = peek.splitlines()
    n = next((int(l.split(":", 1)[1]) for l in lines if l.startswith("entries:")), 0)
    names = []
    for l in lines[2:]:
        if l.startswith("files by type"):
            break
        if l.strip():
            names.append(l.strip())
    return names, n


def _frames_of(names: list[str]) -> Optional[dict]:
    """A folder of camera frames named like DJI_<14-digit time>_<sequence>_<kind>.<ext>:
    the first frame's time and sequence, and the ending its names share (_T.tif)."""
    hits = [m for m in (_FRAME_NAME.match(n) for n in names) if m]
    if len(hits) < max(3, len(names) // 2):
        return None
    ends = {(m.group(4) or "") + m.group(5) for m in hits}
    return {"first_time": hits[0].group(2), "first_seq": int(hits[0].group(3)),
            "name_ends": ends.pop() if len(ends) == 1 else ""}


def _sensor_name(folder: str) -> str:
    n = folder.lower()
    if "thermal" in n or n in ("ir", "lwir", "t"):
        return "Thermal"
    if "multispec" in n or n in ("ms", "multi"):
        return "Multispectral"
    if n in ("rgb", "v", "visible", "wide"):
        return "RGB"
    return folder


def same_flight_folders(folder: str, peek: str, cluster: str, limit: int = 4) -> list[dict]:
    """The flight's other cameras beside a folder of frames: sibling folders whose frames
    start at the same moment (within 5 s) as this folder's — a thermal camera's beside the
    RGB camera's, say. Only the folder's own parent is looked in, never further."""
    from datetime import datetime

    names, _ = _listing(peek)
    mine = _frames_of(names)
    if not mine:
        return []
    parent, here = folder.rstrip("/").rsplit("/", 1)
    siblings, _ = _listing(_gemi_hpc(["folder-peek", parent], cluster, timeout=120))
    t0 = datetime.strptime(mine["first_time"], "%Y%m%d%H%M%S")
    out = []
    for sib in [x for x in siblings if x != here and "." not in x][:limit]:
        path = f"{parent}/{sib}"
        try:
            peek2 = _gemi_hpc(["folder-peek", path], cluster, timeout=120)
        except Exception:
            continue
        sib_names, n = _listing(peek2)
        theirs = _frames_of(sib_names)
        if not theirs:
            continue
        dt = abs((datetime.strptime(theirs["first_time"], "%Y%m%d%H%M%S") - t0).total_seconds())
        if dt > 5:
            continue
        out.append({"folder": path, "sensor": _sensor_name(sib), "files": n, "name_ends": theirs["name_ends"],
                    "seconds_apart_at_start": dt})
    return out


_hpc(cluster_folder, "Data that is already on the cluster: folder = the full path the person named (never search "
     "for one). Without upload: what is in it (two levels). With upload=true and the run's settings: a cluster job "
     "uploads it into the session as one batch, like an upload from the app (asks first). A look at a folder of camera "
     "frames also lists the flight's other cameras beside it (same_flight: e.g. thermal frames taken with the RGB "
     "ones); upload each as its own sensor with the same labels.",
     {"folder": _str, "upload": _bool, "experiment": _str, "site": _str, "population": _str,
      "date": {**_str, "description": "YYYY-MM-DD"}, "platform": _PLATFORM, "sensor": _SENSOR,
      "data_type": {**_str, "description": "images | amiga_bin | orthomosaic"},
      "name_ends": {**_str, "description": "keep only files whose names end so, comma separated, e.g. _V.JPG"},
      "run_of_day": _str, "treatment": _str, "cluster": _str}, ["folder"])
_hpc(cluster_rules, "The cluster administrators' rules for AI agents (published as skills): "
     "without a name, which there are; with a name, its text. Read every one before any cluster action; they "
     "override this agent's own defaults.",
     {"name": _str, "file": {**_str, "description": "another file of that rule set, as its listing names it"},
      "cluster": _str, "fresh": _bool}, [])
