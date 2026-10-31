"""Data from online storage (Box, Google Drive, Dropbox, S3, WebDAV, a web
folder, SFTP) brought into the app with rclone, without passing through the
person's computer when the stack is on a cluster.

Two places a copy can run, the same steps in each:

* ``local`` — the stack runs on this computer (Docker). rclone (a pinned
  release, checked against its SHA-256) is installed under agent/work/bin; the
  connections live in agent/work/rclone/rclone.conf (owner-only); a copy runs
  as its own process (``python -m gemi_agent _fetch <id>``), copies into
  agent/work/incoming/<name> and uploads it with the agent's uploader.
* ``cluster`` — the stack runs on a cluster. The connections live on the
  cluster (its run folder, owner-only); the gate's ``cloud-*`` commands list
  them, browse them and submit a job that copies straight to the cluster and
  uploads from there (``hpc/remote/fetch.sbatch``).

A sign-in to an OAuth service (Box, Google Drive, Dropbox) happens in the
browser on this computer (``rclone authorize``); the token is then stored
where the copies run, and only there. Box hands out refresh tokens that work
once, so one sign-in serves one place.
"""
from __future__ import annotations

import base64
import configparser
import hashlib
import io
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Any, Optional

from .client import AGENT_DIR

RCLONE_VERSION = "v1.68.2"
# From https://downloads.rclone.org/v1.68.2/SHA256SUMS
RCLONE_SHA256 = {
    "linux-amd64": "0e6fa18051e67fc600d803a2dcb10ddedb092247fc6eee61be97f64ec080a13c",
    "linux-arm64": "c6e9d4cf9c88b279f6ad80cd5675daebc068e404890fa7e191412c1bc7a4ac5f",
    "osx-amd64": "cdc685e16abbf35b6f47c95b2a5b4ad73a73921ff6842e5f4136c8b461756188",
    "osx-arm64": "323f387b32bcf9ddfc3874f01879a0b2689dbd91309beb8c3a4410db04d0c41f",
    "windows-amd64": "812bf76cc02c04cf6327f3683f3d5a88e47d36c39db84c1a745777496be7d993",
}

WORK = AGENT_DIR / "work"
BIN = WORK / "bin"
CONF = WORK / "rclone" / "rclone.conf"
INCOMING = WORK / "incoming"
FETCHES = WORK / "fetches"

# What a person can connect, and what each asks for. OAuth ones sign in in the browser.
PROVIDERS: list[dict[str, Any]] = [
    {"type": "box", "label": "Box", "oauth": True},
    {"type": "drive", "label": "Google Drive", "oauth": True},
    {"type": "dropbox", "label": "Dropbox", "oauth": True},
    {"type": "s3", "label": "S3 storage (AWS, Wasabi, MinIO, …)", "fields": [
        {"key": "provider", "label": "Provider", "options": ["AWS", "Wasabi", "Minio", "Ceph", "Other"]},
        {"key": "access_key_id", "label": "Access key ID"},
        {"key": "secret_access_key", "label": "Secret access key", "secret": True},
        {"key": "region", "label": "Region (optional)", "optional": True},
        {"key": "endpoint", "label": "Endpoint URL (not for AWS)", "optional": True}]},
    {"type": "webdav", "label": "WebDAV (Nextcloud, ownCloud, CyVerse Data Store, …)", "fields": [
        {"key": "url", "label": "URL"},
        {"key": "vendor", "label": "Server", "options": ["other", "nextcloud", "owncloud", "sharepoint"]},
        {"key": "user", "label": "User", "optional": True},
        {"key": "pass", "label": "Password", "secret": True, "optional": True}]},
    {"type": "http", "label": "A public web folder (file listing at a URL)", "fields": [
        {"key": "url", "label": "URL"}]},
    {"type": "sftp", "label": "SFTP server", "fields": [
        {"key": "host", "label": "Host"},
        {"key": "user", "label": "User"},
        {"key": "port", "label": "Port (optional)", "optional": True},
        {"key": "pass", "label": "Password", "secret": True}]},
]
_TYPES = {p["type"]: p for p in PROVIDERS}
# Settings rclone keeps obscured in its config (not readable at a glance).
_OBSCURED = {"pass"}

