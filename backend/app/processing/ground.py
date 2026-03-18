"""
Ground-based (Amiga) pipeline step implementations.

Each function follows the runner contract:
    fn(session, run_id, stop_event, emit, **kwargs) -> dict[str, Any]

The returned dict is merged into PipelineRun.outputs using relative paths
(relative to data_root) via RunPaths.rel().

Steps
-----
1. plot_marking   — save user's start/end image selections → plot_borders.csv
2. stitching      — run AgRowStitch on marked images
3. georeferencing — GPS-based georeferencing of stitched plots
4. inference      — Roboflow detection/segmentation (optional)

Binary extraction (step 0) is triggered at upload time, not here.
"""

from __future__ import annotations

import csv
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
    ]
    for p in candidates:
        if p and (p / "AgRowStitch.py").exists():
            return p
    return None


def _import_agrowstitch():
    """Import and return the AgRowStitch run() function, or None if not found."""
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
        img_col = next((c for c in df.columns if "file" in c.lower()), None)

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

    # Map UI device names to AgRowStitch device strings
    ui_device = pipeline_cfg.get("device", "cpu")
    if ui_device == "gpu":
        agrowstitch_device = "cuda"
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

    if not paths.plot_borders.exists():
        raise FileNotFoundError(
            f"plot_borders.csv not found at {paths.plot_borders}. "
            "Complete the Plot Marking step first."
        )

    out_dir = paths.agrowstitch_dir(agrowstitch_version)
    out_dir.mkdir(parents=True, exist_ok=True)

    images_dir = _find_images_dir(paths)
    msgs_path = _find_msgs_synced(paths)

    with open(paths.plot_borders) as f:
        plots = list(csv.DictReader(f))

    emit(
        {
            "event": "progress",
            "message": f"Stitching {len(plots)} plots…",
            "total": len(plots),
        }
    )

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

    # Load msgs_synced for image filtering
    msgs_df = None
    if msgs_path and msgs_path.exists():
        msgs_df = pd.read_csv(msgs_path)

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

        # Gather images for this plot
        plot_temp_dir = tempfile.mkdtemp(prefix=f"agrows_plot{plot_id}_")
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
                rgb_col = next(
                    (
                        c
                        for c in msgs_df.columns
                        if "top" in c.lower() and "file" in c.lower()
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
                                shutil.copy2(src, Path(plot_temp_dir) / basename)
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

            # Build config
            config = dict(base_config)
            config["image_directory"] = plot_temp_dir
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
            _python = str(_agrows_venv_python) if _agrows_venv_python.exists() else sys.executable
            emit({"event": "progress", "message": f"Using Python: {_python}"})

            # A direct function call blocks the thread with no way to interrupt it.
            script = (
                f"import sys; sys.path.insert(0, {str(agrowstitch_dir)!r}); "
                f"from AgRowStitch import run; "
                f"r = run({tmp_config!r}, {cpu_count}); "
                f"[None for _ in r] if hasattr(r, '__iter__') and not isinstance(r, (str, bytes)) else None"
            )
            proc = subprocess.Popen(
                [_python, "-c", script],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
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
                        _vram_stop.set()
                        vram_thread.join(timeout=2)
                        return {}
                    time.sleep(0.3)
                _vram_stop.set()
                vram_thread.join(timeout=2)
                drain_thread.join(timeout=5)
                if proc.returncode != 0:
                    code = proc.returncode
                    # Negative codes are Unix signals (e.g. -11 = SIGSEGV)
                    if code < 0:
                        import signal as _signal

                        try:
                            sig_name = _signal.Signals(-code).name
                        except ValueError:
                            sig_name = f"signal {-code}"
                        if code == -11:
                            tail = "\n".join(f"  {l}" for l in _last_lines[-5:]) if _last_lines else "  (no output)"
                            hint = f"AgRowStitch crashed with {sig_name}.\n\nLast output:\n{tail}"
                        else:
                            hint = f"AgRowStitch was killed by {sig_name} (exit code {code})."
                        raise RuntimeError(hint)
                    raise RuntimeError(f"AgRowStitch exited with code {code}")
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
                    "[Plot %s] No stitched output found in %s", plot_id, plot_temp_dir
                )

        finally:
            shutil.rmtree(plot_temp_dir, ignore_errors=True)

    emit(
        {
            "event": "progress",
            "progress": 100,
            "message": f"Stitching complete — {len(plots)} plot(s) processed",
        }
    )

    # Build stored config (drop temp runtime keys)
    stored_config = dict(base_config)
    stored_config.pop("image_directory", None)

    from datetime import datetime, timezone as _tz
    return {
        "_stitch_new_entry": {
            "version": agrowstitch_version,
            "name": name,
            "dir": paths.rel(out_dir),
            "config": stored_config,
            "plot_count": len(plots),
            "created_at": datetime.now(_tz.utc).isoformat(),
        },
        "stitching_version": agrowstitch_version,
    }


# ── Step 3: Georeferencing ────────────────────────────────────────────────────


def run_georeferencing(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
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

    # Determine the image filename column
    rgb_col = "/top/rgb_file" if "/top/rgb_file" in msgs_df.columns else None
    if rgb_col is None and "rgb_file" in msgs_df.columns:
        rgb_col = "rgb_file"

    # Load plot borders for direction info
    plot_directions: dict[str, str] = {}
    if paths.plot_borders.exists():
        with open(paths.plot_borders) as f:
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
        if rgb_col and paths.plot_borders.exists():
            with open(paths.plot_borders) as f:
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
        plot_borders_csv=paths.plot_borders if paths.plot_borders.exists() else None,
    )

    outputs: dict = {"georeferencing": paths.rel(out_dir)}
    if geojson_path:
        outputs["plot_boundaries_geojson"] = paths.rel(geojson_path)
        # Copy to canonical location and auto-complete plot_boundary_prep so the
        # user can open the tool to review/adjust without having to redo it.
        import shutil as _shutil
        _shutil.copy2(str(geojson_path), str(paths.plot_boundary_geojson))
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

    return {}


# ── Binary extraction (.bin → images) ────────────────────────────────────────
# Called from the upload endpoint when .bin files are detected.
# Runs as a background task; progress tracked via the same SSE mechanism.


def _import_extract_binary():
    """
    Try to import extract_binary from the bin_to_images package (farm-ng-amiga SDK).

    Looks in (priority order):
      1. Installed package (pip install -e vendor/bin_to_images in build.sh)
      2. BIN_TO_IMAGES_PATH environment variable (dev override)
      3. vendor/bin_to_images relative to the backend root
    """
    try:
        from bin_to_images.bin_to_images import extract_binary  # type: ignore

        return extract_binary
    except ImportError:
        pass
    try:
        from bin_to_images import extract_binary  # type: ignore

        return extract_binary
    except ImportError:
        pass

    # Fallback: path-based lookup for development environments
    fallback_paths = [
        os.environ.get("BIN_TO_IMAGES_PATH"),
        str(Path(__file__).parent.parent.parent / "vendor" / "bin_to_images"),
        str(Path(__file__).parent.parent.parent.parent / "bin_to_images"),
    ]
    for p in fallback_paths:
        if p and Path(p).exists() and p not in sys.path:
            sys.path.insert(0, p)
            try:
                from bin_to_images.bin_to_images import extract_binary  # type: ignore

                return extract_binary
            except ImportError:
                continue

    return None


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

    Requires the farm_ng SDK (bin_to_images package).
    Set BIN_TO_IMAGES_PATH to the path containing bin_to_images/bin_to_images.py.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    emit({"event": "start", "message": f"Extracting {bin_path.name}…"})

    extract_binary = _import_extract_binary()
    if extract_binary is None:
        msg = (
            "farm_ng SDK / bin_to_images not available. "
            "Clone the bin_to_images module and set BIN_TO_IMAGES_PATH."
        )
        logger.error(msg)
        emit({"event": "error", "message": msg})
        raise RuntimeError(msg)

    try:
        extract_binary([bin_path], output_dir, granular_progress=True)
    except Exception as exc:
        logger.error("Binary extraction failed for %s: %s", bin_path, exc)
        emit({"event": "error", "message": str(exc)})
        raise

    # msgs_synced.csv lands at output_dir/RGB/Metadata/msgs_synced.csv
    msgs_synced = output_dir / "RGB" / "Metadata" / "msgs_synced.csv"
    calibration = output_dir / "RGB" / "Metadata" / "top_calibration.json"

    logger.info("Extraction complete: %s → %s", bin_path.name, output_dir)
    emit({"event": "complete", "message": f"Extraction complete: {bin_path.name}"})

    return {
        "msgs_synced": str(msgs_synced) if msgs_synced.exists() else None,
        "calibration": str(calibration) if calibration.exists() else None,
    }
