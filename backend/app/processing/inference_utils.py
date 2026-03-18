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
LOCAL_API_URL = "http://localhost:9001"


def _is_local_server_running(host: str = "localhost", port: int = 9001) -> bool:
    import socket
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def _start_local_server() -> None:
    """Attempt to start the Roboflow local inference server."""
    import subprocess
    import time
    logger.info("Starting local Roboflow inference server…")
    subprocess.Popen(["inference", "server", "start"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # Wait up to 30 s for it to become available
    for _ in range(30):
        if _is_local_server_running():
            logger.info("Local inference server is ready.")
            return
        time.sleep(1)
    raise RuntimeError("Local Roboflow inference server did not start within 30 seconds.")


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
    from inference_sdk import InferenceHTTPClient, InferenceConfiguration

    if inference_mode == "local":
        api_url = local_server_url or LOCAL_API_URL
        host = api_url.split("://")[-1].split(":")[0]
        port_str = api_url.split(":")[-1].rstrip("/") if ":" in api_url.split("://")[-1] else "9001"
        try:
            port = int(port_str)
        except ValueError:
            port = 9001
        if not _is_local_server_running(host, port):
            _start_local_server()
    else:
        api_url = CLOUD_API_URL

    client = InferenceHTTPClient(api_url=api_url, api_key=api_key)
    client.configure(InferenceConfiguration(confidence_threshold=confidence_threshold))

    crops = crop_image_with_overlap(image_path, crop_size=crop_size, overlap=overlap)
    if not crops:
        return []

    all_predictions: list[dict] = []
    crop_errors = 0
    temp_dir = crops[0]["temp_dir"]

    try:
        for crop_info in crops:
            try:
                result = client.infer(crop_info["crop_path"], model_id=model_id)
                raw = result.get("predictions", []) if isinstance(result, dict) else []
                all_predictions.extend(_transform_to_image_coords(raw, crop_info))
            except Exception as exc:
                crop_errors += 1
                msg = f"Crop {crop_info['crop_id']}/{len(crops)} failed: {exc}"
                logger.warning("Inference failed on crop %d of %s: %s", crop_info["crop_id"], image_path, exc)
                if on_warning:
                    on_warning(msg)
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

    # Count predictions per plot_id and class
    counts: dict[str, dict[str, int]] = {}
    for row in predictions:
        pid = str(row.get(plot_id_field) or "")
        cls = str(row.get("class") or "")
        if pid and cls:
            inner = counts.setdefault(pid, {})
            inner[cls] = inner.get(cls, 0) + 1

    all_classes = sorted({cls for class_counts in counts.values() for cls in class_counts})
    if not all_classes:
        return  # Nothing to merge

    for feat in gj.get("features", []):
        props = feat.get("properties") or {}
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
        "merge_inference_into_geojson: added %d class columns (%s) to %s",
        len(all_classes), ", ".join(all_classes), geojson_path.name,
    )