# What each upload data type keeps from a copied folder (the uploader's own extensions).
_KEEP = {"images": ("*.jpg", "*.jpeg", "*.png", "*.tif", "*.tiff"), "amiga_bin": ("*.bin",),
         "orthomosaic": ("*.tif", "*.tiff")}


# -- rclone itself -------------------------------------------------------------
def _platform() -> str:
    osname = {"darwin": "osx", "linux": "linux", "win32": "windows"}.get(sys.platform)
    arch = {"x86_64": "amd64", "amd64": "amd64", "arm64": "arm64", "aarch64": "arm64"}.get(platform.machine().lower())
    key = f"{osname}-{arch}"
    if key not in RCLONE_SHA256:
        raise RuntimeError(f"no rclone build known for this computer ({sys.platform} {platform.machine()})")
    return key


def rclone_path(install: bool = True) -> Optional[Path]:
    """rclone on this computer: the one GEMI installed, else one on PATH, else (install) download it."""
    mine = BIN / ("rclone.exe" if os.name == "nt" else "rclone")
    if mine.exists():
        return mine
    found = shutil.which("rclone")
    if found:
        return Path(found)
    if not install:
        return None
    key = _platform()
    name = f"rclone-{RCLONE_VERSION}-{key}"
    req = urllib.request.Request(f"https://downloads.rclone.org/{RCLONE_VERSION}/{name}.zip",
                                 headers={"User-Agent": "gemi-agent"})   # the site refuses Python's default
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if hashlib.sha256(data).hexdigest() != RCLONE_SHA256[key]:
        raise RuntimeError("the rclone download does not match its published checksum; not installed")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        member = next(n for n in z.namelist() if n.rsplit("/", 1)[-1] in ("rclone", "rclone.exe"))
        BIN.mkdir(parents=True, exist_ok=True)
        mine.write_bytes(z.read(member))
    mine.chmod(mine.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return mine


def _rclone(args: list[str], timeout: int = 120, inp: Optional[str] = None) -> str:
    CONF.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run([str(rclone_path()), "--config", str(CONF), *args], capture_output=True, text=True,
                       timeout=timeout, input=inp)
    if r.returncode:
        raise RuntimeError(_rclone_error(r.stderr or r.stdout))
    if CONF.exists():
        CONF.chmod(0o600)
    return r.stdout


def _rclone_error(text: str) -> str:
    lines = [ln.split(": ", 1)[-1] if " ERROR " in ln or "CRITICAL" in ln else ln
             for ln in text.strip().splitlines() if ln.strip()]
    return (lines[-1] if lines else "rclone failed")[:400]


# -- connections -----------------------------------------------------------------
def check_name(name: str) -> str:
    name = name.strip().lower()
    if not re.fullmatch(r"[a-z][a-z0-9_-]{0,30}", name):
        raise ValueError("a connection's name: a letter, then letters, digits, - or _ (up to 31)")
    return name


def authorize(kind: str, timeout: int = 300) -> str:
    """Sign in to an OAuth service in this computer's browser; the token rclone gets back."""
    if not _TYPES.get(kind, {}).get("oauth"):
        raise ValueError(f"{kind} does not sign in in the browser")
    try:
        r = subprocess.run([str(rclone_path()), "authorize", kind], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError("the sign-in was not finished in the browser within 5 minutes") from None
    out = r.stdout + "\n" + r.stderr
    m = re.search(r"--->\s*(\{.*?\})\s*<---", out, re.S) or re.search(r"(\{\"access_token\".*?\})\s*$", out, re.S | re.M)
    if r.returncode or not m:
        raise RuntimeError("the sign-in did not give a token: " + _rclone_error(out))
    token = m.group(1).strip()
    json.loads(token)                       # a token is a JSON object
    return token


def connect(name: str, kind: str, fields: Optional[dict] = None, where: str = "local",
            cluster: Optional[str] = None) -> dict:
    """Add (or replace) a connection where the copies run: OAuth services sign in in the browser here."""
    name = check_name(name)
    spec = _TYPES.get(kind)
    if spec is None:
        raise ValueError(f"unknown storage type {kind}; one of {', '.join(_TYPES)}")
    settings: dict[str, str] = {}
    if spec.get("oauth"):
        settings["token"] = authorize(kind)
    for f in spec.get("fields", []):
        v = str((fields or {}).get(f["key"]) or "").strip()
        if not v:
            if not f.get("optional"):
                raise ValueError(f"{f['label']} is needed")
            continue
        if "\n" in v or len(v) > 4000:
            raise ValueError(f"{f['label']}: one line, at most 4000 characters")
        settings[f["key"]] = _rclone(["obscure", v]).strip() if f["key"] in _OBSCURED else v
    if kind == "s3" and settings.get("provider") == "AWS":
        settings.setdefault("region", "us-east-1")
    if where == "cluster":
        lines = "".join(f"{k} = {v}\n" for k, v in settings.items())
        out = _gemi_hpc_in(["cloud", "add", name, kind], lines, cluster)
        if "refused" in out or "saved" not in out:
            raise RuntimeError((out.strip().splitlines() or ["the cluster did not save the connection"])[-1])
        return {"name": name, "type": kind, "where": "cluster", "result": out.strip()}
    _rclone(["config", "create", name, kind, *[f"{k}={v}" for k, v in settings.items()], "--non-interactive"],
            timeout=120)
    return {"name": name, "type": kind, "where": "local"}


def remove(name: str, where: str = "local", cluster: Optional[str] = None) -> dict:
    name = check_name(name)
    if where == "cluster":
        from .hpc_tools import _gemi_hpc

        return {"result": _gemi_hpc(["cloud", "rm", name], cluster, timeout=120)}
    _rclone(["config", "delete", name])
    return {"removed": name}


def remotes(where: str = "local", cluster: Optional[str] = None) -> dict:
    """The connections (names and types, never their settings)."""
    if where == "cluster":
        from .hpc_tools import _gemi_hpc

        out = _gemi_hpc(["cloud", "remotes"], cluster, timeout=120)
        rows = [ln.split("|") for ln in out.splitlines() if ln.startswith("remote|")]
        return {"where": "cluster", "rclone": "rclone=yes" in out,
                "remotes": [{"name": r[1], "type": r[2], "label": _TYPES.get(r[2], {}).get("label", r[2])}
                            for r in rows if len(r) >= 3]}
    cp = configparser.ConfigParser(interpolation=None)
    if CONF.exists():
        cp.read(CONF)
    return {"where": "local", "rclone": rclone_path(install=False) is not None,
            "remotes": [{"name": s, "type": cp[s].get("type", ""),
                         "label": _TYPES.get(cp[s].get("type", ""), {}).get("label", cp[s].get("type", ""))}
                        for s in cp.sections()]}


def encode_path(path: str) -> str:
    """A remote path as one gate word (url-safe base64; "." for the top)."""
    path = path.strip().strip("/")
    return base64.urlsafe_b64encode(path.encode()).decode().rstrip("=") if path else "."


def browse(name: str, path: str = "", where: str = "local", cluster: Optional[str] = None) -> dict:
    """One folder of a connection: its folders and files, folders first."""
    name = check_name(name)
    path = path.strip().strip("/")
    if where == "cluster":
        from .hpc_tools import _gemi_hpc

        if not remotes("cluster", cluster)["rclone"]:
            ensure_cluster_rclone(cluster)
        out = _gemi_hpc(["cloud", "ls", name, encode_path(path)], cluster, timeout=180)
        text = out[out.find("["):] if "[" in out else "[]"
    else:
        text = _rclone(["lsjson", "--max-depth", "1", "--no-mimetype", f"{name}:{path}"], timeout=180)
    try:
        items = json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError(f"could not list {name}:{path}: {text.strip()[:300]}") from None
    rows = [{"name": i.get("Name"), "path": f"{path}/{i.get('Name')}".strip("/"), "is_dir": bool(i.get("IsDir")),
             "size": i.get("Size") if not i.get("IsDir") else None, "modified": i.get("ModTime")} for i in items]
    rows.sort(key=lambda r: (not r["is_dir"], str(r["name"]).lower()))
    return {"name": name, "path": path, "items": rows}


def read_file(name: str, path: str, where: str = "local", cluster: Optional[str] = None) -> bytes:
    """One small file of a connection (up to 20 MB): a field design, a field map."""
    name = check_name(name)
    path = path.strip().strip("/")
    if where == "cluster":
        from .hpc_tools import _gemi_hpc

        out = _gemi_hpc(["cloud", "cat", name, encode_path(path)], cluster, timeout=300).strip()
        line = out.splitlines()[-1] if out else ""
        try:
            return base64.b64decode(line, validate=True)
        except Exception:
            raise RuntimeError(f"could not read {name}:{path}: {out[-300:]}") from None
    r = subprocess.run([str(rclone_path()), "--config", str(CONF), "cat", "--count", str(20 * 1024 * 1024),
                        f"{name}:{path}"], capture_output=True, timeout=300)
    if r.returncode:
        raise RuntimeError(_rclone_error(r.stderr.decode(errors="replace")))
    return r.stdout


def ensure_cluster_rclone(cluster: Optional[str] = None, wait_s: int = 900) -> None:
    """rclone on the cluster (a one-time download job), waited for."""
    from .hpc_tools import _gemi_hpc

    _gemi_hpc(["pull", "rclone"], cluster, timeout=180)
    deadline = time.time() + wait_s
    while time.time() < deadline:
        time.sleep(15)
        if remotes("cluster", cluster)["rclone"]:
            return
    raise RuntimeError("rclone is not on the cluster yet; see gemi-hpc logs pull-rclone")


def _gemi_hpc_in(args: list[str], stdin: str, cluster: Optional[str]) -> str:
    """gemi-hpc with text on stdin (secrets: never on a command line)."""
    from .hpc_tools import HPC, REPO, _bash, _posix, CLUSTERS

    e = dict(os.environ, GEMI_CLUSTERS_DIR=_posix(CLUSTERS), GEMI_AUDIT_LOG=_posix(WORK / "hpc-audit.log"))
    if cluster:
        e["GEMI_CLUSTER"] = cluster
    r = subprocess.run([_bash(), _posix(HPC / "gemi-hpc"), *args], input=stdin, capture_output=True, text=True,
                       timeout=180, env=e, cwd=str(REPO))
    out = (r.stdout + ("\n" + r.stderr if r.returncode else "")).strip()
    if r.returncode:
        raise RuntimeError(f"gemi-hpc {' '.join(args)} failed: {out[-600:]}")
    return out


# -- copies ------------------------------------------------------------------------
def _dest_name(path: str) -> str:
    base = re.sub(r"[^A-Za-z0-9_.-]+", "-", (path.strip("/").rsplit("/", 1)[-1] or "top")).strip("-.") or "top"
    return f"{base[:50]}-{time.strftime('%Y%m%d-%H%M%S')}"


def includes(data_type: str = "", name_ends: str = "", name_has: str = "") -> list[str]:
    """rclone --include patterns: the files the upload would take (any when no data type).
    ``name_has``: only names containing it (one date's files of a folder of several dates,
    e.g. "2023-06-15")."""
    ends = [e.strip() for e in name_ends.split(",") if e.strip()]
    pats = [f"*{e}" for e in ends] if ends else list(_KEEP.get(data_type, ()))
    has = re.sub(r"[*?\[\]{}]", "", name_has.strip())
    if has:
        pats = [f"*{has}*{p[1:] if p.startswith('*') else p}" for p in pats] or [f"*{has}*"]
    return pats


def in_app_names(client, settings: dict) -> set[str]:
    """Names of the files the app already holds for the upload's date, platform and sensor
    (any earlier upload of that scope). Empty when it cannot be listed: then all is copied,
    and the upload still skips what it finds by name and size."""
    from .uploads import already_uploaded

    s = settings
    prefix = (f"Raw/{s['date'][:4]}/{s['experiment']}/{s['site']}/{s['population']}/"
              f"{s['date']}/{s['platform']}/{s['sensor']}/")
    return {n for n, _ in already_uploaded(client, prefix)}


def _glob_literal(name: str) -> str:
    """A file name as an rclone pattern that matches only that name."""
    return re.sub(r"([*?\[\]{}\\])", r"\\\1", name)


def filter_rules(pats: list[str], skip: set[str]) -> str:
    """rclone --filter-from rules: leave out the names in ``skip`` (at any depth), then keep
    what the include patterns keep (everything when there are none)."""
    lines = [f"- {_glob_literal(n)}" for n in sorted(skip) if n.strip() == n and n]
    lines += [f"+ {p}" for p in pats]
    if pats:
        lines.append("- **")
    return "\n".join(lines) + "\n"


def write_skip_filter(out: str, pats: list[str], settings: dict, client=None) -> int:
    """Write the rules that skip files already in the app; the number of names skipped."""
    from .client import Client

    skip = in_app_names(client or Client(), settings)
    Path(out).write_text(filter_rules(pats, skip))
    return len(skip)


def fetch(name: str, path: str, *, where: str = "local", cluster: Optional[str] = None,
          settings: Optional[dict] = None, keep: bool = False, token: Optional[str] = None,
          api: Optional[str] = None) -> dict:
    """Copy a folder (or one file) of a connection to where the stack runs, then (with the run's
    settings: experiment, site, population, date, platform, sensor, data_type) upload it."""
    name = check_name(name)
    path = path.strip().strip("/")
    settings = {k: str(v).strip() for k, v in (settings or {}).items() if str(v or "").strip()}
    # Which files of the folder to copy (one date's, say): a copy filter, not an upload setting.
    name_has = settings.pop("name_has", "")
    if settings:
        missing = [k for k in ("experiment", "site", "population", "date", "platform", "sensor", "data_type")
                   if not settings.get(k)]
        if missing:
            raise ValueError(f"to upload after copying, give: {', '.join(missing)}")
        from .uploads import check_kit

        settings["platform"], settings["sensor"] = check_kit(settings["platform"], settings["sensor"])
    pats = includes(settings.get("data_type", ""), settings.get("name_ends", ""), name_has)
    dest = _dest_name(path)
    if where == "cluster":
        from .hpc_tools import _gemi_hpc
        from .uploads import encode_setting

        if not remotes("cluster", cluster)["rclone"]:
            ensure_cluster_rclone(cluster)
        words = ["cloud", "fetch", name, encode_path(path), dest]
        if pats:
            words.append("include=" + encode_path(",".join(pats)))
        if keep:
            words.append("keep=1")
        words += [f"{k}={encode_setting(v)}" for k, v in settings.items()]
        try:
            jid = _submit_cluster_copy(words, cluster)
        except JobSlotsFull:
            # Every job slot of the cluster tooling is taken: the copy waits here and starts by
            # itself when one frees (as uploads queued by the agent do).
            return _wait_for_slot(words, cluster, dest, f"{name}:{path}", settings.get("date"))
        return {"where": "cluster", "id": jid, "dest": dest, "state": "QUEUED",
                "note": "a cluster job copies the folder to the cluster" + (" and uploads it" if settings else "")}
    rclone_path()                           # installed before the copy process needs it
    fid = time.strftime("%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    FETCHES.mkdir(parents=True, exist_ok=True)
    state = {"id": fid, "where": "local", "state": "copying", "source": f"{name}:{path}",
             "dest": str(INCOMING / dest), "include": pats, "settings": settings, "keep": keep,
             "created": time.time(), "line": ""}
    _save(state)
    env = dict(os.environ, **({"GEMI_TOKEN": token} if token else {}), **({"GEMI_API": api} if api else {}))
    log = open(FETCHES / f"{fid}.log", "ab")
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "DETACHED_PROCESS", 0) if os.name == "nt" else 0
    me = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, "-m", "gemi_agent"]
    subprocess.Popen([*me, "_fetch", fid], cwd=str(AGENT_DIR), env=env, stdout=log, stderr=log,
                     stdin=subprocess.DEVNULL, creationflags=flags, start_new_session=os.name != "nt")
    return state


def _save(state: dict) -> None:
    tmp = FETCHES / f"{state['id']}.tmp"
    tmp.write_text(json.dumps(state))
    os.replace(tmp, FETCHES / f"{state['id']}.json")


def _read(fid: str) -> dict:
    if not re.fullmatch(r"[0-9A-Za-z-]{1,40}", fid):
        raise ValueError("bad copy id")
    p = FETCHES / f"{fid}.json"
    if not p.exists():
        raise ValueError(f"no copy {fid}")
    return json.loads(p.read_text())


_STATS = re.compile(r"NOTICE:\s*(.*\d+%.*)$")


def progress_line(line: str) -> Optional[str]:
    """rclone's one-line stats ("1.2 GiB / 6.3 GiB, 19%, 50 MiB/s, ETA 1m") from a log line."""
    m = _STATS.search(line.strip())
    return m.group(1).strip() if m else None


def run_fetch(fid: str) -> int:
    """The copy itself (its own process): rclone copy, then the upload, then tidy up."""
    from . import uploads
    from .client import Client

    state = _read(fid)
    dest = Path(state["dest"])
    dest.mkdir(parents=True, exist_ok=True)
    filters = [a for p in state["include"] for a in ("--include", p)]
    skipped = 0
    if state["settings"]:
        # Files the app already has for this date, platform and sensor are not copied at all.
        rules = FETCHES / f"{fid}.filter"
        try:
            skipped = write_skip_filter(str(rules), state["include"], state["settings"], Client())
            filters = ["--filter-from", str(rules)]
        except Exception as e:      # copy all; the upload still skips what is in the app
            state["note"] = f"could not check what is already in the app ({e}); copying everything"
        state["skipped_in_app"] = skipped
        _save(state)
    cmd = [str(rclone_path()), "--config", str(CONF), "copy", state["source"], str(dest), "--ignore-case",
           *filters,
           "--transfers", "4", "--stats", "3s", "--stats-one-line", "--stats-log-level", "NOTICE"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    last_err = ""
    for line in proc.stdout or []:
        p = progress_line(line)
        if p:
            state["line"] = p
            _save(state)
        elif "ERROR" in line or "CRITICAL" in line:
            last_err = line.strip()
    if proc.wait():
        state.update(state="failed", error=_rclone_error(last_err or "the copy failed"))
        _save(state)
        return 1
    files = sorted(p for p in dest.rglob("*") if p.is_file() and not p.name.startswith("."))
    state.update(files=len(files), bytes=sum(p.stat().st_size for p in files))
    if not state["settings"]:
        state.update(state="done", line=f"copied {len(files)} files to {dest}")
        _save(state)
        return 0
    s = state["settings"]
    kind = uploads.DATA_TYPES[s["data_type"]]
    ends = [e.lower() for e in s.get("name_ends", "").split(",") if e]
    files = [p for p in files if p.suffix.lower() in kind["ext"] and (not ends or p.name.lower().endswith(tuple(ends)))]
    if not files and skipped:
        shutil.rmtree(dest, ignore_errors=True)
        state.update(state="done", line=f"nothing new: the app already has these files ({skipped} for "
                                        f"{s['date']} {s['platform']}/{s['sensor']})")
        _save(state)
        return 0
    if not files:
        state.update(state="failed", error=f"no {kind['label']} files in the copy (kept at {dest})")
        _save(state)
        return 1
    state.update(state="uploading", line=f"uploading {len(files)} files")
    _save(state)
    out = uploads.start(Client(), files, experiment=s["experiment"], site=s["site"], population=s["population"],
                        date=s["date"], platform=s["platform"], sensor=s["sensor"], data_type=s["data_type"],
                        run_of_day=s.get("run_of_day", ""), treatment=s.get("treatment", ""),
                        source_folder=state["source"])
    state["upload_task"] = out["task_id"]
    while out.get("status") == "running":   # the upload's own process; followed here for the page
        time.sleep(3)
        out = uploads.summary(uploads.read(out["task_id"]))
        done = (out.get("files") or {}).get("done", 0)
        state["line"] = f"uploading: {out.get('percent', 0)}% ({done}/{len(files)} files)"
        _save(state)
    ok = out.get("status") in ("done", "completed")
    if out.get("failed"):
        state["failed"] = out["failed"][:20]
    if ok and not state["keep"]:
        shutil.rmtree(dest, ignore_errors=True)
    state.update(state="done" if ok else "failed",
                 line="uploaded" + ("" if state["keep"] else "; the copy here is removed") if ok
                 else f"upload {out.get('status')}; the copy is kept at {dest}")
    _save(state)
    return 0 if ok else 1


# -- cluster copies waiting for a free job slot ------------------------------------------------------

WAITING = WORK / "fetches_waiting"
_WAIT_SECONDS = 60


class JobSlotsFull(RuntimeError):
    """The cluster tooling's job limit is reached: nothing else can start until a job ends."""


def _submit_cluster_copy(words: list[str], cluster: Optional[str]) -> str:
    from .hpc_tools import _gemi_hpc

    try:
        out = _gemi_hpc(words, cluster, timeout=180)
    except RuntimeError as e:
        if "job limits" in str(e):
            raise JobSlotsFull(str(e)) from None
        raise
    m = re.search(r"Submitted batch job (\d+)", out)
    if not m:
        raise RuntimeError(out.strip()[-400:] or "the copy job was not submitted")
    return m.group(1)


def _wait_path(wid: str) -> Path:
    if not re.fullmatch(r"w[0-9a-z-]+", wid):
        raise ValueError("bad waiting copy id")
    return WAITING / f"{wid}.json"


def _wait_for_slot(words: list[str], cluster: Optional[str], dest: str, source: str,
                   date: Optional[str]) -> dict:
    WAITING.mkdir(parents=True, exist_ok=True)
    wid = "w" + time.strftime("%m%d%H%M%S") + "-" + uuid.uuid4().hex[:4]
    rec = {"id": wid, "where": "cluster", "state": "WAITING", "source": source, "dest": dest, "date": date,
           "created": time.time(), "words": words, "cluster": cluster,
           "line": "waiting for a free cluster job slot; starts by itself when one frees"}
    _wait_path(wid).write_text(json.dumps(rec))
    threading.Thread(target=_keep_trying, args=(wid,), daemon=True).start()
    return {k: v for k, v in rec.items() if k not in ("words", "cluster")}


def _keep_trying(wid: str) -> None:
    p = _wait_path(wid)
    while p.exists():
        rec = json.loads(p.read_text())
        if rec.get("job_id") or rec.get("state") == "FAILED":
            return
        try:
            rec["job_id"] = _submit_cluster_copy(rec["words"], rec.get("cluster"))
            rec.update(state="QUEUED", line="submitted to the cluster")
            p.write_text(json.dumps(rec))
            return
        except JobSlotsFull:
            time.sleep(_WAIT_SECONDS)
        except Exception as e:                    # noqa: BLE001 — reported on the copy
            rec.update(state="FAILED", error=str(e)[-400:])
            p.write_text(json.dumps(rec))
            return


def resume_waiting() -> None:
    """Copies still waiting for a slot when this service stopped: keep trying (at start)."""
    if not WAITING.exists():
        return
    for p in WAITING.glob("w*.json"):
        try:
            rec = json.loads(p.read_text())
        except Exception:
            continue
        if not rec.get("job_id") and rec.get("state") == "WAITING":
            threading.Thread(target=_keep_trying, args=(rec["id"],), daemon=True).start()


def _waiting(cluster: Optional[str]) -> list[dict]:
    if not WAITING.exists():
        return []
    out = []
    for p in WAITING.glob("w*.json"):
        try:
            rec = json.loads(p.read_text())
        except Exception:
            continue
        if time.time() - rec.get("created", 0) > 3 * 86400:
            continue
        out.append(rec)
    return out


def fetches(where: str = "local", cluster: Optional[str] = None) -> list[dict]:
    """The recent copies, newest first."""
    if where == "cluster":
        waiting = [{k: v for k, v in r.items() if k not in ("words", "cluster")}
                   for r in _waiting(cluster) if not r.get("job_id")]
        from .hpc_tools import _gemi_hpc

        out = _gemi_hpc(["cloud", "state"], cluster, timeout=120)
        rows = []
        for ln in out.splitlines():
            if ln.startswith("job|"):
                _, jid, st, last = (ln.split("|", 3) + [""])[:4]
                rows.append({"id": jid, "where": "cluster", "state": st, "line": progress_line(last) or last})
        return waiting + rows
    if not FETCHES.exists():
        return []
    rows = [json.loads(p.read_text()) for p in FETCHES.glob("*.json")]
    return sorted(rows, key=lambda r: -r.get("created", 0))[:20]


def fetch_state(fid: str, where: str = "local", cluster: Optional[str] = None) -> dict:
    if where == "cluster":
        from .hpc_tools import _gemi_hpc

        if fid.startswith("w"):
            # A copy that waited for a job slot: its own state until submitted, the job's after.
            rec = json.loads(_wait_path(fid).read_text())
            if not rec.get("job_id"):
                return {k: v for k, v in rec.items() if k not in ("words", "cluster")}
            return {**fetch_state(rec["job_id"], where, cluster), "id": fid, "date": rec.get("date")}
        if not re.fullmatch(r"\d+", fid):
            raise ValueError("bad job id")
        log = _gemi_hpc(["cloud", "state", fid], cluster, timeout=120)
        row = next((r for r in fetches("cluster", cluster) if r["id"] == fid), {"id": fid, "state": "UNKNOWN"})
        lines = [progress_line(ln) for ln in log.splitlines()]
        return {**row, "line": next((p for p in reversed(lines) if p), row.get("line")), "log": log[-4000:]}
    return _read(fid)
