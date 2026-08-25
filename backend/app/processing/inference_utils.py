"""
Inference utilities for plot images — Roboflow (cloud/local), local Ultralytics
YOLO `.pt` weights, and HuggingFace models (Hub-hosted pipeline or Inference API).

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
import subprocess as _subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

# Suppress console windows on Windows for every subprocess call in this module.
_WINFLAGS: dict = (
    {"creationflags": _subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
)

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
        **_WINFLAGS,
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
        **_WINFLAGS,
    )

    # Only pull if the image isn't already cached locally
    inspect = subprocess.run(
        [docker, "image", "inspect", ROBOFLOW_DOCKER_IMAGE_CPU],
        capture_output=True,
        **_WINFLAGS,
    )
    if inspect.returncode != 0:
        logger.info(
            "Image %s not found locally — pulling (this may take several minutes on first run)…",
            ROBOFLOW_DOCKER_IMAGE_CPU,
        )
        pull = subprocess.run(
            [docker, "pull", ROBOFLOW_DOCKER_IMAGE_CPU],
            capture_output=True, text=True, timeout=1800,  # 30 min for large image
            **_WINFLAGS,
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
        **_WINFLAGS,
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
        **_WINFLAGS,
    )
    raise RuntimeError(
        f"Roboflow inference server did not become available within {max_wait} seconds.\n"
        f"Container logs:\n{logs.stdout[-1000:]}\n{logs.stderr[-500:]}"
    )


# ── Inference callables ────────────────────────────────────────────────────────

class _InferenceConfigError(RuntimeError):
    """Raised when inference fails due to a config error (bad API key / model ID)."""


# ── Local weights (Ultralytics YOLO) inference ─────────────────────────────────

# Loaded YOLO models are expensive (torch checkpoint deserialization), and
# run_inference_on_image() is called once per plot image — cache by resolved
# path so a run with hundreds of plots only loads each weights file once.
_local_model_cache: dict[str, Any] = {}
_local_model_cache_lock = _threading.Lock()

_TASK_TYPE_TO_ULTRALYTICS_TASK = {
    "detection": "detect",
    "segmentation": "segment",
    "classification": "classify",
}


_SUPPORTED_LOCAL_WEIGHTS_SUFFIXES = (".pt", ".onnx")


def _get_or_load_local_model(weights_path: str, expected_task_type: str) -> Any:
    """
    Load (or return the cached) Ultralytics YOLO model from a local .pt
    checkpoint or a .onnx export of one (e.g. via `model.export(format="onnx")`)
    — Ultralytics' own `YOLO()` loader auto-detects the format from the file
    extension and normalizes both to the same results API, so no other code
    here needs to branch on which one it is.

    Raises _InferenceConfigError if the path is missing/invalid, the file fails
    to load as a YOLO checkpoint, or the checkpoint's task (detect/segment)
    doesn't match expected_task_type.
    """
    if not weights_path:
        raise _InferenceConfigError(
            "No local weights file configured. Set a weights path in the pipeline settings."
        )

    path = Path(weights_path).expanduser().resolve()
    if not path.exists():
        raise _InferenceConfigError(f"Weights file not found: {path}")
    if path.suffix.lower() not in _SUPPORTED_LOCAL_WEIGHTS_SUFFIXES:
        raise _InferenceConfigError(
            f"Unsupported weights file '{path.name}' — only Ultralytics YOLO .pt "
            "checkpoints and their .onnx exports are supported for local weights "
            "inference. A generic ONNX model exported from another framework "
            "(not via `model.export(format=\"onnx\")` on an Ultralytics model) "
            "is not supported — its output tensor layout isn't standardized."
        )

    cache_key = str(path)
    with _local_model_cache_lock:
        model = _local_model_cache.get(cache_key)
        if model is None:
            try:
                from ultralytics import YOLO
                try:
                    from ultralytics import settings as _ultra_settings
                    # This app is fully offline — disable ultralytics' analytics ping.
                    _ultra_settings.update({"sync": False})
                except Exception:
                    pass
                model = YOLO(cache_key)
            except Exception as exc:
                raise _InferenceConfigError(
                    f"Failed to load local weights '{path.name}': {exc}"
                ) from exc
            _local_model_cache[cache_key] = model

    expected_ultra_task = _TASK_TYPE_TO_ULTRALYTICS_TASK.get(expected_task_type)
    actual_task = getattr(model, "task", None)
    if expected_ultra_task and actual_task and actual_task != expected_ultra_task:
        raise _InferenceConfigError(
            f"Weights file '{path.name}' is a '{actual_task}' model, but the pipeline is "
            f"configured for '{expected_task_type}'. Update the task type in pipeline "
            "settings or choose a matching weights file."
        )

    return model


def _make_local_weights_infer_fn(
    weights_path: str,
    task_type: str,
    confidence_threshold: float,
):
    """
    Return a callable(crop_path) -> list[dict] backed by a local Ultralytics
    YOLO checkpoint, producing the same prediction shape as the Roboflow
    cloud/local infer functions: class/confidence/x/y/width/height and, for
    segmentation checkpoints, points (list of {"x", "y"} dicts per polygon).
    """
    model = _get_or_load_local_model(weights_path, task_type)

    def _call(crop_path: str) -> list[dict]:
        results = model.predict(source=crop_path, conf=confidence_threshold, verbose=False)
        r = results[0]
        predictions: list[dict] = []
        if r.boxes is None:
            return predictions

        names = r.names
        boxes_xywh = r.boxes.xywh.tolist()
        confs = r.boxes.conf.tolist()
        classes = r.boxes.cls.tolist()
        polygons = r.masks.xy if (task_type == "segmentation" and r.masks is not None) else None

        for i, (x, y, w, h) in enumerate(boxes_xywh):
            cls_id = int(classes[i])
            pred: dict[str, Any] = {
                "class": names[cls_id] if cls_id in names else str(cls_id),
                "confidence": float(confs[i]),
                "x": float(x),
                "y": float(y),
                "width": float(w),
                "height": float(h),
            }
            if polygons is not None and i < len(polygons):
                pred["points"] = [{"x": float(px), "y": float(py)} for px, py in polygons[i]]
            predictions.append(pred)

        return predictions

    return _call


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


# ── HuggingFace inference ───────────────────────────────────────────────────────

# Loaded HF pipelines are expensive (model download + torch deserialization),
# and run_inference_on_image()/run_classification_on_image() are called once
# per crop/plot image — cache by (model_id, hf_task) so a run with hundreds of
# plots only loads each model once.
_hf_pipeline_cache: dict[str, Any] = {}
_hf_pipeline_cache_lock = _threading.Lock()

_TASK_TYPE_TO_HF_PIPELINE_TASK = {
    "detection": "object-detection",
    "segmentation": "image-segmentation",
    "classification": "image-classification",
}

# Zero-shot (prompted) models take a list of candidate labels instead of
# predicting from a fixed label set baked into the checkpoint. Only detection
# and classification have a standard zero-shot pipeline in `transformers` —
# there is no standard zero-shot image-segmentation pipeline.
_TASK_TYPE_TO_HF_ZERO_SHOT_PIPELINE_TASK = {
    "detection": "zero-shot-object-detection",
    "classification": "zero-shot-image-classification",
}

# HF decommissioned the old api-inference.huggingface.co host — inference now
# routes through the "hf-inference" provider on router.huggingface.co.
HF_INFERENCE_API_URL = "https://router.huggingface.co/hf-inference/models"


def _parse_candidate_labels(prompt: str) -> list[str]:
    """Split a comma-separated prompt string into candidate labels for a zero-shot model."""
    return [p.strip() for p in prompt.split(",") if p.strip()]


def _get_or_load_hf_pipeline(
    model_id: str,
    task_type: str,
    api_key: str | None = None,
    zero_shot: bool = False,
) -> Any:
    """
    Load (or return the cached) HuggingFace `transformers` pipeline for a model
    repo ID, downloading and caching the checkpoint from the HF Hub on first use.

    Raises _InferenceConfigError if model_id is empty, task_type has no HF
    pipeline mapping (zero-shot only supports detection/classification), or
    the pipeline fails to load (bad repo ID, gated repo without a token,
    unsupported architecture, etc).
    """
    if not model_id:
        raise _InferenceConfigError(
            "No HuggingFace model ID configured. Set a model ID "
            "(e.g. \"facebook/detr-resnet-50\") in the pipeline settings."
        )

    task_map = _TASK_TYPE_TO_HF_ZERO_SHOT_PIPELINE_TASK if zero_shot else _TASK_TYPE_TO_HF_PIPELINE_TASK
    hf_task = task_map.get(task_type)
    if hf_task is None:
        if zero_shot:
            raise _InferenceConfigError(
                f"Zero-shot HuggingFace models don't support task '{task_type}' — "
                "only detection and classification have a zero-shot pipeline."
            )
        raise _InferenceConfigError(
            f"Unsupported task type '{task_type}' for HuggingFace models."
        )

    cache_key = f"{model_id}::{hf_task}"
    with _hf_pipeline_cache_lock:
        pipe = _hf_pipeline_cache.get(cache_key)
        if pipe is None:
            try:
                from transformers import pipeline as _hf_pipeline_factory
                pipe = _hf_pipeline_factory(hf_task, model=model_id, token=api_key or None)
            except Exception as exc:
                raise _InferenceConfigError(
                    f"Failed to load HuggingFace model '{model_id}': {exc}"
                ) from exc
            _hf_pipeline_cache[cache_key] = pipe

    return pipe


def _mask_to_polygon(mask_img: Any) -> tuple[list[dict] | None, tuple[float, float, float, float] | None]:
    """
    Convert a binary segmentation mask (PIL Image, mode "L") to the largest
    contour's polygon points plus its bounding box, matching the shape
    produced by Ultralytics segmentation (`points`: list of {"x", "y"} dicts).

    Returns (None, None) if the mask has no foreground pixels.
    """
    import cv2
    import numpy as np

    arr = np.array(mask_img.convert("L"))
    binary = (arr > 127).astype("uint8")
    ys, xs = np.where(binary)
    if xs.size == 0:
        return None, None

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, None
    largest = max(contours, key=cv2.contourArea)
    points = [{"x": float(pt[0][0]), "y": float(pt[0][1])} for pt in largest]
    bbox = (float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max()))
    return points, bbox


_sam_pipeline_cache: dict[str, Any] = {}
_sam_pipeline_cache_lock = _threading.Lock()

# facebook/sam-vit-base is the smallest official SAM checkpoint (~375MB) —
# used as the default so auto-segmentation works out of the box without the
# user configuring a model id, matching how local_weights needs no api_key.
DEFAULT_SAM_MODEL_ID = "facebook/sam-vit-base"


def _get_or_load_sam_pipeline(model_id: str) -> Any:
    """Load (or return the cached) SAM automatic mask-generation pipeline."""
    with _sam_pipeline_cache_lock:
        pipe = _sam_pipeline_cache.get(model_id)
        if pipe is None:
            try:
                from transformers import pipeline as _hf_pipeline_factory
                pipe = _hf_pipeline_factory("mask-generation", model=model_id, points_per_batch=64)
            except Exception as exc:
                raise _InferenceConfigError(
                    f"Failed to load SAM model '{model_id}': {exc}"
                ) from exc
            _sam_pipeline_cache[model_id] = pipe
    return pipe


def _make_sam_auto_infer_fn(
    model_id: str,
    confidence_threshold: float,
    min_area_frac: float = 0.001,
    max_area_frac: float = 0.8,
):
    """
    Return a callable(crop_path) -> list[dict] backed by SAM's automatic
    (promptless) mask generation — segments a whole image into class-agnostic
    candidate object masks for a human to review/classify/reject in the
    labeling tool, rather than predicting from a fixed label set. `class` is
    always "" (unlabeled — assigned by the user at review time); `confidence`
    is SAM's own per-mask IoU prediction score.

    SAM's automatic mode commonly proposes many overlapping masks for the
    same object at different granularities, plus near-whole-image background
    masks and single-pixel noise — filtered here by score, by area band
    (drops masks covering under ~0.1% or over 80% of the crop), and deduped
    via the same box-IoU NMS used for detection predictions.
    """
    pipe = _get_or_load_sam_pipeline(model_id or DEFAULT_SAM_MODEL_ID)

    def _call(crop_path: str) -> list[dict]:
        image = Image.open(crop_path).convert("RGB")
        img_area = image.width * image.height
        result = pipe(image)
        masks = result.get("masks", [])
        scores = result.get("scores", [])

        candidates: list[dict] = []
        for mask, score in zip(masks, scores):
            score_val = float(score)
            if score_val < confidence_threshold:
                continue
            mask_np = mask.numpy() if hasattr(mask, "numpy") else mask
            mask_img = Image.fromarray((mask_np.astype("uint8")) * 255, mode="L")
            points, bbox = _mask_to_polygon(mask_img)
            if points is None:
                continue
            x0, y0, x1, y1 = bbox
            area = (x1 - x0) * (y1 - y0)
            if img_area <= 0 or not (min_area_frac * img_area <= area <= max_area_frac * img_area):
                continue
            candidates.append({
                "class": "",
                "confidence": score_val,
                "x": (x0 + x1) / 2,
                "y": (y0 + y1) / 2,
                "width": x1 - x0,
                "height": y1 - y0,
                "points": points,
            })

        return apply_nms(candidates, iou_threshold=0.7)

    return _call


def _make_local_huggingface_infer_fn(
    model_id: str,
    task_type: str,
    confidence_threshold: float,
    api_key: str | None = None,
    zero_shot: bool = False,
    prompt: str = "",
):
    """
    Return a callable(crop_path) -> list[dict] backed by a local `transformers`
    pipeline, downloaded/cached from the HuggingFace Hub, producing the same
    prediction shape as the Roboflow/local-weights infer functions.

    zero_shot=True uses the zero-shot pipeline variant (e.g. OWL-ViT, Grounding
    DINO) and requires `prompt` — a comma-separated list of candidate labels —
    since these models predict from an open, user-supplied label set instead
    of a fixed one baked into the checkpoint.
    """
    pipe = _get_or_load_hf_pipeline(model_id, task_type, api_key, zero_shot=zero_shot)
    task_map = _TASK_TYPE_TO_HF_ZERO_SHOT_PIPELINE_TASK if zero_shot else _TASK_TYPE_TO_HF_PIPELINE_TASK
    hf_task = task_map[task_type]

    candidate_labels = _parse_candidate_labels(prompt) if zero_shot else None
    if zero_shot and not candidate_labels:
        raise _InferenceConfigError(
            f"No prompt configured for zero-shot HuggingFace model '{model_id}'. "
            "Enter comma-separated candidate labels (e.g. \"weed, crop, soil\")."
        )

    def _call(crop_path: str) -> list[dict]:
        image = Image.open(crop_path).convert("RGB")

        if hf_task in ("object-detection", "zero-shot-object-detection"):
            results = (
                pipe(image, candidate_labels=candidate_labels, threshold=confidence_threshold)
                if zero_shot
                else pipe(image, threshold=confidence_threshold)
            )
            predictions: list[dict] = []
            for r in results:
                box = r["box"]
                x0, y0, x1, y1 = box["xmin"], box["ymin"], box["xmax"], box["ymax"]
                predictions.append({
                    "class": str(r["label"]),
                    "confidence": float(r["score"]),
                    "x": (x0 + x1) / 2,
                    "y": (y0 + y1) / 2,
                    "width": x1 - x0,
                    "height": y1 - y0,
                })
            return predictions

        # image-segmentation
        results = pipe(image)
        predictions = []
        for r in results:
            score = r.get("score")
            if score is not None and score < confidence_threshold:
                continue
            points, bbox = _mask_to_polygon(r["mask"])
            if points is None:
                continue
            x0, y0, x1, y1 = bbox
            predictions.append({
                "class": str(r["label"]),
                "confidence": float(score) if score is not None else 1.0,
                "x": (x0 + x1) / 2,
                "y": (y0 + y1) / 2,
                "width": x1 - x0,
                "height": y1 - y0,
                "points": points,
            })
        return predictions

    return _call


def _make_cloud_huggingface_infer_fn(
    api_key: str,
    model_id: str,
    task_type: str,
    confidence_threshold: float,
    zero_shot: bool = False,
    prompt: str = "",
):
    """
    Return a callable(crop_path) -> list[dict] that calls the HuggingFace
    hosted Inference API for the given model repo ID.

    zero_shot=True sends `prompt` (comma-separated candidate labels) as a
    JSON `parameters.candidate_labels` payload instead of raw image bytes —
    required by zero-shot object-detection models on the Inference API.
    """
    import requests

    task_map = _TASK_TYPE_TO_HF_ZERO_SHOT_PIPELINE_TASK if zero_shot else _TASK_TYPE_TO_HF_PIPELINE_TASK
    hf_task = task_map.get(task_type)
    if hf_task is None:
        if zero_shot:
            raise _InferenceConfigError(
                f"Zero-shot HuggingFace models don't support task '{task_type}' — "
                "only detection and classification have a zero-shot pipeline."
            )
        raise _InferenceConfigError(
            f"Unsupported task type '{task_type}' for HuggingFace models."
        )

    candidate_labels = _parse_candidate_labels(prompt) if zero_shot else None
    if zero_shot and not candidate_labels:
        raise _InferenceConfigError(
            f"No prompt configured for zero-shot HuggingFace model '{model_id}'. "
            "Enter comma-separated candidate labels (e.g. \"weed, crop, soil\")."
        )

    endpoint = f"{HF_INFERENCE_API_URL}/{model_id}"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    def _post(image_bytes: bytes):
        if zero_shot:
            import base64
            import json as _json
            payload = _json.dumps({
                "inputs": base64.b64encode(image_bytes).decode("ascii"),
                "parameters": {"candidate_labels": candidate_labels},
            })
            return requests.post(
                endpoint,
                headers={**headers, "Content-Type": "application/json"},
                data=payload,
                timeout=30,
            )
        return requests.post(endpoint, headers=headers, data=image_bytes, timeout=30)

    def _call(crop_path: str) -> list[dict]:
        with open(crop_path, "rb") as f:
            data = f.read()
        resp = _post(data)
        if resp.status_code == 503:
            # Model is cold-starting on HF's infra — retry for up to 3 minutes.
            import time as _time
            for _attempt in range(36):  # 36 × 5 s = 3 min
                _time.sleep(5)
                resp = _post(data)
                if resp.status_code != 503:
                    break
            else:
                raise RuntimeError(
                    f"HuggingFace Inference API still returned 503 for '{model_id}' "
                    "after 3 minutes — the model may be too large to load on the free tier."
                )
        if resp.status_code == 401:
            raise _InferenceConfigError(
                f"HuggingFace API returned 401 Unauthorized for model '{model_id}'. "
                "Check your API token in the pipeline settings."
            )
        if resp.status_code == 404:
            raise _InferenceConfigError(
                f"HuggingFace model '{model_id}' not found (404). "
                "Check the model ID in the pipeline settings."
            )
        if not resp.ok:
            raise _InferenceConfigError(
                f"HuggingFace API returned {resp.status_code} for model '{model_id}': {resp.text[:200]}"
            )
        body = resp.json()
        if isinstance(body, dict) and body.get("error"):
            raise _InferenceConfigError(
                f"HuggingFace API error for model '{model_id}': {body['error']}"
            )

        predictions: list[dict] = []
        if hf_task in ("object-detection", "zero-shot-object-detection"):
            for r in body:
                score = float(r.get("score", 0))
                if score < confidence_threshold:
                    continue
                box = r["box"]
                x0, y0, x1, y1 = box["xmin"], box["ymin"], box["xmax"], box["ymax"]
                predictions.append({
                    "class": str(r["label"]),
                    "confidence": score,
                    "x": (x0 + x1) / 2,
                    "y": (y0 + y1) / 2,
                    "width": x1 - x0,
                    "height": y1 - y0,
                })
            return predictions

        # image-segmentation — mask comes back as a base64-encoded PNG string
        import base64
        import io as _io
        for r in body:
            score = r.get("score")
            if score is not None and score < confidence_threshold:
                continue
            mask_b64 = r.get("mask")
            if not mask_b64:
                continue
            mask_img = Image.open(_io.BytesIO(base64.b64decode(mask_b64)))
            points, bbox = _mask_to_polygon(mask_img)
            if points is None:
                continue
            x0, y0, x1, y1 = bbox
            predictions.append({
                "class": str(r["label"]),
                "confidence": float(score) if score is not None else 1.0,
                "x": (x0 + x1) / 2,
                "y": (y0 + y1) / 2,
                "width": x1 - x0,
                "height": y1 - y0,
                "points": points,
            })
        return predictions

    return _call


def _make_huggingface_classify_fn(
    api_key: str,
    model_id: str,
    inference_mode: str,
    zero_shot: bool = False,
    prompt: str = "",
):
    """
    Return a callable(image_path) -> dict for whole-image HF classification.
    inference_mode "local" runs a cached `transformers` pipeline in-process;
    otherwise calls the HuggingFace hosted Inference API.

    zero_shot=True uses the zero-shot-image-classification pipeline (e.g.
    CLIP) and requires `prompt` — a comma-separated list of candidate labels.
    """
    candidate_labels = _parse_candidate_labels(prompt) if zero_shot else None
    if zero_shot and not candidate_labels:
        raise _InferenceConfigError(
            f"No prompt configured for zero-shot HuggingFace model '{model_id}'. "
            "Enter comma-separated candidate labels (e.g. \"weed, crop, soil\")."
        )

    if inference_mode == "local":
        pipe = _get_or_load_hf_pipeline(model_id, "classification", api_key, zero_shot=zero_shot)

        def _call(image_path: str) -> dict:
            image = Image.open(image_path).convert("RGB")
            results = (
                pipe(image, candidate_labels=candidate_labels) if zero_shot else pipe(image)
            )
            if not results:
                return {"class": "", "confidence": 0.0}
            top1 = max(results, key=lambda r: r.get("score", 0))
            return {"class": str(top1["label"]), "confidence": float(top1["score"])}

        return _call

    import requests

    endpoint = f"{HF_INFERENCE_API_URL}/{model_id}"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    def _post(image_bytes: bytes):
        if zero_shot:
            import base64
            import json as _json
            payload = _json.dumps({
                "inputs": base64.b64encode(image_bytes).decode("ascii"),
                "parameters": {"candidate_labels": candidate_labels},
            })
            return requests.post(
                endpoint,
                headers={**headers, "Content-Type": "application/json"},
                data=payload,
                timeout=30,
            )
        return requests.post(endpoint, headers=headers, data=image_bytes, timeout=30)

    def _call(image_path: str) -> dict:
        with open(image_path, "rb") as f:
            data = f.read()
        resp = _post(data)
        if resp.status_code == 503:
            import time as _time
            for _attempt in range(36):  # 36 × 5 s = 3 min
                _time.sleep(5)
                resp = _post(data)
                if resp.status_code != 503:
                    break
            else:
                raise RuntimeError(
                    f"HuggingFace Inference API still returned 503 for '{model_id}' "
                    "after 3 minutes — the model may be too large to load on the free tier."
                )
        if resp.status_code == 401:
            raise _InferenceConfigError(
                f"HuggingFace API returned 401 Unauthorized for model '{model_id}'. "
                "Check your API token in the pipeline settings."
            )
        if resp.status_code == 404:
            raise _InferenceConfigError(
                f"HuggingFace model '{model_id}' not found (404). "
                "Check the model ID in the pipeline settings."
            )
        if not resp.ok:
            raise _InferenceConfigError(
                f"HuggingFace API returned {resp.status_code} for model '{model_id}': {resp.text[:200]}"
            )
        body = resp.json()
        if isinstance(body, dict) and body.get("error"):
            raise _InferenceConfigError(
                f"HuggingFace API error for model '{model_id}': {body['error']}"
            )
        if not body:
            return {"class": "", "confidence": 0.0}
        top1 = max(body, key=lambda r: r.get("score", 0))
        return {"class": str(top1["label"]), "confidence": float(top1["score"])}

    return _call


# ── Classification (whole image, no cropping/NMS) ──────────────────────────────

def _parse_roboflow_classification_response(body: dict) -> dict:
    """
    Normalize a Roboflow v0 hosted classification response to a single
    top-1 {"class", "confidence"} dict. The exact shape varies: either
    top-level "top"/"confidence" fields, or a "predictions" dict keyed by
    class name, or a "predictions" list of {"class", "confidence"} dicts.
    """
    top_cls, top_conf = body.get("top"), body.get("confidence")
    if top_cls is not None and top_conf is not None:
        return {"class": str(top_cls), "confidence": float(top_conf)}

    preds = body.get("predictions")
    if isinstance(preds, dict) and preds:
        cls, info = max(preds.items(), key=lambda kv: kv[1].get("confidence", 0))
        return {"class": str(cls), "confidence": float(info.get("confidence", 0))}
    if isinstance(preds, list) and preds:
        best = max(preds, key=lambda p: p.get("confidence", 0))
        return {"class": str(best.get("class", "")), "confidence": float(best.get("confidence", 0))}

    return {"class": "", "confidence": 0.0}


def _make_cloud_classify_fn(api_key: str, model_id: str):
    """Return a callable(image_path) -> dict using the Roboflow cloud classify endpoint."""
    import base64
    import requests

    endpoint = f"{CLOUD_API_URL}/{model_id}"

    def _call(image_path: str) -> dict:
        with open(image_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode("ascii")
        resp = requests.post(
            endpoint,
            params={"api_key": api_key},
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
        return _parse_roboflow_classification_response(resp.json())

    return _call


def _make_local_classify_fn(api_key: str, model_id: str, local_server_url: str | None):
    """Return a callable(image_path) -> dict using the local inference server's classify endpoint."""
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
            if not _is_local_server_running(host, port):
                _start_local_server(host_port=port)

    endpoint = f"{api_url}/{model_id}"

    def _call(image_path: str) -> dict:
        with open(image_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode("ascii")
        resp = requests.post(
            endpoint,
            params={"api_key": api_key},
            data=img_b64,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
        if resp.status_code == 503 or not resp.text.strip():
            import time as _time
            for _attempt in range(36):  # 36 × 5 s = 3 min
                _time.sleep(5)
                resp = requests.post(
                    endpoint,
                    params={"api_key": api_key},
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
        return _parse_roboflow_classification_response(resp.json())

    return _call


def run_classification_on_image(
    image_path: Path | str,
    api_key: str = "",
    model_id: str = "",
    inference_mode: str = "cloud",
    local_server_url: str = LOCAL_API_URL,
    source: str = "roboflow",
    weights_path: str | None = None,
    hf_zero_shot: bool = False,
    hf_prompt: str = "",
) -> list[dict[str, Any]]:
    """
    Run whole-image classification — no cropping/NMS, since a classification
    model labels the whole image rather than finding objects within it.

    Returns 0 or 1 prediction dicts: [{"class": str, "confidence": float}]
    (no x/y/width/height/points — callers/CSV/frontend treat a prediction
    without geometry as a classification result).
    """
    if source == "local_weights":
        model = _get_or_load_local_model(weights_path or "", "classification")
        results = model.predict(source=str(image_path), verbose=False)
        r = results[0]
        probs = r.probs
        if probs is None:
            return []
        top1 = int(probs.top1)
        return [{"class": r.names[top1], "confidence": float(probs.top1conf)}]

    if source == "huggingface":
        classify_fn = _make_huggingface_classify_fn(
            api_key=api_key, model_id=model_id, inference_mode=inference_mode,
            zero_shot=hf_zero_shot, prompt=hf_prompt,
        )
        return [classify_fn(str(image_path))]

    classify_fn = (
        _make_local_classify_fn(api_key=api_key, model_id=model_id, local_server_url=local_server_url)
        if inference_mode == "local"
        else _make_cloud_classify_fn(api_key=api_key, model_id=model_id)
    )
    return [classify_fn(str(image_path))]


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
    source: str = "roboflow",
    weights_path: str | None = None,
    hf_zero_shot: bool = False,
    hf_prompt: str = "",
    on_warning: Any = None,
) -> list[dict[str, Any]]:
    """
    Run inference on one (potentially large) image.

    source: "roboflow" (default) uses api_key/model_id via inference_mode
    ("cloud" → detect.roboflow.com, "local" → local Roboflow-protocol server).
    source: "local_weights" instead loads a local Ultralytics YOLO checkpoint
    (.pt, or a .onnx export of one) from weights_path and ignores
    api_key/model_id/inference_mode.
    source: "huggingface" uses model_id as a HF Hub repo ID via inference_mode
    ("local" → cached `transformers` pipeline downloaded from the Hub, "cloud"
    → HF's hosted Inference API using api_key as the HF token). hf_zero_shot=True
    switches to the zero-shot pipeline variant (e.g. OWL-ViT), which predicts
    from hf_prompt (comma-separated candidate labels) instead of a fixed label
    set baked into the checkpoint.
    source: "sam_auto" runs SAM's automatic (promptless) mask generation
    (model_id optional, defaults to DEFAULT_SAM_MODEL_ID) — produces
    class-agnostic candidate segmentation masks with `class: ""` for the
    labeling tool to review/classify/reject; ignores api_key/inference_mode.

    Crops the image into overlapping patches, runs inference on each,
    transforms coordinates back to image level, applies NMS.

    on_warning: optional callable(str) — called with a warning message for
    each crop that fails (in addition to logger.warning).

    Returns a list of prediction dicts with image-level (x, y, width, height).
    """
    if source == "local_weights":
        _infer_fn = _make_local_weights_infer_fn(
            weights_path=weights_path or "",
            task_type=task_type,
            confidence_threshold=confidence_threshold,
        )
    elif source == "sam_auto":
        _infer_fn = _make_sam_auto_infer_fn(
            model_id=model_id or DEFAULT_SAM_MODEL_ID,
            confidence_threshold=confidence_threshold,
        )
    elif source == "huggingface":
        _infer_fn = (
            _make_local_huggingface_infer_fn(
                model_id=model_id,
                task_type=task_type,
                confidence_threshold=confidence_threshold,
                api_key=api_key,
                zero_shot=hf_zero_shot,
                prompt=hf_prompt,
            )
            if inference_mode == "local"
            else _make_cloud_huggingface_infer_fn(
                api_key=api_key,
                model_id=model_id,
                task_type=task_type,
                confidence_threshold=confidence_threshold,
                zero_shot=hf_zero_shot,
                prompt=hf_prompt,
            )
        )
    elif inference_mode == "local":
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
