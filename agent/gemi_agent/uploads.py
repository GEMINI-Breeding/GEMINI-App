"""Background uploads: a batch of local files sent to the stack in parallel,
with a status file an agent (or a person) can poll.

A batch runs in its own process (`python -m gemi_agent _task <id>`), so it
survives the command or tool call that started it. State lives in
``agent/work/tasks/<id>.json``; a ``<id>.cancel`` file next to it stops the
batch after the parts in flight.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from .client import AGENT_DIR, Client

TASKS = AGENT_DIR / "work" / "tasks"
CHUNK = 8 * 1024 * 1024          # one S3 multipart part; the server needs >= 5 MiB
PARTS_PARALLEL = 4               # parts of one file in flight

# What each data type is called in the app and where its files go under the
# dataset folder. EXTRACT_BINARY is queued per file for rover logs.
DATA_TYPES = {
    "amiga_bin": {"label": "Farm-ng Binary File", "subdir": "Images", "ext": (".bin",), "extract": True},
    "images": {"label": "Image Data", "subdir": "Images", "ext": (".jpg", ".jpeg", ".png", ".tif", ".tiff"), "extract": False},
    "orthomosaic": {"label": "Orthomosaic", "subdir": "Orthomosaic", "ext": (".tif", ".tiff"), "extract": False},
}


def _path(task_id: str) -> Path:
    return TASKS / f"{task_id}.json"


def read(task_id: str) -> dict:
    p = _path(task_id)
    if not p.exists():
        raise ValueError(f"no task {task_id}")
    for _ in range(15):                     # the worker may be mid-write
        try:
            return json.loads(p.read_text())
        except (json.JSONDecodeError, PermissionError):   # Windows: file briefly locked while replaced
            time.sleep(0.2)
    raise RuntimeError(f"task file {p} is unreadable")


def list_tasks() -> list[dict]:
    TASKS.mkdir(parents=True, exist_ok=True)
    out = []
    for p in sorted(TASKS.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            out.append(summary(json.loads(p.read_text())))
        except (json.JSONDecodeError, KeyError, PermissionError):
            continue
    return out


def summary(t: dict) -> dict:
    files = t["files"]
    sent = sum(f["sent"] for f in files)
    total = sum(f["size"] for f in files)
    by = {}
    for f in files:
        by[f["status"]] = by.get(f["status"], 0) + 1
    alive = t["status"] == "running" and time.time() - t.get("heartbeat", 0) < 120
    return {
        "task_id": t["id"], "kind": "upload", "status": t["status"] if (alive or t["status"] != "running") else "stalled",
        "files": by, "bytes_sent": sent, "bytes_total": total,
        "percent": round(100 * sent / total, 1) if total else 100.0,
        "mb_per_s": t.get("mb_per_s"), "eta_min": t.get("eta_min"),
        "parallel_files": t["parallel"], "target": t["prefix"], "dataset_id": t["dataset_id"],
        "extraction_jobs": [f["job_id"] for f in files if f.get("job_id")],
        "failed": [{"name": f["name"], "error": f.get("error")} for f in files if f["status"] == "failed"],
        "error": t.get("error"),
    }


# The platforms and sensors data is uploaded as (the app's sensorKit.ts): they choose the
# processing. A sensor is the platform's own camera ("RGB") or another one mounted on it,
# named after it ("RGB-SonyA7R"), so two cameras tested on one date stay apart.
PLATFORMS = ("Drone", "Rover", "Handheld")
SENSOR_TYPES = ("RGB", "Thermal")


def check_kit(platform: str, sensor: str) -> tuple[str, str]:
    """The platform and sensor as stored, from what was given ("drone", "rgb - Sony A7R" →
    "Drone", "RGB-SonyA7R"); anything outside the lists is refused, saying what is allowed."""
    p = next((x for x in PLATFORMS if x.lower() == str(platform or "").strip().lower()), None)
    if p is None:
        raise ValueError(f"platform {platform!r}: use one of {', '.join(PLATFORMS)} (it chooses the processing: "
                         "drones the aerial pipeline, rovers and handheld cameras the ground one)")
    head, _, camera = str(sensor or "").strip().partition("-")
    t = next((x for x in SENSOR_TYPES if x.lower() == head.strip().lower()), None)
    if t is None:
        raise ValueError(f"sensor {sensor!r}: use one of {', '.join(SENSOR_TYPES)}, or another camera of that type as "
                         "<type>-<camera>, e.g. RGB-SonyA7R")
    slug = "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", camera) if w)
    return p, (f"{t}-{slug}" if slug else t)


def start(client: Client, files: list[Path], *, experiment: str, site: str, population: str, date: str,
          platform: str, sensor: str, data_type: str, parallel: int = 3, dataset_id: Optional[str] = None,
          extract: Optional[bool] = None, run_of_day: str = "", treatment: str = "", source_folder: str = "",
          foreground: bool = False) -> dict:
    """Create what the upload needs in the app (experiment, site, population,
    season of that year, platform, sensor, a dataset) and start the batch."""
    kind = DATA_TYPES.get(data_type)
    if kind is None:
        raise ValueError(f"data_type must be one of {', '.join(DATA_TYPES)}")
    platform, sensor = check_kit(platform, sensor)
    if not files:
        raise ValueError("no files to upload")
    year = date[:4]
    if not (len(date) == 10 and year.isdigit()):
        raise ValueError("date must be YYYY-MM-DD")
    exp = client.ensure_entity("experiments", experiment)
    client.ensure_entity("sites", site, experiment_name=experiment)
    client.ensure_entity("populations", population, experiment_name=experiment)
    client.ensure_entity("seasons", year, experiment_name=experiment)
    client.ensure_entity("sensor_platforms", platform, experiment_name=experiment)
    client.ensure_entity("sensors", sensor, experiment_name=experiment, sensor_platform_name=platform)
    if dataset_id:
        ds_id = dataset_id                     # add to an earlier batch (e.g. after a failure)
    else:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        name = f"{experiment}-{kind['label'].replace(' ', '')}-{stamp}-{uuid.uuid4().hex[:4]}"
        # Same-day batches at one scope are told apart by these two labels (the app's upload page
        # stores the same keys): which run of the day, and which treatment.
        labels = {k: str(v).strip() for k, v in (("run_of_day", run_of_day), ("treatment", treatment),
                                                 ("source_folder", source_folder)) if str(v or "").strip()}
        slug = "__".join(f"{'run' if k == 'run_of_day' else 'trt'}-{re.sub(r'[^A-Za-z0-9]+', '-', v)}"
                         for k, v in labels.items() if k != "source_folder")
        if slug:
            name += "__" + slug
        ds = client.post_json("/api/datasets", {
            "dataset_name": name, "experiment_name": experiment,
            "dataset_info": {"files_prefix": f"gemini/Raw/{experiment}", "bucket": "gemini",
                             "data_type_label": kind["label"], "season": year, "site": site, "population": population,
                             "collection_date": date, "platform": platform, "sensor": sensor, **labels}})
        ds_id = str(ds["id"])
    scope_dir = f"Raw/{year}/{experiment}/{site}/{population}/{date}/{platform}/{sensor}"
    if data_type == "orthomosaic":
        # Where the app's upload puts them and its run page looks: no dataset folder, and the
        # elevation model beside the RGB in Orthomosaic-DEM/ (one is not offered as the other).
        prefix = f"{scope_dir}/Orthomosaic"
    else:
        prefix = f"{scope_dir}/{ds_id[:8]}/{kind['subdir']}"
    task_id = time.strftime("%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    task = {
        "id": task_id, "status": "running", "created": time.time(), "heartbeat": time.time(),
        "parallel": max(1, min(int(parallel), 8)), "prefix": prefix, "dataset_id": ds_id,
        "experiment_id": str(exp["id"]), "extract": kind["extract"] if extract is None else bool(extract),
        "batch_label": batch_label(run_of_day, treatment),
        "files": [{"path": str(f), "name": f.name, "size": f.stat().st_size, "sent": 0, "status": "pending",
                   **({"prefix": f"{scope_dir}/Orthomosaic-DEM"}
                      if data_type == "orthomosaic" and is_elevation(f.name) else {})}
                  for f in files],
    }
    TASKS.mkdir(parents=True, exist_ok=True)
    _path(task_id).write_text(json.dumps(task))
    if foreground:                          # a cluster job uploading data that is already on the cluster
        run(task_id)
        return summary(read(task_id))
    env = dict(os.environ, GEMI_API=client.base, GEMI_TOKEN=client.token())
    log = open(TASKS / f"{task_id}.log", "ab")
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "DETACHED_PROCESS", 0) if os.name == "nt" else 0
    # The packaged app is one executable that takes the same sub-commands as `python -m gemi_agent`.
    me = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, "-m", "gemi_agent"]
    subprocess.Popen([*me, "_task", task_id], cwd=str(AGENT_DIR), env=env,
                     stdout=log, stderr=log, stdin=subprocess.DEVNULL, creationflags=flags,
                     start_new_session=os.name != "nt")
    return summary(task)


_PLAIN = re.compile(r"[A-Za-z0-9_.,:@%+-]{1,80}")


def encode_setting(value: str) -> str:
    """A setting as one word the cluster's gate lets through: as it is when it
    is plain, else `b64:` and its URL-safe base64 (names with spaces, …)."""
    import base64

    if _PLAIN.fullmatch(value) and not value.startswith("b64:"):
        return value
    return "b64:" + base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


def decode_setting(value: str) -> str:
    import base64

    if not value.startswith("b64:"):
        return value
    v = value[4:]
    return base64.urlsafe_b64decode(v + "=" * (-len(v) % 4)).decode()


def is_elevation(name: str) -> bool:
    """An elevation model by its name (2022-08-23-DEM.tif, odm_dem_dsm.tif, …_DSM.tif)."""
    return re.search(r"(^|[^a-z])(dem|dsm|dtm|elevation)([^a-z]|$)", name.lower()) is not None


def batch_label(run_of_day: Any, treatment: Any) -> str:
    """"run 2 · drought": how a labelled batch is shown; "" when it has no labels."""
    run, trt = str(run_of_day or "").strip(), str(treatment or "").strip()
    return " · ".join(x for x in (f"run {run}" if run else "", trt) if x)


def cancel(task_id: str) -> dict:
    read(task_id)
    (TASKS / f"{task_id}.cancel").write_text("")
    return {"task_id": task_id, "cancelling": True}


def run(task_id: str) -> None:
    """The batch itself (worker process)."""
    task = read(task_id)
    client = Client()
    lock = threading.Lock()
    cancel_flag = TASKS / f"{task_id}.cancel"
    started = time.time()
    already = sum(f["sent"] for f in task["files"])

    def save() -> None:
        with lock:
            sent = sum(f["sent"] for f in task["files"])
            total = sum(f["size"] for f in task["files"])
            dt = max(1e-6, time.time() - started)
            rate = (sent - already) / dt
            task["heartbeat"] = time.time()
            task["mb_per_s"] = round(rate / 1048576, 1)
            task["eta_min"] = round((total - sent) / rate / 60, 1) if rate > 0 else None
            tmp = _path(task_id).with_suffix(".tmp")
            tmp.write_text(json.dumps(task))
            for _ in range(20):
                try:
                    os.replace(tmp, _path(task_id))
                    break
                except PermissionError:     # Windows: a reader has the file open right now
                    time.sleep(0.05)

    def one(f: dict) -> None:
        if cancel_flag.exists() or f["status"] == "done":
            return
        f["status"] = "uploading"
        size = f["size"]
        total = max(1, -(-size // CHUNK))
        object_name = f"{f.get('prefix') or task['prefix']}/{f['name']}"
        ident = f"agent:{object_name}:{size}"
        try:
            have = set(client.post_json("/api/files/check_uploaded_chunks", {
                "file_identifier": ident, "total_chunks": total, "object_name": object_name,
            }).get("uploaded_part_numbers") or [])
            f["sent"] = sum(min(CHUNK, size - (n - 1) * CHUNK) for n in have if 1 <= n <= total)
            todo = [i for i in range(total) if (i + 1) not in have]
            fd_lock = threading.Lock()
            with open(f["path"], "rb") as fh:
                def part(i: int) -> None:
                    if cancel_flag.exists():
                        raise InterruptedError("cancelled")
                    with fd_lock:
                        fh.seek(i * CHUNK)
                        data = fh.read(CHUNK)
                    client.upload_chunk(data, i, total, ident, object_name, task["experiment_id"], task["dataset_id"])
                    with lock:
                        f["sent"] += len(data)
                with ThreadPoolExecutor(PARTS_PARALLEL) as pool:
                    list(pool.map(part, todo))
            if task["extract"]:
                job = client.submit_job("EXTRACT_BINARY", {
                    "files": [f["name"]], "localDirPath": task["prefix"],
                    "experiment_id": task["experiment_id"], "dataset_id": task["dataset_id"],
                }, task["experiment_id"])
                f["job_id"] = str(job.get("id"))
            f["status"] = "done"
        except InterruptedError:
            f["status"] = "cancelled"
        except Exception as e:  # one bad file must not stop the others
            f["status"], f["error"] = "failed", f"{type(e).__name__}: {e}"[:300]

    stop = threading.Event()

    def ticker() -> None:
        while not stop.wait(2):
            try:
                save()
            except OSError:                 # status is best-effort; the upload goes on
                pass

    threading.Thread(target=ticker, daemon=True).start()
    try:
        with ThreadPoolExecutor(task["parallel"]) as pool:
            list(pool.map(one, task["files"]))
        states = {f["status"] for f in task["files"]}
        task["status"] = ("cancelled" if cancel_flag.exists() else
                          "completed" if states == {"done"} else "completed_with_failures")
    except Exception as e:
        task["status"], task["error"] = "failed", f"{type(e).__name__}: {e}"
    finally:
        stop.set()
        save()
    if task["status"] == "completed":
        _show_on_process_tab(client, task)


def _show_on_process_tab(client: Client, task: dict) -> None:
    """A finished upload becomes a run on the Process tab with Data Sync done,
    so the next step is ready there (best effort)."""
    try:
        from .process_runs import ProcessRuns, scope_from_path

        scope = scope_from_path(task["prefix"])
        if scope is None:
            return
        if task.get("batch_label"):
            scope["batchLabel"] = task["batch_label"]     # a labelled batch gets its own pipeline run
        pr = ProcessRuns(client)
        run = pr.ensure_run(scope)
        pr.set_step(run, "data_sync", "completed", outputs={"files": len(task["files"])})
    except Exception as e:  # never fail an upload over this
        print(f"process tab not updated: {type(e).__name__}: {e}")
