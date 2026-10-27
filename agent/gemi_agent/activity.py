"""What the agent service is doing, for the app's Console.

The API's log shows requests and its workers' jobs, but the work this service
does itself was silent: uploads from a cluster folder, copies from online
storage, starting and stopping cluster jobs, and those jobs coming and going
in the cluster's queue. Each of those notes a line here; ``GET /agent/logs``
hands them to the Console, which merges them with the API's.

Lines live in memory only (the last 1000), like the API's own.
"""
from __future__ import annotations

import collections
import logging
import threading
import time
from typing import Optional

MAX_LINES = 1000
_lines: collections.deque = collections.deque(maxlen=MAX_LINES)
_lock = threading.Lock()


def note(message: str, level: str = "INFO", source: str = "agent") -> None:
    """One line in the Console (tagged with its source: "agent", "cluster", …)."""
    message = " ".join(str(message).split())[:1000]
    if not message:
        return
    with _lock:
        _lines.append({"level": level.upper(), "message": message, "ts": time.time(), "source": source})


def lines(since: Optional[float] = None, limit: Optional[int] = None) -> list[dict]:
    with _lock:
        out = [dict(x) for x in _lines]
    if since is not None:
        out = [x for x in out if x["ts"] > since]
    if limit:
        out = out[-limit:]
    return out


class _Handler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            note(record.getMessage(), record.levelname)
        except Exception:
            pass


def install() -> None:
    """Send the package's own log records (logging.getLogger("gemi_agent…")) here too."""
    log = logging.getLogger("gemi_agent")
    if not any(isinstance(h, _Handler) for h in log.handlers):
        log.addHandler(_Handler(level=logging.INFO))
        if log.level == logging.NOTSET or log.level > logging.INFO:
            log.setLevel(logging.INFO)


# -- cluster jobs coming and going ----------------------------------------------------------------

_seen: dict[str, dict] = {}          # Slurm job id -> its last row
_primed = False

_STATE = {"PENDING": "queued", "RUNNING": "running", "COMPLETING": "finishing",
          "CANCELLED": "cancelled", "FAILED": "failed", "TIMEOUT": "out of time"}


def _what(job_name: str) -> str:
    n = job_name[len("gemi-"):] if job_name.startswith("gemi-") else job_name
    return {"core": "app core", "llm": "model"}.get(n) or (f"{n[len('worker-'):]} worker" if n.startswith("worker-") else n)


def cluster_jobs(rows: list[dict], tail=None) -> None:
    """The cluster's queue as just read (every gemi-* job: id, name, state,
    reason, node). Notes jobs that appeared, changed state, or left the
    queue; for a job that left, ``tail(job)`` may give its log's last lines.
    The first read only remembers, so a restart doesn't repeat the queue."""
    global _primed
    now = {r["job_id"]: r for r in rows}
    if _primed:
        for jid, r in now.items():
            old = _seen.get(jid)
            st = _STATE.get(r["slurm_state"], r["slurm_state"].lower())
            if old is None:
                where = f" on {r['node']}" if r.get("node") else f" ({r['reason']})" if r.get("reason") else ""
                note(f"{_what(r['name'])} job {jid} {st}{where}", source="cluster")
            elif old["slurm_state"] != r["slurm_state"]:
                where = f" on {r['node']}" if r.get("node") and r["slurm_state"] == "RUNNING" else ""
                note(f"{_what(r['name'])} job {jid} {st}{where}", source="cluster")
        gone = [old for jid, old in _seen.items() if jid not in now]
        if gone:
            # Reading a log is another trip to the cluster: not while the queue is being read.
            threading.Thread(target=_ended, args=(gone, tail), daemon=True).start()
    _seen.clear()
    _seen.update(now)
    _primed = True


def _ended(jobs: list[dict], tail) -> None:
    for old in jobs:
        last = ""
        if tail is not None:
            try:
                last = (tail(old) or "").strip()
            except Exception:
                last = ""
        bad = any(w in last.lower() for w in ("error", "failed", "traceback", "refused", "denied", "killed"))
        note(f"{_what(old['name'])} job {old['job_id']} ended" + (f": {last[-400:]}" if last else ""),
             level="WARNING" if bad else "INFO", source="cluster")


def log_name(job_name: str, job_id: str) -> str:
    """The Slurm log the gate's `logs` reads for one job (hpc/remote: --output=…)."""
    n = job_name[len("gemi-"):] if job_name.startswith("gemi-") else job_name
    if n in ("fetch", "pull-rclone"):
        return f"slurm-{n}-{job_id}"
    return f"{n}-{job_id}"


# -- work running in other processes (uploads, copies) ---------------------------------------------

_said: dict[str, str] = {}           # key -> the last line noted for it
_polled = {"t": 0.0}


