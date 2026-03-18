"""
Aerial (drone) pipeline step implementations.

Steps
-----
1. gcp_selection    — user marks GCP pixel locations; save gcp_list.txt + geo.txt
2. orthomosaic      — run ODM via Docker to produce RGB.tif + DEM.tif
3. plot_boundaries  — save user-drawn GeoJSON polygons from Leaflet
4. trait_extraction — vegetation fraction, height, temperature per plot
5. inference        — Roboflow on split plot images (optional)
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

import numpy as np
from sqlmodel import Session

from app.core.paths import RunPaths
from app.models.workspace import Workspace

logger = logging.getLogger(__name__)


def _get_paths(session: Session, run_id: uuid.UUID) -> RunPaths:
    from app.models.pipeline import Pipeline, PipelineRun

    run = session.get(PipelineRun, run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline:
        raise ValueError(f"Pipeline {run.pipeline_id} not found")
    workspace = session.get(Workspace, pipeline.workspace_id)
    if not workspace:
        raise ValueError(f"Workspace {pipeline.workspace_id} not found")
    return RunPaths.from_db(session=session, run=run, workspace=workspace)


# ── Step 1: GCP Selection (data persistence only) ─────────────────────────────

def save_gcp_selection(
    *,
    session: Session,
    run_id: uuid.UUID,
    gcp_selections: list[dict[str, Any]],
    image_gps: list[dict[str, Any]],
    gcp_locations_csv: str | None = None,
) -> dict[str, str]:
    """
    Save GCP pixel selections and image GPS list.

    gcp_selections: [
        {"label": "GCP1", "image": "DJI_0001.jpg",
         "pixel_x": 1024, "pixel_y": 768,
         "lat": 33.1, "lon": -111.9, "alt": 380.0},
        ...
    ]

    image_gps: [
        {"image": "DJI_0001.jpg", "lat": 33.1, "lon": -111.9, "alt": 380.0},
        ...
    ]

    gcp_locations_csv: optional raw CSV text if uploaded inline at GCP picker step.
                       Saved to Intermediate/{pipeline}/ and Raw/{pop}/ if absent.
    """
    paths = _get_paths(session, run_id)
    paths.intermediate_run.mkdir(parents=True, exist_ok=True)

    # Save gcp_list.txt (ODM format: EPSG:4326 header, then lon lat alt pixel_x pixel_y image label)
    with open(paths.gcp_list, "w") as f:
        f.write("EPSG:4326\n")
        for sel in gcp_selections:
            f.write(
                f"{sel['lon']} {sel['lat']} {sel['alt']} "
                f"{sel['pixel_x']} {sel['pixel_y']} {sel['image']} {sel['label']}\n"
            )

    # Save geo.txt (ODM format: SRS header on line 1, then image lon lat alt)
    with open(paths.geo_txt, "w") as f:
        f.write("EPSG:4326\n")
        for img in image_gps:
            f.write(f"{img['image']} {img['lon']} {img['lat']} {img['alt']}\n")

    # Save inline gcp_locations.csv if provided
    if gcp_locations_csv:
        gcp_csv_path = paths.gcp_locations_intermediate
        gcp_csv_path.parent.mkdir(parents=True, exist_ok=True)
        gcp_csv_path.write_text(gcp_locations_csv)
        logger.info("Saved inline gcp_locations.csv to %s", gcp_csv_path)

    logger.info("Saved GCP selection for run %s (%d GCPs)", run_id, len(gcp_selections))
    return {
        "gcp_selection": paths.rel(paths.gcp_list),
        "geo_txt": paths.rel(paths.geo_txt),
    }


# ── Step 2: Orthomosaic Generation (ODM via Docker) ───────────────────────────

_ODM_PROGRESS_STAGES = [
    "Running dataset stage",
    "Finished dataset stage",
    "Computing pair matching",
    "Merging features onto tracks",
    "Export reconstruction stats",
    "Finished opensfm stage",
    "Densifying point-cloud completed",
    "Finished openmvs stage",
    "Finished odm_filterpoints stage",
    "Finished mvs_texturing stage",
    "Finished odm_georeferencing stage",
    "Finished odm_dem stage",
    "Finished odm_orthophoto stage",
    "Finished odm_report stage",
    "Finished odm_postprocess stage",
    "ODM app finished",
]


def _check_docker() -> bool:
    return shutil.which("docker") is not None


def _check_gpu() -> bool:
    try:
        result = subprocess.run(["nvidia-smi"], capture_output=True, timeout=5)
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _find_image_dir(paths: RunPaths) -> Path:
    """Drone images are expected in Raw/.../Images/ or Raw/... directly."""
    for candidate in [paths.raw / "Images", paths.raw]:
        if candidate.exists() and any(candidate.glob("*.jpg")):
            return candidate
    return paths.raw / "Images"  # return expected path even if empty


def run_orthomosaic(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
    dem_resolution: float = 3.0,
    orthophoto_resolution: float = 3.0,
    pc_quality: str = "medium",
    feature_quality: str = "high",
    custom_odm_options: str = "",
    name: str | None = None,
) -> dict[str, Any]:
    """
    Run OpenDroneMap via Docker to produce orthomosaic + DEM.

    Reads:
      - Raw/{pop}/{run_seg}/Images/*.jpg  (drone images)
      - Intermediate/{workspace}/{pop}/{run_seg}/gcp_list.txt
      - Intermediate/{workspace}/{pop}/{run_seg}/geo.txt

    Writes:
      - Intermediate/{workspace}/{pop}/{run_seg}/temp/project/  (ODM working dir)
      - Processed/{workspace}/{pop}/{run_seg}/{date}-RGB.tif
      - Processed/{workspace}/{pop}/{run_seg}/{date}-DEM.tif
    """
    if not _check_docker():
        raise RuntimeError("Docker is not installed or not in PATH. ODM requires Docker.")

    paths = _get_paths(session, run_id)

    if not paths.gcp_list.exists():
        raise FileNotFoundError(
            f"gcp_list.txt not found at {paths.gcp_list}. "
            "Complete the GCP Selection step first."
        )

    image_dir = _find_image_dir(paths)

    # ODM project layout: odm_working_dir/project/code/
    # Clear previous ODM working directory on re-run to avoid stale state.
    # Docker runs as root so the dir may be root-owned — fall back to a Docker
    # container to delete it if shutil.rmtree gets a PermissionError.
    if paths.odm_working_dir.exists():
        try:
            shutil.rmtree(paths.odm_working_dir)
        except PermissionError:
            logger.warning("Permission denied removing %s — using Docker to clean up", paths.odm_working_dir)
            subprocess.run(
                ["docker", "run", "--rm",
                 "-v", f"{paths.odm_working_dir}:/target",
                 "alpine", "rm", "-rf", "/target"],
                timeout=60, capture_output=True,
            )
            if paths.odm_working_dir.exists():
                shutil.rmtree(paths.odm_working_dir)
        logger.info("Cleared previous ODM working directory: %s", paths.odm_working_dir)

    odm_project = paths.odm_working_dir / "project"
    odm_code = odm_project / "code"
    odm_code.mkdir(parents=True, exist_ok=True)
    paths.processed_run.mkdir(parents=True, exist_ok=True)

    # Determine next version number from existing run outputs
    from app.models.pipeline import PipelineRun as _PipelineRun
    _run = session.get(_PipelineRun, run_id)
    _existing_orthos = (_run.outputs or {}).get("orthomosaics", []) if _run else []
    # Backward-compat: old flat "orthomosaic" key treated as v1
    if not _existing_orthos and _run and (_run.outputs or {}).get("orthomosaic"):
        _existing_orthos = [{"version": 1}]
    next_version = max((o["version"] for o in _existing_orthos), default=0) + 1

    # Copy gcp_list.txt into the ODM project, patching SRS header if needed
    gcp_dest = odm_code / "gcp_list.txt"
    gcp_lines = paths.gcp_list.read_text().splitlines()
    if len(gcp_lines) >= 2:
        first = gcp_lines[0].strip()
        if first.lower() == "wgs84" or (first and not first.startswith("EPSG:") and not first.startswith("+proj")):
            logger.warning("gcp_list.txt has invalid SRS header '%s' — replacing with EPSG:4326", first)
            gcp_lines[0] = "EPSG:4326"
        gcp_dest.write_text("\n".join(gcp_lines) + "\n")
        logger.info("Copied gcp_list.txt to ODM project")

    geo_dest = odm_code / "geo.txt"
    if paths.geo_txt.exists():
        geo_lines = paths.geo_txt.read_text().splitlines()
        # Ensure first line is a valid SRS header (not an image filename)
        first = geo_lines[0].strip() if geo_lines else ""
        if first and not first.startswith("EPSG:") and first.lower() != "wgs84" and not first.startswith("+proj"):
            logger.warning("geo.txt missing SRS header — prepending EPSG:4326")
            geo_lines.insert(0, "EPSG:4326")
        geo_dest.write_text("\n".join(geo_lines) + "\n")

    # Log file inside project dir (ODM writes its own logs; we create one)
    log_file = odm_code / "logs.txt"
    log_file.write_text("")

    # Host-path translation for Docker-in-Docker (desktop: same path)
    host_data_root = os.environ.get("HOST_DATA_ROOT", str(paths.data_root))
    container_data_root = str(paths.data_root)
    host_project = str(odm_project).replace(container_data_root, host_data_root)
    host_images = str(image_dir).replace(container_data_root, host_data_root)

    # Build ODM options
    # --skip-report avoids a NumPy 2.x / GDAL incompatibility in the ODM
    # report stage that causes a non-fatal crash after the orthomosaic is done.
    odm_options = "--dsm --skip-report"
    if custom_odm_options:
        odm_options += f" {custom_odm_options}"
    else:
        odm_options += (
            f" --dem-resolution {dem_resolution}"
            f" --orthophoto-resolution {orthophoto_resolution}"
            f" --pc-quality {pc_quality}"
            f" --feature-quality {feature_quality}"
        )

    container_name = f"ODM-gemi-{run_id!s:.8}"

    docker_cmd: list[str] = [
        "docker", "run",
        "--name", container_name,
        "-i", "--rm",
        "--security-opt=no-new-privileges",
        "--user", f"{os.getuid()}:{os.getgid()}",
        "-w", "/datasets",
        "-v", f"{host_project}:/datasets:rw",
        "-v", f"{host_images}:/datasets/code/images:ro",
    ]
    # Only mount timezone files if they exist as regular files (not present on all distros)
    from pathlib import Path as _Path
    if _Path("/etc/timezone").is_file():
        docker_cmd += ["-v", "/etc/timezone:/etc/timezone:ro"]
    if _Path("/etc/localtime").exists():
        docker_cmd += ["-v", "/etc/localtime:/etc/localtime:ro"]
    if _check_gpu():
        docker_cmd += ["--gpus", "all", "opendronemap/odm:gpu"]
    else:
        docker_cmd.append("opendronemap/odm")

    docker_cmd += ["--project-path", "/datasets", "code"] + odm_options.split()

    logger.info("Starting ODM: %s", " ".join(docker_cmd))
    emit({"event": "progress", "message": "Starting ODM Docker container…", "progress": 0})

    with open(log_file, "w") as lf:
        proc = subprocess.Popen(docker_cmd, stdout=lf, stderr=subprocess.STDOUT)

    # Monitor log file for progress while ODM runs
    stage_count = len(_ODM_PROGRESS_STAGES)
    current_stage = -1
    log_offset = 0  # byte position — only read new content each cycle

    try:
        while proc.poll() is None:
            if stop_event.is_set():
                proc.terminate()
                try:
                    subprocess.run(["docker", "stop", container_name], timeout=10, capture_output=True)
                except Exception:
                    pass
                return {}

            try:
                with open(log_file, "r", errors="replace") as lf:
                    lf.seek(log_offset)
                    new_text = lf.read()
                    log_offset = lf.tell()

                if new_text:
                    # Emit each new non-empty line as a raw log event
                    for line in new_text.splitlines():
                        line = line.strip()
                        if line:
                            emit({"event": "log", "message": line})

                    # Check for stage transitions in the full log so far
                    full_text = log_file.read_text(errors="replace")
                    for idx, stage in enumerate(_ODM_PROGRESS_STAGES):
                        if stage in full_text and idx > current_stage:
                            current_stage = idx
                            pct = round((idx + 1) / stage_count * 80)
                            emit({"event": "progress", "message": stage, "progress": pct})
            except OSError:
                pass

            time.sleep(10)

        # Flush any remaining log lines written after the last sleep cycle
        # (also catches output from processes that exit immediately)
        try:
            with open(log_file, "r", errors="replace") as lf:
                lf.seek(log_offset)
                remaining = lf.read()
            for line in remaining.splitlines():
                line = line.strip()
                if line:
                    emit({"event": "log", "message": line})
        except OSError:
            pass

        if proc.returncode != 0:
            raise RuntimeError(f"ODM exited with code {proc.returncode}. See raw output above for details.")

    except Exception:
        try:
            subprocess.run(["docker", "rm", "-f", container_name], timeout=5, capture_output=True)
        except Exception:
            pass
        raise

    emit({"event": "progress", "message": "Copying ODM outputs…", "progress": 82})

    # Copy outputs to Processed/
    ortho_src = odm_code / "odm_orthophoto" / "odm_orthophoto.tif"
    dem_src = odm_code / "odm_dem" / "dsm.tif"

    if not ortho_src.exists():
        raise FileNotFoundError(f"ODM orthomosaic not found at {ortho_src}")

    rgb_dest = paths.aerial_rgb_versioned(next_version)
    pyramid_dest = paths.aerial_rgb_pyramid_versioned(next_version)
    dem_dest = paths.aerial_dem_versioned(next_version)

    shutil.copy2(ortho_src, rgb_dest)
    logger.info("Copied orthomosaic → %s", rgb_dest.name)

    emit({"event": "progress", "message": "Generating pyramid (COG)…", "progress": 88})

    pyramid_ok = False
    try:
        import rasterio
        from rasterio.enums import Resampling as _Resampling

        shutil.copy2(ortho_src, pyramid_dest)
        with rasterio.open(pyramid_dest, "r+") as dst:
            dst.build_overviews([2, 4, 8, 16], _Resampling.average)
            dst.update_tags(ns="rio_overview", resampling="average")
        logger.info("Built pyramid → %s", pyramid_dest.name)
        pyramid_ok = True
    except Exception as exc:
        logger.warning("Pyramid generation failed (non-fatal): %s", exc)

    dem_ok = False
    if dem_src.exists():
        shutil.copy2(dem_src, dem_dest)
        logger.info("Copied DEM → %s", dem_dest.name)
        dem_ok = True

    emit({"event": "progress", "message": "Orthomosaic complete.", "progress": 100})

    from datetime import datetime as _dt, timezone as _tz
    new_entry = {
        "version": next_version,
        "name": name,
        "rgb": paths.rel(rgb_dest),
        "dem": paths.rel(dem_dest) if dem_ok else None,
        "pyramid": paths.rel(pyramid_dest) if pyramid_ok else None,
        "created_at": _dt.now(_tz.utc).isoformat(),
    }

    return {
        "_ortho_new_entry": new_entry,
        "active_ortho_version": next_version,
        "odm_log": paths.rel(log_file),
    }


# ── Step 3: Plot Boundaries (data persistence only) ───────────────────────────

def save_plot_boundaries(
    *,
    session: Session,
    run_id: uuid.UUID,
    geojson: dict[str, Any],
    version: int | None = None,
) -> dict[str, str]:
    """
    Save user-drawn plot boundary polygons (from Leaflet) as GeoJSON.

    If version is None, overwrites the canonical Plot-Boundary-WGS84.geojson.
    If version is given, saves as Plot-Boundary-WGS84_v{N}.geojson.
    """
    paths = _get_paths(session, run_id)
    paths.intermediate_year.mkdir(parents=True, exist_ok=True)

    if version is not None:
        target = paths.plot_boundary_geojson_versioned(version)
    else:
        target = paths.plot_boundary_geojson

    with open(target, "w") as f:
        json.dump(geojson, f, indent=2)

    logger.info("Saved plot boundaries to %s", target)
    return {"plot_boundaries": paths.rel(target)}


# ── Step 4: Trait Extraction ──────────────────────────────────────────────────

def _compute_otsu_criteria(im: np.ndarray, th: int) -> float:
    """Otsu criterion for a given threshold on a uint8 array."""
    thresholded = im >= th
    nb = im.size
    nb1 = int(np.count_nonzero(thresholded))
    w1 = nb1 / nb
    w0 = 1.0 - w1
    if w1 == 0 or w0 == 0:
        return float("inf")
    val1 = im[thresholded]
    val0 = im[~thresholded]
    return w0 * float(np.var(val0)) + w1 * float(np.var(val1))


def _calculate_exg_mask(rgb_arr: np.ndarray) -> np.ndarray:
    """
    Compute Excess Green vegetation mask via Otsu thresholding.

    rgb_arr: (H, W, 3) uint8 RGB array.
    Returns uint8 mask (0 = background, 255 = vegetation).
    """
    import cv2

    arr = rgb_arr.astype(np.float32)
    total = arr[:, :, 0] + arr[:, :, 1] + arr[:, :, 2]
    total = np.where(total == 0, 1.0, total)
    ratio = arr / total[:, :, np.newaxis]
    exg = 2 * ratio[:, :, 1] - ratio[:, :, 0] - ratio[:, :, 2]
    exg_norm = cv2.normalize(exg, None, 0, 255, cv2.NORM_MINMAX, cv2.CV_8U)

    criterias = [_compute_otsu_criteria(exg_norm, th) for th in range(int(exg_norm.max()) + 1)]
    best_th = int(np.argmin(criterias))
    mask = (exg_norm > best_th).astype(np.uint8) * 255

    # Morphological closing to fill gaps
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    return mask


def _prop(row: Any, *keys: str) -> Any:
    """Get the first non-None property value from a GeoDataFrame row by trying multiple keys.

    Uses row[k] via the index rather than getattr to avoid returning pandas
    built-in attributes (e.g. row.plot returns the PlotAccessor, not the column value).
    """
    for k in keys:
        try:
            v = row[k] if k in row.index else None
        except Exception:
            v = None
        if v is not None and str(v) not in ("nan", "None", ""):
            return v
    return None


def run_trait_extraction(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
    ortho_version: int | None = None,
    boundary_version: int | None = None,
) -> dict[str, Any]:
    """
    Extract vegetation fraction, height, and temperature per plot.

    Uses rasterio (instead of GDAL/osgeo) to crop the orthomosaic and DEM
    by each plot polygon, then computes per-plot metrics.

    Reads:
      - Processed/{workspace}/{pop}/{run_seg}/{date}-RGB.tif
      - Processed/{workspace}/{pop}/{run_seg}/{date}-DEM.tif  (optional)
      - Intermediate/{workspace}/{pop}/Plot-Boundary-WGS84.geojson

    Writes:
      - Processed/{workspace}/{pop}/{run_seg}/Traits-WGS84.geojson
      - Processed/{workspace}/{pop}/{run_seg}/cropped_images/plot_*.png
    """
    import cv2
    import geopandas as gpd
    import pandas as pd
    import rasterio
    from rasterio.windows import from_bounds as _from_bounds

    from app.models.pipeline import PipelineRun as _PipelineRun
    _run = session.get(_PipelineRun, run_id)
    paths = _get_paths(session, run_id)

    # Resolve orthomosaic path — use specified version or fall back to active
    _outputs = (_run.outputs or {}) if _run else {}
    _orthos = _outputs.get("orthomosaics", [])
    _resolve_v = ortho_version if ortho_version is not None else _outputs.get("active_ortho_version")
    _ortho = next((o for o in _orthos if o["version"] == _resolve_v), None)
    if _ortho:
        aerial_rgb = paths.abs(_ortho["rgb"])
        aerial_dem = paths.abs(_ortho["dem"]) if _ortho.get("dem") else None
    else:
        # Backward-compat: old flat "orthomosaic" key
        _legacy = _outputs.get("orthomosaic")
        aerial_rgb = paths.abs(_legacy) if _legacy else paths.aerial_rgb
        aerial_dem = paths.aerial_dem if paths.aerial_dem.exists() else None

    if not aerial_rgb.exists():
        raise FileNotFoundError(
            f"Orthomosaic not found at {aerial_rgb}. "
            "Complete the Orthomosaic step or select a valid version."
        )

    # Resolve plot boundary GeoJSON — use specified version or fall back to canonical
    _boundary_path = paths.plot_boundary_geojson  # default canonical
    if boundary_version is not None:
        _boundaries = _outputs.get("plot_boundaries", [])
        _bv = next((b for b in _boundaries if b["version"] == boundary_version), None)
        if _bv:
            _boundary_path = paths.abs(_bv["geojson_path"])

    if not _boundary_path.exists():
        raise FileNotFoundError(
            f"Plot boundaries not found at {_boundary_path}. "
            "Complete the Plot Boundaries step first."
        )

    # Compute this TraitRecord's version number early (needed for versioned crop dir)
    from app.models.pipeline import TraitRecord as _TraitRecord_early
    from sqlmodel import func as _func_early, select as _sel_early
    _max_v_early = session.exec(
        _sel_early(_func_early.max(_TraitRecord_early.version)).where(_TraitRecord_early.run_id == run_id)
    ).first()
    _next_version_early = (_max_v_early or 0) + 1

    paths.cropped_images_dir.mkdir(parents=True, exist_ok=True)
    _versioned_crops_dir = paths.cropped_images_versioned(_next_version_early)
    _versioned_crops_dir.mkdir(parents=True, exist_ok=True)

    # Load boundary GeoJSON
    gdf = gpd.read_file(_boundary_path)
    n_plots = len(gdf)
    emit({"event": "progress", "message": f"Extracting traits for {n_plots} plots…",
          "total": n_plots, "progress": 0})

    has_dem = aerial_dem is not None and aerial_dem.exists()
    records: list[dict] = []

    with rasterio.open(aerial_rgb) as rgb_src:
        # Reproject boundaries to raster CRS
        if gdf.crs is None:
            gdf = gdf.set_crs("EPSG:4326")
        if gdf.crs != rgb_src.crs:
            gdf_raster = gdf.to_crs(rgb_src.crs)
        else:
            gdf_raster = gdf

        dem_src = rasterio.open(aerial_dem) if has_dem else None
        if dem_src is not None and dem_src.crs != rgb_src.crs:
            gdf_dem = gdf.to_crs(dem_src.crs)
        elif dem_src is not None:
            gdf_dem = gdf_raster
        else:
            gdf_dem = None

        try:
            for i, (_, row) in enumerate(gdf_raster.iterrows()):
                if stop_event.is_set():
                    break

                orig_row = gdf.iloc[i]
                geom = row.geometry
                if geom is None or geom.is_empty:
                    continue

                bounds = geom.bounds  # (minx, miny, maxx, maxy)
                window = _from_bounds(*bounds, rgb_src.transform)

                # Crop RGB
                rgb_data = rgb_src.read([1, 2, 3], window=window, boundless=True, fill_value=0)
                rgb_arr = np.transpose(rgb_data, (1, 2, 0))  # (H, W, 3) RGB

                if rgb_arr.size == 0 or rgb_arr.shape[0] == 0 or rgb_arr.shape[1] == 0:
                    continue

                # Vegetation fraction
                mask = _calculate_exg_mask(rgb_arr)
                vf = round(float(np.sum(mask > 0)) / mask.size, 4)

                # Canopy height from DEM
                height_m: float | None = None
                if dem_src is not None and gdf_dem is not None:
                    dem_row = gdf_dem.iloc[i]
                    dem_bounds = dem_row.geometry.bounds
                    dem_window = _from_bounds(*dem_bounds, dem_src.transform)
                    dem_data = dem_src.read(1, window=dem_window, boundless=True, fill_value=0)
                    if dem_data.size > 0:
                        # Resize mask to match DEM crop
                        dm = cv2.resize(mask, (dem_data.shape[1], dem_data.shape[0]))
                        dem_vals = dem_data[dm > 0]
                        if len(dem_vals) > 0:
                            height_m = round(
                                float(np.quantile(dem_vals, 0.95)) - float(np.quantile(dem_vals, 0.05)),
                                4,
                            )

                # Derive plot ID and labels from GeoJSON properties
                plot_id = (
                    _prop(orig_row, "Plot", "plot", "plot_id")
                    or _prop(orig_row, "id", "ID")
                    or str(i)
                )
                bed = _prop(orig_row, "Bed", "bed", "column", "col")
                tier = _prop(orig_row, "Tier", "tier", "row")
                label = _prop(orig_row, "Label", "label", "accession", "Accession")

                # Save cropped image to both canonical dir (backward compat) and versioned dir
                bgr = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR)
                crop_path = paths.cropped_images_dir / f"plot_{plot_id}.png"
                cv2.imwrite(str(crop_path), bgr)
                cv2.imwrite(str(_versioned_crops_dir / f"plot_{plot_id}.png"), bgr)

                record: dict[str, Any] = {
                    "plot_id": plot_id,
                    "Bed": bed,
                    "Tier": tier,
                    "Label": label,
                    "Vegetation_Fraction": vf,
                }
                if height_m is not None:
                    record["Height_95p_meters"] = height_m

                records.append(record)

                pct = round((i + 1) / n_plots * 100)
                emit({"event": "progress", "index": i, "total": n_plots,
                      "progress": pct,
                      "message": f"Plot {plot_id}: VF={vf:.3f}"
                                 + (f", H={height_m:.3f}m" if height_m is not None else "")})

        finally:
            if dem_src is not None:
                dem_src.close()

    if not records:
        raise RuntimeError("No plot traits could be extracted. Check plot boundaries and orthomosaic overlap.")

    # Merge traits back into GeoJSON features
    df_traits = pd.DataFrame(records)
    gdf_out = gdf.copy()

    for col in ["Vegetation_Fraction", "Height_95p_meters"]:
        if col in df_traits.columns:
            gdf_out[col] = df_traits[col].values

    gdf_out.to_file(str(paths.traits_geojson), driver="GeoJSON")
    logger.info("Wrote Traits-WGS84.geojson (%d plots)", len(records))

    # ── Compute summary stats ─────────────────────────────────────────────
    vf_values = [r["Vegetation_Fraction"] for r in records if "Vegetation_Fraction" in r]
    vf_avg = round(float(np.mean(vf_values)), 4) if vf_values else None
    h_values = [r["Height_95p_meters"] for r in records if "Height_95p_meters" in r]
    height_avg = round(float(np.mean(h_values)), 4) if h_values else None
    trait_cols = [c for c in df_traits.columns if c not in ("plot_id",)]

    # Resolve boundary version + name used
    _resolved_boundary_v: int | None = None
    _resolved_boundary_name: str | None = None
    if boundary_version is not None:
        _boundaries_list = (_run.outputs or {}).get("plot_boundaries", []) if _run else []
        _matched_bv = next((b for b in _boundaries_list if b["version"] == boundary_version), None)
        if _matched_bv:
            _resolved_boundary_v = boundary_version
            _resolved_boundary_name = _matched_bv.get("name")

    # Resolve ortho version + name used
    _resolved_ortho_v = ortho_version if ortho_version is not None else _resolve_v
    _resolved_ortho_name = _ortho.get("name") if _ortho else None

    # ── Create provenance record ──────────────────────────────────────────
    from app.models.pipeline import TraitRecord as _TraitRecord
    # Use the pre-computed version (_next_version_early) — consistent with versioned crop dir
    _trait_record = _TraitRecord(
        run_id=run_id,
        version=_next_version_early,
        geojson_path=paths.rel(paths.traits_geojson),
        ortho_version=_resolved_ortho_v,
        ortho_name=_resolved_ortho_name,
        boundary_version=_resolved_boundary_v,
        boundary_name=_resolved_boundary_name,
        plot_count=len(records),
        trait_columns=list(trait_cols),
        vf_avg=vf_avg,
        height_avg=height_avg,
    )
    session.add(_trait_record)
    session.commit()
    logger.info("Created TraitRecord v%d (%d plots, ortho v%s)", _next_version_early, len(records), _resolved_ortho_v)

    return {
        "traits": paths.rel(paths.traits_geojson),
        "cropped_images": paths.rel(paths.cropped_images_dir),
        f"cropped_images_v{_next_version_early}": paths.rel(_versioned_crops_dir),
    }


# ── On-demand plot cropping ────────────────────────────────────────────────────

def crop_plots_to_stream(
    *,
    ortho_path: Path,
    boundary_path: Path,
) -> list[tuple[str, bytes]]:
    """
    Crop the orthomosaic by each plot polygon in the boundary GeoJSON.
    Returns a list of (filename, image_bytes) tuples for ZIP streaming.
    Does not write any files to disk.
    """
    import cv2
    import geopandas as gpd
    import rasterio
    from rasterio.windows import from_bounds as _from_bounds

    gdf = gpd.read_file(boundary_path)
    results: list[tuple[str, bytes]] = []

    with rasterio.open(ortho_path) as rgb_src:
        if gdf.crs is None:
            gdf = gdf.set_crs("EPSG:4326")
        if gdf.crs != rgb_src.crs:
            gdf = gdf.to_crs(rgb_src.crs)

        for i, (_, row) in enumerate(gdf.iterrows()):
            geom = row.geometry
            if geom is None or geom.is_empty:
                continue
            bounds = geom.bounds
            window = _from_bounds(*bounds, rgb_src.transform)
            rgb_data = rgb_src.read([1, 2, 3], window=window, boundless=True, fill_value=0)
            rgb_arr = np.transpose(rgb_data, (1, 2, 0))
            if rgb_arr.size == 0 or rgb_arr.shape[0] == 0 or rgb_arr.shape[1] == 0:
                continue

            # Derive plot ID from properties
            orig_row = gdf.iloc[i]
            plot_id = (
                _prop(orig_row, "Plot", "plot", "plot_id")
                or _prop(orig_row, "id", "ID")
                or str(i)
            )

            bgr = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR)
            ok, buf = cv2.imencode(".png", bgr)
            if ok:
                results.append((f"plot_{plot_id}.png", buf.tobytes()))

    return results


# ── Step 5: Inference (Roboflow) ─────────────────────────────────────────────

def run_inference(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
    models: list[dict],
    trait_version: int | None = None,
    inference_mode: str = "cloud",
    local_server_url: str | None = None,
) -> dict[str, Any]:
    """
    Run Roboflow inference on split plot images using one or more model configs.

    trait_version: which TraitRecord version's cropped_images_v{N}/ to run inference on.
                   If not specified, falls back to the latest cropped_images/ directory.
                   Stored in inference result metadata to link back to the ortho + boundary used.

    Each completed model run is appended as an entry in run.outputs["inference"] (list format).
    """
    import csv as _csv
    from app.processing.inference_utils import run_inference_on_image, merge_inference_into_geojson
    from app.crud.pipeline import update_pipeline_run
    from app.models.pipeline import PipelineRunUpdate, PipelineRun as _PipelineRun
    from datetime import datetime, timezone

    if not models:
        raise ValueError("No inference models provided.")

    paths = _get_paths(session, run_id)
    run = session.get(_PipelineRun, run_id)
    outputs = dict(run.outputs or {}) if run else {}

    # Resolve which crop directory to use
    if trait_version is not None:
        crops_dir = paths.cropped_images_versioned(trait_version)
        if not crops_dir.exists():
            # Fall back to canonical if versioned dir missing (e.g. old run before versioning)
            crops_dir = paths.cropped_images_dir
    else:
        crops_dir = paths.cropped_images_dir
        # Infer the active trait version from the latest versioned dir
        if trait_version is None:
            from app.models.pipeline import TraitRecord as _TR
            from sqlmodel import func as _func, select as _sel
            trait_version = session.exec(
                _sel(_func.max(_TR.version)).where(_TR.run_id == run_id)
            ).first()

    if not crops_dir.exists() or not any(crops_dir.glob("*.png")):
        raise FileNotFoundError(
            f"No cropped plot images found in {crops_dir}. "
            "Complete the Trait Extraction step first."
        )

    plot_images = sorted(crops_dir.glob("*.png"))

    # Load Traits GeoJSON for plot metadata (plot_id → label, bed, tier)
    plot_meta: dict[str, dict] = {}
    traits_geojson_path: Path | None = None
    if trait_version is not None:
        from app.models.pipeline import TraitRecord as _TR2
        from sqlmodel import select as _sel2
        _tr = session.exec(
            _sel2(_TR2).where(_TR2.run_id == run_id, _TR2.version == trait_version)
        ).first()
        if _tr and _tr.geojson_path:
            traits_geojson_path = paths.abs(_tr.geojson_path)
    if traits_geojson_path is None:
        # Fallback to canonical traits geojson
        if paths.traits_geojson.exists():
            traits_geojson_path = paths.traits_geojson
    if traits_geojson_path and traits_geojson_path.exists():
        with open(traits_geojson_path) as _gf:
            _gj = json.load(_gf)
        for _feat in _gj.get("features", []):
            _props = _feat.get("properties") or {}
            _pid = str(
                _props.get("Plot") or _props.get("plot") or _props.get("plot_id") or ""
            )
            if _pid:
                plot_meta[_pid] = {
                    "plot_label": _pid,
                    "accession": str(_props.get("Label") or _props.get("label") or _props.get("Accession") or ""),
                    "row": str(_props.get("Tier") or _props.get("tier") or _props.get("row") or ""),
                    "col": str(_props.get("Bed") or _props.get("bed") or _props.get("col") or ""),
                }
        logger.info("Loaded plot metadata: %d plots from %s", len(plot_meta), traits_geojson_path.name)

    def _get_plot_id_from_png(img_path: Path) -> str:
        """Extract plot_id from plot_{plot_id}.png"""
        stem = img_path.stem  # "plot_ABC123" or "plot_5"
        if stem.startswith("plot_"):
            return stem[len("plot_"):]
        return stem

    # Normalise existing inference to list format
    existing_inference = outputs.get("inference", [])
    if isinstance(existing_inference, dict):
        existing_inference = [
            {"label": lbl, "csv_path": rel, "trait_version": None, "created_at": None}
            for lbl, rel in existing_inference.items()
        ]

    fieldnames = ["image", "plot_id", "plot_label", "accession", "row", "col", "model_id",
                  "class", "confidence", "x", "y", "width", "height", "points"]
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
                f"(trait v{trait_version}) — model: {model_id}, key: {masked_key}"
            ),
            "total": global_total,
            "done": global_done,
        })

        safe_label = "".join(c if c.isalnum() or c in "-_" else "_" for c in label)
        predictions_path = paths.processed_run / f"roboflow_predictions_{safe_label}.csv"
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
            plot_id = _get_plot_id_from_png(img)
            meta = plot_meta.get(plot_id, {})
            import json as _json2
            for p in preds:
                p["image"] = img.name
                p["plot_id"] = plot_id
                p["plot_label"] = meta.get("plot_label", plot_id)
                p["accession"] = meta.get("accession", "")
                p["row"] = meta.get("row", "")
                p["col"] = meta.get("col", "")
                p["model_id"] = model_id
                p["points"] = _json2.dumps(p["points"]) if p.get("points") else ""
            all_rows.extend(preds)

        with open(predictions_path, "w", newline="") as f:
            writer = _csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
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

        # Merge detection counts into Traits GeoJSON
        if traits_geojson_path and traits_geojson_path.exists():
            merge_inference_into_geojson(
                traits_geojson_path, all_rows, model_label=label,
                plot_id_field="plot_id", feature_match_prop="Plot",
            )

        new_entries.append({
            "label": label,
            "csv_path": paths.rel(predictions_path),
            "trait_version": trait_version,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    if new_entries:
        new_labels = {e["label"] for e in new_entries}
        existing_inference = [e for e in existing_inference if e.get("label") not in new_labels]
        existing_inference.extend(new_entries)
        outputs["inference"] = existing_inference
        run = session.get(_PipelineRun, run_id)
        update_pipeline_run(session=session, db_run=run, run_in=PipelineRunUpdate(outputs=outputs))

    return {}
