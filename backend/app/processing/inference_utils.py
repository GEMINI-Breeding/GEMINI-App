"""
Roboflow inference utilities for plot images.

Handles overlapping crop-and-infer for large images, coordinate transformation
back to image level, and Non-Maximum Suppression (NMS) deduplication.

Public API
----------
run_inference_on_image(image_path, api_key, model_id, ...) -> list[dict]
apply_nms(predictions, iou_threshold) -> list[dict]
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


# ── Image cropping ─────────────────────────────────────────────────────────────

def crop_image_with_overlap(
    image_path: Path | str,
    crop_size: int = 640,
    overlap: int = 32,
) -> list[dict[str, Any]]:
    """
    Tile a large image into overlapping crop_size x crop_size patches.

    Returns a list of dicts:
        { crop_id, x_offset, y_offset, width, height, crop_path, temp_dir }

    The caller is responsible for deleting temp_dir after use.
    """
    image = Image.open(str(image_path))
    img_w, img_h = image.size

    stride = crop_size - overlap

    def _positions(length: int) -> list[int]:
        pos = list(range(0, length - crop_size + 1, stride))
        if pos and pos[-1] + crop_size < length:
            pos.append(length - crop_size)
        return pos or [0]

    x_positions = _positions(img_w)
    y_positions = _positions(img_h)

    temp_dir = tempfile.mkdtemp()
    crops: list[dict[str, Any]] = []
    crop_id = 0

    for y in y_positions:
        for x in x_positions:
            actual_x = min(x, img_w - crop_size) if img_w >= crop_size else 0
            actual_y = min(y, img_h - crop_size) if img_h >= crop_size else 0
            actual_w = min(crop_size, img_w - actual_x)
            actual_h = min(crop_size, img_h - actual_y)

            crop = image.crop((actual_x, actual_y, actual_x + actual_w, actual_y + actual_h))

            if actual_w < crop_size or actual_h < crop_size:
                padded = Image.new("RGB", (crop_size, crop_size), (255, 255, 255))
                padded.paste(crop, (0, 0))
                crop = padded

            crop_path = str(Path(temp_dir) / f"crop_{crop_id}.jpg")
            crop.save(crop_path, format="JPEG", quality=85)

            crops.append(
                {
                    "crop_id": crop_id,
                    "x_offset": actual_x,
                    "y_offset": actual_y,
                    "width": actual_w,
                    "height": actual_h,
                    "crop_path": crop_path,
                    "temp_dir": temp_dir,
                }
            )
            crop_id += 1

    return crops


def _transform_to_image_coords(predictions: list[dict], crop_info: dict) -> list[dict]:
    """Shift crop-level box centres and polygon points to image-level coordinates."""
    result = []
    for p in predictions:
        transformed: dict[str, Any] = {
            "class": p.get("class", ""),
            "confidence": p.get("confidence", 0.0),
            "x": p.get("x", 0) + crop_info["x_offset"],
            "y": p.get("y", 0) + crop_info["y_offset"],
            "width": p.get("width", 0),
            "height": p.get("height", 0),
            "crop_id": crop_info["crop_id"],
        }
        # Segmentation: offset polygon points to image-level coordinates
        raw_points = p.get("points", [])
        if raw_points:
            transformed["points"] = [
                {"x": pt["x"] + crop_info["x_offset"], "y": pt["y"] + crop_info["y_offset"]}
                for pt in raw_points
            ]
        result.append(transformed)
    return result


# ── NMS ───────────────────────────────────────────────────────────────────────

def _iou(a: dict, b: dict) -> float:
    """IoU between two centre-format boxes (x, y, width, height)."""
    ax0, ay0 = a["x"] - a["width"] / 2, a["y"] - a["height"] / 2
    ax1, ay1 = a["x"] + a["width"] / 2, a["y"] + a["height"] / 2
    bx0, by0 = b["x"] - b["width"] / 2, b["y"] - b["height"] / 2
    bx1, by1 = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2

    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)

    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0

    inter = (ix1 - ix0) * (iy1 - iy0)
    union = a["width"] * a["height"] + b["width"] * b["height"] - inter
    return inter / union if union > 0 else 0.0


def apply_nms(predictions: list[dict], iou_threshold: float = 0.5) -> list[dict]:
    """Per-class greedy NMS."""
    if not predictions:
        return []

    by_class: dict[str, list[dict]] = {}
    for p in predictions:
        by_class.setdefault(p["class"], []).append(p)

    kept: list[dict] = []
    for preds in by_class.values():
        preds.sort(key=lambda x: x["confidence"], reverse=True)
        while preds:
            best = preds.pop(0)
            kept.append(best)
            preds = [p for p in preds if _iou(best, p) < iou_threshold]

    return kept


# ── Local inference server helpers ─────────────────────────────────────────────

CLOUD_API_URL = "https://detect.roboflow.com"
LOCAL_API_URL = "http://localhost:9002"

# Prevents two concurrent inference jobs from both trying to start the Docker
# container at the same time (race condition: both would docker rm -f each other).
import threading as _threading
_docker_start_lock = _threading.Lock()


def _is_local_server_running(host: str = "localhost", port: int = 9002) -> bool:
    """
    Returns True only if a Roboflow inference server is responding on the given
    host/port.  A plain TCP connection check is not sufficient because other
    services (e.g. the GEMI frontend dev server) may occupy the port.
    """
    import requests
    try:
        # Use /info which returns JSON on the Roboflow inference server.
        # Avoid checking / because newer inference server versions serve an HTML
        # Swagger/welcome page there, which would be falsely rejected.
        resp = requests.get(f"http://{host}:{port}/info", timeout=2)
        logger.debug(
            "_is_local_server_running %s:%s → status=%s content-type=%r",
            host, port, resp.status_code, resp.headers.get("content-type", ""),
        )
        return resp.status_code < 500
    except Exception as exc:
        logger.debug("_is_local_server_running %s:%s → exception: %s", host, port, exc)
        return False


ROBOFLOW_DOCKER_IMAGE_CPU = "roboflow/roboflow-inference-server-cpu:latest"
ROBOFLOW_DOCKER_IMAGE_GPU = "roboflow/roboflow-inference-server-gpu:latest"


def _find_docker() -> str | None:
    """Return path to docker binary, checking common install locations."""
    import shutil
    common = [
        "/usr/local/bin/docker",
        "/opt/homebrew/bin/docker",
        "/usr/bin/docker",
        shutil.which("docker") or "",
    ]
    for p in common:
        if p and shutil.which(p) is not None:
            return p
    found = shutil.which("docker")
    return found


def _start_local_server(host_port: int = 9002) -> None:
    """Start the Roboflow inference server via Docker (no pip conflict)."""
    import subprocess
    import time

    logger.info("Starting Roboflow inference server via Docker…")

    docker = _find_docker()
    if docker is None:
        raise RuntimeError(
            "Docker not found. The local inference server runs as a Docker container.\n"
            "Install Docker Desktop from https://www.docker.com/products/docker-desktop/ "
            "and ensure it is running."
        )

    # Verify Docker daemon is reachable before doing anything else
    ping = subprocess.run(
        [docker, "info"],
        capture_output=True, text=True,
    )
    if ping.returncode != 0:
        raise RuntimeError(
            f"Docker daemon is not running or not accessible.\n{ping.stderr[:400]}\n"
            "Start Docker Desktop and retry."
        )

    # Remove any stopped container with the same name to avoid conflicts
    subprocess.run(
        [docker, "rm", "-f", "gemi-inference"],
        capture_output=True,
    )

    # Only pull if the image isn't already cached locally
    inspect = subprocess.run(
        [docker, "image", "inspect", ROBOFLOW_DOCKER_IMAGE_CPU],
        capture_output=True,
    )
    if inspect.returncode != 0:
        logger.info(
            "Image %s not found locally — pulling (this may take several minutes on first run)…",
            ROBOFLOW_DOCKER_IMAGE_CPU,
        )
        pull = subprocess.run(
            [docker, "pull", ROBOFLOW_DOCKER_IMAGE_CPU],
            capture_output=True, text=True, timeout=1800,  # 30 min for large image
        )
        if pull.returncode != 0:
            raise RuntimeError(
                f"Failed to pull {ROBOFLOW_DOCKER_IMAGE_CPU}:\n{pull.stderr[:400]}"
            )
    else:
        logger.info("Image %s already cached locally — skipping pull.", ROBOFLOW_DOCKER_IMAGE_CPU)

    run_result = subprocess.run(
        [
            docker, "run", "--rm", "-d",
            "-p", "9002:9001",
            "--name", "gemi-inference",
            ROBOFLOW_DOCKER_IMAGE_CPU,
        ],
        capture_output=True, text=True,
    )
    if run_result.returncode != 0:
        raise RuntimeError(
            f"Failed to start gemi-inference container:\n{run_result.stderr[:400]}"
        )
    logger.info("Container started: %s", run_result.stdout.strip())

    # Give the container a moment to bind its port before we start polling.
    # WSL2/Windows adds significant startup overhead.
    time.sleep(5)

    # Wait up to 3 minutes for the server to become available.
    # The Roboflow image loads PyTorch + models on first request, which can
    # take 2+ minutes on Windows/WSL2.
    max_wait = 180
    for i in range(max_wait):
        if _is_local_server_running(port=host_port):
            logger.info("Local inference server is ready (waited %ds).", i + 5)
            return
        time.sleep(1)
    # Capture container logs to help diagnose why it didn't come up
    logs = subprocess.run(
        [docker, "logs", "gemi-inference"],
        capture_output=True, text=True,
    )
    raise RuntimeError(
        f"Roboflow inference server did not become available within {max_wait} seconds.\n"
        f"Container logs:\n{logs.stdout[-1000:]}\n{logs.stderr[-500:]}"
    )


# ── Inference callables ────────────────────────────────────────────────────────

class _InferenceConfigError(RuntimeError):
    """Raised when inference fails due to a config error (bad API key / model ID)."""


def _make_cloud_infer_fn(
    api_key: str,
    model_id: str,
    confidence_threshold: float,
):
    """
    Return a callable(crop_path) -> list[dict] that calls the Roboflow cloud
    REST API (v0 format) directly: base64-encoded image sent as raw POST body.
    This bypasses inference_sdk's v1 auto-detection which breaks against the
    cloud endpoint.
    """
    import base64
    import requests

    # model_id may be "workspace/model/version" or "workspace/model" (latest)
    endpoint = f"{CLOUD_API_URL}/{model_id}"

    def _call(crop_path: str) -> list[dict]:
        with open(crop_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode("ascii")
        resp = requests.post(
            endpoint,
            params={"api_key": api_key, "confidence": confidence_threshold},
            data=img_b64,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
        if resp.status_code == 401:
            raise _InferenceConfigError(
                f"Roboflow API returned 401 Unauthorized for model '{model_id}'. "
                "Check your API key in the pipeline settings."
            )
        if resp.status_code == 404:
            raise _InferenceConfigError(
                f"Roboflow model '{model_id}' not found (404). "
                "Check the model ID in the pipeline settings."
            )
        if not resp.ok:
            raise _InferenceConfigError(
                f"Roboflow API returned {resp.status_code} for model '{model_id}': {resp.text[:200]}"
            )
        if not resp.text:
            raise RuntimeError(
                f"Roboflow returned an empty body (status {resp.status_code}) — "
                "possible rate limit or transient error."
            )
        body = resp.json()
        return body.get("predictions", [])

    return _call


def _make_local_infer_fn(
    api_key: str,
    model_id: str,
    confidence_threshold: float,
    local_server_url: str | None,
):
    """
    Return a callable(crop_path) -> list[dict] using the local inference server.

    The Roboflow inference Docker container exposes the same v0 HTTP API as the
    cloud endpoint, so we use the identical direct-HTTP approach — avoiding
    inference_sdk's infer_from_api_v1 which calls list_loaded_models() first and
    crashes when that endpoint returns empty on a freshly-started container.
    """
    import base64
    import requests

    api_url = (local_server_url or LOCAL_API_URL).rstrip("/")
    host = api_url.split("://")[-1].split(":")[0]
    port_str = api_url.split(":")[-1].rstrip("/") if ":" in api_url.split("://")[-1] else "9001"
    try:
        port = int(port_str)
    except ValueError:
        port = 9001

    if not _is_local_server_running(host, port):
        with _docker_start_lock:
            # Re-check inside the lock — another thread may have started it
            if not _is_local_server_running(host, port):
                _start_local_server(host_port=port)

    endpoint = f"{api_url}/{model_id}"

    def _call(crop_path: str) -> list[dict]:
        with open(crop_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode("ascii")
        resp = requests.post(
            endpoint,
            params={"api_key": api_key, "confidence": confidence_threshold},
            data=img_b64,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
        logger.debug(
            "[local-infer] %s status=%s body_len=%d body_preview=%r",
            crop_path, resp.status_code, len(resp.text), resp.text[:120],
        )
        if resp.status_code == 503 or not resp.text.strip():
            # Server is still loading the model — wait and retry up to 3 minutes
            import time as _time
            for _attempt in range(36):  # 36 × 5 s = 3 min
                _time.sleep(5)
                resp = requests.post(
                    endpoint,
                    params={"api_key": api_key, "confidence": confidence_threshold},
                    data=img_b64,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    timeout=30,
                )
                if resp.status_code != 503 and resp.text.strip():
                    break
            else:
                raise RuntimeError(
                    f"Local inference server still returned {resp.status_code} after 3 minutes — "
                    "model may have failed to load."
                )
        if not resp.ok:
            raise _InferenceConfigError(
                f"Local inference server returned {resp.status_code} for model '{model_id}': {resp.text[:200]}"
            )
        body = resp.json()
        return body.get("predictions", [])

    return _call


# ── Main inference entry point ─────────────────────────────────────────────────

def run_inference_on_image(
    image_path: Path | str,
    api_key: str,
    model_id: str,
    task_type: str = "detection",
    confidence_threshold: float = 0.1,
    iou_threshold: float = 0.5,
    crop_size: int = 640,
    overlap: int = 32,
    inference_mode: str = "cloud",
    local_server_url: str = LOCAL_API_URL,
    on_warning: Any = None,
) -> list[dict[str, Any]]:
    """
    Run Roboflow inference on one (potentially large) image.

    inference_mode: "cloud" uses detect.roboflow.com; "local" uses a local
    inference server (auto-started if not already running).

    Crops the image into overlapping patches, runs inference on each,
    transforms coordinates back to image level, applies NMS.

    on_warning: optional callable(str) — called with a warning message for
    each crop that fails (in addition to logger.warning).

    Returns a list of prediction dicts with image-level (x, y, width, height).
    """
    if inference_mode == "local":
        _infer_fn = _make_local_infer_fn(
            api_key=api_key,
            model_id=model_id,
            confidence_threshold=confidence_threshold,
            local_server_url=local_server_url,
        )
    else:
        _infer_fn = _make_cloud_infer_fn(
            api_key=api_key,
            model_id=model_id,
            confidence_threshold=confidence_threshold,
        )

    crops = crop_image_with_overlap(image_path, crop_size=crop_size, overlap=overlap)
    if not crops:
        return []

    all_predictions: list[dict] = []
    crop_errors = 0
    temp_dir = crops[0]["temp_dir"]

    try:
        # Preflight on crop 0 — fail fast on config errors before processing all images.
        first_crop = crops[0]
        try:
            raw = _infer_fn(first_crop["crop_path"])
            all_predictions.extend(_transform_to_image_coords(raw, first_crop))
        except _InferenceConfigError:
            raise
        except Exception as exc:
            crop_errors += 1
            msg = f"Crop {first_crop['crop_id']}/{len(crops)} failed: {exc}"
            logger.warning("Inference failed on crop %d of %s: %s", first_crop["crop_id"], image_path, exc)
            if on_warning:
                on_warning(msg)

        consecutive_failures = 0
        for crop_info in crops[1:]:
            try:
                raw = _infer_fn(crop_info["crop_path"])
                all_predictions.extend(_transform_to_image_coords(raw, crop_info))
                consecutive_failures = 0
            except _InferenceConfigError:
                raise
            except Exception as exc:
                crop_errors += 1
                consecutive_failures += 1
                msg = f"Crop {crop_info['crop_id']}/{len(crops)} failed: {exc}"
                logger.warning("Inference failed on crop %d of %s: %s", crop_info["crop_id"], image_path, exc)
                if on_warning:
                    on_warning(msg)
                if consecutive_failures >= 5:
                    logger.warning(
                        "5 consecutive crop failures on %s — skipping remaining crops. "
                        "Check API key, model ID, and rate limits.",
                        Path(image_path).name,
                    )
                    break
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    after_nms = apply_nms(all_predictions, iou_threshold=iou_threshold)
    logger.debug(
        "%s: %d crops, %d raw predictions → %d after NMS%s",
        Path(image_path).name, len(crops), len(all_predictions), len(after_nms),
        f" ({crop_errors} crop errors)" if crop_errors else "",
    )
    return after_nms


# ── Traits GeoJSON integration ────────────────────────────────────────────────

def merge_inference_into_geojson(
    geojson_path: Path,
    predictions: list[dict],
    model_label: str,
    plot_id_field: str = "plot_id",
    feature_match_prop: str = "Plot",
) -> None:
    """
    Add {model_label}/{class} detection-count columns to a Traits GeoJSON.

    For each GeoJSON feature whose `feature_match_prop` property matches a
    `plot_id_field` value in predictions, the count of detections per class is
    written as a new property.  Features with no predictions get 0.

    Creates the file if it does not exist (writes an empty FeatureCollection
    with only inference columns — caller should ensure the file exists first).
    Overwrites the GeoJSON in place.
    """
    import json as _json

    if not geojson_path.exists():
        logger.warning("merge_inference_into_geojson: %s not found, skipping", geojson_path)
        return

    with open(geojson_path) as f:
        gj = _json.load(f)

    model_prefix = f"{model_label}/"

    # Count predictions per plot_id and class
    counts: dict[str, dict[str, int]] = {}
    for row in predictions:
        pid = str(row.get(plot_id_field) or "")
        cls = str(row.get("class") or "")
        if pid and cls:
            inner = counts.setdefault(pid, {})
            inner[cls] = inner.get(cls, 0) + 1

    all_classes = sorted({cls for class_counts in counts.values() for cls in class_counts})

    for feat in gj.get("features", []):
        props = feat.get("properties") or {}
        # Always clear stale columns for this model so re-runs don't leave old values
        for k in [k for k in props if k.startswith(model_prefix)]:
            del props[k]
        if all_classes:
            # Match feature to a plot_id using the configured property key
            pid = str(
                props.get(feature_match_prop)
                or props.get(feature_match_prop.lower())
                or ""
            )
            plot_counts = counts.get(pid, {})
            for cls in all_classes:
                props[f"{model_label}/{cls}"] = plot_counts.get(cls, 0)
        feat["properties"] = props

    with open(geojson_path, "w") as f:
        _json.dump(gj, f)

    logger.info(
        "merge_inference_into_geojson: cleared stale %s/* columns, added %d class columns (%s) to %s",
        model_label, len(all_classes), ", ".join(all_classes), geojson_path.name,
    )