def track(key: str, text: str, level: str = "INFO", source: str = "agent") -> None:
    """Note ``text`` for ``key`` only when it differs from the last one noted for that key."""
    if _said.get(key) != text:
        _said[key] = text
        note(text, level, source)


def _mb(n: float) -> str:
    return f"{n / 1e9:.1f} GB" if n >= 1e9 else f"{n / 1e6:.0f} MB"


def poll_local_work() -> None:
    """Uploads and copies run as their own processes and keep their state in files: read
    those and note what changed (progress in 10% steps). At most every 5 s."""
    if time.time() - _polled["t"] < 5:
        return
    _polled["t"] = time.time()
    from . import cloud, uploads

    first = not _said
    try:
        for t in uploads.list_tasks()[:20]:
            if first and t["status"] not in ("running", "stalled"):
                _said[f"upload:{t['task_id']}"] = "seen"
                continue
            n = sum(t["files"].values())
            done = t["files"].get("done", 0)
            where = t["target"].rstrip("/").split("/")[-1] or t["target"]
            if t["status"] in ("running", "stalled"):
                step = int(t["percent"] // 10) * 10
                speed = f", {t['mb_per_s']} MB/s" if t.get("mb_per_s") else ""
                track(f"upload:{t['task_id']}",
                      f"upload to {where}: {t['status']} {step}%+ ({done}/{n} files, "
                      f"{_mb(t['bytes_sent'])} of {_mb(t['bytes_total'])}{speed})",
                      "WARNING" if t["status"] == "stalled" else "INFO")
            else:
                failed = "; ".join(f"{f['name']}: {f['error']}" for f in t["failed"][:3])
                track(f"upload:{t['task_id']}",
                      f"upload to {where} {t['status']}: {done}/{n} files" + (f" — failed {failed}" if failed else "")
                      + (f" — {t['error']}" if t.get("error") else ""),
                      "ERROR" if t["status"] == "failed" or t["failed"] else "INFO")
    except Exception:
        pass
    try:
        for f in cloud.fetches("local")[:20]:
            key = f"fetch:{f['id']}"
            if first and f.get("state") not in ("copying", "uploading"):
                _said[key] = "seen"
                continue
            # rclone's progress line changes every second: only with the outcome.
            done = f.get("state") not in ("copying", "uploading")
            line = f" — {f['line']}" if done and f.get("line") else ""
            track(key, f"copy {f.get('source', f['id'])}: {f.get('state')}{line}",
                  "ERROR" if str(f.get("state")).lower() == "failed" else "INFO")
    except Exception:
        pass


# -- work in flight, for the app's process panel -------------------------------------------------

_KIND = {"ingest": "Upload from a cluster folder", "fetch": "Copy from online storage",
         "pull-rclone": "Installing the storage copier"}


def work_in_flight() -> list[dict]:
    """Uploads and copies under way or waiting: on the cluster (from the last queue read),
    waiting for a cluster job slot, and on this computer. One row each:
    {kind, title, state: waiting | queued | running, detail}."""
    rows: list[dict] = []
    for jid, r in sorted(_seen.items()):
        name = r["name"][len("gemi-"):] if r["name"].startswith("gemi-") else r["name"]
        if name not in _KIND:
            continue
        st = r.get("slurm_state")
        state = "running" if st in ("RUNNING", "COMPLETING") else "queued"
        why = "" if state == "running" else (
            "waiting for the account's CPU allowance" if str(r.get("reason") or "").startswith("QOSGrp")
            else "waiting for room on the cluster")
        rows.append({"kind": name, "id": jid, "title": f"{_KIND[name]} (cluster job {jid})", "state": state,
                     "detail": why or (f"on {r['node']}" if r.get("node") else "")})
    try:
        from . import cloud

        for w in cloud._waiting(None):
            if w.get("job_id") or w.get("state") != "WAITING":
                continue
            rows.append({"kind": "fetch", "id": w["id"],
                         "title": "Copy from online storage" + (f" · {w['date']}" if w.get("date") else ""),
                         "state": "waiting", "detail": "waiting for a free cluster job slot; starts by itself"})
        for f in cloud.fetches("local")[:20]:
            if f.get("state") in ("copying", "uploading"):
                rows.append({"kind": "fetch", "id": f["id"], "title": f"Copy {f.get('source', '')}".strip(),
                             "state": "running", "detail": f.get("line") or f.get("state")})
    except Exception:
        pass
    try:
        from . import uploads

        for t in uploads.list_tasks()[:20]:
            if t["status"] in ("running", "stalled"):
                where = t["target"].rstrip("/").split("/")[-1] or t["target"]
                rows.append({"kind": "upload", "id": t["task_id"], "title": f"Upload to {where}",
                             "state": "running", "detail": f"{int(t['percent'])}%"})
    except Exception:
        pass
    return rows
