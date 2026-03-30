"""
Ground-based (Amiga) pipeline step implementations.

Each function follows the runner contract:
    fn(session, run_id, stop_event, emit, **kwargs) -> dict[str, Any]

The returned dict is merged into PipelineRun.outputs using relative paths
(relative to data_root) via RunPaths.rel().

Steps
-----
1. plot_marking   — save user's start/end image selections → plot_borders.csv
2. stitching      — run AgRowStitch on marked images + auto-georeference
3. inference      — Roboflow detection/segmentation (optional)

Binary extraction (step 0) is triggered at upload time, not here.
"""

from __future__ import annotations

import csv
import hashlib
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from sqlmodel import Session

from app.core.paths import RunPaths
from app.crud.pipeline import get_pipeline_run
from app.models.workspace import Workspace

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


def _get_paths(session: Session, run_id: uuid.UUID) -> RunPaths:
    """Resolve RunPaths from DB for a given run."""
    from app.models.pipeline import Pipeline

    run = session.get(
        __import__("app.models.pipeline", fromlist=["PipelineRun"]).PipelineRun, run_id
    )
    if not run:
        raise ValueError(f"Run {run_id} not found")
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline:
        raise ValueError(f"Pipeline {run.pipeline_id} not found")
    workspace = session.get(Workspace, pipeline.workspace_id)
    if not workspace:
        raise ValueError(f"Workspace {pipeline.workspace_id} not found")
    return RunPaths.from_db(session=session, run=run, workspace=workspace)


def _find_msgs_synced(paths: RunPaths) -> Path | None:
    """
    Find msgs_synced.csv — bin extraction writes it into the Raw tree;
    the intermediate copy (if made) lives in intermediate_run.
    """
    candidates = [
        paths.msgs_synced,
        paths.raw / "Metadata" / "msgs_synced.csv",
        paths.raw / "RGB" / "Metadata" / "msgs_synced.csv",
        paths.raw / "msgs_synced.csv",
    ]
    return next((p for p in candidates if p.exists()), None)


def _find_images_dir(paths: RunPaths) -> Path:
    """
    Return the directory that holds extracted top-view frame images.
    For Amiga data the images live in a nested 'top' subdirectory at an
    unpredictable depth (e.g. raw/Images/RGB/Images/top/).
    Falls back to raw/ if nothing is found.
    """
    # Prefer the 'top' subdir (Amiga layout)
    top_dirs = list(paths.raw.rglob("top"))
    for d in top_dirs:
        if d.is_dir():
            return d
    # Fallback for simpler layouts
    for candidate in [
        paths.raw / "RGB" / "Images",
        paths.raw / "Images",
        paths.raw,
    ]:
        if candidate.exists():
            return candidate
    return paths.raw


def _find_agrowstitch_dir() -> Path | None:
    """
    Return the directory containing AgRowStitch.py, or None if not found.

    Looks in (priority order):
      1. vendor/AgRowStitch relative to the backend root (git submodule)
      2. AGROWSTITCH_PATH environment variable (dev override)
      3. Sibling AgRowStitch directory next to the repo root
    """
    candidates = [
        Path(__file__).parent.parent.parent / "vendor" / "AgRowStitch",
        Path(os.environ.get("AGROWSTITCH_PATH", "")),
        Path(__file__).parent.parent.parent.parent / "AgRowStitch",
        # PyInstaller bundle — AgRowStitch.py collected alongside the executable
        Path(getattr(sys, "_MEIPASS", "")),
    ]
    for p in candidates:
        if p and (p / "AgRowStitch.py").exists():
            return p
    return None


def _import_agrowstitch():
    """Import and return the AgRowStitch run() function, or None if not found."""
    # Try direct import first — works when installed in the venv or bundled by PyInstaller.
    try:
        from AgRowStitch import run as run_agrowstitch  # type: ignore
        return run_agrowstitch
    except ImportError:
        pass

    # Fallback: path-based lookup for dev environments where it isn't pip-installed.
    p = _find_agrowstitch_dir()
    if p is None:
        return None
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
    try:
        from AgRowStitch import run as run_agrowstitch  # type: ignore
        return run_agrowstitch
    except ImportError:
        return None


# ── Step 1: Plot Marking (data persistence only) ──────────────────────────────
# The interactive part (image viewer) lives in the frontend.
# This function is called by the POST /plot-marking endpoint to save the
# selections as plot_borders.csv in Intermediate/.


def _find_msgs_synced(paths: "RunPaths") -> "Path | None":
    """Locate msgs_synced.csv under the raw dir (Amiga nested layout) or intermediate."""
    found = next(paths.raw.rglob("msgs_synced.csv"), None)
    if found:
        return found
    if paths.msgs_synced.exists():
        return paths.msgs_synced
    return None


def _build_gps_index(msgs_synced_path: "Path") -> dict[str, tuple[float, float]]:
    """
    Build a {image_basename: (lat, lon)} index from msgs_synced.csv.
    The Amiga CSV has a '/top/rgb_file' column with paths like '/top/rgb-123.jpg'.
    """
    import pandas as pd

    try:
        df = pd.read_csv(msgs_synced_path, on_bad_lines="skip")
        df.columns = df.columns.str.strip()
    except Exception:
        return {}

    lat_col = next((c for c in df.columns if c.lower() in ("lat", "latitude")), None)
    lon_col = next(
        (c for c in df.columns if c.lower() in ("lon", "lng", "longitude")), None
    )
    img_col = next(
        (c for c in df.columns if "top" in c.lower() and "file" in c.lower()), None
    )
    if not img_col:
        img_col = next(
            (c for c in df.columns if c.lower() in ("image_path", "image", "filename", "file")),
            None,
        )
    if not img_col:
        img_col = next((c for c in df.columns if "file" in c.lower() or "path" in c.lower()), None)

    if not lat_col or not lon_col or not img_col:
        return {}

    index: dict[str, tuple[float, float]] = {}
    for _, row in df.iterrows():
        try:
            lat = float(row[lat_col])
            lon = float(row[lon_col])
        except (ValueError, TypeError):
            continue
        raw_img = str(row.get(img_col, ""))
        if raw_img and raw_img != "nan":
            basename = raw_img.split("/")[-1]
            index[basename] = (lat, lon)
    return index


def translate_markers_by_gps(
    selections: list[dict],
    current_image_set: set[str],
    msgs_synced_path: "Path",
) -> tuple[list[dict], bool]:
    """
    When saved plot markers reference images that don't exist in the current run
    (i.e. the markers came from a different dataset), translate start/end images
    to the nearest image in the current run using GPS coordinates.

    Returns (translated_selections, any_translated).
    Each translated row gains  translated=True  so the frontend can warn the user.
    """
    import pandas as pd
    import math

    # Check whether translation is needed at all
    needs_translation = any(
        (sel.get("start_image") or "") not in current_image_set
        or (sel.get("end_image") or "") not in current_image_set
        for sel in selections
        if sel.get("start_lat") is not None or sel.get("end_lat") is not None
    )
    logger.info("[translate_markers] needs_translation=%s (current_image_set size=%d)", needs_translation, len(current_image_set))
    if not needs_translation:
        # Log why — show which images were already found
        for sel in selections[:3]:
            logger.debug(
                "[translate_markers] no translation needed — start_image=%s (in_set=%s) end_image=%s (in_set=%s) has_lat=%s",
                sel.get("start_image"), (sel.get("start_image") or "") in current_image_set,
                sel.get("end_image"), (sel.get("end_image") or "") in current_image_set,
                sel.get("start_lat") is not None,
            )
        return selections, False

    # Build ordered GPS track for the current run: [(lat, lon, image_name), ...]
    gps_track: list[tuple[float, float, str]] = []
    try:
        df = pd.read_csv(msgs_synced_path, on_bad_lines="skip")
        df.columns = df.columns.str.strip()
        logger.info("[translate_markers] msgs_synced has %d rows, columns: %s", len(df), list(df.columns))

        lat_col = next((c for c in df.columns if c.lower() in ("lat", "latitude")), None)
        lon_col = next((c for c in df.columns if c.lower() in ("lon", "lng", "longitude")), None)
        img_col = next(
            (c for c in df.columns if "top" in c.lower() and "file" in c.lower()), None
        )
        if not img_col:
            img_col = next(
                (c for c in df.columns if c.lower() in ("image_path", "image", "filename", "file")),
                None,
            )
        if not img_col:
            img_col = next(
                (c for c in df.columns if "file" in c.lower() or "path" in c.lower()), None
            )

        logger.info("[translate_markers] detected columns — lat=%s lon=%s img=%s", lat_col, lon_col, img_col)

        if lat_col and lon_col and img_col:
            skipped_no_lat = 0
            for _, row in df.iterrows():
                try:
                    lat = float(row[lat_col])
                    lon = float(row[lon_col])
                except (ValueError, TypeError):
                    skipped_no_lat += 1
                    continue
                raw_img = str(row.get(img_col, ""))
                if raw_img and raw_img != "nan":
                    # Normalise to forward-slashes before splitting so that Windows
                    # absolute paths (D:\...\file.jpg) stored in msgs_synced.csv are
                    # handled correctly on any OS.
                    name = raw_img.replace("\\", "/").split("/")[-1]
                    if name:
                        gps_track.append((lat, lon, name))
            # Log a sample of extracted names to confirm basename extraction worked
            sample_extracted = [e[2] for e in gps_track[:3]]
            logger.info(
                "[translate_markers] GPS track built: %d entries, %d rows skipped (bad lat/lon); "
                "sample names: %s | sample current_image_set: %s",
                len(gps_track), skipped_no_lat,
                sample_extracted, sorted(current_image_set)[:3],
            )
        else:
            logger.warning("[translate_markers] missing required columns — lat=%s lon=%s img=%s", lat_col, lon_col, img_col)
    except Exception:
        logger.exception("[translate_markers] failed to read msgs_synced: %s", msgs_synced_path)

    if not gps_track:
        logger.warning("[translate_markers] GPS track is empty — cannot translate, returning original selections")
        return selections, False

    def _nearest(lat: float, lon: float) -> str:
        best_name = gps_track[0][2]
        best_dist = math.inf
        for tlat, tlon, tname in gps_track:
            d = (tlat - lat) ** 2 + (tlon - lon) ** 2
            if d < best_dist:
                best_dist = d
                best_name = tname
        return best_name

    out = []
    any_translated = False
    for sel in selections:
        row = dict(sel)
        translated = False

        start_img = row.get("start_image") or ""
        if start_img not in current_image_set:
            s_lat = row.get("start_lat")
            s_lon = row.get("start_lon")
            logger.debug(
                "[translate_markers] plot %s: start_image=%s not in set — lat=%s lon=%s",
                row.get("plot_id"), start_img, s_lat, s_lon,
            )
            if s_lat is not None and s_lon is not None:
                try:
                    row["start_image"] = _nearest(float(s_lat), float(s_lon))
                    logger.debug("[translate_markers] plot %s: start → %s", row.get("plot_id"), row["start_image"])
                    translated = True
                except (TypeError, ValueError) as exc:
                    logger.warning("[translate_markers] plot %s: start translation failed — %s", row.get("plot_id"), exc)
            else:
                logger.warning("[translate_markers] plot %s: start has no GPS coords — cannot translate", row.get("plot_id"))

        end_img = row.get("end_image") or ""
        if end_img not in current_image_set:
            e_lat = row.get("end_lat")
            e_lon = row.get("end_lon")
            logger.debug(
                "[translate_markers] plot %s: end_image=%s not in set — lat=%s lon=%s",
                row.get("plot_id"), end_img, e_lat, e_lon,
            )
            if e_lat is not None and e_lon is not None:
                try:
                    row["end_image"] = _nearest(float(e_lat), float(e_lon))
                    logger.debug("[translate_markers] plot %s: end → %s", row.get("plot_id"), row["end_image"])
                    translated = True
                except (TypeError, ValueError) as exc:
                    logger.warning("[translate_markers] plot %s: end translation failed — %s", row.get("plot_id"), exc)
            else:
                logger.warning("[translate_markers] plot %s: end has no GPS coords — cannot translate", row.get("plot_id"))

        if translated:
            row["translated"] = True
            any_translated = True
        out.append(row)

    return out, any_translated


def save_plot_marking(
    *,
    session: Session,
    run_id: uuid.UUID,
    selections: list[dict[str, Any]],
) -> dict[str, str]:
    """
    Persist plot boundary selections to plot_borders.csv.
    GPS coordinates are looked up from msgs_synced.csv for each start/end image.
    """
    paths = _get_paths(session, run_id)
    paths.intermediate_year.mkdir(parents=True, exist_ok=True)

    # Build GPS index from msgs_synced.csv so we can fill in lat/lon
    gps_index: dict[str, tuple[float, float]] = {}
    msgs_synced = _find_msgs_synced(paths)
    if msgs_synced:
        gps_index = _build_gps_index(msgs_synced)
        logger.info(
            "Built GPS index with %d entries from %s", len(gps_index), msgs_synced
        )

    enriched = []
    for sel in selections:
        row = dict(sel)
        start_img = row.get("start_image") or ""
        end_img = row.get("end_image") or ""
        if start_img in gps_index:
            row["start_lat"], row["start_lon"] = gps_index[start_img]
        if end_img in gps_index:
            row["end_lat"], row["end_lon"] = gps_index[end_img]
        enriched.append(row)

    fieldnames = [
        "plot_id",
        "start_image",
        "end_image",
        "start_lat",
        "start_lon",
        "end_lat",
        "end_lon",
        "direction",
    ]
    with open(paths.plot_borders, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(enriched)

    logger.info(
        "Saved plot_borders.csv with %d plots to %s", len(enriched), paths.plot_borders
    )
    return {"plot_marking": paths.rel(paths.plot_borders)}


# ── Step 2: Stitching (AgRowStitch) ──────────────────────────────────────────


def run_stitching(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
    name: str | None = None,
    plot_marking_version: int | None = None,
) -> dict[str, Any]:
    """
    Run AgRowStitch on each plot defined in plot_borders.csv.

    Reads:
      - Intermediate/{workspace}/{pop}/plot_borders.csv
      - Raw/…/RGB/Images/{camera}/*.jpg  (extracted images)
      - Intermediate/{workspace}/{pop}/agrowstitch_config.yaml  (optional base config)

    Writes:
      - Processed/{workspace}/{pop}/{run_seg}/AgRowStitch_v{N}/
          full_res_mosaic_temp_plot_{id}.png
    """
    import pandas as pd

    try:
        import yaml
    except ImportError:
        raise RuntimeError(
            "PyYAML is required for stitching. Install it with: uv add pyyaml"
        )

    agrowstitch_dir = _find_agrowstitch_dir()
    if agrowstitch_dir is None:
        raise RuntimeError(
            "AgRowStitch is not available. Clone the AgRowStitch git submodule and set "
            "AGROWSTITCH_PATH to its root directory."
        )

    paths = _get_paths(session, run_id)

    # Load pipeline config for device setting and any custom overrides
    from app.models.pipeline import Pipeline, PipelineRun

    run = session.get(PipelineRun, run_id)
    pipeline = session.get(Pipeline, run.pipeline_id) if run else None
    pipeline_cfg: dict = dict(pipeline.config or {}) if pipeline else {}

    # Auto-increment stitching version
    _existing = list((run.outputs or {}).get("stitchings", []))
    agrowstitch_version = max((s["version"] for s in _existing), default=0) + 1

    # Write the new version number immediately so stitch-outputs polling reads
    # from the correct (new) directory while plots are being generated.
    from app.crud.pipeline import update_pipeline_run
    from app.models.pipeline import PipelineRunUpdate
    _early_outputs = dict(run.outputs or {})
    _early_outputs["stitching_version"] = agrowstitch_version
    update_pipeline_run(session=session, db_run=run, run_in=PipelineRunUpdate(outputs=_early_outputs))

    # Map UI device names to AgRowStitch device strings
    ui_device = pipeline_cfg.get("device", "cpu")
    if ui_device == "gpu":
        # Prefer CUDA, fall back to MPS (Apple Silicon), then CPU
        try:
            import torch
            if torch.cuda.is_available():
                agrowstitch_device = "cuda"
            elif torch.backends.mps.is_available():
                agrowstitch_device = "mps"
            else:
                agrowstitch_device = "cpu"
        except Exception:
            agrowstitch_device = "cpu"
    elif ui_device == "multiprocessing":
        agrowstitch_device = "multiprocessing"
    else:
        agrowstitch_device = "cpu"

    # num_cpu: 0 means auto (os.cpu_count() - 1), otherwise use the configured value
    cfg_num_cpu = int(pipeline_cfg.get("num_cpu", 0))
    if cfg_num_cpu > 0:
        cpu_count = cfg_num_cpu
    else:
        cpu_count = max(1, (os.cpu_count() or 1) - 1)

    # Start with the vendor defaults so all required keys are present
    agrowstitch_candidates = [
        Path(__file__).parent.parent.parent / "vendor" / "AgRowStitch" / "config.yaml",
        Path(os.environ.get("AGROWSTITCH_PATH", "")) / "config.yaml",
        Path(__file__).parent.parent.parent.parent / "AgRowStitch" / "config.yaml",
    ]
    base_config: dict = {}
    for vendor_config_path in agrowstitch_candidates:
        if vendor_config_path.exists():
            with open(vendor_config_path) as f:
                base_config = yaml.safe_load(f) or {}
            logger.info(
                "Loaded AgRowStitch vendor defaults from %s", vendor_config_path
            )
            break

    # Allow per-pipeline overrides stored in the intermediate directory (year-scoped)
    pipeline_config_path = paths.intermediate_year / "agrowstitch_config.yaml"
    if pipeline_config_path.exists():
        with open(pipeline_config_path) as f:
            base_config.update(yaml.safe_load(f) or {})

    # Apply structured agrowstitch_params saved from the UI (forward_limit, mask, etc.)
    structured = pipeline_cfg.get("agrowstitch_params") or {}
    if structured:
        to_apply: dict = {}
        mask_keys = {"mask_left", "mask_right", "mask_top", "mask_bottom"}
        if mask_keys & set(structured):
            to_apply["mask"] = [
                int(structured.get("mask_left", 0)),
                int(structured.get("mask_right", 0)),
                int(structured.get("mask_top", 0)),
                int(structured.get("mask_bottom", 0)),
            ]
        for k in ("forward_limit", "max_reprojection_error", "batch_size", "min_inliers"):
            if k in structured:
                to_apply[k] = structured[k]
        base_config.update(to_apply)
        logger.info("Applied structured agrowstitch_params: %s", list(to_apply.keys()))

    # Apply custom_agrowstitch_options from pipeline settings (freeform YAML string)
    custom_opts_str = pipeline_cfg.get("custom_agrowstitch_options", "").strip()
    if custom_opts_str:
        try:
            custom_opts = yaml.safe_load(custom_opts_str)
            if isinstance(custom_opts, dict):
                base_config.update(custom_opts)
                emit(
                    {
                        "event": "progress",
                        "message": f"Applied custom AgRowStitch options: {list(custom_opts.keys())}",
                    }
                )
        except Exception as e:
            emit(
                {
                    "event": "progress",
                    "message": f"Warning: could not parse custom AgRowStitch options: {e}",
                }
            )

    # Stamp resolved pipeline settings onto base_config so stored_config reflects
    # the actual values used (not whatever was in config.yaml).
    # These will be overridden per-plot (direction) or at subprocess time (device),
    # but we want the viewer to show the real pipeline-level settings.
    base_config["device"] = agrowstitch_device
    base_config["num_cpu"] = cpu_count

    emit(
        {
            "event": "progress",
            "message": f"Device: {ui_device} → {agrowstitch_device}, CPUs: {cpu_count}",
        }
    )

    # Resolve which plot_borders file to use.
    # If an explicit version was requested, honour it.
    # Otherwise fall back to the active version stored in run outputs so the
    # canonical plot_borders.csv (which may be stale) is never silently used
    # when versioned files are present.
    if plot_marking_version is None:
        plot_marking_version = (run.outputs or {}).get("active_plot_marking_version")

    if plot_marking_version is not None:
        plot_borders_path = paths.plot_borders_versioned(int(plot_marking_version))
        if not plot_borders_path.exists():
            logger.warning(
                "[stitching] plot_borders_v%d.csv not found at %s — falling back to canonical plot_borders.csv",
                plot_marking_version,
                plot_borders_path,
            )
            plot_borders_path = paths.plot_borders
            plot_marking_version = None  # don't log a version that wasn't actually used
    else:
        plot_borders_path = paths.plot_borders

    logger.info(
        "[stitching] using plot borders file: %s (plot_marking_version=%s, active_in_db=%s)",
        plot_borders_path,
        plot_marking_version,
        (run.outputs or {}).get("active_plot_marking_version"),
    )

    if not plot_borders_path.exists():
        raise FileNotFoundError(
            f"plot_borders.csv not found at {plot_borders_path}. "
            "Complete the Plot Marking step first."
        )

    out_dir = paths.agrowstitch_dir(agrowstitch_version)
    # Clear any stale output from a previous failed/partial run at the same version
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    images_dir = _find_images_dir(paths)
    msgs_path = _find_msgs_synced(paths)

    with open(plot_borders_path) as f:
        plots = list(csv.DictReader(f))

    emit(
        {
            "event": "progress",
            "message": f"Stitching {len(plots)} plots…",
            "total": len(plots),
        }
    )

    # Load msgs_synced for image filtering
    msgs_df = None
    if msgs_path and msgs_path.exists():
        msgs_df = pd.read_csv(msgs_path)
    # log path to msgs_synced and its columns for debugging
    logger.info("[stitching] msgs_synced path: %s", msgs_path)
    if msgs_df is not None:
        logger.info("[stitching] msgs_synced columns: %s", list(msgs_df.columns))

    DIRECTION_MAP = {
        "down": "DOWN",
        "up": "UP",
        "left": "LEFT",
        "right": "RIGHT",
        # legacy values from older saves
        "north_to_south": "DOWN",
        "south_to_north": "UP",
        "east_to_west": "LEFT",
        "west_to_east": "RIGHT",
    }

    failed_plots: list = []
    succeeded_plots: list = []

    for i, plot in enumerate(plots):
        if stop_event.is_set():
            return {}

        plot_id = plot.get("plot_id", i + 1)
        start_img = plot.get("start_image", "")
        end_img = plot.get("end_image", "")
        ui_direction = plot.get("direction", "down")
        stitch_dir = DIRECTION_MAP.get(ui_direction, "DOWN")

        plot_pct = int(i / len(plots) * 100)
        emit(
            {
                "event": "progress",
                "index": i,
                "plot_id": plot_id,
                "progress": plot_pct,
                "message": f"Stitching plot {plot_id}/{len(plots)} | direction: {ui_direction} → {stitch_dir}",
            }
        )

        # Gather images for this plot.
        # IMPORTANT: AgRowStitch derives its output path as:
        #   parent_directory = os.path.dirname(image_directory)
        #   final_mosaic_path = parent_directory / "final_mosaics"
        # If all plots share the same parent (e.g. /tmp), every plot writes
        # into the same /tmp/final_mosaics/ folder and outputs collide.
        # Fix: give each plot a unique outer dir; images go in a sub-dir so
        # AgRowStitch sees a unique parent_directory per plot.
        plot_temp_outer = tempfile.mkdtemp(prefix=f"agrows_plot{plot_id}_")
        plot_temp_dir = Path(plot_temp_outer) / "images"
        plot_temp_dir.mkdir()
        emit(
            {
                "event": "progress",
                "message": f"Plot {plot_id}: images_dir = {images_dir}",
            }
        )
        emit(
            {
                "event": "progress",
                "message": f"Plot {plot_id}: start='{start_img}' end='{end_img}'",
            }
        )
        emit(
            {
                "event": "progress",
                "message": f"Plot {plot_id}: msgs_df loaded = {msgs_df is not None}",
            }
        )
        try:
            copied = 0
            if msgs_df is not None:
                # The /top/rgb_file column has values like "/top/rgb-123.jpg";
                # start_image/end_image in plot_borders are plain basenames "rgb-123.jpg".
                # Build a basename column for reliable range filtering.
                # Farm-ng column first (/top/rgb_file), then standard image_path fallback
                rgb_col = next(
                    (
                        c
                        for c in msgs_df.columns
                        if "top" in c.lower() and "file" in c.lower()
                    ),
                    None,
                )
                if rgb_col is None:
                    rgb_col = next(
                        (
                            c
                            for c in msgs_df.columns
                            if c.lower() in ("image_path", "image", "filename", "file", "path")
                        ),
                        None,
                    )
                emit(
                    {
                        "event": "progress",
                        "message": f"Plot {plot_id}: rgb_col='{rgb_col}', msgs columns={list(msgs_df.columns[:6])}",
                    }
                )
                if rgb_col:
                    msgs_df["_basename"] = msgs_df[rgb_col].apply(
                        lambda v: str(v).split("/")[-1] if v and str(v) != "nan" else ""
                    )
                    sample = (
                        msgs_df["_basename"].dropna().iloc[:3].tolist()
                        if len(msgs_df) > 0
                        else []
                    )
                    emit(
                        {
                            "event": "progress",
                            "message": f"Plot {plot_id}: sample basenames = {sample}",
                        }
                    )
                    # Find row indices of start and end images
                    start_mask = msgs_df["_basename"] == start_img
                    end_mask = msgs_df["_basename"] == end_img
                    emit(
                        {
                            "event": "progress",
                            "message": f"Plot {plot_id}: start found={start_mask.any()}, end found={end_mask.any()}",
                        }
                    )
                    if start_mask.any() and end_mask.any():
                        start_idx = msgs_df.index[start_mask][0]
                        end_idx = msgs_df.index[end_mask][-1]
                        # Swap if user marked end before start in the sequence
                        if start_idx > end_idx:
                            start_idx, end_idx = end_idx, start_idx
                        plot_rows = msgs_df.loc[start_idx:end_idx]
                        # log which images are being copied for this plot
                        logger.info("[stitching] Plot %s: copying images from %s to %s", plot_id, start_img, end_img)
                        unique_basenames = list(
                            dict.fromkeys(b for b in plot_rows["_basename"] if b)
                        )
                        emit(
                            {
                                "event": "progress",
                                "message": f"Plot {plot_id}: {len(plot_rows)} rows → {len(unique_basenames)} unique images in range",
                            }
                        )
                        for basename in unique_basenames:
                            src = images_dir / basename
                            if src.exists():
                                shutil.copy2(src, plot_temp_dir / basename)
                                copied += 1
                        emit(
                            {
                                "event": "progress",
                                "message": f"Plot {plot_id}: {copied}/{len(unique_basenames)} files copied",
                            }
                        )
                    else:
                        logger.warning(
                            "[Plot %s] start_image '%s' or end_image '%s' not found in msgs_synced",
                            plot_id,
                            start_img,
                            end_img,
                        )
            else:
                emit(
                    {
                        "event": "progress",
                        "message": f"Plot {plot_id}: no msgs_synced — msgs_path={msgs_path}",
                    }
                )

            emit(
                {
                    "event": "progress",
                    "message": f"Plot {plot_id}: total {copied} images copied to temp dir",
                }
            )

            # Build config — strip keys not in AgRowStitch's type_dict
            config = dict(base_config)
            config.pop("num_cpu", None)  # passed as arg to run(), not a config key
            config["image_directory"] = str(plot_temp_dir)
            logger.info(f"Temporary dir for plot {plot_id}: {plot_temp_dir} with {copied} images")
            config["device"] = agrowstitch_device
            config["stitching_direction"] = stitch_dir

            with tempfile.NamedTemporaryFile(
                delete=False, mode="w", suffix=f"_plot_{plot_id}.yaml"
            ) as tmpf:
                yaml.safe_dump(config, tmpf)
                tmp_config = tmpf.name

            # Run AgRowStitch in a subprocess so it can be killed on stop.
            # Use a dedicated AgRowStitch venv if present (allows pinning
            # opencv-contrib-python==4.7.0.72 without affecting the main backend).
            # Create it with:
            #   python3 -m venv backend/vendor/AgRowStitch/.venv
            #   .venv/bin/pip install opencv-contrib-python==4.7.0.72 numpy==1.26.4 torch torchvision pyyaml
            #   .venv/bin/pip install -e backend/vendor/LightGlue
            _agrows_venv_python = agrowstitch_dir / ".venv" / "bin" / "python"
            if _agrows_venv_python.exists():
                # Dedicated AgRowStitch venv takes priority (dev override).
                _python = str(_agrows_venv_python)
                _subprocess_env = None
                _subprocess_cmd = [
                    _python, "-c",
                    f"import sys; sys.path.insert(0, {str(agrowstitch_dir)!r}); "
                    f"from AgRowStitch import run; "
                    f"r = run({tmp_config!r}, {cpu_count}); "
                    f"[None for _ in r] if hasattr(r, '__iter__') and not isinstance(r, (str, bytes)) else None",
                ]
            elif getattr(sys, "frozen", False):
                # PyInstaller bundle: there is no standalone Python executable.
                # Re-invoke the bundle executable with GEMI_AGROWSTITCH_CONFIG set;
                # run_server.py detects this env var and runs AgRowStitch instead
                # of starting the server.
                _meipass = getattr(sys, "_MEIPASS", "")
                _subprocess_env = {
                    **os.environ,
                    "GEMI_AGROWSTITCH_CONFIG": tmp_config,
                    "GEMI_AGROWSTITCH_CPU_COUNT": str(cpu_count),
                    "GEMI_AGROWSTITCH_DIR": str(agrowstitch_dir),
                    # Suppress the server's port so it doesn't try to bind one.
                    "GEMI_BACKEND_PORT": "",
                }
                _subprocess_cmd = [sys.executable]
                _python = sys.executable
            else:
                _python = sys.executable
                _subprocess_env = None
                _subprocess_cmd = [
                    _python, "-c",
                    f"import sys; sys.path.insert(0, {str(agrowstitch_dir)!r}); "
                    f"from AgRowStitch import run; "
                    f"r = run({tmp_config!r}, {cpu_count}); "
                    f"[None for _ in r] if hasattr(r, '__iter__') and not isinstance(r, (str, bytes)) else None",
                ]
            emit({"event": "progress", "message": f"Using Python: {_python}"})

            # Pre-flight: verify AgRowStitch can be imported.
            # This surfaces import-time errors (missing deps, ABI mismatch) with
            # a readable message instead of a silent SIGSEGV.
            _preflight_cmd: list[str]
            if getattr(sys, "frozen", False):
                _preflight_cmd = [sys.executable]
                _preflight_env = {
                    **(_subprocess_env or os.environ),
                    "GEMI_AGROWSTITCH_CONFIG": "__probe__",  # sentinel → import-only check
                    "GEMI_AGROWSTITCH_CPU_COUNT": "0",
                    "GEMI_AGROWSTITCH_DIR": str(agrowstitch_dir),
                }
            else:
                _preflight_cmd = [
                    _python, "-c",
                    f"import sys; sys.path.insert(0, {str(agrowstitch_dir)!r}); "
                    f"import AgRowStitch; print('AgRowStitch import OK')",
                ]
                _preflight_env = _subprocess_env
            try:
                _pf = subprocess.run(
                    _preflight_cmd,
                    capture_output=True,
                    text=True,
                    timeout=60,
                    env=_preflight_env,
                )
                _pf_out = (_pf.stdout or "").strip()
                _pf_err = (_pf.stderr or "").strip()
                if _pf.returncode != 0:
                    detail = "\n".join(filter(None, [_pf_out, _pf_err])) or "(no output)"
                    raise RuntimeError(
                        f"AgRowStitch failed import pre-flight check "
                        f"(exit {_pf.returncode}):\n{detail}"
                    )
                if _pf_out:
                    emit({"event": "progress", "message": f"[pre-flight] {_pf_out}"})
            except subprocess.TimeoutExpired:
                emit({"event": "progress", "message": "AgRowStitch pre-flight timed out — proceeding anyway"})
            except RuntimeError:
                raise
            except Exception as _pf_exc:
                emit({"event": "progress", "message": f"Pre-flight check error (non-fatal): {_pf_exc}"})

            proc = subprocess.Popen(
                _subprocess_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=_subprocess_env,
            )

            # Resource snapshot helper — emits RAM + VRAM in one line
            def _emit_resources(_emit):
                parts = []
                # RAM via psutil or /proc/meminfo
                try:
                    import psutil as _psutil

                    vm = _psutil.virtual_memory()
                    parts.append(
                        f"RAM: {vm.used // 1024 // 1024}/{vm.total // 1024 // 1024} MiB"
                        f" ({vm.percent:.0f}%)"
                    )
                except ImportError:
                    try:
                        meminfo = {}
                        with open("/proc/meminfo") as _f:
                            for _line in _f:
                                k, v = _line.split(":")
                                meminfo[k.strip()] = int(v.split()[0])
                        total_mb = meminfo["MemTotal"] // 1024
                        avail_mb = meminfo["MemAvailable"] // 1024
                        used_mb = total_mb - avail_mb
                        parts.append(
                            f"RAM: {used_mb}/{total_mb} MiB ({used_mb / total_mb * 100:.0f}%)"
                        )
                    except Exception:
                        pass
                # VRAM via nvidia-smi
                try:
                    import shutil as _shutil

                    if _shutil.which("nvidia-smi"):
                        out = subprocess.check_output(
                            [
                                "nvidia-smi",
                                "--query-gpu=memory.used,memory.total,utilization.gpu",
                                "--format=csv,noheader,nounits",
                            ],
                            stderr=subprocess.DEVNULL,
                            text=True,
                        ).strip()
                        for gpu_idx, line in enumerate(out.splitlines()):
                            p = [x.strip() for x in line.split(",")]
                            if len(p) >= 2:
                                util = f", util: {p[2]}%" if len(p) >= 3 else ""
                                parts.append(
                                    f"VRAM GPU{gpu_idx}: {p[0]}/{p[1]} MiB{util}"
                                )
                except Exception:
                    pass
                if parts:
                    _emit({"event": "progress", "message": "  ".join(parts)})

            # Snapshot immediately before launch
            _emit_resources(emit)

            # Monitor thread — polls every 5 min while the subprocess runs
            _res_stop = threading.Event()

            def _monitor_resources(_emit, _stop):
                while not _stop.wait(300.0):
                    _emit_resources(_emit)

            vram_thread = threading.Thread(
                target=_monitor_resources,
                args=(emit, _res_stop),
                daemon=True,
            )
            _vram_stop = _res_stop  # alias so existing stop calls still work
            vram_thread.start()

            # Drain stdout in a background thread so readline() never blocks
            # the stop-event polling loop below.
            import re as _re

            _total_plots = len(plots)
            _plot_index = i
            _total_images = copied  # images copied into temp dir

            _last_lines: list[str] = []
            _last_stderr: list[str] = []

            def _drain(pipe, _emit, _plot_id, _pi, _np, _ni, _buf):
                for line in pipe:
                    line = line.rstrip()
                    if not line.strip():
                        continue
                    _buf.append(line)
                    if len(_buf) > 20:
                        _buf.pop(0)
                    # Parse "Starting new batch with image N" for intra-plot progress
                    m = _re.search(r"Starting new batch with image (\d+)", line)
                    if m and _ni > 0:
                        batch_img = int(m.group(1))
                        intra = batch_img / _ni  # 0.0–1.0 within this plot
                        pct = int((_pi + intra) / _np * 100)
                        _emit(
                            {
                                "event": "progress",
                                "progress": pct,
                                "message": f"[AgRowStitch plot {_plot_id}] {line}",
                            }
                        )
                    else:
                        _emit(
                            {
                                "event": "progress",
                                "message": f"[AgRowStitch plot {_plot_id}] {line}",
                            }
                        )

            def _drain_stderr(pipe, _buf):
                for line in pipe:
                    line = line.rstrip()
                    if not line.strip():
                        continue
                    _buf.append(line)
                    if len(_buf) > 30:
                        _buf.pop(0)

            drain_thread = threading.Thread(
                target=_drain,
                args=(
                    proc.stdout,
                    emit,
                    plot_id,
                    _plot_index,
                    _total_plots,
                    _total_images,
                    _last_lines,
                ),
                daemon=True,
            )
            drain_thread.start()
            stderr_thread = threading.Thread(
                target=_drain_stderr,
                args=(proc.stderr, _last_stderr),
                daemon=True,
            )
            stderr_thread.start()

            try:
                # Poll until done, checking stop every 0.3 s
                while proc.poll() is None:
                    if stop_event.is_set():
                        emit(
                            {
                                "event": "progress",
                                "message": f"Plot {plot_id}: stop requested — killing process",
                            }
                        )
                        proc.kill()
                        proc.wait()
                        drain_thread.join(timeout=2)
                        stderr_thread.join(timeout=2)
                        _vram_stop.set()
                        vram_thread.join(timeout=2)
                        return {}
                    time.sleep(0.3)
                _vram_stop.set()
                vram_thread.join(timeout=2)
                drain_thread.join(timeout=5)
                stderr_thread.join(timeout=5)
                if proc.returncode != 0:
                    code = proc.returncode
                    stdout_tail = "\n".join(f"  {l}" for l in _last_lines[-5:]) if _last_lines else "  (no stdout)"
                    stderr_tail = "\n".join(f"  {l}" for l in _last_stderr[-10:]) if _last_stderr else "  (no stderr)"
                    # Negative codes are Unix signals (e.g. -11 = SIGSEGV)
                    if code < 0:
                        import signal as _signal

                        try:
                            sig_name = _signal.Signals(-code).name
                        except ValueError:
                            sig_name = f"signal {-code}"
                        label = f"AgRowStitch crashed with {sig_name}"
                    else:
                        label = f"AgRowStitch exited with code {code}"
                    raise RuntimeError(
                        f"{label}.\n\n"
                        f"Last stdout:\n{stdout_tail}\n\n"
                        f"Last stderr:\n{stderr_tail}"
                    )
            finally:
                _vram_stop.set()
                try:
                    os.unlink(tmp_config)
                except OSError:
                    pass

            # Find output file — AgRowStitch writes to plot_temp_dir or a subdirectory
            output_png = None
            for search_dir in [
                Path(plot_temp_dir),
                Path(plot_temp_dir).parent / "final_mosaics",
            ]:
                if not search_dir.exists():
                    continue
                patterns = [
                    f"full_res_mosaic_temp_plot_{plot_id}",
                    f"plot_{plot_id}",
                    "full_res_mosaic",
                ]
                for pat in patterns:
                    matches = list(search_dir.glob(f"{pat}*.png")) + list(
                        search_dir.glob(f"{pat}*.tif")
                    )
                    if matches:
                        output_png = matches[0]
                        break
                if output_png:
                    break

            if output_png and output_png.exists():
                dest = (
                    out_dir / f"full_res_mosaic_temp_plot_{plot_id}{output_png.suffix}"
                )
                shutil.copy2(output_png, dest)
                logger.info("[Plot %s] Stitched → %s", plot_id, dest.name)
            else:
                logger.warning(
                    "[Plot %s] No stitched output found in %s", plot_id, plot_temp_outer
                )

        except RuntimeError as _plot_err:
            _err_msg = str(_plot_err)[:400]
            failed_plots.append(plot_id)
            logger.warning("[Plot %s] Stitching failed, skipping: %s", plot_id, _err_msg)
            emit(
                {
                    "event": "progress",
                    "message": f"Plot {plot_id}: FAILED — skipping. {_err_msg}",
                }
            )
        else:
            succeeded_plots.append(plot_id)
        finally:
            shutil.rmtree(plot_temp_outer, ignore_errors=True)

    _n_ok = len(succeeded_plots)
    _n_fail = len(failed_plots)
    _summary = f"Stitching complete — {_n_ok}/{len(plots)} plot(s) succeeded"
    if failed_plots:
        _summary += f", {_n_fail} failed (plot IDs: {failed_plots})"
    emit(
        {
            "event": "progress",
            "progress": 100,
            "message": _summary,
        }
    )
    if failed_plots:
        logger.warning("[stitching] %d plot(s) failed: %s", _n_fail, failed_plots)

    # Build stored config (drop temp runtime keys)
    stored_config = dict(base_config)
    stored_config.pop("image_directory", None)

    from datetime import datetime, timezone as _tz
    stitch_result: dict[str, Any] = {
        "_stitch_new_entry": {
            "version": agrowstitch_version,
            "name": name,
            "dir": paths.rel(out_dir),
            "config": stored_config,
            "plot_count": len(plots),
            "succeeded_plots": succeeded_plots,
            "failed_plots": failed_plots,
            "created_at": datetime.now(_tz.utc).isoformat(),
            "plot_marking_version": plot_marking_version,
        },
        "stitching_version": agrowstitch_version,
    }

    # Automatically run georeferencing right after stitching completes
    emit({"event": "progress", "message": "Starting georeferencing…"})
    try:
        geo_outputs = run_georeferencing(
            session=session,
            run_id=run_id,
            stop_event=stop_event,
            emit=emit,
            plot_borders_path=plot_borders_path,
        )
        stitch_result.update(geo_outputs)
    except Exception as exc:
        logger.warning("Georeferencing failed (non-fatal): %s", exc)
        emit({"event": "progress", "message": f"Georeferencing skipped: {exc}"})

    return stitch_result


# ── Step 3: Georeferencing ────────────────────────────────────────────────────


def run_georeferencing(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
    plot_borders_path: "Path | None" = None,
) -> dict[str, Any]:
    """
    Georeference stitched plot PNGs using GPS data from msgs_synced.csv.

    Reads:
      - Processed/{workspace}/{pop}/{run_seg}/AgRowStitch_v{N}/*.png
      - msgs_synced.csv (searched in Raw/ and Intermediate/)
      - Intermediate/{workspace}/{pop}/plot_borders.csv

    Writes:
      - Processed/{workspace}/{pop}/{run_seg}/AgRowStitch_v{N}/
          georeferenced_plot_{id}_utm.tif
          combined_mosaic_utm.tif
          combined_mosaic.tif
    """
    import pandas as pd
    from app.processing.geo_utils import georeference_plot, combine_utm_tiffs_to_mosaic
    from app.models.pipeline import PipelineRun

    paths = _get_paths(session, run_id)
    run = session.get(PipelineRun, run_id)
    agrowstitch_version = int((run.outputs or {}).get("stitching_version") or 1)
    out_dir = paths.agrowstitch_dir(agrowstitch_version)

    if not out_dir.exists():
        raise FileNotFoundError(
            f"Stitching output not found at {out_dir}. "
            "Complete the Stitching step first."
        )

    # Load msgs_synced.csv
    msgs_path = _find_msgs_synced(paths)
    if msgs_path is None:
        raise FileNotFoundError(
            "msgs_synced.csv not found. Ensure binary extraction completed "
            "or place the file in the run's Intermediate directory."
        )
    msgs_df = pd.read_csv(msgs_path)
    logger.info("Loaded msgs_synced.csv: %d rows from %s", len(msgs_df), msgs_path)

    # Determine the image filename column (Farm-ng first, then standard fallback)
    rgb_col = "/top/rgb_file" if "/top/rgb_file" in msgs_df.columns else None
    if rgb_col is None and "rgb_file" in msgs_df.columns:
        rgb_col = "rgb_file"
    if rgb_col is None:
        rgb_col = next(
            (c for c in msgs_df.columns if c.lower() in ("image_path", "image", "filename", "file", "path")),
            None,
        )

    # Resolve which plot_borders file to use (versioned takes priority over canonical)
    if plot_borders_path is None:
        plot_borders_path = paths.plot_borders
    _effective_borders = plot_borders_path if plot_borders_path.exists() else paths.plot_borders
    logger.info("[georeferencing] using plot borders file: %s", _effective_borders)

    # Load plot borders for direction info
    plot_directions: dict[str, str] = {}
    if _effective_borders.exists():
        with open(_effective_borders) as f:
            for row in csv.DictReader(f):
                plot_directions[str(row["plot_id"])] = row.get("direction", "down")

    # Find stitched plot images
    plot_pngs = sorted(out_dir.glob("full_res_mosaic_temp_plot_*.png"))
    if not plot_pngs:
        plot_pngs = sorted(out_dir.glob("AgRowStitch_plot-id-*.png"))
    if not plot_pngs:
        raise FileNotFoundError(f"No stitched plot images found in {out_dir}")

    emit(
        {
            "event": "progress",
            "message": f"Georeferencing {len(plot_pngs)} plots…",
            "total": len(plot_pngs),
        }
    )

    plot_ids = []
    for i, png in enumerate(plot_pngs):
        if stop_event.is_set():
            return {}

        # Extract plot_id from filename
        stem = png.stem  # e.g. full_res_mosaic_temp_plot_3
        plot_id_str = stem.split("_")[-1]
        emit(
            {
                "event": "progress",
                "index": i,
                "message": f"Georeferencing plot {plot_id_str}",
            }
        )

        # Filter msgs_df to the rows for this plot
        if rgb_col and _effective_borders.exists():
            with open(_effective_borders) as f:
                borders = {str(r["plot_id"]): r for r in csv.DictReader(f)}
            border = borders.get(plot_id_str, {})
            start_img = border.get("start_image", "")
            end_img = border.get("end_image", "")
            if start_img and end_img and rgb_col:
                # rgb_col values may be full paths ("/top/rgb-123.jpg") while
                # start/end images are plain basenames — normalise to basename
                if "_basename" not in msgs_df.columns:
                    msgs_df["_basename"] = msgs_df[rgb_col].apply(
                        lambda v: str(v).split("/")[-1] if v and str(v) != "nan" else ""
                    )
                start_bn = start_img.split("/")[-1]
                end_bn = end_img.split("/")[-1]
                plot_df = msgs_df[
                    (msgs_df["_basename"] >= start_bn) & (msgs_df["_basename"] <= end_bn)
                ].copy()
            else:
                plot_df = msgs_df.copy()
        else:
            plot_df = msgs_df.copy()

        if len(plot_df) < 2:
            logger.warning(
                "[Plot %s] Only %d GPS rows — skipping georeferencing",
                plot_id_str,
                len(plot_df),
            )
            continue

        ui_direction = plot_directions.get(plot_id_str, "down")
        success = georeference_plot(
            plot_id_str, plot_df, out_dir, ui_direction=ui_direction
        )
        if success:
            plot_ids.append(plot_id_str)
        else:
            logger.warning("[Plot %s] Georeferencing failed", plot_id_str)

    if not plot_ids:
        raise RuntimeError("No plots were successfully georeferenced.")

    emit({"event": "progress", "message": "Combining plot mosaics…"})
    combine_utm_tiffs_to_mosaic(out_dir, plot_ids)

    emit({"event": "progress", "message": "Building plot boundary GeoJSON…"})
    from app.processing.geo_utils import build_plot_boundaries_geojson

    geojson_path = build_plot_boundaries_geojson(
        out_dir=out_dir,
        plot_ids=plot_ids,
        plot_borders_csv=_effective_borders if _effective_borders.exists() else None,
    )

    outputs: dict = {"georeferencing": paths.rel(out_dir)}
    if geojson_path:
        outputs["plot_boundaries_geojson"] = paths.rel(geojson_path)
        # Write to canonical location so the boundary tool can open it directly.
        # Use read_bytes/write_bytes instead of shutil.copy2 — more portable on Windows.
        paths.plot_boundary_geojson.parent.mkdir(parents=True, exist_ok=True)
        paths.plot_boundary_geojson.write_bytes(geojson_path.read_bytes())
        outputs["plot_boundary_prep"] = paths.rel(paths.plot_boundary_geojson)
        outputs["_mark_steps_complete"] = ["plot_boundary_prep"]
    return outputs


# ── Step 4: Inference (Roboflow) ─────────────────────────────────────────────


def run_inference(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
    models: list[dict],
    stitch_version: int | None = None,
    association_version: int | None = None,
    inference_mode: str = "cloud",
    local_server_url: str | None = None,
) -> dict[str, Any]:
    """
    Run Roboflow inference on stitched plot images using one or more model configs.

    models: [
        {"label": "Wheat", "roboflow_api_key": "...", "roboflow_model_id": "...", "task_type": "detection"},
        ...
    ]

    stitch_version: which AgRowStitch version's images to run inference on.
    association_version: which association version maps plot indices to plot metadata.
                         Stored as metadata so downstream trait joining uses the right CSV.

    Each completed model run is appended as an entry in run.outputs["inference"] (list format).
    """
    from app.processing.inference_utils import run_inference_on_image, merge_inference_into_geojson
    from app.crud.pipeline import update_pipeline_run
    from app.models.pipeline import PipelineRunUpdate
    from datetime import datetime, timezone

    if not models:
        raise ValueError("No inference models provided.")

    from app.models.pipeline import PipelineRun

    paths = _get_paths(session, run_id)
    run = session.get(PipelineRun, run_id)
    outputs = dict(run.outputs or {})

    # Resolve which stitch version to use
    resolved_stitch_version = stitch_version or int(outputs.get("stitching_version") or 1)
    out_dir = paths.agrowstitch_dir(resolved_stitch_version)

    if not out_dir.exists():
        raise FileNotFoundError(
            f"Stitching v{resolved_stitch_version} output not found. Complete Stitching first."
        )

    plot_images = sorted(out_dir.glob("full_res_mosaic_temp_plot_*.png"))
    if not plot_images:
        plot_images = sorted(out_dir.glob("AgRowStitch_plot-id-*.png"))
    if not plot_images:
        raise FileNotFoundError(f"No plot images found in stitching v{resolved_stitch_version} output.")

    # Resolve which association version to use
    resolved_assoc_version = association_version
    if resolved_assoc_version is None:
        existing_assocs = outputs.get("associations", [])
        active_assoc_v = outputs.get("active_association_version")
        if active_assoc_v is not None:
            resolved_assoc_version = int(active_assoc_v)
        elif existing_assocs:
            resolved_assoc_version = existing_assocs[-1]["version"]

    # Load association CSV → build {plot_idx: row} lookup for metadata enrichment
    assoc_by_idx: dict[str, dict] = {}
    assoc_entry = None
    if resolved_assoc_version is not None:
        assoc_entry = next(
            (a for a in outputs.get("associations", []) if a["version"] == resolved_assoc_version),
            None,
        )
    if assoc_entry and assoc_entry.get("association_path"):
        assoc_csv_path = paths.abs(assoc_entry["association_path"])
    else:
        assoc_csv_path = paths.intermediate_run / "association.csv"
    if assoc_csv_path.exists():
        with open(assoc_csv_path, newline="") as _f:
            for _row in csv.DictReader(_f):
                tif_name = _row.get("plot_tif", "")
                stem = Path(tif_name).stem  # "georeferenced_plot_3_utm"
                parts = stem.split("_")
                plot_idx = None
                for _i, _p in enumerate(parts):
                    if _p == "plot" and _i + 1 < len(parts) and parts[_i + 1].isdigit():
                        plot_idx = parts[_i + 1]
                        break
                if plot_idx is not None:
                    assoc_by_idx[plot_idx] = _row
        logger.info("Loaded association CSV: %d plot entries from %s", len(assoc_by_idx), assoc_csv_path.name)

    def _get_plot_idx(img_path: Path) -> str:
        """Extract plot index from full_res_mosaic_temp_plot_{N}.png"""
        stem = img_path.stem
        parts = stem.split("_")
        for _i, _p in enumerate(parts):
            if _p == "plot" and _i + 1 < len(parts) and parts[_i + 1].isdigit():
                return parts[_i + 1]
        return stem

    fieldnames = ["image", "plot_index", "plot_label", "accession", "row", "col", "model_id",
                  "class", "confidence", "x", "y", "width", "height", "points"]

    # Read existing inference list (new list format); migrate old dict format if needed
    existing_inference = outputs.get("inference", [])
    if isinstance(existing_inference, dict):
        # Migrate legacy {label: path} → list
        existing_inference = [
            {"label": lbl, "csv_path": rel, "stitch_version": None, "association_version": None, "created_at": None}
            for lbl, rel in existing_inference.items()
        ]

    new_entries: list[dict] = []
    global_total = len(models) * len(plot_images)
    global_done = 0

    for model in models:
        if stop_event.is_set():
            return {}
        label = model.get("label", "model")
        api_key = model.get("roboflow_api_key", "")
        model_id = model.get("roboflow_model_id", "")
        task_type = model.get("task_type", "detection")

        mode_tag = "local" if inference_mode == "local" else "cloud"
        masked_key = (api_key[:4] + "…" + api_key[-4:]) if len(api_key) > 8 else "***"
        emit({
            "event": "log",
            "message": (
                f"[{label}] Starting {mode_tag} inference on {len(plot_images)} plots "
                f"(stitch v{resolved_stitch_version}) — model: {model_id}, key: {masked_key}"
            ),
            "total": global_total,
            "done": global_done,
        })

        safe_label = "".join(c if c.isalnum() or c in "-_" else "_" for c in label)
        predictions_path = out_dir / f"roboflow_predictions_{safe_label}.csv"
        all_rows: list[dict] = []

        for i, img in enumerate(plot_images):
            if stop_event.is_set():
                emit({"event": "log", "message": f"[{label}] Stopped after {i}/{len(plot_images)} plots."})
                return {}

            def _warn(msg: str, _lbl: str = label) -> None:
                emit({"event": "log", "message": f"  ⚠ [{_lbl}] {msg}"})

            preds = run_inference_on_image(
                img, api_key=api_key, model_id=model_id, task_type=task_type,
                inference_mode=inference_mode,
                local_server_url=local_server_url or "",
                on_warning=_warn,
            )
            global_done += 1
            det_label = f"{len(preds)} detection{'s' if len(preds) != 1 else ''}" if preds else "no detections"
            pct = round(global_done / global_total * 100)
            emit({"event": "progress", "progress": pct})
            emit({
                "event": "log",
                "message": f"[{label}] ({i + 1}/{len(plot_images)}) {img.name} → {det_label}",
                "total": global_total,
                "done": global_done,
            })
            plot_idx = _get_plot_idx(img)
            assoc = assoc_by_idx.get(plot_idx, {})
            plot_label = assoc.get("plot") or assoc.get("Plot") or plot_idx
            accession = assoc.get("accession") or assoc.get("Accession") or ""
            row_val = assoc.get("row") or assoc.get("Row") or ""
            col_val = assoc.get("column") or assoc.get("col") or assoc.get("Col") or ""
            import json as _json
            for p in preds:
                p["image"] = img.name
                p["plot_index"] = plot_idx
                p["plot_label"] = plot_label
                p["accession"] = accession
                p["row"] = row_val
                p["col"] = col_val
                p["model_id"] = model_id
                p["points"] = _json.dumps(p["points"]) if p.get("points") else ""
            all_rows.extend(preds)

        with open(predictions_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(all_rows)

        # Class breakdown summary
        class_counts: dict[str, int] = {}
        for r in all_rows:
            cls = r.get("class", "?")
            class_counts[cls] = class_counts.get(cls, 0) + 1
        if class_counts:
            breakdown = ", ".join(f"{cls}: {n}" for cls, n in sorted(class_counts.items()))
            summary = f"[{label}] Done — {len(all_rows)} detections across {len(plot_images)} plots ({breakdown})"
        else:
            summary = f"[{label}] Done — 0 detections across {len(plot_images)} plots. Check model ID, API key, and confidence threshold."
        emit({"event": "log", "message": summary})
        logger.info("[%s] Wrote %d predictions → %s", label, len(all_rows), predictions_path.name)

        # Merge detection counts into Traits GeoJSON if a plot boundary exists
        traits_path = paths.traits_geojson
        boundary_path = paths.plot_boundary_geojson
        if boundary_path.exists() and not traits_path.exists():
            import shutil as _shutil
            traits_path.parent.mkdir(parents=True, exist_ok=True)
            _shutil.copy2(boundary_path, traits_path)
            logger.info("Copied plot boundary → %s for inference trait merge", traits_path.name)
        if traits_path.exists():
            merge_inference_into_geojson(
                traits_path, all_rows, model_label=label,
                plot_id_field="plot_label", feature_match_prop="Plot",
            )

        new_entries.append({
            "label": label,
            "csv_path": paths.rel(predictions_path),
            "stitch_version": resolved_stitch_version,
            "association_version": resolved_assoc_version,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    if new_entries:
        # Replace any existing entries with the same label (re-run overwrites)
        new_labels = {e["label"] for e in new_entries}
        existing_inference = [e for e in existing_inference if e.get("label") not in new_labels]
        existing_inference.extend(new_entries)
        outputs["inference"] = existing_inference
        run = session.get(PipelineRun, run_id)
        update_pipeline_run(session=session, db_run=run, run_in=PipelineRunUpdate(outputs=outputs))

        # Create a TraitRecord so the Analyze tab can display this run
        traits_path = paths.traits_geojson
        if traits_path.exists():
            from app.models.pipeline import TraitRecord as _TraitRecord
            from sqlmodel import select as _select, func as _func
            import json as _json2

            with open(traits_path) as _gj_f:
                _gj = _json2.load(_gj_f)
            _features = _gj.get("features", [])
            _trait_cols: list[str] = sorted({
                k
                for f in _features
                for k, v in (f.get("properties") or {}).items()
                if isinstance(v, (int, float)) and v is not True and v is not False
            })
            _boundary_v = int(outputs.get("active_plot_boundary_version") or 0) or None
            _max_v = session.exec(
                _select(_func.max(_TraitRecord.version)).where(_TraitRecord.run_id == run_id)
            ).one() or 0
            _tr = _TraitRecord(
                run_id=run_id,
                geojson_path=paths.rel(traits_path),
                ortho_version=None,
                boundary_version=_boundary_v,
                version=_max_v + 1,
                plot_count=len(_features),
                trait_columns=_trait_cols,
                vf_avg=None,
                height_avg=None,
            )
            session.add(_tr)
            session.commit()
            logger.info("Created TraitRecord v%d for ground run %s (%d plots, %d trait columns)",
                        _max_v + 1, run_id, len(_features), len(_trait_cols))

            # ── Populate PlotRecord table ─────────────────────────────────────
            try:
                from sqlmodel import select as _sel_pr2
                from app.models.pipeline import Pipeline as _Pipeline_pr2
                from app.models.workspace import Workspace as _Workspace_pr2
                from app.processing.plot_record_utils import upsert_plot_records_from_features as _upsert_pr2

                _run_pr = session.get(PipelineRun, run_id)
                _pl_pr2 = session.exec(_sel_pr2(_Pipeline_pr2).where(_Pipeline_pr2.id == _run_pr.pipeline_id)).first() if _run_pr else None
                _ws_pr2 = session.exec(_sel_pr2(_Workspace_pr2).where(_Workspace_pr2.id == _pl_pr2.workspace_id)).first() if _pl_pr2 else None

                # Resolve stitch version for ground
                _run_outputs_pr = (_run_pr.outputs or {}) if _run_pr else {}
                _stitch_v_pr = int(_run_outputs_pr.get("stitching_version") or 0) or None
                _stitchings_pr = _run_outputs_pr.get("stitchings") or []
                _stitch_entry_pr = next((s for s in _stitchings_pr if s.get("version") == _stitch_v_pr), None)
                _stitch_name_pr = _stitch_entry_pr.get("name") if _stitch_entry_pr else None

                _pr_count2 = _upsert_pr2(
                    session=session,
                    trait_record_id=_tr.id,
                    run_id=run_id,
                    pipeline_id=_run_pr.pipeline_id if _run_pr else run_id,
                    pipeline_type="ground",
                    pipeline_name=_pl_pr2.name if _pl_pr2 else "",
                    workspace_id=_pl_pr2.workspace_id if _pl_pr2 else run_id,
                    workspace_name=_ws_pr2.name if _ws_pr2 else "",
                    date=_run_pr.date if _run_pr else "",
                    experiment=_run_pr.experiment if _run_pr else "",
                    location=_run_pr.location if _run_pr else "",
                    population=_run_pr.population if _run_pr else "",
                    platform=_run_pr.platform if _run_pr else "",
                    sensor=_run_pr.sensor if _run_pr else "",
                    trait_record_version=_max_v + 1,
                    ortho_version=None,
                    ortho_name=None,
                    stitch_version=_stitch_v_pr,
                    stitch_name=_stitch_name_pr,
                    boundary_version=_boundary_v,
                    boundary_name=None,
                    features=_features,
                    cropped_images_rel_dir=None,  # ground crops are per-plot in AgRowStitch dir
                )
                logger.info("PlotRecord: inserted %d ground plot records", _pr_count2)
            except Exception as _pr_exc2:
                session.rollback()
                logger.warning("PlotRecord upsert failed for ground run (non-fatal): %s", _pr_exc2)

    return {}


# ── Binary extraction (.bin → images) ────────────────────────────────────────
# Called from the upload endpoint when .bin files are detected.
# Runs as a background task; progress tracked via the same SSE mechanism.


def _import_extract_binary():
    """
    Try to import extract_binary from the bin_to_images package (farm-ng-amiga SDK).

    Looks in (priority order):
      1. Installed package (standard import)
      2. BIN_TO_IMAGES_PATH environment variable (dev override)
      3. backend/ directory (bin_to_images/ lives here in the local repo)
      4. vendor/bin_to_images relative to the backend root (legacy path)
      5. Sibling bin_to_images/ directory
    """
    try:
        from bin_to_images.bin_to_images import extract_binary  # type: ignore
        return extract_binary
    except Exception as e:
        logger.warning("bin_to_images.bin_to_images import failed: %s: %s", type(e).__name__, e)
    try:
        from bin_to_images import extract_binary  # type: ignore
        return extract_binary
    except Exception as e:
        logger.warning("bin_to_images import failed: %s: %s", type(e).__name__, e)

    # Fallback: path-based lookup.
    # Each entry is added to sys.path so that `bin_to_images` is importable as a package.
    backend_dir = str(Path(__file__).parent.parent.parent)  # backend/
    fallback_paths = [
        os.environ.get("BIN_TO_IMAGES_PATH"),
        backend_dir,  # backend/bin_to_images/ lives here — works for local dev
        str(Path(__file__).parent.parent.parent / "vendor" / "bin_to_images"),
        str(Path(__file__).parent.parent.parent.parent / "bin_to_images"),
        # PyInstaller frozen bundle — bin_to_images collected alongside the exe
        str(Path(getattr(sys, "_MEIPASS", ""))) if getattr(sys, "frozen", False) else None,
    ]
    for p in fallback_paths:
        if not p:
            continue
        candidate = Path(p)
        if not candidate.exists():
            continue
        if str(candidate) not in sys.path:
            sys.path.insert(0, str(candidate))
        try:
            from bin_to_images.bin_to_images import extract_binary  # type: ignore
            return extract_binary
        except Exception as e:
            logger.warning("bin_to_images import from %s failed: %s: %s", p, type(e).__name__, e)

    return None


_DOCKER_IMAGE = "gemi-bin-extractor:latest"

# Prevents concurrent docker build attempts (e.g. user retries while first build is running).
_docker_build_lock = threading.Lock()
_docker_build_in_progress = threading.Event()  # set while a build is running


def _docker_build_context() -> tuple[Path, Path]:
    """
    Return (dockerfile_dir, bin_to_images_src) for assembling the Docker build context.

    In a PyInstaller bundle, these are extracted alongside the binary.
    In development, they live in the backend/ source tree.
    """
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)
        return (
            base / "docker" / "bin-extractor",
            base / "docker" / "bin-extractor" / "bin_to_images",
        )
    base = Path(__file__).parent.parent.parent  # backend/
    return (
        base / "docker" / "bin-extractor",
        base / "bin_to_images",
    )


def _dockerfile_hash() -> str:
    """Short MD5 of Dockerfile + run_extraction.py — used to detect when a rebuild is needed."""
    dockerfile_dir, _ = _docker_build_context()
    content = (dockerfile_dir / "Dockerfile").read_bytes()
    content += (dockerfile_dir / "run_extraction.py").read_bytes()
    return hashlib.md5(content).hexdigest()[:16]  # noqa: S324


def _image_needs_rebuild() -> bool:
    """Return True if the Docker image doesn't exist or was built from an older Dockerfile."""
    result = subprocess.run(
        [
            "docker", "image", "inspect",
            "--format", "{{index .Config.Labels \"gemi.hash\"}}",
            _DOCKER_IMAGE,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return True  # image doesn't exist
    return result.stdout.strip() != _dockerfile_hash()


def _build_bin_extractor_image(emit: Callable[[dict], None]) -> None:
    """
    Build gemi-bin-extractor from the bundled Dockerfile.

    Assembles a self-contained build context in a temp directory (Dockerfile +
    run_extraction.py + bin_to_images source), then streams docker build output
    line-by-line so the user can see progress.
    """
    msg = (
        "Building .bin extraction tool — this downloads ~1 GB and may take "
        "10–20 minutes depending on your internet connection. "
        "This only happens once (and again after GEMI updates)."
    )
    logger.info(msg)
    emit({"event": "progress", "message": msg})

    dockerfile_dir, bin_to_images_src = _docker_build_context()

    if not dockerfile_dir.exists():
        raise RuntimeError(
            "Docker build context not found inside the GEMI installation. "
            "This is a packaging issue — please reinstall GEMI."
        )
    if not bin_to_images_src.exists():
        raise RuntimeError(
            "bin_to_images source not found. "
            "Make sure submodules are checked out: git submodule update --init --recursive"
        )

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        shutil.copy(dockerfile_dir / "Dockerfile", tmp_path / "Dockerfile")
        shutil.copy(dockerfile_dir / "run_extraction.py", tmp_path / "run_extraction.py")
        shutil.copytree(bin_to_images_src, tmp_path / "bin_to_images")

        cmd = [
            "docker", "build",
            "--build-arg", f"GEMI_HASH={_dockerfile_hash()}",
            "-t", _DOCKER_IMAGE,
            ".",
        ]
        logger.info("Running: %s (cwd=%s)", " ".join(cmd), tmp_path)
        proc = subprocess.Popen(
            cmd,
            cwd=str(tmp_path),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            logger.info("[docker build] %s", line)
            # Only surface step-level lines to the UI (e.g. "Step 3/9 : RUN pip install")
            # so the label stays readable rather than flickering through hundreds of lines.
            if line.startswith("Step ") or line.startswith("#"):
                emit({"event": "progress", "message": f"Building extraction tool… {line}"})
        proc.wait()

    if proc.returncode != 0:
        raise RuntimeError(
            "Failed to build the gemi-bin-extractor Docker image.\n"
            "Make sure Docker Desktop is running and you have an internet connection,\n"
            "then try the extraction again."
        )

    logger.info("gemi-bin-extractor image built successfully.")
    emit({"event": "progress", "message": "Extraction tool built successfully."})


def _ensure_docker_ready(emit: Callable[[dict], None]) -> None:
    """
    Check Docker daemon is reachable and the extractor image is built.
    Raises RuntimeError with a user-readable message on any failure.
    """
    # ── 1. Docker daemon reachable? ───────────────────────────────────────────
    try:
        subprocess.run(
            ["docker", "info"],
            capture_output=True,
            check=True,
            timeout=15,
        )
    except FileNotFoundError:
        raise RuntimeError(
            ".bin extraction is not supported natively on Windows and Docker was not found.\n"
            "\n"
            "To enable .bin extraction on Windows:\n"
            "  1. Install Docker Desktop: https://www.docker.com/products/docker-desktop/\n"
            "  2. Start Docker Desktop and wait for it to finish loading.\n"
            "  3. Retry — GEMI will build the extraction tool automatically (one-time, ~15 min)."
        )
    except subprocess.CalledProcessError:
        raise RuntimeError(
            ".bin extraction on Windows requires Docker Desktop to be running.\n"
            "Please start Docker Desktop, wait for it to finish loading, then try again."
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(
            "Docker Desktop did not respond within 15 seconds.\n"
            "Please ensure Docker Desktop is fully started and try again."
        )

    # ── 2. Build image if missing or outdated ─────────────────────────────────
    if _image_needs_rebuild():
        with _docker_build_lock:
            if _image_needs_rebuild():
                logger.info("gemi-bin-extractor image missing or outdated — building now.")
                _docker_build_in_progress.set()
                try:
                    _build_bin_extractor_image(emit)
                finally:
                    _docker_build_in_progress.clear()
            else:
                logger.info("gemi-bin-extractor image is now up-to-date (built by concurrent request).")
    elif _docker_build_in_progress.is_set():
        logger.info("Docker build in progress — waiting for it to complete…")
        emit({"event": "progress", "message": "Extraction tool is being built (started by another upload) — please wait…"})
        _docker_build_in_progress.wait(timeout=1800)


def _run_docker_container(bin_path: Path, output_dir: Path, resource_flags: list[str]) -> None:
    """
    Run a single docker container to extract one .bin file into output_dir.
    output_dir is the per-file temporary directory (not the final destination).
    Raises RuntimeError on non-zero exit.
    """
    if sys.platform == "win32":
        host_bin_dir = bin_path.parent.resolve().as_posix()
        host_output_dir = output_dir.resolve().as_posix()
    else:
        host_bin_dir = str(bin_path.parent)
        host_output_dir = str(output_dir)

    cmd = [
        "docker", "run", "--rm",
        *resource_flags,
        "-v", f"{host_bin_dir}:/input:ro",
        "-v", f"{host_output_dir}:/output",
        _DOCKER_IMAGE,
        f"/input/{bin_path.name}",
        "/output",
    ]
    logger.info("docker run: %s", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if proc.stdout:
        for line in proc.stdout.splitlines():
            logger.info("[docker] %s", line)
    if proc.returncode != 0:
        if proc.stderr:
            logger.error("[docker stderr] %s", proc.stderr.strip())
        detail = proc.stderr.strip() or proc.stdout.strip() or "no output from container"
        raise RuntimeError(f".bin extraction failed inside Docker:\n{detail}")


def _merge_docker_results(temp_dirs: list[Path], final_output: Path) -> None:
    """
    Merge per-file extraction outputs from temp dirs into the final output directory.
    Each temp dir contains:  RGB/top/*.jpg  RGB/Metadata/msgs_synced.csv  RGB/Metadata/gps_*.csv
    Images have timestamp-based names and are safe to move without conflict.
    CSVs are merged and de-duplicated by timestamp.
    """
    import shutil
    import pandas as pd

    final_rgb = final_output / "RGB"
    final_metadata = final_rgb / "Metadata"
    final_metadata.mkdir(parents=True, exist_ok=True)

    msgs_dfs: list[pd.DataFrame] = []
    gps_parts: dict[str, list[pd.DataFrame]] = {"pvt": [], "relposned": []}

    for tmp_dir in temp_dirs:
        rgb_dir = tmp_dir / "RGB"
        if not rgb_dir.exists():
            logger.warning("Expected RGB subdir not found in temp extraction dir: %s", tmp_dir)
            continue

        # Move image subdirectories (everything except Metadata)
        for entry in rgb_dir.iterdir():
            if not entry.is_dir() or entry.name == "Metadata":
                continue
            dest_root = final_rgb / entry.name
            dest_root.mkdir(parents=True, exist_ok=True)
            for img_file in entry.rglob("*"):
                if img_file.is_file():
                    dest = dest_root / img_file.relative_to(entry)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(img_file), str(dest))

        # Collect CSVs and calibration JSON from Metadata
        meta = rgb_dir / "Metadata"
        if not meta.exists():
            continue

        msgs_csv = meta / "msgs_synced.csv"
        if msgs_csv.exists():
            try:
                df = pd.read_csv(msgs_csv)
                if not df.empty:
                    msgs_dfs.append(df)
            except Exception as e:
                logger.warning("Could not read msgs_synced.csv from %s: %s", tmp_dir, e)

        for k in ("pvt", "relposned"):
            gps_csv = meta / f"gps_{k}.csv"
            if gps_csv.exists():
                try:
                    gdf = pd.read_csv(gps_csv)
                    if not gdf.empty:
                        gps_parts[k].append(gdf)
                except Exception as e:
                    logger.warning("Could not read gps_%s.csv from %s: %s", k, tmp_dir, e)

        # Calibration JSON — first-found wins (same for all files in a session)
        for json_file in meta.glob("*_calibration.json"):
            dest_json = final_metadata / json_file.name
            if not dest_json.exists():
                shutil.copy2(str(json_file), str(dest_json))

    # Write merged msgs_synced.csv
    if msgs_dfs:
        merged_msgs = pd.concat(msgs_dfs, ignore_index=True)
        merged_msgs.to_csv(final_metadata / "msgs_synced.csv", index=False)
        logger.info("Merged msgs_synced.csv from %d temp extraction dirs", len(msgs_dfs))
    else:
        logger.warning("No msgs_synced.csv found in any extraction temp dir — skipping merge")

    # Write merged gps_*.csv
    for k, parts in gps_parts.items():
        if parts:
            gps_merged = (
                pd.concat(parts, ignore_index=True)
                .drop_duplicates("stamp")
                .sort_values("stamp")
                .reset_index(drop=True)
            )
            gps_merged.to_csv(final_metadata / f"gps_{k}.csv", index=False)
            logger.info("Merged gps_%s.csv from %d sources", k, len(parts))


def extract_bin_files_batch(
    bin_files: list[tuple[int, Path]],
    output_dir: Path,
    emit: Callable[[dict], None],
) -> None:
    """
    Extract multiple .bin files in parallel and emit per-file progress events.

    Both native and Docker paths use the same strategy: one thread per file,
    each writing to its own temporary directory, with results merged afterward.
    This avoids multiprocessing (which breaks when spawned from within a thread)
    and prevents CSV conflicts from concurrent writes to the same directory.

    bin_files : list of (sse_index, dest_path)
    output_dir: final destination directory (same for all files)
    emit      : callback; dicts must include event, index, file, message
    """
    import tempfile
    import shutil
    from concurrent.futures import ThreadPoolExecutor

    extract_binary = _import_extract_binary()
    use_docker = (
        extract_binary is None
        and (sys.platform == "win32" or os.environ.get("GEMI_FORCE_DOCKER") == "1")
    )

    if extract_binary is None and not use_docker:
        msg = (
            "farm_ng SDK is not available in this environment.\n"
            "Run: uv pip install farm-ng-amiga"
        )
        for idx, p in bin_files:
            emit({"event": "error", "index": idx, "file": p.name, "message": msg})
        raise RuntimeError(msg)

    # ── Docker: check readiness + fetch resource flags once ───────────────────
    if use_docker:
        _ensure_docker_ready(emit)
        from app.core.db import engine
        from app.crud.app_settings import get_docker_resource_flags
        from sqlmodel import Session as _Session
        with _Session(engine) as _s:
            resource_flags = get_docker_resource_flags(session=_s)
        if resource_flags:
            logger.info("Docker resource limits: %s", " ".join(resource_flags))
        else:
            logger.info("Docker resource limits: none")
    else:
        resource_flags = []

    max_workers = min(len(bin_files), max(1, (os.cpu_count() or 2) // 2), 4)
    logger.info("Extracting %d .bin file(s) with up to %d parallel worker(s) [%s]",
                len(bin_files), max_workers, "Docker" if use_docker else "native")

    temp_base = Path(tempfile.mkdtemp(prefix="gemi_binext_"))
    temp_dirs: list[Path] = []
    errors: list[str] = []
    lock = threading.Lock()

    def _count_images(directory: Path) -> int:
        """Count extracted image files recursively in a directory."""
        try:
            return sum(
                1 for p in directory.rglob("*")
                if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png"}
            )
        except OSError:
            return 0

    def _extract_one(idx: int, bin_path: Path, temp_dir: Path) -> None:
        emit({"event": "progress", "index": idx, "file": bin_path.name,
              "message": "Running extraction via Docker…" if use_docker else "Extracting…"})

        # Background thread: poll temp_dir every 5 s and emit image-count progress
        # so the UI shows live progress instead of staying stuck at 0%.
        _stop_poll = threading.Event()

        def _poll_images() -> None:
            while not _stop_poll.wait(timeout=5.0):
                n = _count_images(temp_dir)
                if n > 0:
                    emit({"event": "progress", "index": idx, "file": bin_path.name,
                          "message": f"Extracting… {n} image(s) found"})

        poll_thread = threading.Thread(target=_poll_images, daemon=True)
        poll_thread.start()

        try:
            if use_docker:
                _run_docker_container(bin_path, temp_dir, resource_flags)
            else:
                # Single-file call → sequential mode inside extract_binary (safe,
                # no multiprocessing.Pool spawned, no conflicts with other threads).
                assert extract_binary is not None
                extract_binary([bin_path], temp_dir, granular_progress=False)

            _stop_poll.set()
            poll_thread.join(timeout=2.0)

            # Delete the .bin immediately after successful extraction — the images
            # are now in temp_dir; the source binary is no longer needed.
            try:
                bin_path.unlink(missing_ok=True)
                logger.info("Deleted .bin after extraction: %s", bin_path.name)
            except OSError as e:
                logger.warning("Could not delete .bin %s: %s", bin_path.name, e)

            final_count = _count_images(temp_dir)
            emit({"event": "complete", "index": idx, "file": bin_path.name,
                  "message": f"Extraction complete: {bin_path.name} ({final_count} images)"})
        except Exception as exc:
            _stop_poll.set()
            poll_thread.join(timeout=2.0)
            with lock:
                errors.append(str(exc))
            # Keep .bin on failure so the user can retry without re-uploading
            emit({"event": "error", "index": idx, "file": bin_path.name,
                  "message": str(exc)})

    try:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = []
            for idx, bin_path in bin_files:
                temp_dir = temp_base / f"file_{idx}"
                temp_dir.mkdir(parents=True, exist_ok=True)
                temp_dirs.append(temp_dir)
                futures.append(pool.submit(_extract_one, idx, bin_path, temp_dir))
            for f in futures:
                f.result()

        if errors:
            raise RuntimeError(
                f"{len(errors)} of {len(bin_files)} extraction(s) failed.\n" + errors[0]
            )

        emit({"event": "progress", "index": -1, "file": "",
              "message": "Merging extraction results…"})
        _merge_docker_results(temp_dirs, output_dir)
        total_images = sum(
            1 for p in output_dir.rglob("*")
            if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png"}
        )
        logger.info("Extraction + merge complete: %d total images in %s", total_images, output_dir)

    finally:
        try:
            shutil.rmtree(temp_base, ignore_errors=True)
        except Exception:
            pass


def _extract_binary_via_docker(
    bin_path: Path,
    output_dir: Path,
    emit: Callable[[dict], None],
) -> None:
    """
    Single-file Docker extraction wrapper (kept for compatibility).
    For batch uploads prefer extract_bin_files_batch().
    """
    _ensure_docker_ready(emit)

    from app.core.db import engine
    from app.crud.app_settings import get_docker_resource_flags
    from sqlmodel import Session as _Session
    with _Session(engine) as _s:
        resource_flags = get_docker_resource_flags(session=_s)
    if resource_flags:
        logger.info("Docker resource limits (bin extractor): %s", " ".join(resource_flags))
    else:
        logger.info("Docker resource limits (bin extractor): none (no limits set)")

    logger.info("Running bin extraction via Docker for %s", bin_path.name)
    emit({"event": "progress", "message": "Running extraction via Docker…"})
    _run_docker_container(bin_path, output_dir, resource_flags)


def extract_bin_file(
    *,
    bin_path: Path,
    output_dir: Path,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
) -> dict[str, Any]:
    """
    Extract images, msgs_synced.csv, and calibration JSON from an Amiga .bin file.

    Output lives in Raw/ (not Intermediate/Processed) — extraction is not a
    processing step, it's making the raw data available.

    On Linux/macOS: uses the farm_ng SDK directly from the Python environment.
    On Windows:     falls back to a Docker container (gemi-bin-extractor image).
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    emit({"event": "start", "message": f"Extracting {bin_path.name}…"})

    extract_binary = _import_extract_binary()

    # GEMI_FORCE_DOCKER=1 bypasses the native import for local Docker testing
    if os.environ.get("GEMI_FORCE_DOCKER") == "1":
        extract_binary = None

    def _delete_bin() -> None:
        """Delete the source .bin file — called after success and on failure."""
        try:
            bin_path.unlink(missing_ok=True)
            logger.info("Deleted .bin file: %s", bin_path.name)
        except OSError as e:
            logger.warning("Could not delete .bin file %s: %s", bin_path.name, e)

    try:
        if extract_binary is not None:
            # Native path — Linux / macOS
            try:
                extract_binary([bin_path], output_dir, granular_progress=True)
            except Exception as exc:
                logger.error("Binary extraction failed for %s: %s", bin_path, exc)
                emit({"event": "error", "message": str(exc)})
                raise

        elif sys.platform == "win32" or os.environ.get("GEMI_FORCE_DOCKER") == "1":
            # Windows fallback — Docker container
            try:
                _extract_binary_via_docker(bin_path, output_dir, emit)
            except RuntimeError as exc:
                logger.error("Docker extraction failed for %s: %s", bin_path, exc)
                emit({"event": "error", "message": str(exc)})
                raise

        else:
            msg = (
                "farm_ng SDK / bin_to_images is not available in this environment.\n"
                "Run: uv pip install farm-ng-amiga kornia kornia_rs\n"
                "bin_to_images is at backend/bin_to_images/ and is found automatically."
            )
            logger.error(msg)
            emit({"event": "error", "message": msg})
            raise RuntimeError(msg)

    except Exception:
        # Keep the .bin file on failure so the user can retry without re-uploading.
        raise

    # Extraction succeeded — raw images are now in output_dir, binary no longer needed.
    _delete_bin()

    # msgs_synced.csv lands at output_dir/RGB/Metadata/msgs_synced.csv
    msgs_synced = output_dir / "RGB" / "Metadata" / "msgs_synced.csv"
    calibration = output_dir / "RGB" / "Metadata" / "top_calibration.json"

    logger.info("Extraction complete: %s → %s", bin_path.name, output_dir)
    emit({"event": "complete", "message": f"Extraction complete: {bin_path.name}"})

    return {
        "msgs_synced": str(msgs_synced) if msgs_synced.exists() else None,
        "calibration": str(calibration) if calibration.exists() else None,
    }
