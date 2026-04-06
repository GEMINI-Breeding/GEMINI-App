"""
Processing action endpoints for PipelineRuns.

Routes
------
POST /pipeline-runs/{id}/execute-step    trigger a compute step
POST /pipeline-runs/{id}/stop            cancel running step
GET  /pipeline-runs/{id}/progress        SSE stream
GET  /pipeline-runs/{id}/outputs         list output files

Ground-specific:
POST /pipeline-runs/{id}/plot-marking        save image selections
GET  /pipeline-runs/{id}/images              list raw images for marking
POST /pipeline-runs/{id}/apply-boundaries    copy plot_borders to new run

Aerial-specific:
POST /pipeline-runs/{id}/gcp-selection       save GCP pixel coords
POST /pipeline-runs/{id}/plot-boundaries     save drawn GeoJSON polygons

Shared:
POST /pipeline-runs/{id}/inference           trigger Roboflow (both types)
POST /pipeline-runs/{id}/download-crops      serve cropped images as ZIP
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.core.paths import RunPaths
from app.crud.pipeline import get_pipeline_run, get_pipeline
from app.crud.pipeline import update_pipeline_run
from app.models.pipeline import Pipeline, PipelineRun, PipelineRunUpdate
from app.models.workspace import Workspace
from app.processing import runner

logger = logging.getLogger(__name__)
router = APIRouter(tags=["processing"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_run_or_404(session: Session, run_id: uuid.UUID) -> PipelineRun:
    run = get_pipeline_run(session=session, id=run_id)
    if not run:
        raise HTTPException(status_code=404, detail="PipelineRun not found")
    return run


def _get_paths(session: Session, run: PipelineRun) -> RunPaths:
    pipeline = session.get(Pipeline, run.pipeline_id)
    workspace = session.get(Workspace, pipeline.workspace_id)
    return RunPaths.from_db(session=session, run=run, workspace=workspace)


def _get_active_ortho_tif(paths: RunPaths, outputs: dict) -> Path | None:
    """
    Return the active orthomosaic TIF path (pyramid preferred, falls back to RGB).
    Handles both the new versioned format and the old flat-key format.
    """
    active_version = outputs.get("active_ortho_version")
    orthos = outputs.get("orthomosaics", [])
    active = next((o for o in orthos if o["version"] == active_version), None)
    if active:
        for key in ("pyramid", "rgb"):
            rel = active.get(key)
            if rel:
                p = paths.abs(rel)
                if p.exists():
                    return p
    # Backward-compat: old flat keys / unversioned files
    for candidate in (paths.aerial_rgb_pyramid, paths.aerial_rgb):
        if candidate.exists():
            return candidate
    return None


# ── Data sync helpers ─────────────────────────────────────────────────────────

def _resolve_sync_step(body: "ExecuteStepRequest", sync_module: Any) -> tuple[Any, dict]:
    """Return (step_fn, kwargs) for the data_sync step based on sync_mode."""
    if body.sync_mode == "cross_sensor":
        if not body.sync_source_run_id:
            raise HTTPException(
                status_code=400,
                detail="sync_source_run_id is required when sync_mode is 'cross_sensor'",
            )
        return sync_module.run_cross_sensor_sync, {
            "source_run_id": body.sync_source_run_id,
            "max_extrapolation_sec": body.sync_max_extrapolation_sec,
        }
    return sync_module.run_data_sync, {}


@router.get("/pipeline-runs/{id}/available-sync-sources")
def available_sync_sources(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> list[dict[str, Any]]:
    """
    Return all runs in the same workspace whose msgs_synced.csv has both
    a timestamp column and GPS data — usable as cross-sensor sync sources.
    The requesting run itself is excluded.
    """
    import pandas as pd
    from sqlmodel import select as _sel

    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    workspace = session.get(Workspace, pipeline.workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # All runs in this workspace
    all_pipelines = session.exec(
        _sel(Pipeline).where(Pipeline.workspace_id == pipeline.workspace_id)
    ).all()
    pipeline_ids = {p.id for p in all_pipelines}

    all_runs = session.exec(
        _sel(PipelineRun).where(PipelineRun.pipeline_id.in_(pipeline_ids))  # type: ignore[attr-defined]
    ).all()

    pipeline_map = {p.id: p for p in all_pipelines}
    results: list[dict[str, Any]] = []

    from app.models.file_upload import FileUpload as _FU
    from app.core.config import settings as _cfg
    from app.crud.app_settings import get_setting as _gs

    data_root = Path(_gs(session=session, key="data_root") or _cfg.APP_DATA_ROOT)

    def _find_gps_file(r: PipelineRun) -> "Path | None":
        """Return the best available GPS file for a run (Intermediate or bundled Raw)."""
        r_paths = RunPaths.from_db(session=session, run=r, workspace=workspace)
        # 1. Intermediate msgs_synced (produced by a previous Data Sync)
        if r_paths.msgs_synced.exists():
            return r_paths.msgs_synced
        # 2. Bundled GPS from FileUpload record (Farm-ng binary uploads)
        fu = session.exec(
            _sel(_FU).where(
                _FU.experiment == r.experiment,
                _FU.location == r.location,
                _FU.population == r.population,
                _FU.date == r.date,
                _FU.platform == r.platform,
                _FU.sensor == r.sensor,
                _FU.msgs_synced_path.isnot(None),  # type: ignore[attr-defined]
            )
        ).first()
        if fu and fu.msgs_synced_path:
            candidate = data_root / fu.msgs_synced_path
            if candidate.exists():
                return candidate
        # 3. Scan Raw upload dir for any Metadata/msgs_synced.csv
        for candidate in r_paths.raw.rglob("Metadata/msgs_synced.csv"):
            return candidate
        return None

    for r in all_runs:
        if r.id == id:
            continue

        r_pipeline = pipeline_map.get(r.pipeline_id)
        if not r_pipeline:
            continue

        gps_file = _find_gps_file(r)
        if gps_file is None:
            continue

        # Normalise column names then check for timestamp + GPS with actual data.
        # Importing here to avoid circular imports at module load time.
        try:
            from app.processing.sync import _normalise_msgs_synced_columns as _norm
            df = _norm(pd.read_csv(gps_file, nrows=10))
            has_ts = "timestamp" in df.columns and df["timestamp"].notna().any()
            has_gps = (
                "lat" in df.columns and "lon" in df.columns
                and df["lat"].notna().any() and df["lon"].notna().any()
            )
            if not has_ts or not has_gps:
                continue
            total_rows = sum(1 for _ in open(gps_file)) - 1
        except Exception:
            continue

        results.append({
            "run_id": str(r.id),
            "pipeline_id": str(r.pipeline_id),
            "pipeline_name": r_pipeline.name,
            "pipeline_type": r_pipeline.type,
            "date": r.date,
            "experiment": r.experiment,
            "location": r.location,
            "population": r.population,
            "platform": r.platform,
            "sensor": r.sensor,
            "gps_record_count": total_rows,
            "gps_source": "bundled" if "Metadata" in str(gps_file) and "Intermediate" not in str(gps_file) else "synced",
        })

    return results


# ── Execute step ──────────────────────────────────────────────────────────────

GROUND_COMPUTE_STEPS = {"stitching", "georeferencing", "associate_boundaries"}
AERIAL_COMPUTE_STEPS = {"orthomosaic", "trait_extraction"}
SHARED_COMPUTE_STEPS = {"inference"}


class ModelConfig(BaseModel):
    label: str
    roboflow_api_key: str
    roboflow_model_id: str
    task_type: str = "detection"


class ExecuteStepRequest(BaseModel):
    step: str
    # Multi-model inference config
    models: list[ModelConfig] = []
    # Stitching run name (ground only, optional)
    stitch_name: str | None = None
    plot_marking_version: int | None = None
    # Orthomosaic run name (aerial only, optional)
    ortho_name: str | None = None
    # Trait extraction / association version overrides
    ortho_version: int | None = None
    boundary_version: int | None = None
    exg_threshold: float = 0.1  # ExG vegetation threshold for trait extraction
    stitch_version: int | None = None
    association_version: int | None = None
    trait_version: int | None = None
    # Inference mode
    inference_mode: str = "cloud"
    local_server_url: str | None = None
    # Data sync mode: "own_metadata" (default) or "cross_sensor"
    sync_mode: str = "own_metadata"
    sync_source_run_id: str | None = None  # required when sync_mode == "cross_sensor"
    sync_max_extrapolation_sec: float = 30.0  # threshold for out-of-range fallback


@router.post("/pipeline-runs/{id}/execute-step")
def execute_step(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: ExecuteStepRequest,
) -> dict[str, str]:
    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)

    if run.status == "running":
        raise HTTPException(status_code=409, detail="A step is already running")

    step = body.step
    ptype = pipeline.type if pipeline else "ground"

    # Resolve step function
    if ptype == "ground":
        from app.processing import ground, plot_boundary, sync
        _sync_fn, _sync_kwargs = _resolve_sync_step(body, sync)
        dispatch: dict[str, Any] = {
            "data_sync": (_sync_fn, _sync_kwargs),
            "stitching": (
                ground.run_stitching,
                {
                    "name": body.stitch_name,
                    # Resolve plot marking version: explicit selection wins; otherwise fall back
                    # to the active version stored in run.outputs so the canonical plot_borders.csv
                    # (which may be stale) is never silently used when versioned files exist.
                    "plot_marking_version": (
                        body.plot_marking_version
                        if body.plot_marking_version is not None
                        else (run.outputs or {}).get("active_plot_marking_version")
                    ),
                },
            ),
            "associate_boundaries": (
                plot_boundary.run_associate_boundaries,
                {
                    "stitch_version": body.stitch_version,
                    "boundary_version": body.boundary_version,
                },
            ),
            "inference": (
                ground.run_inference,
                {
                    "models": [m.model_dump() for m in body.models],
                    "stitch_version": body.stitch_version,
                    "association_version": body.association_version,
                    "inference_mode": body.inference_mode,
                    "local_server_url": body.local_server_url,
                },
            ),
        }
    else:
        from app.processing import aerial, sync
        _sync_fn, _sync_kwargs = _resolve_sync_step(body, sync)
        dispatch = {
            "data_sync": (_sync_fn, _sync_kwargs),
            "orthomosaic": (
                aerial.run_orthomosaic,
                {
                    "dem_resolution": float(
                        (pipeline.config or {}).get("dem_resolution", 3.0)
                    ),
                    "orthophoto_resolution": float(
                        (pipeline.config or {}).get("orthophoto_resolution", 3.0)
                    ),
                    "pc_quality": (pipeline.config or {}).get("pc_quality", "medium"),
                    "feature_quality": (pipeline.config or {}).get("feature_quality", "high"),
                    "custom_odm_options": (pipeline.config or {}).get("custom_odm_options", ""),
                    "name": body.ortho_name,
                },
            ),
            "trait_extraction": (
                aerial.run_trait_extraction,
                {
                    "ortho_version": body.ortho_version,
                    "boundary_version": body.boundary_version,
                    "exg_threshold": body.exg_threshold,
                },
            ),
            "inference": (
                aerial.run_inference,
                {
                    "models": [m.model_dump() for m in body.models],
                    "trait_version": body.trait_version,
                    "inference_mode": body.inference_mode,
                    "local_server_url": body.local_server_url,
                },
            ),
        }

    if step not in dispatch:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown or non-executable step '{step}' for {ptype} pipeline",
        )

    step_fn, kwargs = dispatch[step]
    runner.run_step_in_background(
        run_id=id,
        step=step,
        step_fn=step_fn,
        step_fn_kwargs=kwargs,
    )
    return {"status": "started", "step": step}


# ── Stop running step ─────────────────────────────────────────────────────────

@router.post("/pipeline-runs/{id}/stop")
def stop_step(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, str]:
    was_running = runner.request_stop(str(id))
    if not was_running:
        raise HTTPException(status_code=404, detail="No running step found for this run")
    return {"status": "stop_requested"}


# ── SSE progress stream ───────────────────────────────────────────────────────

@router.get("/pipeline-runs/{id}/progress")
def progress_stream(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    offset: int = 0,
) -> StreamingResponse:
    _get_run_or_404(session, id)
    return StreamingResponse(
        runner.sse_stream(str(id), offset=offset),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Outputs listing ───────────────────────────────────────────────────────────

@router.get("/pipeline-runs/{id}/outputs")
def list_outputs(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, Any]:
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    # Resolve stored relative paths back to absolute and verify they exist
    resolved: dict[str, Any] = {}
    for key, rel_val in (run.outputs or {}).items():
        if isinstance(rel_val, str):
            abs_path = paths.abs(rel_val)
            resolved[key] = {
                "path": rel_val,
                "exists": abs_path.exists(),
                "is_dir": abs_path.is_dir() if abs_path.exists() else False,
            }
            # For directories, list their contents
            if abs_path.is_dir():
                resolved[key]["files"] = [
                    f.name for f in sorted(abs_path.iterdir()) if f.is_file()
                ]

    return {"outputs": resolved, "run_id": str(id)}


# ── Ground: plot marking ──────────────────────────────────────────────────────

class PlotMarkingRequest(BaseModel):
    selections: list[dict[str, Any]]  # see ground.save_plot_marking for schema
    save_as: bool = False
    name: str | None = None


class RenamePlotMarkingRequest(BaseModel):
    name: str


def _get_plot_marking_versions(outputs: dict) -> list[dict]:
    return list(outputs.get("plot_markings", []))


def _discover_pm_versions(paths: RunPaths, run_outputs: dict) -> tuple[list[dict], int | None]:
    """Scan disk for plot_borders_v*.csv and merge with stored metadata."""
    import re
    stored = {v["version"]: v for v in _get_plot_marking_versions(run_outputs)}
    active = run_outputs.get("active_plot_marking_version")
    versions = []
    if paths.intermediate_year.exists():
        for p in sorted(paths.intermediate_year.glob("plot_borders_v*.csv")):
            m = re.search(r"_v(\d+)\.csv$", p.name)
            if not m:
                continue
            n = int(m.group(1))
            meta = stored.get(n, {})
            versions.append({
                "version": n,
                "name": meta.get("name") or "",
                "csv_path": paths.rel(p),
                "created_at": meta.get("created_at") or "",
                "run_id": meta.get("run_id") or "",
                "run_label": meta.get("run_label") or "",
            })
    return versions, active


@router.get("/pipeline-runs/{id}/plot-markings")
def list_plot_markings(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> list[dict]:
    from sqlmodel import select as _select
    from app.models.pipeline import PipelineRun as _PR, Pipeline as _Pipeline

    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    versions, active = _discover_pm_versions(paths, dict(run.outputs or {}))

    # For versions missing metadata (created by a different run or pipeline),
    # search all runs in the same workspace — plot_borders_vN.csv files live in
    # intermediate_year which is workspace/year/experiment/location/population
    # scoped, so they are visible across pipelines within the same workspace.
    missing = {v["version"] for v in versions if not v.get("run_label") and not v.get("created_at")}
    if missing:
        current_pipeline = session.get(_Pipeline, run.pipeline_id)
        workspace_runs = session.exec(
            _select(_PR)
            .join(_Pipeline, _PR.pipeline_id == _Pipeline.id)
            .where(
                _Pipeline.workspace_id == current_pipeline.workspace_id,
                _PR.id != run.id,
            )
        ).all()
        cross_meta: dict[int, dict] = {}
        for sr in workspace_runs:
            for pm in (sr.outputs or {}).get("plot_markings", []):
                vnum = pm.get("version")
                if vnum in missing and vnum not in cross_meta:
                    cross_meta[vnum] = pm
        for v in versions:
            if v["version"] in cross_meta:
                fb = cross_meta[v["version"]]
                v["run_label"] = v["run_label"] or fb.get("run_label", "")
                v["created_at"] = v["created_at"] or fb.get("created_at", "")

    for v in versions:
        v["is_active"] = (v["version"] == active)
    return versions


@router.post("/pipeline-runs/{id}/plot-marking")
def save_plot_marking(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: PlotMarkingRequest,
) -> dict[str, Any]:
    import shutil
    from datetime import datetime, timezone

    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline or pipeline.type != "ground":
        raise HTTPException(status_code=400, detail="Not a ground pipeline")

    from app.processing.ground import save_plot_marking as _save

    # Write canonical plot_borders.csv
    outputs = _save(session=session, run_id=id, selections=body.selections)
    paths = _get_paths(session, run)

    existing_outputs = dict(run.outputs or {})
    existing_outputs.update(outputs)
    existing_versions, active_version = _discover_pm_versions(paths, existing_outputs)

    run_label = f"{run.date} · {run.location} / {run.population} · {run.sensor}"

    if body.save_as or not existing_versions:
        # Create a new version
        next_version = (max((v["version"] for v in existing_versions), default=0) + 1)
        versioned_path = paths.plot_borders_versioned(next_version)
        shutil.copy2(paths.plot_borders, versioned_path)
        logger.info("[save_plot_marking] created new version v%d → %s", next_version, versioned_path)
        created_at = datetime.now(timezone.utc).isoformat()
        existing_versions.append({
            "version": next_version,
            "name": body.name or "",
            "csv_path": paths.rel(versioned_path),
            "created_at": created_at,
            "run_id": str(run.id),
            "run_label": run_label,
        })
        active_version = next_version
    else:
        # Overwrite active version in place
        target_version = active_version or existing_versions[-1]["version"]
        versioned_path = paths.plot_borders_versioned(target_version)
        shutil.copy2(paths.plot_borders, versioned_path)
        logger.info("[save_plot_marking] overwrote active version v%d → %s", target_version, versioned_path)
        # Update name if provided
        if body.name:
            for v in existing_versions:
                if v["version"] == target_version:
                    v["name"] = body.name
        active_version = target_version

    existing_outputs["plot_markings"] = existing_versions
    existing_outputs["active_plot_marking_version"] = active_version

    existing_steps = dict(run.steps_completed or {})
    existing_steps["plot_marking"] = True

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(
            steps_completed=existing_steps,
            outputs=existing_outputs,
        ),
    )
    return {"status": "saved", "version": active_version, "outputs": outputs}


@router.patch("/pipeline-runs/{id}/plot-markings/{version}/rename")
def rename_plot_marking(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
    body: RenamePlotMarkingRequest,
) -> dict:
    run = _get_run_or_404(session, id)
    existing_outputs = dict(run.outputs or {})
    versions = _get_plot_marking_versions(existing_outputs)
    for v in versions:
        if v["version"] == version:
            v["name"] = body.name
            break
    existing_outputs["plot_markings"] = versions
    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(outputs=existing_outputs),
    )
    return {"status": "renamed"}


@router.delete("/pipeline-runs/{id}/plot-markings/{version}", status_code=200)
def delete_plot_marking_version(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
) -> None:
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    versioned_path = paths.plot_borders_versioned(version)
    if versioned_path.exists():
        versioned_path.unlink()
    existing_outputs = dict(run.outputs or {})
    versions = [v for v in _get_plot_marking_versions(existing_outputs) if v["version"] != version]
    existing_outputs["plot_markings"] = versions
    if existing_outputs.get("active_plot_marking_version") == version:
        existing_outputs["active_plot_marking_version"] = versions[-1]["version"] if versions else None
    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(outputs=existing_outputs),
    )


@router.get("/pipeline-runs/{id}/plot-marking")
def load_plot_marking(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int | None = None,
) -> dict[str, Any]:
    """Return plot marking selections. Pass ?version=N to load a specific version."""
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    if version is not None:
        csv_path = paths.plot_borders_versioned(version)
    else:
        # Load from the active versioned file so the tool always shows the version
        # the user last saved — not the canonical plot_borders.csv which can lag behind.
        active_version = (run.outputs or {}).get("active_plot_marking_version")
        if active_version is not None:
            versioned_path = paths.plot_borders_versioned(int(active_version))
            csv_path = versioned_path if versioned_path.exists() else paths.plot_borders
        else:
            csv_path = paths.plot_borders

    logger.info("[load_plot_marking] run=%s reading csv: %s", id, csv_path)
    if not csv_path.exists():
        logger.warning("[load_plot_marking] csv not found: %s", csv_path)
        return {"selections": [], "gps_translated": False}

    selections = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Convert numeric fields back from strings
            for key in ("plot_id",):
                if key in row and row[key]:
                    try:
                        row[key] = int(row[key])
                    except ValueError:
                        pass
            for key in ("start_lat", "start_lon", "end_lat", "end_lon"):
                if key in row:
                    val = row[key]
                    if val:
                        try:
                            row[key] = float(val)
                        except ValueError:
                            row[key] = None
                    else:
                        row[key] = None
            selections.append(dict(row))

    logger.info("[load_plot_marking] loaded %d selections from %s", len(selections), csv_path)
    if selections:
        s0 = selections[0]
        logger.debug(
            "[load_plot_marking] first selection: plot_id=%s start_image=%s end_image=%s start_lat=%s start_lon=%s",
            s0.get("plot_id"), s0.get("start_image"), s0.get("end_image"),
            s0.get("start_lat"), s0.get("start_lon"),
        )

    # Attempt GPS-based translation when markers reference images from a different run
    msgs_synced_path = _find_msgs_synced(paths)
    if msgs_synced_path and paths.raw.exists():
        from app.processing.ground import translate_markers_by_gps as _translate
        exts = {".jpg", ".jpeg", ".png"}

        # Use the same image-directory priority as list_images so that current_image_set
        # only contains images from the active sensor directory.  A plain rglob would
        # also pick up Amiga top/ frames when the active images are in Images/, causing
        # needs_translation=False even though the filenames refer to a different run.
        _images_subdir = paths.raw / "Images"
        _direct = [p for p in paths.raw.iterdir() if p.is_file() and p.suffix.lower() in exts]
        if _images_subdir.is_dir() and any(f.suffix.lower() in exts for f in _images_subdir.iterdir()):
            _image_dir = _images_subdir
        elif _direct:
            _image_dir = paths.raw
        else:
            _top_dirs = list(paths.raw.rglob("top"))
            _top_dir = next((d for d in _top_dirs if d.is_dir()), None)
            _image_dir = _top_dir if _top_dir else paths.raw

        current_image_set: set[str] = {
            p.name for p in _image_dir.iterdir()
            if p.is_file() and p.suffix.lower() in exts
        }
        logger.info(
            "[load_plot_marking] current_image_set has %d images (image_dir=%s), msgs_synced=%s",
            len(current_image_set), _image_dir, msgs_synced_path,
        )
        if current_image_set:
            sample = sorted(current_image_set)[:3]
            logger.debug("[load_plot_marking] sample images in current_image_set: %s", sample)
        selections, gps_translated = _translate(selections, current_image_set, msgs_synced_path)
        logger.info("[load_plot_marking] translation result: gps_translated=%s", gps_translated)
    else:
        logger.warning(
            "[load_plot_marking] skipping translation — msgs_synced_path=%s raw_exists=%s",
            msgs_synced_path, paths.raw.exists(),
        )
        gps_translated = False

    active_version = (run.outputs or {}).get("active_plot_marking_version")
    return {
        "selections": selections,
        "gps_translated": gps_translated,
        "active_version": active_version,
    }


def _find_msgs_synced(paths: RunPaths) -> Path | None:
    """
    Locate msgs_synced.csv for Amiga/ground runs.
    The file lives inside the extracted archive at an unpredictable depth
    (e.g. raw/Images/RGB/Metadata/msgs_synced.csv), so we search recursively
    before falling back to the intermediate run directory.
    """
    logger.debug("[find_msgs_synced] searching raw dir: %s", paths.raw)
    # Recursive search under raw dir first (covers Amiga nested layout)
    found = next(paths.raw.rglob("msgs_synced.csv"), None)
    if found:
        logger.debug("[find_msgs_synced] found in raw: %s", found)
        return found
    logger.debug("[find_msgs_synced] not in raw — checking intermediate: %s", paths.msgs_synced)
    # Fallback: intermediate (aerial / pre-copied)
    if paths.msgs_synced.exists():
        logger.debug("[find_msgs_synced] found in intermediate: %s", paths.msgs_synced)
        return paths.msgs_synced
    logger.warning("[find_msgs_synced] msgs_synced.csv not found (raw=%s, intermediate=%s)", paths.raw, paths.msgs_synced)
    return None


# ── Ground: image listing (for plot marking UI) ───────────────────────────────

@router.get("/pipeline-runs/{id}/images")
def list_images(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    extensions: str = "jpg,jpeg,png",
) -> dict[str, Any]:
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    if not paths.raw.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Raw data directory not found: {paths.raw}",
        )

    exts = {f".{e.strip().lower()}" for e in extensions.split(",")}

    # Priority: Images/ subdir (standard upload), then direct files in raw/,
    # then Farm-ng "top/" subdir for extracted .bin data.
    image_dir = paths.raw
    images_subdir = paths.raw / "Images"
    direct = [p for p in paths.raw.iterdir() if p.is_file() and p.suffix.lower() in exts]
    if images_subdir.is_dir() and any(f.suffix.lower() in exts for f in images_subdir.iterdir()):
        image_dir = images_subdir
    elif not direct:
        top_dirs = list(paths.raw.rglob("top"))
        top_dir = next((d for d in top_dirs if d.is_dir()), None)
        if top_dir:
            image_dir = top_dir

    images = sorted(
        p for p in image_dir.iterdir()
        if p.is_file() and p.suffix.lower() in exts
    )

    msgs_synced_path = _find_msgs_synced(paths)
    has_gps = msgs_synced_path is not None

    return {
        "images": [img.name for img in images],
        "count": len(images),
        "raw_dir": str(image_dir),
        "has_gps": has_gps,
        "msgs_synced": str(msgs_synced_path) if has_gps else None,
    }


# ── Ground: GPS trajectory data (for plot marking map) ───────────────────────

@router.get("/pipeline-runs/{id}/gps-data")
def get_gps_data(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, Any]:
    """
    Return GPS trajectory points from msgs_synced.csv for the plot marking map.
    Each point includes lat, lon, and the image filename so the frontend can
    highlight the current image's position on the map.
    """
    import pandas as pd

    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    csv_path = _find_msgs_synced(paths)
    if not csv_path:
        return {"points": [], "count": 0}

    try:
        df = pd.read_csv(csv_path)
        df.columns = df.columns.str.strip()
    except Exception:
        return {"points": [], "count": 0}

    lat_col = next((c for c in df.columns if c.lower() in ("lat", "latitude")), None)
    lon_col = next((c for c in df.columns if c.lower() in ("lon", "lng", "longitude")), None)
    img_col = next((c for c in df.columns if c in ("/top/rgb_file", "rgb_file", "image_path")), None)

    if not lat_col or not lon_col:
        return {"points": [], "count": 0}

    points = []
    for _, row in df.iterrows():
        try:
            lat = float(row[lat_col])
            lon = float(row[lon_col])
        except (ValueError, TypeError):
            continue
        if lat != lat or lon != lon:  # NaN check
            continue
        point: dict[str, Any] = {"lat": lat, "lon": lon}
        if img_col:
            raw = row.get(img_col)
            # Store just the basename so it matches the filenames returned by /images
            point["image"] = str(raw).split("/")[-1] if raw and str(raw) != "nan" else None
        points.append(point)

    return {"points": points, "count": len(points)}


# ── Apply existing boundaries to a new run (ground + aerial) ─────────────────

@router.post("/pipeline-runs/{id}/apply-boundaries")
def apply_boundaries(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, Any]:
    """
    Mark the boundary step as complete on a new run using pipeline-level files.

    Ground: copies plot_borders.csv  → marks plot_marking complete.
    Aerial: copies Plot-Boundary-WGS84.geojson → marks plot_boundaries complete.

    Returns 404 if no saved boundaries exist yet for this pipeline.
    """
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    pipeline = get_pipeline(session=session, id=run.pipeline_id)

    existing_outputs = dict(run.outputs or {})
    existing_steps = dict(run.steps_completed or {})

    if not paths.plot_boundary_geojson.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                "No Plot-Boundary-WGS84.geojson found for this pipeline. "
                "Complete the Plot Boundary Prep step on an earlier run first."
            ),
        )
    existing_outputs["plot_boundary_prep"] = paths.rel(paths.plot_boundary_geojson)
    existing_steps["plot_boundary_prep"] = True

    # Ground: if plot_borders.csv already exists from a prior run on this pipeline,
    # mark plot_marking as complete too so the user doesn't have to redo it.
    if pipeline.type == "ground" and paths.plot_borders.exists():
        existing_outputs["plot_marking"] = paths.rel(paths.plot_borders)
        existing_steps["plot_marking"] = True

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(steps_completed=existing_steps, outputs=existing_outputs),
    )
    return {"status": "applied", "plot_boundary": paths.rel(paths.plot_boundary_geojson)}


# ── Shared: field design ──────────────────────────────────────────────────────

@router.get("/pipeline-runs/{id}/field-design")
def get_field_design(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, Any]:
    """
    Check whether a field design CSV exists for this pipeline and return its data.

    Response:
        {
          "available": bool,
          "rows": [...],   # parsed CSV rows (list of dicts)
          "row_count": int,
          "col_count": int,
        }
    """
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    csv_path = paths.field_design_csv()
    if not csv_path:
        return {"available": False, "rows": [], "row_count": 0, "col_count": 0}

    import csv as _csv
    rows: list[dict[str, str]] = []
    with open(csv_path, newline="") as f:
        for row in _csv.DictReader(f):
            rows.append({k.strip(): v.strip() for k, v in row.items()})

    row_nums = {int(r["row"]) for r in rows if r.get("row", "").isdigit()}
    col_nums = {int(r["col"]) for r in rows if r.get("col", "").isdigit()}

    return {
        "available": True,
        "rows": rows,
        "row_count": max(row_nums) if row_nums else 0,
        "col_count": max(col_nums) if col_nums else 0,
    }


class SaveFieldDesignRequest(BaseModel):
    csv_text: str  # raw CSV content


@router.post("/pipeline-runs/{id}/field-design")
def save_field_design(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: SaveFieldDesignRequest,
) -> dict[str, Any]:
    """Save field design CSV inline (without going to the Files tab)."""
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    paths.field_design_intermediate.parent.mkdir(parents=True, exist_ok=True)
    paths.field_design_intermediate.write_text(body.csv_text)

    import csv as _csv
    import io
    rows: list[dict[str, str]] = []
    for row in _csv.DictReader(io.StringIO(body.csv_text)):
        rows.append({k.strip(): v.strip() for k, v in row.items()})

    row_nums = {int(r["row"]) for r in rows if r.get("row", "").isdigit()}
    col_nums = {int(r["col"]) for r in rows if r.get("col", "").isdigit()}

    return {
        "status": "saved",
        "row_count": max(row_nums) if row_nums else 0,
        "col_count": max(col_nums) if col_nums else 0,
    }


class GeneratePlotGridRequest(BaseModel):
    pop_boundary: dict[str, Any]   # GeoJSON Feature or FeatureCollection
    options: dict[str, Any]        # width, length, rows, columns, verticalSpacing, horizontalSpacing, angle


class SavePlotGridRequest(BaseModel):
    geojson: dict[str, Any]        # pre-computed GeoJSON FeatureCollection
    pop_boundary: dict[str, Any] | None = None   # GeoJSON Feature (for saving Pop-Boundary file)
    grid_options: dict[str, Any] | None = None   # GridOptions (width, length, rows, …)
    grid_offset: dict[str, Any] | None = None    # { lon, lat } drag offset
    ortho_version: int | None = None    # aerial: which ortho version was used as background
    stitch_version: int | None = None   # ground: which stitch version was used as background
    save_as: bool = False     # True → always create new version; False → overwrite active or create v1
    name: str | None = None   # optional name for the new version (only used when save_as=True)


@router.post("/pipeline-runs/{id}/save-plot-grid")
def save_plot_grid(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: SavePlotGridRequest,
) -> dict[str, Any]:
    """Save a pre-computed plot grid GeoJSON from the frontend (bypasses backend computation)."""
    import re as _re
    from datetime import datetime as _dt

    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    pipeline_type = pipeline.type if pipeline else "aerial"
    paths = _get_paths(session, run)
    paths.intermediate_year.mkdir(parents=True, exist_ok=True)

    if body.pop_boundary is not None:
        paths.pop_boundary_geojson.write_text(json.dumps(body.pop_boundary, indent=2))

    # Embed grid_settings and run_meta as non-standard top-level keys so they
    # can be recovered when the file is discovered by other runs in the same pipeline.
    geojson_to_save = dict(body.geojson)
    if body.grid_options is not None:
        geojson_to_save["grid_settings"] = {
            "options": body.grid_options,
            "offset": body.grid_offset or {"lon": 0, "lat": 0},
        }
    geojson_to_save["_run_meta"] = {
        "experiment": paths.experiment,
        "location": paths.location,
        "population": paths.population,
        "platform": paths.platform,
        "sensor": paths.sensor,
        "date": paths.date,
        "stitch_version": body.stitch_version,
        "ortho_version": body.ortho_version,
        "pipeline_type": pipeline_type,
    }

    existing_outputs = dict(run.outputs or {})
    versions = [dict(v) for v in existing_outputs.get("plot_boundaries", [])]
    now = _dt.utcnow().isoformat()

    if body.save_as or not versions:
        # Determine next version number from ALL existing versioned files in the
        # shared population directory — prevents overwriting versions created by
        # a different pipeline type (e.g. ground Save As clobbering aerial v1).
        shared_dir = paths.intermediate_shared_pop
        existing_file_versions = [
            int(m.group(1))
            for f in shared_dir.glob("Plot-Boundary-WGS84_v*.geojson")
            if (m := _re.match(r"Plot-Boundary-WGS84_v(\d+)\.geojson", f.name))
        ]
        all_known_versions = existing_file_versions + [v["version"] for v in versions]
        new_version = max(all_known_versions, default=0) + 1

        versioned_path = paths.plot_boundary_geojson_versioned(new_version)
        versioned_path.write_text(json.dumps(geojson_to_save, indent=2))
        entry = {
            "version": new_version,
            "name": body.name.strip() if body.name else None,
            "geojson_path": paths.rel(versioned_path),
            "ortho_version": body.ortho_version,
            "stitch_version": body.stitch_version,
            "created_at": now,
        }
        versions.append(entry)
        existing_outputs["active_plot_boundary_version"] = new_version

        # On Save As: only update the canonical file if this pipeline owns it (or it
        # doesn't exist yet), so we don't clobber another pipeline's canonical boundary.
        canonical_owned = True
        if paths.plot_boundary_geojson.exists():
            try:
                existing_meta = json.loads(paths.plot_boundary_geojson.read_text()).get("_run_meta", {})
                existing_pt = existing_meta.get("pipeline_type")
                if existing_pt and existing_pt != pipeline_type:
                    canonical_owned = False
            except Exception:
                pass
        if canonical_owned:
            paths.plot_boundary_geojson.write_text(json.dumps(geojson_to_save, indent=2))
    else:
        # Overwrite the current active version
        active_v = existing_outputs.get("active_plot_boundary_version")
        target = next((v for v in versions if v["version"] == active_v), versions[-1] if versions else None)
        if target:
            versioned_path = paths.abs(target["geojson_path"])
            versioned_path.write_text(json.dumps(geojson_to_save, indent=2))
            target["ortho_version"] = body.ortho_version
            target["stitch_version"] = body.stitch_version

        # Overwrite always updates the canonical (this run explicitly chose to save here)
        paths.plot_boundary_geojson.write_text(json.dumps(geojson_to_save, indent=2))

    existing_outputs["plot_boundaries"] = versions
    existing_outputs["plot_boundary_prep"] = paths.rel(paths.plot_boundary_geojson)
    if body.ortho_version is not None:
        existing_outputs["plot_boundary_ortho_version"] = body.ortho_version
        # Also set as active so downstream steps (trait extraction) use the same ortho
        existing_outputs["active_ortho_version"] = body.ortho_version
    existing_steps = dict(run.steps_completed or {})
    existing_steps["plot_boundary_prep"] = True

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(steps_completed=existing_steps, outputs=existing_outputs),
    )

    return {"status": "saved" if not body.save_as else "saved_as", "feature_count": len(body.geojson.get("features", []))}


@router.get("/pipeline-runs/{id}/trait-extraction-preview")
def trait_extraction_preview(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    ortho_version: int | None = None,
    boundary_version: int | None = None,
    plot_index: int = 0,
    threshold: float = 0.1,
) -> dict[str, Any]:
    """Return a preview image + metrics for a single plot at a given ExG threshold."""
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    try:
        from app.processing import aerial
        return aerial.preview_trait_extraction(
            paths=paths,
            run_outputs=run.outputs or {},
            ortho_version=ortho_version,
            boundary_version=boundary_version,
            plot_index=plot_index,
            threshold=threshold,
        )
    except (FileNotFoundError, ValueError) as exc:
        logger.warning("trait_extraction_preview 404: %s", exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("trait_extraction_preview 500")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/pipeline-runs/{id}/generate-plot-grid")
def generate_plot_grid(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: GeneratePlotGridRequest,
) -> dict[str, Any]:
    """
    Generate a rectangular plot grid from the population boundary + grid options.
    Saves Pop-Boundary-WGS84.geojson and Plot-Boundary-WGS84.geojson at pipeline level.
    Returns the generated GeoJSON for preview.
    """
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    paths.intermediate_year.mkdir(parents=True, exist_ok=True)

    # Save population boundary
    paths.pop_boundary_geojson.write_text(json.dumps(body.pop_boundary, indent=2))

    from app.processing.plot_boundary import generate_plot_grid as _gen
    grid_fc = _gen(
        pop_boundary=body.pop_boundary,
        options=body.options,
        field_design_path=paths.field_design_csv(),
    )

    # Save as the canonical plot boundary file
    paths.plot_boundary_geojson.write_text(json.dumps(grid_fc, indent=2))
    logger.info(
        "Generated plot grid with %d features for run %s",
        len(grid_fc["features"]),
        id,
    )

    # Mark step complete
    existing_outputs = dict(run.outputs or {})
    existing_outputs["plot_boundary_prep"] = paths.rel(paths.plot_boundary_geojson)
    existing_steps = dict(run.steps_completed or {})
    existing_steps["plot_boundary_prep"] = True

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(steps_completed=existing_steps, outputs=existing_outputs),
    )

    return {
        "status": "saved",
        "feature_count": len(grid_fc["features"]),
        "geojson": grid_fc,
        "plot_boundary": paths.rel(paths.plot_boundary_geojson),
    }


# ── Aerial: GCP selection ─────────────────────────────────────────────────────

class GcpSelectionRequest(BaseModel):
    gcp_selections: list[dict[str, Any]]
    image_gps: list[dict[str, Any]]
    gcp_locations_csv: str | None = None  # inline CSV if not uploaded via files tab


@router.post("/pipeline-runs/{id}/gcp-selection")
def save_gcp_selection(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: GcpSelectionRequest,
) -> dict[str, Any]:
    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline or pipeline.type != "aerial":
        raise HTTPException(status_code=400, detail="Not an aerial pipeline")

    from app.processing.aerial import save_gcp_selection as _save

    outputs = _save(
        session=session,
        run_id=id,
        gcp_selections=body.gcp_selections,
        image_gps=body.image_gps,
        gcp_locations_csv=body.gcp_locations_csv,
    )

    existing_outputs = dict(run.outputs or {})
    existing_outputs.update(outputs)
    existing_steps = dict(run.steps_completed or {})
    existing_steps["gcp_selection"] = True

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(
            steps_completed=existing_steps,
            outputs=existing_outputs,
        ),
    )
    return {"status": "saved", "outputs": outputs}


# ── Aerial: GCP candidates (images near GCP coordinates) ─────────────────────

def _parse_gcp_csv(csv_path: Path) -> list[dict[str, Any]]:
    """Parse gcp_locations.csv → list of {label, lat, lon, alt}."""
    import csv as _csv
    gcps = []
    with open(csv_path, newline="") as f:
        # Normalise header: strip spaces and lowercase
        reader = _csv.DictReader(f)
        if not reader.fieldnames:
            return gcps
        norm = {k: k.strip().lower() for k in reader.fieldnames}
        for row in reader:
            nrow = {norm[k]: v.strip() for k, v in row.items() if k in norm}
            try:
                gcps.append({
                    "label": nrow.get("label", ""),
                    "lat":   float(nrow.get("lat_dec") or nrow.get("lat", 0)),
                    "lon":   float(nrow.get("lon_dec") or nrow.get("lon", 0)),
                    "alt":   float(nrow.get("altitude") or nrow.get("alt", 0)),
                })
            except (ValueError, KeyError):
                continue
    return gcps


def _read_exif_gps(img_path: Path) -> dict[str, float | None]:
    """Extract GPS lat/lon/alt from image EXIF. Returns None values if absent."""
    try:
        from PIL import Image
        from PIL.ExifTags import Base as ExifBase, GPSTAGS

        with Image.open(img_path) as img:
            exif = img.getexif()
            gps_info_raw = exif.get_ifd(ExifBase.GPSInfo)
            if not gps_info_raw:
                return {"lat": None, "lon": None, "alt": None}

            gps = {GPSTAGS.get(k, k): v for k, v in gps_info_raw.items()}

            def dms_to_deg(dms: tuple, ref: str) -> float:
                d, m, s = (float(x) for x in dms)
                deg = d + m / 60 + s / 3600
                return -deg if ref in ("S", "W") else deg

            lat = dms_to_deg(gps["GPSLatitude"], gps.get("GPSLatitudeRef", "N"))
            lon = dms_to_deg(gps["GPSLongitude"], gps.get("GPSLongitudeRef", "E"))
            alt_raw = gps.get("GPSAltitude")
            alt = float(alt_raw) if alt_raw is not None else None
            return {"lat": lat, "lon": lon, "alt": alt}
    except Exception:
        return {"lat": None, "lon": None, "alt": None}


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return great-circle distance in metres between two WGS-84 points."""
    import math
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _parse_gps_float(val: Any) -> float | None:
    """
    Safely parse a GPS value from a CSV cell.
    Returns None for empty strings, 'nan', 'none', or actual NaN floats
    (pandas writes NaN as empty string in CSV output).
    """
    import math
    if val is None:
        return None
    s = str(val).strip().lower()
    if s in ("", "nan", "none", "null"):
        return None
    try:
        f = float(s)
        return None if math.isnan(f) else f
    except ValueError:
        return None


@router.get("/pipeline-runs/{id}/gcp-candidates")
def gcp_candidates(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    radius_m: float = 5.0,
    filter_by_gcp: bool = True,
) -> dict[str, Any]:
    """
    Return drone images, optionally filtered to those within `radius_m` metres
    of any GCP.

    GPS source priority:
      1. msgs_synced.csv  — platform-log-corrected positions (most accurate)
      2. Image EXIF       — fallback when data_sync hasn't run yet

    When filter_by_gcp=True (default), only images with valid GPS within the
    radius are returned.  Images with no GPS at all are excluded from the
    filtered set (they cannot be reliably placed relative to GCPs).
    When filter_by_gcp=False, all images are returned unfiltered.
    """
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    gcp_csv = paths.gcp_locations()
    has_gcp_csv = gcp_csv.exists()
    gcps: list[dict[str, Any]] = _parse_gcp_csv(gcp_csv) if has_gcp_csv else []

    # ── Resolve image directory ───────────────────────────────────────────────
    _img_exts = {".jpg", ".jpeg", ".png"}
    image_dir: Path | None = None
    if run.file_upload_id is not None:
        from app.models.file_upload import FileUpload as _FileUpload
        fu = session.get(_FileUpload, run.file_upload_id)
        if fu:
            candidate = paths.data_root / fu.storage_path
            if candidate.is_dir():
                image_dir = candidate
    if image_dir is None:
        for candidate in [paths.raw / "Images", paths.raw]:
            if candidate.is_dir() and any(f.suffix.lower() in _img_exts for f in candidate.iterdir()):
                image_dir = candidate
                break

    all_image_files: list[Path] = []
    if image_dir and image_dir.exists():
        all_image_files = sorted(
            p for p in image_dir.iterdir() if p.suffix.lower() in _img_exts
        )

    # ── Build GPS lookup from msgs_synced.csv (preferred) ────────────────────
    # msgs_synced columns: image_path, timestamp, lat, lon, alt, ...
    # pandas writes NaN as empty string, so use _parse_gps_float everywhere.
    msgs_gps: dict[str, dict[str, float | None]] = {}
    has_msgs_synced = paths.msgs_synced.exists()
    if has_msgs_synced:
        try:
            import csv
            with open(paths.msgs_synced, newline="") as fh:
                reader = csv.DictReader(fh)
                for row in reader:
                    try:
                        basename = Path(row["image_path"]).name
                        msgs_gps[basename] = {
                            "lat": _parse_gps_float(row.get("lat")),
                            "lon": _parse_gps_float(row.get("lon")),
                            "alt": _parse_gps_float(row.get("alt")),
                        }
                    except (KeyError, ValueError):
                        continue
        except Exception:
            has_msgs_synced = False

    # ── Build image list with best-available GPS ──────────────────────────────
    images: list[dict[str, Any]] = []
    for p in all_image_files:
        if p.name in msgs_gps:
            gps = msgs_gps[p.name]
        else:
            gps = _read_exif_gps(p)
        images.append({"name": p.name, **gps})

    # ── Filter by proximity to any GCP ────────────────────────────────────────
    total_images = len(images)
    filtered = False
    no_gps_count = sum(1 for img in images if img.get("lat") is None or img.get("lon") is None)

    if filter_by_gcp and gcps:
        gcp_coords = [(g["lat"], g["lon"]) for g in gcps if g.get("lat") is not None]
        if gcp_coords:
            near: list[dict[str, Any]] = []
            for img in images:
                lat, lon = img.get("lat"), img.get("lon")
                if lat is None or lon is None:
                    # No GPS — exclude from filtered results (can't determine proximity)
                    continue
                min_dist = min(
                    _haversine_m(lat, lon, glat, glon)
                    for glat, glon in gcp_coords
                )
                if min_dist <= radius_m:
                    near.append({**img, "dist_m": round(min_dist, 1)})
            # Only apply filter if it actually reduced the set; if nothing matched
            # (e.g. all images lack GPS or radius too tight) return all images.
            if near:
                images = near
                filtered = True

    # ── Load existing gcp_list.txt selections ─────────────────────────────────
    existing_selections: list[dict[str, Any]] = []
    if paths.gcp_list.exists():
        try:
            lines = paths.gcp_list.read_text().splitlines()
        except Exception:
            lines = []
        for line in lines[1:]:  # skip EPSG:4326 header
            parts = line.strip().split()
            if len(parts) < 7:
                continue
            try:
                existing_selections.append({
                    "label":   parts[6],
                    "image":   parts[5],
                    "lat":     float(parts[0]),
                    "lon":     float(parts[1]),
                    "alt":     float(parts[2]),
                    "pixel_x": int(parts[3]),
                    "pixel_y": int(parts[4]),
                })
            except (ValueError, IndexError):
                continue

    return {
        "has_gcp_locations": has_gcp_csv,
        "gcps": gcps,
        "images": images,
        "count": len(images),
        "total_images": total_images,
        "filtered": filtered,
        "radius_m": radius_m,
        "no_gps_count": no_gps_count,
        "has_msgs_synced": has_msgs_synced,
        "raw_dir": str(image_dir) if image_dir else str(paths.raw),
        "existing_selections": existing_selections,
    }


# ── Aerial: inline GCP locations CSV upload ──────────────────────────────────

class SaveGcpLocationsRequest(BaseModel):
    csv_text: str  # raw CSV content pasted/uploaded by user


@router.post("/pipeline-runs/{id}/save-gcp-locations")
def save_gcp_locations(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: SaveGcpLocationsRequest,
) -> dict[str, Any]:
    """
    Save gcp_locations.csv inline (without going to the Files tab).
    Stored in Intermediate/{workspace}/{pop}/ and returned as parsed GCPs
    so the frontend can immediately render the picker.
    """
    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline or pipeline.type != "aerial":
        raise HTTPException(status_code=400, detail="Not an aerial pipeline")

    paths = _get_paths(session, run)
    paths.gcp_locations_intermediate.parent.mkdir(parents=True, exist_ok=True)
    paths.gcp_locations_intermediate.write_text(body.csv_text)
    logger.info("Saved inline gcp_locations.csv for run %s at %s", id, paths.gcp_locations_intermediate)

    gcps = _parse_gcp_csv(paths.gcp_locations_intermediate)
    return {"status": "saved", "gcps": gcps, "count": len(gcps)}


# ── Aerial: plot boundaries ───────────────────────────────────────────────────

class PlotBoundariesRequest(BaseModel):
    geojson: dict[str, Any]
    version: int | None = None  # None = overwrite canonical; int = save versioned copy


@router.post("/pipeline-runs/{id}/plot-boundaries")
def save_plot_boundaries(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: PlotBoundariesRequest,
) -> dict[str, Any]:
    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=400, detail="Pipeline not found")

    if pipeline.type == "ground":
        # Ground: write the adjusted polygons back as plot_boundaries.geojson
        # in the georeferencing output dir (overwriting the auto-generated one)
        paths = _get_paths(session, run)
        geo_rel = (run.outputs or {}).get("georeferencing")
        if not geo_rel:
            raise HTTPException(
                status_code=400,
                detail="Georeferencing output not found. Complete the Georeferencing step first.",
            )
        geo_dir = paths.abs(geo_rel)
        geojson_path = geo_dir / "plot_boundaries.geojson"
        geojson_path.write_text(json.dumps(body.geojson, indent=2))
        logger.info("Saved ground plot_boundaries.geojson with %d features to %s",
                    len(body.geojson.get("features", [])), geojson_path)
        outputs = {"plot_boundaries_geojson": paths.rel(geojson_path)}
    else:
        from app.processing.aerial import save_plot_boundaries as _save
        outputs = _save(
            session=session,
            run_id=id,
            geojson=body.geojson,
            version=body.version,
        )

    existing_outputs = dict(run.outputs or {})
    existing_outputs.update(outputs)
    existing_steps = dict(run.steps_completed or {})
    existing_steps["plot_boundaries"] = True

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(
            steps_completed=existing_steps,
            outputs=existing_outputs,
        ),
    )
    return {"status": "saved", "outputs": outputs}


# ── GeoTIFF bounds reader (pure Python, no GDAL) ─────────────────────────────

def _read_geotiff_wgs84_bounds(
    tif_path: Path,
) -> list[list[float]] | None:
    """
    Read the WGS84 bounding box from a GeoTIFF using only the Python standard
    library (struct) — no rasterio/GDAL required, which keeps the PyInstaller
    bundle simple.

    Handles the common case where the TIF is already in WGS84 (EPSG:4326) and
    uses the ModelTiepointTag + ModelPixelScaleTag TIFF tags to compute bounds.
    Returns [[southLat, westLon], [northLat, eastLon]] for Leaflet, or None if
    the bounds cannot be determined.

    Limitations:
    - Only works for TIFs stored in geographic WGS84 (lat/lon degrees).
    - Projected CRS (UTM etc.) will return None — the frontend shows a "not
      available" message and the user cannot draw boundaries without the
      orthomosaic overlay.  In that case the ODM output should be re-exported
      to WGS84 before this step.
    """
    import struct

    with open(tif_path, "rb") as f:
        header = f.read(4)
        if header[:2] == b"II":
            endian = "<"  # little-endian
        elif header[:2] == b"MM":
            endian = ">"  # big-endian
        else:
            return None

        magic = struct.unpack(endian + "H", header[2:4])[0]
        bigtiff = magic == 43
        if magic not in (42, 43):
            return None

        if bigtiff:
            f.read(4)  # offset size, constant offset
            ifd_offset = struct.unpack(endian + "Q", f.read(8))[0]
        else:
            ifd_offset = struct.unpack(endian + "I", f.read(4))[0]

        f.seek(ifd_offset)
        if bigtiff:
            entry_count = struct.unpack(endian + "Q", f.read(8))[0]
            entry_fmt, entry_size = endian + "HHQ", 20
        else:
            entry_count = struct.unpack(endian + "H", f.read(2))[0]
            entry_fmt, entry_size = endian + "HHI", 12

        # GeoTIFF tags we care about
        TAG_MODEL_PIXEL_SCALE  = 33550  # (ScaleX, ScaleY, ScaleZ)
        TAG_MODEL_TIEPOINT     = 33922  # (I,J,K, X,Y,Z) × N
        TAG_GEO_KEY_DIRECTORY  = 34735  # confirms WGS84 geographic CRS

        tag_data: dict[int, bytes] = {}

        for _ in range(min(entry_count, 512)):
            raw = f.read(entry_size)
            if len(raw) < entry_size:
                break
            if bigtiff:
                tag, dtype, count, value_or_offset = struct.unpack(entry_fmt, raw)
            else:
                tag, dtype, count, value_or_offset = struct.unpack(entry_fmt, raw)

            if tag not in (TAG_MODEL_PIXEL_SCALE, TAG_MODEL_TIEPOINT, TAG_GEO_KEY_DIRECTORY):
                continue

            # Determine byte size of the value
            TYPE_SIZES = {1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8, 16:8, 17:8, 18:8}
            item_size = TYPE_SIZES.get(dtype, 1)
            total = item_size * count

            pos = f.tell()
            if bigtiff:
                if total <= 8:
                    data = raw[-8:][:total]
                else:
                    f.seek(value_or_offset)
                    data = f.read(total)
            else:
                if total <= 4:
                    data = raw[-4:][:total]
                else:
                    f.seek(value_or_offset)
                    data = f.read(total)
            f.seek(pos)

            tag_data[tag] = (dtype, count, data)

        def read_doubles(dtype: int, count: int, data: bytes) -> list[float]:
            if dtype == 12:  # DOUBLE
                return list(struct.unpack(endian + "d" * count, data[:8 * count]))
            if dtype == 11:  # FLOAT
                return [float(x) for x in struct.unpack(endian + "f" * count, data[:4 * count])]
            return []

        if TAG_MODEL_PIXEL_SCALE not in tag_data or TAG_MODEL_TIEPOINT not in tag_data:
            return None

        ps_dtype, ps_count, ps_data = tag_data[TAG_MODEL_PIXEL_SCALE]
        tp_dtype, tp_count, tp_data = tag_data[TAG_MODEL_TIEPOINT]

        scales = read_doubles(ps_dtype, ps_count, ps_data)
        tiepoints = read_doubles(tp_dtype, tp_count, tp_data)

        if len(scales) < 2 or len(tiepoints) < 6:
            return None

        scale_x, scale_y = scales[0], scales[1]
        # Tiepoint: (pixel_i, pixel_j, pixel_k, world_x, world_y, world_z)
        tp_i, tp_j, _, tp_x, tp_y, _ = tiepoints[:6]

        # Image dimensions from standard TIFF tags (256=ImageWidth, 257=ImageLength)
        # We need a second pass — simplest approach: re-read width/height
        f.seek(ifd_offset)
        if bigtiff:
            ec2 = struct.unpack(endian + "Q", f.read(8))[0]
        else:
            ec2 = struct.unpack(endian + "H", f.read(2))[0]

        width = height = None
        for _ in range(min(ec2, 512)):
            raw = f.read(entry_size)
            if len(raw) < entry_size:
                break
            if bigtiff:
                tag2, dtype2, count2, val2 = struct.unpack(entry_fmt, raw)
            else:
                tag2, dtype2, count2, val2 = struct.unpack(entry_fmt, raw)
            if tag2 == 256:  # ImageWidth
                width = val2
            elif tag2 == 257:  # ImageLength
                height = val2
            if width and height:
                break

        if not width or not height:
            return None

        # Top-left corner in geographic coords
        west = tp_x - tp_i * scale_x
        north = tp_y + tp_j * scale_y  # scale_y is negative for north-up, stored positive

        east = west + width * scale_x
        south = north - height * scale_y

        # Sanity check: must be valid lat/lon ranges
        if not (-180 <= west <= 180 and -180 <= east <= 180):
            return None
        if not (-90 <= south <= 90 and -90 <= north <= 90):
            return None

        return [[south, west], [north, east]]


# ── Aerial: orthomosaic info (for BoundaryDrawer) ────────────────────────────

def _read_tif_bounds(tif: Path) -> list[list[float]] | None:
    """Read WGS84 bounds from a GeoTIFF, trying rasterio then pure-Python."""
    try:
        import rasterio
        from rasterio.crs import CRS
        from rasterio.warp import transform_bounds

        with rasterio.open(tif) as src:
            left, bottom, right, top = transform_bounds(
                src.crs,
                CRS.from_epsg(4326),
                src.bounds.left,
                src.bounds.bottom,
                src.bounds.right,
                src.bounds.top,
            )
        return [[bottom, left], [top, right]]
    except Exception as exc:
        logger.warning("rasterio bounds failed (%s), trying pure-Python parser", exc)
        try:
            return _read_geotiff_wgs84_bounds(tif)
        except Exception as exc2:
            logger.warning("Could not read TIF bounds: %s", exc2)
            return None


@router.get("/pipeline-runs/{id}/orthomosaic-info")
def orthomosaic_info(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, Any]:
    """
    Return the mosaic image path and WGS84 bounding box so BoundaryDrawer can
    render it as a Leaflet ImageOverlay.  Works for both pipeline types:

    - Aerial: returns RGB.tif (or Pyramid.tif), existing Plot-Boundary-WGS84.geojson
    - Ground: returns combined_mosaic.tif from georeferencing output dir,
              existing plot_boundaries.geojson (georeferenced plot footprints)

    Response shape:
        {
          "available": bool,
          "path": str | None,                 # absolute path for /files/serve
          "bounds": [[s, w], [n, e]] | None,  # Leaflet LatLngBounds format
          "existing_geojson": {...} | None,
        }
    """
    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    paths = _get_paths(session, run)

    not_available = {"available": False, "path": None, "bounds": None,
                    "existing_geojson": None, "existing_pop_boundary": None,
                    "existing_grid_settings": None}

    if pipeline and pipeline.type == "ground":
        # Ground: combined_mosaic.tif lives inside the georeferencing output dir
        geo_rel = (run.outputs or {}).get("georeferencing")
        if not geo_rel:
            return not_available
        geo_dir = paths.abs(geo_rel)
        tif = geo_dir / "combined_mosaic.tif"
        if not tif.exists():
            return not_available

        bounds = _read_tif_bounds(tif)

        _outputs = run.outputs or {}
        _pb_versions, _active_pbv = _discover_pb_versions(paths, _outputs)

        existing_geojson = None
        existing_grid_settings = None

        # First choice (ground): load the run-specific boundary saved by PlotBoundaryPrep.
        _ground_boundary_rel = _outputs.get("plot_boundaries_geojson")
        if _ground_boundary_rel:
            _ground_boundary_path = paths.abs(_ground_boundary_rel)
            if _ground_boundary_path.exists():
                try:
                    existing_geojson = json.loads(_ground_boundary_path.read_text())
                except Exception:
                    pass

        # Second choice: load the boundary this run explicitly saved via the versioned system.
        if existing_geojson is None:
            _active_pbv_own = _outputs.get("active_plot_boundary_version")
            if _active_pbv_own is not None:
                _vf = paths.plot_boundary_geojson_versioned(_active_pbv_own)
                if _vf.exists():
                    try:
                        raw = json.loads(_vf.read_text())
                        existing_grid_settings = raw.pop("grid_settings", None)
                        raw.pop("_run_meta", None)
                        existing_geojson = raw
                    except Exception:
                        pass

        # Fallback: if this run has no own boundary yet, load the most recent
        # boundary from the shared population directory (e.g. one saved by the
        # aerial pipeline) so the user has a starting point to edit and Save As.
        if existing_geojson is None and _pb_versions:
            _aerial_versions = [
                v for v in _pb_versions
                if (v.get("run_meta") or {}).get("pipeline_type") == "aerial"
            ]
            # Prefer aerial; fall back to any version (older files may lack pipeline_type)
            _fallback_v = _aerial_versions[-1] if _aerial_versions else _pb_versions[-1]
            _vf2 = paths.abs(_fallback_v["geojson_path"])
            if _vf2.exists():
                try:
                    raw = json.loads(_vf2.read_text())
                    existing_grid_settings = raw.pop("grid_settings", None)
                    raw.pop("_run_meta", None)
                    existing_geojson = raw
                except Exception:
                    pass

        # Load existing pop boundary if present
        existing_pop = None
        if paths.pop_boundary_geojson.exists():
            try:
                existing_pop = json.loads(paths.pop_boundary_geojson.read_text())
            except Exception:
                pass

        # Stitching versions that have a combined_mosaic.tif
        _stitchings = list(_outputs.get("stitchings", []))
        if not _stitchings and _outputs.get("stitching_version"):
            _stitchings = [{"version": int(_outputs["stitching_version"]), "name": None}]
        _stitch_versions = []
        for _s in _stitchings:
            if (paths.agrowstitch_dir(_s["version"]) / "combined_mosaic.tif").exists():
                _stitch_versions.append({"version": _s["version"], "name": _s.get("name")})
        _active_sv = int(_outputs["stitching_version"]) if _outputs.get("stitching_version") else (
            _stitch_versions[-1]["version"] if _stitch_versions else None
        )

        return {
            "available": True,
            "path": str(tif),
            "bounds": bounds,
            "existing_geojson": existing_geojson,
            "existing_pop_boundary": existing_pop,
            "existing_grid_settings": existing_grid_settings,
            "plot_boundary_versions": _pb_versions,
            "active_plot_boundary_version": _active_pbv,
            "stitch_versions": _stitch_versions,
            "active_stitch_version": _active_sv,
        }

    else:
        # Aerial: use active orthomosaic version (pyramid preferred)
        tif = _get_active_ortho_tif(paths, run.outputs or {})
        if not tif:
            return not_available

        bounds = _read_tif_bounds(tif)

        _outputs = run.outputs or {}
        _versions = _get_ortho_versions(_outputs)
        _active_v = _outputs.get("active_ortho_version")
        _pb_versions, _active_pbv = _discover_pb_versions(paths, _outputs)

        # Only pre-load boundaries that THIS aerial run explicitly saved.  Do
        # not fall back to the canonical shared file — it may have been written
        # by a ground pipeline run on the same population, and showing those
        # ground polygons in the aerial boundary drawer would be confusing.
        existing_geojson = None
        existing_grid_settings = None
        _active_pbv_own = _outputs.get("active_plot_boundary_version")
        if _active_pbv_own is not None:
            _vf = paths.plot_boundary_geojson_versioned(_active_pbv_own)
            if _vf.exists():
                try:
                    raw = json.loads(_vf.read_text())
                    existing_grid_settings = raw.pop("grid_settings", None)
                    raw.pop("_run_meta", None)
                    existing_geojson = raw
                except Exception:
                    pass

        existing_pop = None
        if paths.pop_boundary_geojson.exists():
            try:
                existing_pop = json.loads(paths.pop_boundary_geojson.read_text())
            except Exception:
                pass

        return {
            "available": True,
            "path": str(tif),
            "bounds": bounds,
            "existing_geojson": existing_geojson,
            "existing_pop_boundary": existing_pop,
            "existing_grid_settings": existing_grid_settings,
            "active_ortho_version": _active_v,
            "plot_boundary_ortho_version": _outputs.get("plot_boundary_ortho_version"),
            "ortho_versions": [
                {"version": v["version"], "name": v.get("name")}
                for v in sorted(_versions, key=lambda x: x["version"])
            ],
            "plot_boundary_versions": _pb_versions,
            "active_plot_boundary_version": _active_pbv,
        }


@router.get("/pipeline-runs/{id}/auto-boundary")
def auto_boundary(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, Any]:
    """
    Estimate outer field boundary and grid options from available spatial data.

    Ground: derives boundary + grid from individual georeferenced plot TIF extents
            and their spatial layout (precise — matches actual plot positions).
    Aerial: derives boundary from the orthomosaic extent; derives plot dimensions
            from (boundary size / rows×cols) using the field design if available.

    Returns pop_boundary (GeoJSON Feature) and grid_options.
    """
    import math as _math

    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    paths = _get_paths(session, run)

    # ── Aerial path ───────────────────────────────────────────────────────────
    if pipeline and pipeline.type == "aerial":
        tif = _get_active_ortho_tif(paths, run.outputs or {})
        if not tif:
            return {"available": False}
        bounds = _read_tif_bounds(tif)
        if not bounds:
            return {"available": False}

        south, west = bounds[0]
        north, east = bounds[1]
        avg_lat = (south + north) / 2
        meters_per_deg = 111_320 * _math.cos(_math.radians(avg_lat))
        field_w_m = (east - west) * meters_per_deg
        field_h_m = (north - south) * meters_per_deg

        # Rows/cols from field design if available
        n_rows, n_cols = 1, 1
        fd_path = paths.field_design_csv()
        if fd_path:
            import csv as _csv
            try:
                rows_data: list[dict[str, str]] = []
                with open(fd_path, newline="") as fh:
                    for row in _csv.DictReader(fh):
                        rows_data.append({k.strip(): v.strip() for k, v in row.items()})
                row_nums = {int(r["row"]) for r in rows_data if r.get("row", "").isdigit()}
                col_nums = {int(r["col"]) for r in rows_data if r.get("col", "").isdigit()}
                if row_nums:
                    n_rows = max(row_nums)
                if col_nums:
                    n_cols = max(col_nums)
            except Exception:
                pass

        plot_width_m  = round(field_w_m / n_cols, 2)
        plot_length_m = round(field_h_m / n_rows, 2)

        # Pop boundary: 95% of orthomosaic extent (trims edge artefacts)
        shrink_lon = (east - west)  * 0.025
        shrink_lat = (north - south) * 0.025
        pop_boundary = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [west  + shrink_lon, south + shrink_lat],
                    [east  - shrink_lon, south + shrink_lat],
                    [east  - shrink_lon, north - shrink_lat],
                    [west  + shrink_lon, north - shrink_lat],
                    [west  + shrink_lon, south + shrink_lat],
                ]],
            },
            "properties": {},
        }
        return {
            "available": True,
            "pop_boundary": pop_boundary,
            "grid_options": {
                "width": plot_width_m,
                "length": plot_length_m,
                "rows": n_rows,
                "columns": n_cols,
                "verticalSpacing": 0.0,
                "horizontalSpacing": 0.0,
                "angle": 0.0,
            },
        }

    # ── Ground path ───────────────────────────────────────────────────────────
    _outputs = run.outputs or {}
    _stitchings = list(_outputs.get("stitchings", []))
    if not _stitchings and _outputs.get("stitching_version"):
        _stitchings = [{"version": int(_outputs["stitching_version"]), "name": None}]
    if not _stitchings:
        return {"available": False}
    stitch_version = int(_outputs["stitching_version"]) if _outputs.get("stitching_version") else _stitchings[-1]["version"]
    stitch_dir = paths.agrowstitch_dir(stitch_version)

    if not stitch_dir.exists():
        return {"available": False}

    utm_tifs = sorted(stitch_dir.glob("georeferenced_plot_*_utm.tif"))
    if not utm_tifs:
        return {"available": False}

    try:
        import rasterio
        from rasterio.crs import CRS
        from rasterio.warp import transform_bounds  # noqa: F811
    except ImportError:
        return {"available": False}

    wgs84 = CRS.from_epsg(4326)
    plot_boxes: list[dict[str, Any]] = []

    for tif_path in utm_tifs:
        try:
            with rasterio.open(tif_path) as src:
                left, bottom, right, top = transform_bounds(
                    src.crs, wgs84,
                    src.bounds.left, src.bounds.bottom,
                    src.bounds.right, src.bounds.top,
                )
                plot_boxes.append({
                    "west": left, "south": bottom, "east": right, "north": top,
                    "cx": (left + right) / 2,
                    "cy": (top + bottom) / 2,
                    "width_deg": right - left,
                    "height_deg": top - bottom,
                })
        except Exception as exc:
            logger.warning("auto_boundary: could not read %s: %s", tif_path.name, exc)

    if not plot_boxes:
        return {"available": False}

    avg_lat = sum(b["cy"] for b in plot_boxes) / len(plot_boxes)
    meters_per_deg = 111_320 * _math.cos(_math.radians(avg_lat))

    avg_width_deg  = sum(b["width_deg"]  for b in plot_boxes) / len(plot_boxes)
    avg_height_deg = sum(b["height_deg"] for b in plot_boxes) / len(plot_boxes)
    plot_width_m  = round(avg_width_deg  * meters_per_deg, 2)
    plot_length_m = round(avg_height_deg * meters_per_deg, 2)

    # Cluster centroids into rows by latitude (top-first)
    sorted_by_lat = sorted(plot_boxes, key=lambda b: -b["cy"])
    lat_threshold = avg_height_deg * 0.5
    row_clusters: list[list[dict]] = []
    for box in sorted_by_lat:
        placed = False
        for cluster in row_clusters:
            cluster_mean_lat = sum(b["cy"] for b in cluster) / len(cluster)
            if abs(box["cy"] - cluster_mean_lat) < lat_threshold:
                cluster.append(box)
                placed = True
                break
        if not placed:
            row_clusters.append([box])

    n_rows = len(row_clusters)
    n_cols = max(len(c) for c in row_clusters) if row_clusters else 1

    # Vertical spacing (row centre-to-centre gap minus plot height)
    v_spacing_m = 0.0
    if n_rows > 1:
        row_means = sorted(
            [sum(b["cy"] for b in c) / len(c) for c in row_clusters],
            reverse=True,
        )
        gaps = [row_means[i] - row_means[i + 1] for i in range(len(row_means) - 1)]
        avg_gap = sum(gaps) / len(gaps)
        v_spacing_m = max(0.0, round((avg_gap - avg_height_deg) * meters_per_deg, 2))

    # Horizontal spacing (column centre-to-centre gap minus plot width)
    h_spacing_m = 0.0
    if n_cols > 1:
        spacings: list[float] = []
        for cluster in row_clusters:
            ordered = sorted(cluster, key=lambda b: b["cx"])
            for i in range(len(ordered) - 1):
                gap = ordered[i + 1]["cx"] - ordered[i]["cx"] - avg_width_deg
                spacings.append(gap * meters_per_deg)
        if spacings:
            h_spacing_m = max(0.0, round(sum(spacings) / len(spacings), 2))

    # Angle: direction along the widest row
    angle_deg = 0.0
    widest = max(row_clusters, key=len)
    if len(widest) > 1:
        ordered = sorted(widest, key=lambda b: b["cx"])
        dx = ordered[-1]["cx"] - ordered[0]["cx"]
        dy = ordered[-1]["cy"] - ordered[0]["cy"]
        angle_deg = round(_math.degrees(_math.atan2(dy, dx)), 1)

    # Outer boundary: bounding box of all TIF corners + 15% padding
    all_west  = min(b["west"]  for b in plot_boxes)
    all_south = min(b["south"] for b in plot_boxes)
    all_east  = max(b["east"]  for b in plot_boxes)
    all_north = max(b["north"] for b in plot_boxes)
    pad = avg_width_deg * 0.15
    pop_boundary = {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [all_west - pad, all_south - pad],
                [all_east + pad, all_south - pad],
                [all_east + pad, all_north + pad],
                [all_west - pad, all_north + pad],
                [all_west - pad, all_south - pad],
            ]],
        },
        "properties": {},
    }

    return {
        "available": True,
        "pop_boundary": pop_boundary,
        "grid_options": {
            "width": plot_width_m,
            "length": plot_length_m,
            "rows": n_rows,
            "columns": n_cols,
            "verticalSpacing": v_spacing_m,
            "horizontalSpacing": h_spacing_m,
            "angle": angle_deg,
        },
    }


@router.get("/pipeline-runs/{id}/plot-boundaries/{version}")
def get_plot_boundary_version(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
) -> dict[str, Any]:
    """Return the GeoJSON for a specific saved plot boundary version."""
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    versions = (run.outputs or {}).get("plot_boundaries", [])
    entry = next((v for v in versions if v["version"] == version), None)

    # Resolve the file path: prefer the per-run metadata entry, but fall back to
    # the shared population directory for versions saved by other runs in this pipeline.
    if entry:
        p = paths.abs(entry["geojson_path"])
    else:
        p = paths.intermediate_shared_pop / f"Plot-Boundary-WGS84_v{version}.geojson"
        if not p.exists():
            raise HTTPException(status_code=404, detail=f"Plot boundary version {version} not found")

    if not p.exists():
        raise HTTPException(status_code=404, detail="Plot boundary file not found on disk")
    try:
        raw = json.loads(p.read_text())
        grid_settings = raw.pop("grid_settings", None)
        raw.pop("_run_meta", None)
        return {
            "geojson": raw,
            "grid_settings": grid_settings,
            "version": version,
            "name": entry.get("name") if entry else None,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Mosaic preview (web-safe JPEG for Leaflet ImageOverlay) ──────────────────

@router.get("/pipeline-runs/{id}/mosaic-preview")
def mosaic_preview(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    max_size: int = 4096,
    stitch_version: int | None = None,
):
    """
    Return the mosaic as a downscaled JPEG so WebKit can render it.
    TIF files are not renderable as <img> in WebKit/Tauri.
    For ground runs, pass stitch_version to preview a specific stitching version.
    """
    import io
    import numpy as np
    import rasterio
    from rasterio.crs import CRS
    from rasterio.warp import transform_bounds, calculate_default_transform, reproject, Resampling
    from fastapi.responses import Response

    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    paths = _get_paths(session, run)

    # Resolve TIF path (same logic as orthomosaic_info)
    if pipeline and pipeline.type == "ground":
        if stitch_version is not None:
            tif = paths.agrowstitch_dir(stitch_version) / "combined_mosaic.tif"
        else:
            geo_rel = (run.outputs or {}).get("georeferencing")
            if not geo_rel:
                raise HTTPException(404, "No mosaic available")
            tif = paths.abs(geo_rel) / "combined_mosaic.tif"
    else:
        tif = _get_active_ortho_tif(paths, run.outputs or {})

    if not tif or not tif.exists():
        raise HTTPException(404, "Mosaic file not found")

    try:
        with rasterio.open(tif) as src:
            # Downsample to max_size on the longest side
            scale = min(max_size / src.width, max_size / src.height, 1.0)
            out_w = max(1, int(src.width * scale))
            out_h = max(1, int(src.height * scale))

            # Read RGB bands (first 3)
            n_bands = min(src.count, 3)
            data = src.read(
                list(range(1, n_bands + 1)),
                out_shape=(n_bands, out_h, out_w),
                resampling=Resampling.average,
            )

        # Normalise to uint8
        img = np.transpose(data, (1, 2, 0))  # (H, W, C)
        if img.dtype != np.uint8:
            mn, mx = img.min(), img.max()
            if mx > mn:
                img = ((img - mn) / (mx - mn) * 255).astype(np.uint8)
            else:
                img = np.zeros_like(img, dtype=np.uint8)

        # If only 1 band, duplicate to RGB
        if img.shape[2] == 1:
            img = np.repeat(img, 3, axis=2)

        from PIL import Image
        pil_img = Image.fromarray(img, mode="RGB")
        buf = io.BytesIO()
        pil_img.save(buf, format="JPEG", quality=85)
        buf.seek(0)
        return Response(content=buf.read(), media_type="image/jpeg")

    except Exception as exc:
        logger.exception("mosaic_preview failed: %s", exc)
        raise HTTPException(500, f"Failed to generate preview: {exc}")


# ── Orthomosaic version management ───────────────────────────────────────────

def _get_ortho_versions(outputs: dict) -> list[dict]:
    """Return the orthomosaics list, surfacing old flat-key format as v1."""
    versions = list(outputs.get("orthomosaics", []))
    if not versions and outputs.get("orthomosaic"):
        versions = [{
            "version": 1,
            "rgb": outputs["orthomosaic"],
            "dem": outputs.get("dem"),
            "pyramid": None,
            "created_at": None,
        }]
    return versions


def _get_plot_boundary_versions(outputs: dict) -> list[dict]:
    return list(outputs.get("plot_boundaries", []))


def _discover_pb_versions(paths: RunPaths, run_outputs: dict) -> tuple[list[dict], int | None]:
    """
    Discover plot-boundary versions by scanning the shared population directory on disk.

    Returns (versions_list, active_version) where versions_list is sorted by version
    number.  Metadata (name, created_at) is populated from run_outputs when available,
    falling back to the file modification time for versions created by other runs.
    """
    import re as _re
    from datetime import datetime as _dt

    shared_dir = paths.intermediate_shared_pop
    if not shared_dir.exists():
        return [], None

    # Build a lookup from version → metadata stored in THIS run's outputs
    run_meta: dict[int, dict] = {
        v["version"]: v
        for v in run_outputs.get("plot_boundaries", [])
    }

    versions: list[dict] = []
    for f in shared_dir.glob("Plot-Boundary-WGS84_v*.geojson"):
        m = _re.search(r"_v(\d+)\.geojson$", f.name)
        if not m:
            continue
        vnum = int(m.group(1))
        meta = run_meta.get(vnum, {})
        created_at = meta.get("created_at") or _dt.utcfromtimestamp(f.stat().st_mtime).isoformat()

        # Read run_meta embedded in the file (saved by save_plot_grid); fall back to
        # per-run DB metadata for versions created by this run.
        file_run_meta: dict = {}
        try:
            raw = json.loads(f.read_text())
            file_run_meta = raw.get("_run_meta") or {}
        except Exception:
            pass

        versions.append({
            "version": vnum,
            "name": meta.get("name"),
            "geojson_path": paths.rel(f),
            "created_at": created_at,
            "stitch_version": meta.get("stitch_version") or file_run_meta.get("stitch_version"),
            "ortho_version": meta.get("ortho_version") or file_run_meta.get("ortho_version"),
            "run_meta": file_run_meta or None,
        })

    versions.sort(key=lambda x: x["version"])
    active = run_outputs.get("active_plot_boundary_version")
    if active is None and versions:
        active = versions[-1]["version"]
    return versions, active


@router.get("/pipeline-runs/{id}/orthomosaics")
def list_orthomosaics(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> list[dict]:
    run = _get_run_or_404(session, id)
    outputs = run.outputs or {}
    versions = _get_ortho_versions(outputs)
    active = outputs.get("active_ortho_version")
    result = []
    for v in sorted(versions, key=lambda x: x["version"]):
        ver = v["version"]
        # has_crops: versioned key wins, then fall back to the general key for the active version
        has_crops = (
            f"cropped_images_v{ver}" in outputs
            or (ver == active and "cropped_images" in outputs)
        )
        result.append({"active": ver == active, "has_crops": has_crops, **v})
    return result


@router.get("/pipeline-runs/{id}/orthomosaics/{version}/preview")
def orthomosaic_version_preview(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
    max_size: int = 2000,
):
    """
    Return a specific orthomosaic version as a downscaled JPEG.
    max_size controls the longest-side resolution (default 2000 for low-res, pass 8000 for high-res).
    """
    import io
    import numpy as np
    import rasterio
    from rasterio.transform import from_bounds
    from rasterio.enums import Resampling
    from fastapi.responses import Response

    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    versions = _get_ortho_versions(run.outputs or {})
    target = next((v for v in versions if v["version"] == version), None)
    if not target:
        raise HTTPException(404, f"Orthomosaic version {version} not found")

    # Prefer pyramid → rgb
    tif_rel = target.get("pyramid") or target.get("rgb")
    logger.info("[ortho-preview] run=%s version=%s stored_rgb=%s stored_pyramid=%s → tif_rel=%s",
                id, version, target.get("rgb"), target.get("pyramid"), tif_rel)
    if not tif_rel:
        raise HTTPException(404, "No TIF file for this version")
    tif = paths.abs(tif_rel)
    logger.info("[ortho-preview] resolved tif path=%s exists=%s", tif, tif.exists())
    if not tif.exists():
        raise HTTPException(404, "TIF file not found on disk")

    try:
        with rasterio.open(tif) as src:
            scale = min(max_size / src.width, max_size / src.height, 1.0)
            out_w = max(1, int(src.width * scale))
            out_h = max(1, int(src.height * scale))
            n_bands = min(src.count, 3)
            data = src.read(
                list(range(1, n_bands + 1)),
                out_shape=(n_bands, out_h, out_w),
                resampling=Resampling.average,
            )

        img = np.transpose(data, (1, 2, 0))
        if img.dtype != np.uint8:
            mn, mx = img.min(), img.max()
            if mx > mn:
                img = ((img - mn) / (mx - mn) * 255).astype(np.uint8)
            else:
                img = np.zeros_like(img, dtype=np.uint8)
        if img.shape[2] == 1:
            img = np.repeat(img, 3, axis=2)

        from PIL import Image
        buf = io.BytesIO()
        Image.fromarray(img, mode="RGB").save(buf, format="JPEG", quality=88)
        buf.seek(0)
        return Response(content=buf.read(), media_type="image/jpeg")

    except Exception as exc:
        logger.exception("orthomosaic_version_preview failed: %s", exc)
        raise HTTPException(500, f"Failed to generate preview: {exc}")


@router.delete("/pipeline-runs/{id}/orthomosaics/{version}", status_code=200)
def delete_orthomosaic(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
) -> None:
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    existing_outputs = dict(run.outputs or {})
    versions = _get_ortho_versions(existing_outputs)
    target = next((v for v in versions if v["version"] == version), None)
    if not target:
        raise HTTPException(404, f"Orthomosaic version {version} not found")

    # Delete files
    for key in ("rgb", "dem", "pyramid"):
        rel = target.get(key)
        if rel:
            p = paths.abs(rel)
            if p.exists():
                p.unlink(missing_ok=True)

    # Remove from list and update active if needed
    versions = [v for v in versions if v["version"] != version]
    existing_outputs["orthomosaics"] = versions
    existing_outputs.pop("orthomosaic", None)  # remove legacy key if present
    existing_outputs.pop("dem", None)

    if existing_outputs.get("active_ortho_version") == version:
        if versions:
            existing_outputs["active_ortho_version"] = max(v["version"] for v in versions)
        else:
            existing_outputs.pop("active_ortho_version", None)

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(outputs=existing_outputs),
    )


@router.post("/pipeline-runs/{id}/orthomosaics/{version}/activate")
def activate_orthomosaic(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
) -> dict:
    run = _get_run_or_404(session, id)
    existing_outputs = dict(run.outputs or {})
    versions = _get_ortho_versions(existing_outputs)
    if not any(v["version"] == version for v in versions):
        raise HTTPException(404, f"Orthomosaic version {version} not found")
    existing_outputs["active_ortho_version"] = version
    existing_outputs["orthomosaics"] = versions  # ensure list format is stored
    existing_outputs.pop("orthomosaic", None)  # remove legacy key
    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(outputs=existing_outputs),
    )
    return {"active_ortho_version": version}


class RenameOrthoRequest(BaseModel):
    name: str


@router.patch("/pipeline-runs/{id}/orthomosaics/{version}/rename")
def rename_orthomosaic(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
    body: RenameOrthoRequest,
) -> dict:
    run = _get_run_or_404(session, id)
    existing_outputs = dict(run.outputs or {})
    # Deep-copy each version dict so SQLAlchemy sees a genuinely new object
    versions = [dict(v) for v in _get_ortho_versions(existing_outputs)]
    target = next((v for v in versions if v["version"] == version), None)
    if not target:
        raise HTTPException(404, f"Orthomosaic version {version} not found")
    target["name"] = body.name.strip() or None
    existing_outputs["orthomosaics"] = versions
    existing_outputs.pop("orthomosaic", None)
    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(outputs=existing_outputs),
    )
    return {"version": version, "name": target["name"]}


# ── Plot boundary versions ─────────────────────────────────────────────────────────

@router.get("/pipeline-runs/{id}/plot-boundaries")
def list_plot_boundaries(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> list[dict]:
    """
    Return all plot boundary versions for this run's population directory.
    Scans the shared intermediate directory so versions saved by other runs
    (e.g. different dates in the same pipeline) are always included.
    """
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    outputs = run.outputs or {}
    versions, active_v = _discover_pb_versions(paths, outputs)
    return [{"active": v["version"] == active_v, **v} for v in versions]


class RenamePlotBoundaryRequest(BaseModel):
    name: str


@router.patch("/pipeline-runs/{id}/plot-boundaries/{version}/rename")
def rename_plot_boundary(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
    body: RenamePlotBoundaryRequest,
) -> dict:
    run = _get_run_or_404(session, id)
    existing_outputs = dict(run.outputs or {})
    versions = [dict(v) for v in _get_plot_boundary_versions(existing_outputs)]
    target = next((v for v in versions if v["version"] == version), None)
    if not target:
        raise HTTPException(404, f"Plot boundary version {version} not found")
    target["name"] = body.name.strip() or None
    existing_outputs["plot_boundaries"] = versions
    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(outputs=existing_outputs),
    )
    return {"version": version, "name": target["name"]}


@router.delete("/pipeline-runs/{id}/plot-boundaries/{version}", status_code=200)
def delete_plot_boundary(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
) -> None:
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    existing_outputs = dict(run.outputs or {})
    versions = _get_plot_boundary_versions(existing_outputs)
    target = next((v for v in versions if v["version"] == version), None)
    if not target:
        raise HTTPException(404, f"Plot boundary version {version} not found")

    # Delete the GeoJSON file
    geojson_rel = target.get("geojson_path")
    if geojson_rel:
        paths.abs(geojson_rel).unlink(missing_ok=True)

    # Remove from list
    versions = [v for v in versions if v["version"] != version]
    existing_outputs["plot_boundaries"] = versions

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(outputs=existing_outputs),
    )


@router.get("/pipeline-runs/{id}/plot-boundaries/{boundary_version}/download-crops")
def download_crops_for_boundary(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    boundary_version: int,
    ortho_version: int,
) -> StreamingResponse:
    """Crop the specified ortho version using the specified boundary version and return as ZIP."""
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    outputs = run.outputs or {}

    # Resolve boundary geojson
    versions = _get_plot_boundary_versions(outputs)
    bv = next((v for v in versions if v["version"] == boundary_version), None)
    if not bv:
        raise HTTPException(404, f"Plot boundary version {boundary_version} not found")
    boundary_path = paths.abs(bv["geojson_path"])
    if not boundary_path.exists():
        raise HTTPException(404, "Boundary GeoJSON file not found on disk")

    # Resolve ortho RGB tif
    ortho_list = _get_ortho_versions(outputs)
    ov = next((o for o in ortho_list if o["version"] == ortho_version), None)
    if not ov:
        raise HTTPException(404, f"Orthomosaic version {ortho_version} not found")
    # Prefer pyramid, fall back to rgb
    rgb_rel = ov.get("pyramid") or ov.get("rgb")
    if not rgb_rel:
        raise HTTPException(404, "No RGB file in orthomosaic version")
    ortho_path = paths.abs(rgb_rel)
    if not ortho_path.exists():
        raise HTTPException(404, "Orthomosaic file not found on disk")

    from app.processing.aerial import crop_plots_to_stream

    images = crop_plots_to_stream(ortho_path=ortho_path, boundary_path=boundary_path)
    if not images:
        raise HTTPException(404, "No plots could be cropped from the given boundary and ortho")

    filename = f"crops_{run.date}_{run.population}_b{boundary_version}_o{ortho_version}.zip"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for img_name, img_bytes in images:
            zf.writestr(img_name, img_bytes)
    buf.seek(0)

    return StreamingResponse(
        iter([buf.read()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Aerial: use uploaded orthomosaic (skip ODM step) ─────────────────────────

class _UseUploadedOrthoRequest(BaseModel):
    file_upload_id: str | None = None      # RGB orthomosaic FileUpload UUID
    dem_file_upload_id: str | None = None  # DEM FileUpload UUID (optional)
    save_mode: str = "new_version"         # "new_version" | "replace"
    name: str | None = None                # optional name for the version


@router.post("/pipeline-runs/{id}/use-uploaded-ortho")
def use_uploaded_ortho(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: _UseUploadedOrthoRequest | None = None,
) -> dict[str, Any]:
    """
    Register a user-uploaded orthomosaic TIF as the orthomosaic output for this
    run, skipping ODM generation entirely.

    Without a body: looks in the run's own Raw/{...}/Orthomosaic/ dir (backward compat).
    With file_upload_id: uses that FileUpload record's storage path instead, so any
    uploaded ortho can be imported regardless of which fields it was uploaded with.

    save_mode="new_version" (default) adds a new versioned entry.
    save_mode="replace" overwrites the currently active version.
    """
    from app.crud.file_upload import get_file_upload as _get_fu
    from app.crud.app_settings import get_setting as _get_setting
    from datetime import datetime as _dt, timezone as _tz

    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline or pipeline.type != "aerial":
        raise HTTPException(status_code=400, detail="Not an aerial pipeline")

    paths = _get_paths(session, run)
    # Use the user-configured data_root (same logic as _get_paths) so that
    # FileUpload.storage_path (relative to data_root) resolves correctly.
    from app.core.config import settings as _settings
    _data_root = Path(_get_setting(session=session, key="data_root") or _settings.APP_DATA_ROOT)
    req = body or _UseUploadedOrthoRequest()
    logger.info(
        "[use_uploaded_ortho] run=%s data_root=%s file_upload_id=%s dem_file_upload_id=%s save_mode=%s",
        id, _data_root, req.file_upload_id, req.dem_file_upload_id, req.save_mode,
    )

    # ── Locate the source TIF ──────────────────────────────────────────────────
    _bc_dem_tifs: list = []  # populated by backward-compat branch; used by DEM auto-detection below
    if req.file_upload_id:
        try:
            fu_id = uuid.UUID(req.file_upload_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid file_upload_id")
        fu = _get_fu(session=session, id=fu_id)
        if not fu:
            raise HTTPException(status_code=404, detail="File upload not found")
        src_dir = _data_root / fu.storage_path
        logger.info("[use_uploaded_ortho] RGB src_dir=%s (exists=%s)", src_dir, src_dir.exists())
        _all_fu_tifs = sorted(
            p for p in src_dir.rglob("*")
            if p.suffix.lower() in {".tif", ".tiff"}
            and ".original" not in p.stem
            and ".converting" not in p.stem
        )
        logger.info("[use_uploaded_ortho] all tif_files in src_dir: %s", [p.name for p in _all_fu_tifs])
        # RGB and DEM share the same Orthomosaic/ folder — classify to avoid picking
        # the DEM (which sorts before RGB alphabetically: D < R).
        tif_files = [p for p in _all_fu_tifs if p.stem.endswith("-RGB") or (not p.stem.endswith("-DEM") and "dem" not in p.stem.lower())]
        if not tif_files:
            tif_files = _all_fu_tifs  # fallback: no classification possible, take first
        logger.info("[use_uploaded_ortho] RGB tif_files (after classification): %s", [p.name for p in tif_files])
    else:
        # Backward-compat: run's own Raw dir
        ortho_dir = paths.raw / "Orthomosaic"
        logger.info("[use_uploaded_ortho] backward-compat path: ortho_dir=%s (exists=%s)", ortho_dir, ortho_dir.exists())
        if not ortho_dir.exists():
            raise HTTPException(
                status_code=404,
                detail=(
                    "No Orthomosaic directory found. Upload a GeoTIFF via Files → "
                    "Orthomosaic first (matching experiment/location/population/date/"
                    "platform/sensor), or select an existing upload."
                ),
            )
        _all_tifs = sorted(
            p for p in ortho_dir.rglob("*")
            if p.suffix.lower() in {".tif", ".tiff"}
            and ".original" not in p.stem
            and ".converting" not in p.stem
        )
        logger.info("[use_uploaded_ortho] backward-compat all tif_files: %s", [p.name for p in _all_tifs])
        # Classify by canonical name ({date}-RGB.tif / {date}-DEM.tif) with
        # fallback to "dem" stem check for any pre-existing non-canonical files.
        tif_files = [p for p in _all_tifs if p.stem.endswith("-RGB") or (not p.stem.endswith("-DEM") and "dem" not in p.stem.lower())]
        _bc_dem_tifs = [p for p in _all_tifs if p.stem.endswith("-DEM") or ("dem" in p.stem.lower() and not p.stem.endswith("-RGB"))]
        logger.info("[use_uploaded_ortho] backward-compat rgb=%s dem=%s",
                    [p.name for p in tif_files], [p.name for p in _bc_dem_tifs])

    if not tif_files:
        logger.error("[use_uploaded_ortho] No TIF files found — file_upload_id=%s src_dir=%s",
                     req.file_upload_id, _data_root / fu.storage_path if req.file_upload_id and fu else "N/A")
        raise HTTPException(status_code=404, detail="No TIF files found in the selected upload")

    src_tif = tif_files[0]
    logger.info("[use_uploaded_ortho] selected RGB src_tif=%s", src_tif)

    # ── Locate the DEM TIF ────────────────────────────────────────────────────
    # Priority: explicit dem_file_upload_id → auto-detected from same Orthomosaic folder
    src_dem: Path | None = None
    if req.dem_file_upload_id:
        try:
            dem_fu_id = uuid.UUID(req.dem_file_upload_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid dem_file_upload_id")
        dem_fu = _get_fu(session=session, id=dem_fu_id)
        if not dem_fu:
            raise HTTPException(status_code=404, detail="DEM file upload not found")
        dem_src_dir = _data_root / dem_fu.storage_path
        logger.info("[use_uploaded_ortho] DEM src_dir=%s (exists=%s)", dem_src_dir, dem_src_dir.exists())
        dem_tifs = sorted(
            p for p in dem_src_dir.rglob("*")
            if p.suffix.lower() in {".tif", ".tiff"}
            and ".original" not in p.stem
            and ".converting" not in p.stem
        )
        logger.info("[use_uploaded_ortho] DEM tif_files found: %s", [p.name for p in dem_tifs])
        if dem_tifs:
            src_dem = dem_tifs[0]
        else:
            logger.warning("[use_uploaded_ortho] DEM upload %s has no TIF files — DEM will be skipped", req.dem_file_upload_id)
    elif not req.file_upload_id and _bc_dem_tifs:
        # Backward-compat: auto-pick DEM from the same Orthomosaic folder
        src_dem = _bc_dem_tifs[0]
        logger.info("[use_uploaded_ortho] auto-detected DEM from Orthomosaic folder: %s", src_dem.name)

    paths.make_dirs()

    # ── Determine version ──────────────────────────────────────────────────────
    existing_outputs = dict(run.outputs or {})
    existing_versions = list(_get_ortho_versions(existing_outputs))
    active_version = existing_outputs.get("active_ortho_version")

    if req.save_mode == "replace" and existing_versions:
        # Overwrite the active version (or last version if no active set)
        target_version = active_version or existing_versions[-1]["version"]
    else:
        # New version
        target_version = max((v["version"] for v in existing_versions), default=0) + 1

    dest_tif = paths.aerial_rgb_versioned(target_version)

    # Hard-link (instant, same filesystem) or copy
    def _link_or_copy(src: Path, dest: Path) -> None:
        logger.info("[use_uploaded_ortho] copying %s → %s", src, dest)
        try:
            if dest.exists():
                dest.unlink()
            os.link(src, dest)
            logger.info("[use_uploaded_ortho] hard-linked successfully")
        except OSError as _link_err:
            logger.info("[use_uploaded_ortho] hard-link failed (%s), falling back to copy", _link_err)
            shutil.copy2(src, dest)
            logger.info("[use_uploaded_ortho] copy completed")

    _link_or_copy(src_tif, dest_tif)
    logger.info("[use_uploaded_ortho] registered RGB ortho %s → %s (v%d)", src_tif.name, dest_tif.name, target_version)

    dest_dem: Path | None = None
    if src_dem:
        dest_dem = paths.aerial_dem_versioned(target_version)
        _link_or_copy(src_dem, dest_dem)
        logger.info("Registered uploaded DEM %s → %s (v%d)", src_dem.name, dest_dem.name, target_version)
    else:
        logger.info("No DEM TIF found in upload — plant height will be unavailable for v%d", target_version)

    # ── Update outputs list ────────────────────────────────────────────────────
    new_entry = {
        "version": target_version,
        "name": req.name,
        "rgb": paths.rel(dest_tif),
        "dem": paths.rel(dest_dem) if dest_dem else None,
        "pyramid": None,
        "created_at": _dt.now(_tz.utc).isoformat(),
        "imported": True,
    }

    if req.save_mode == "replace" and any(v["version"] == target_version for v in existing_versions):
        # Replace the matching entry in-place, preserving name if not overriding
        updated_versions = []
        for v in existing_versions:
            if v["version"] == target_version:
                merged = dict(v)
                merged.update({k: val for k, val in new_entry.items() if val is not None})
                updated_versions.append(merged)
            else:
                updated_versions.append(v)
        existing_outputs["orthomosaics"] = updated_versions
    else:
        # Append new version entry (also handles migration from flat key)
        existing_outputs["orthomosaics"] = existing_versions + [new_entry]
        # Remove legacy flat key to avoid confusion
        existing_outputs.pop("orthomosaic", None)

    existing_outputs["active_ortho_version"] = target_version

    existing_steps = dict(run.steps_completed or {})
    existing_steps["data_sync"] = True
    existing_steps["orthomosaic"] = True

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(steps_completed=existing_steps, outputs=existing_outputs),
    )
    return {
        "status": "registered",
        "version": target_version,
        "tif": paths.rel(dest_tif),
    }


@router.get("/pipeline-runs/{id}/check-uploaded-ortho")
def check_uploaded_ortho(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, Any]:
    """Check whether an uploaded orthomosaic TIF exists in Raw/.../Orthomosaic/.

    Files are classified as DEM or RGB by filename: any TIF whose stem contains
    "dem" (case-insensitive) is treated as a DEM; all others are treated as RGB.

    Returns:
      available      – True if at least one RGB TIF was found
      filename       – name of the first RGB TIF (display only)
      rgb_files      – sorted list of RGB TIF filenames
      dem_files      – sorted list of DEM TIF filenames (may be empty)
      needs_selection – True when >1 RGB file exists (user must choose via Import dialog)
    """
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    ortho_dir = paths.raw / "Orthomosaic"
    logger.info("[check-uploaded-ortho] run=%s ortho_dir=%s exists=%s", id, ortho_dir, ortho_dir.exists())
    if not ortho_dir.exists():
        return {"available": False, "filename": None, "rgb_files": [], "dem_files": [], "needs_selection": False}
    tif_files = sorted(
        p for p in ortho_dir.iterdir()
        if p.suffix.lower() in {".tif", ".tiff"}
        and ".original" not in p.stem
        and ".converting" not in p.stem
    )
    logger.info("[check-uploaded-ortho] tif_files in ortho_dir: %s", [p.name for p in tif_files])
    # Canonical names: {date}-RGB.tif and {date}-DEM.tif (set by upload handler).
    # Fall back to "dem" stem check for any pre-existing non-canonical files.
    rgb_files = [p for p in tif_files if p.stem.endswith("-RGB") or (not p.stem.endswith("-DEM") and "dem" not in p.stem.lower())]
    dem_files = [p for p in tif_files if p.stem.endswith("-DEM") or ("dem" in p.stem.lower() and not p.stem.endswith("-RGB"))]
    logger.info("[check-uploaded-ortho] classified — rgb: %s  dem: %s",
                [p.name for p in rgb_files], [p.name for p in dem_files])
    if not rgb_files:
        return {"available": False, "filename": None, "rgb_files": [], "dem_files": [p.name for p in dem_files], "needs_selection": False}
    return {
        "available": True,
        "filename": rgb_files[0].name,
        "rgb_files": [p.name for p in rgb_files],
        "dem_files": [p.name for p in dem_files],
        "needs_selection": len(rgb_files) > 1,
    }


# ── Shared: inference results ────────────────────────────────────────────────

@router.get("/pipeline-runs/{id}/inference-results")
def inference_results(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    model: str | None = None,
) -> dict[str, Any]:
    """
    Return parsed predictions CSV + image list for the inference viewer.

    `model` query param selects which model's results to return (defaults to first).

    Response:
        {
          "available": bool,
          "models": ["ModelA", "ModelB"],   # all available model labels
          "active_model": "ModelA",
          "predictions": [...],
          "images": [{"name": str, "path": str}, ...]
        }
    """
    import csv as _csv
    import json as _json

    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    pipeline = session.get(Pipeline, run.pipeline_id)
    outputs = run.outputs or {}

    inference_out = outputs.get("inference")
    if not inference_out:
        return {"available": False, "models": [], "active_model": None, "predictions": [], "images": []}

    # Support old format (str or dict) and new list format
    if isinstance(inference_out, str):
        model_entries: list[dict] = [{"label": "Results", "csv_path": inference_out}]
    elif isinstance(inference_out, list):
        model_entries = inference_out
    else:
        # Old dict format: {label: path}
        model_entries = [{"label": lbl, "csv_path": rel} for lbl, rel in inference_out.items()]

    model_paths: dict[str, str] = {e["label"]: e["csv_path"] for e in model_entries}
    available_models = list(model_paths.keys())
    active_model = model if model in model_paths else available_models[0]
    csv_path = paths.abs(model_paths[active_model])

    if not csv_path.exists():
        return {"available": False, "models": available_models, "active_model": active_model, "predictions": [], "images": []}

    rows: list[dict] = []
    # Per-image metadata captured from CSV (ground pipelines store row/col/accession per prediction)
    img_meta_from_csv: dict[str, dict] = {}
    with open(csv_path, newline="") as f:
        for row in _csv.DictReader(f):
            try:
                points_raw = row.get("points", "") or ""
                points = _json.loads(points_raw) if points_raw else []
                entry: dict[str, Any] = {
                    "image": row.get("image", ""),
                    "class": row.get("class", ""),
                    "confidence": round(float(row.get("confidence", 0)), 4),
                    "x": float(row.get("x", 0)),
                    "y": float(row.get("y", 0)),
                    "width": float(row.get("width", 0)),
                    "height": float(row.get("height", 0)),
                }
                if points:
                    entry["points"] = points
                rows.append(entry)
                img_name = row.get("image", "")
                if img_name and img_name not in img_meta_from_csv:
                    img_meta_from_csv[img_name] = {
                        "plot": str(row.get("plot_label", "") or ""),
                        "row": str(row.get("row", "") or ""),
                        "col": str(row.get("col", "") or ""),
                        "accession": str(row.get("accession", "") or ""),
                    }
            except (ValueError, TypeError):
                continue

    # Image list (absolute paths for /files/serve)
    active_entry = next((e for e in model_entries if e.get("label") == active_model), None)
    if pipeline and pipeline.type == "aerial":
        tv = (active_entry or {}).get("trait_version") if isinstance(inference_out, list) else None
        if tv is not None:
            img_dir = paths.cropped_images_versioned(tv)
            if not img_dir.exists():
                img_dir = paths.cropped_images_dir
        else:
            img_dir = paths.cropped_images_dir
    else:
        sv = (active_entry or {}).get("stitch_version") if isinstance(inference_out, list) else None
        version = sv or int(outputs.get("stitching_version", 1))
        img_dir = paths.agrowstitch_dir(int(version))

    images: list[dict] = []
    if img_dir.exists():
        for f in sorted(img_dir.glob("*.png")):
            images.append({"name": f.name, "path": str(f)})

    # Enrich images with plot metadata (row/col/accession) from traits GeoJSON
    traits_rel = outputs.get("traits_geojson") or outputs.get("traits")
    traits_path: Any = paths.abs(traits_rel) if traits_rel else None
    if not traits_path or not traits_path.exists():
        traits_path = paths.traits_geojson if paths.traits_geojson.exists() else None

    plot_meta: dict[str, dict] = {}
    if traits_path:
        try:
            with open(traits_path) as _gf:
                _gj = _json.load(_gf)
            for _feat in _gj.get("features", []):
                _props = _feat.get("properties") or {}
                _pid = str(_props.get("Plot") or _props.get("plot") or _props.get("plot_id") or "")
                if _pid:
                    plot_meta[_pid] = {
                        "accession": str(_props.get("Label") or _props.get("label") or _props.get("accession") or _props.get("Accession") or ""),
                        "row": str(_props.get("Tier") or _props.get("tier") or _props.get("row") or ""),
                        "col": str(_props.get("Bed") or _props.get("bed") or _props.get("col") or ""),
                    }
        except Exception:
            pass

    # For ground pipelines: also load the association CSV as a fallback for plot metadata.
    # Images without predictions won't appear in img_meta_from_csv, but the association CSV
    # has row/col/accession for every plot.
    assoc_meta: dict[str, dict] = {}
    if pipeline and pipeline.type != "aerial":
        try:
            active_entry_for_assoc = next((e for e in model_entries if e.get("label") == active_model), None)
            assoc_version = (active_entry_for_assoc or {}).get("association_version") if isinstance(inference_out, list) else None
            assoc_entries = outputs.get("associations", [])
            assoc_entry = next((a for a in assoc_entries if a.get("version") == assoc_version), None) if assoc_version else None
            assoc_csv_path = paths.abs(assoc_entry["association_path"]) if assoc_entry and assoc_entry.get("association_path") else paths.intermediate_run / "association.csv"
            if assoc_csv_path.exists():
                with open(assoc_csv_path, newline="") as _af:
                    for _row in _csv.DictReader(_af):
                        tif_name = _row.get("plot_tif", "")
                        stem = Path(tif_name).stem
                        parts = stem.split("_")
                        plot_idx = None
                        for _i, _p in enumerate(parts):
                            if _p == "plot" and _i + 1 < len(parts) and parts[_i + 1].isdigit():
                                plot_idx = parts[_i + 1]
                                break
                        if plot_idx is not None:
                            assoc_meta[plot_idx] = {
                                "plot": str(_row.get("plot") or _row.get("Plot") or plot_idx),
                                "row": str(_row.get("row") or _row.get("Row") or ""),
                                "col": str(_row.get("column") or _row.get("col") or _row.get("Col") or ""),
                                "accession": str(_row.get("accession") or _row.get("Accession") or ""),
                            }
        except Exception:
            pass

    import re as _re
    for img in images:  # always set plot_id; enrich with metadata when available
        stem = img["name"]
        if stem.endswith(".png"):
            stem = stem[:-4]
        # Ground images are named "full_res_mosaic_temp_plot_1" — extract trailing number.
        # Also handles simple "plot_1" prefix style.
        _m = _re.search(r"_(\d+)$", stem)
        plot_id = _m.group(1) if _m else (stem[len("plot_"):] if stem.startswith("plot_") else stem)
        # Priority: CSV predictions metadata > association CSV > traits GeoJSON
        csv_meta = img_meta_from_csv.get(img["name"])
        if csv_meta and (csv_meta.get("row") or csv_meta.get("col") or csv_meta.get("accession")):
            img["plot"] = csv_meta.get("plot") or plot_id
            img["row"] = csv_meta.get("row", "")
            img["col"] = csv_meta.get("col", "")
            img["accession"] = csv_meta.get("accession", "")
        elif assoc_meta.get(plot_id):
            am = assoc_meta[plot_id]
            img["plot"] = am.get("plot") or plot_id
            img["row"] = am.get("row", "")
            img["col"] = am.get("col", "")
            img["accession"] = am.get("accession", "")
        else:
            meta = plot_meta.get(plot_id) or plot_meta.get(stem) or {}
            img["plot"] = plot_id
            img["row"] = meta.get("row", "")
            img["col"] = meta.get("col", "")
            img["accession"] = meta.get("accession", "")

    # Lazily sync detection counts to PlotRecord rows so the Analyze tab can
    # quickly show which plots have detections without reading inference CSVs.
    try:
        from app.processing.plot_record_utils import sync_detection_counts_to_plot_records as _sync
        _sync(
            session=session,
            run_id=id,
            predictions=rows,
            images=images,
        )
    except Exception as _sync_err:
        logger.warning("inference_results: detection sync failed (non-fatal): %s", _sync_err)

    return {
        "available": True,
        "models": available_models,
        "active_model": active_model,
        "predictions": rows,
        "images": images,
    }


# ── Apply confidence threshold to traits GeoJSON ─────────────────────────────

class ApplyThresholdRequest(BaseModel):
    confidence_threshold: float  # 0.0 – 1.0
    label: str | None = None     # which model label; None → apply all models


class MarkStepCompleteBody(BaseModel):
    step: str


@router.post("/pipeline-runs/{id}/mark-step-complete")
def mark_step_complete(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: MarkStepCompleteBody,
) -> dict[str, Any]:
    """Mark a pipeline step as complete without running it (e.g. skip inference)."""
    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    existing_steps = dict(run.steps_completed or {})
    existing_steps[body.step] = True
    if pipeline and pipeline.type == "aerial":
        all_step_keys = ["orthomosaic", "plot_boundary_prep", "trait_extraction", "inference"]
    else:
        all_step_keys = ["plot_marking", "stitching", "inference"]
    all_done = all(existing_steps.get(s, False) for s in all_step_keys)
    new_status = "completed" if all_done else (run.status or "idle")
    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(steps_completed=existing_steps, status=new_status),
    )
    return {"ok": True, "step": body.step, "status": new_status}


@router.post("/pipeline-runs/{id}/apply-inference-threshold")
def apply_inference_threshold(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: ApplyThresholdRequest,
) -> dict[str, Any]:
    """
    Re-merge inference predictions into the Traits GeoJSON using a specific
    confidence threshold, without re-running inference.

    Reads the saved prediction CSV(s), filters rows by confidence, then
    re-runs merge_inference_into_geojson so the GeoJSON reflects only
    detections above the chosen threshold.
    """
    import csv as _csv
    import json as _json
    from app.processing.inference_utils import merge_inference_into_geojson
    from app.models.pipeline import Pipeline as _Pipeline

    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    pipeline = session.get(_Pipeline, run.pipeline_id)
    outputs = run.outputs or {}

    inference_out = outputs.get("inference")
    if not inference_out:
        raise HTTPException(status_code=404, detail="No inference results found for this run.")

    if isinstance(inference_out, str):
        model_entries: list[dict] = [{"label": "Results", "csv_path": inference_out}]
    elif isinstance(inference_out, list):
        model_entries = inference_out
    else:
        model_entries = [{"label": lbl, "csv_path": rel} for lbl, rel in inference_out.items()]

    # Filter to requested label(s)
    if body.label:
        model_entries = [e for e in model_entries if e.get("label") == body.label]
        if not model_entries:
            raise HTTPException(status_code=404, detail=f"No inference result for label '{body.label}'.")

    # Determine Traits GeoJSON path and plot_id field based on pipeline type
    is_aerial = pipeline and pipeline.type == "aerial"
    if is_aerial:
        plot_id_field = "plot_id"
        feature_match_prop = "Plot"
        traits_path = paths.traits_geojson
    else:
        plot_id_field = "plot_label"
        feature_match_prop = "Plot"
        traits_path = paths.traits_geojson

    if not traits_path.exists():
        raise HTTPException(
            status_code=404,
            detail="Traits GeoJSON not found. Complete the trait extraction (or plot boundary) step first.",
        )

    applied: list[str] = []
    for entry in model_entries:
        csv_rel = entry.get("csv_path", "")
        label = entry.get("label", "model")
        if not csv_rel:
            continue
        csv_path = paths.abs(csv_rel)
        if not csv_path.exists():
            logger.warning("apply_inference_threshold: CSV not found at %s", csv_path)
            continue

        # Keep the original (unfiltered) CSV as a backup so thresholds can be
        # re-applied at any confidence level without re-running inference.
        original_csv_path = csv_path.with_stem(csv_path.stem + "_original")
        if not original_csv_path.exists():
            import shutil as _shutil
            _shutil.copy2(csv_path, original_csv_path)
            logger.info("apply_inference_threshold: backed up original CSV → %s", original_csv_path.name)

        rows: list[dict] = []
        fieldnames: list[str] = []
        with open(original_csv_path, newline="") as f:
            reader = _csv.DictReader(f)
            fieldnames = list(reader.fieldnames or [])
            for row in reader:
                try:
                    conf = float(row.get("confidence", 0))
                except (ValueError, TypeError):
                    conf = 0.0
                if conf >= body.confidence_threshold:
                    rows.append(row)

        # Write filtered rows to the active CSV so inference-summary reflects the threshold
        with open(csv_path, "w", newline="") as f:
            writer = _csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

        merge_inference_into_geojson(
            traits_path, rows,
            model_label=label,
            plot_id_field=plot_id_field,
            feature_match_prop=feature_match_prop,
        )
        logger.info(
            "apply_inference_threshold: label=%s threshold=%.2f → %d rows merged into %s",
            label, body.confidence_threshold, len(rows), traits_path.name,
        )
        applied.append(label)

    return {
        "status": "ok",
        "applied": applied,
        "confidence_threshold": body.confidence_threshold,
        "traits_geojson": str(paths.rel(traits_path)),
    }


# ── Ground: stitching version management ─────────────────────────────────────

@router.get("/pipeline-runs/{id}/stitchings")
def list_stitchings(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> list[dict]:
    """Return all stitching versions stored in run.outputs['stitchings']."""
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    stitchings = list((run.outputs or {}).get("stitchings", []))

    # Backward-compat: synthesize a v1 entry from flat stitching_version key
    if not stitchings and (run.outputs or {}).get("stitching_version"):
        version = int(run.outputs["stitching_version"])
        img_dir = paths.agrowstitch_dir(version)
        count = len(list(img_dir.glob("*.png"))) if img_dir.exists() else 0
        stitchings = [{
            "version": version,
            "name": None,
            "dir": str(paths.rel(img_dir)),
            "config": {},
            "plot_count": count,
            "created_at": None,
        }]

    # Annotate each entry with plot count and image URLs
    result = []
    for s in stitchings:
        img_dir = paths.agrowstitch_dir(s["version"])
        plot_count = s.get("plot_count") or (len(list(img_dir.glob("*.png"))) if img_dir.exists() else 0)
        result.append({**s, "plot_count": plot_count})

    return sorted(result, key=lambda s: s["version"], reverse=True)


@router.get("/pipeline-runs/{id}/stitchings/{version}/download")
def download_stitching_images(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
    association_version: int | None = None,
) -> StreamingResponse:
    """
    Download all stitch plot images for a given version as a ZIP.

    association_version selects which association CSV to use for naming.
    If omitted, picks the latest association whose stitch_version matches,
    falling back to the active association, then any association.

    Naming:
    - If association.csv exists and a plot is matched: plot-{Plot}_row-{Row}_col-{Col}_accession-{Accession}.png
    - Otherwise: plot_{N}.png  (N = plot index from original filename)
    """
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    img_dir = paths.agrowstitch_dir(version)
    if not img_dir.exists():
        raise HTTPException(status_code=404, detail=f"Stitching v{version} output directory not found")

    pngs = sorted(img_dir.glob("full_res_mosaic_temp_plot_*.png"))
    if not pngs:
        pngs = sorted(img_dir.glob("*.png"))
    if not pngs:
        raise HTTPException(status_code=404, detail="No plot images found for this stitching version")

    # Build plot_index → association row mapping
    assoc_by_idx: dict[str, dict] = {}
    outputs = run.outputs or {}
    associations = outputs.get("associations", [])

    if association_version is not None:
        # Explicit version requested
        active_assoc = next((a for a in associations if a["version"] == association_version), None)
    else:
        # Auto-select: latest association whose stitch_version matches this stitch version
        matching = sorted(
            [a for a in associations if a.get("stitch_version") == version],
            key=lambda a: a["version"],
        )
        if matching:
            active_assoc = matching[-1]
        else:
            # Fall back to active association version, then any
            active_assoc_version = outputs.get("active_association_version")
            active_assoc = next(
                (a for a in associations if a["version"] == active_assoc_version),
                associations[-1] if associations else None,
            )
    if active_assoc and active_assoc.get("association_path"):
        assoc_path = paths.abs(active_assoc["association_path"])
    else:
        # Legacy fallback
        assoc_path = paths.intermediate_run / "association.csv"
    if assoc_path.exists():
        with open(assoc_path, newline="") as f:
            for row in csv.DictReader(f):
                tif_name = row.get("plot_tif", "")
                # Extract plot index from TIF name: "georeferenced_plot_3_utm.tif" → "3"
                stem = Path(tif_name).stem  # "georeferenced_plot_3_utm"
                parts = stem.split("_")
                # Find the numeric part between "plot" and "utm"
                plot_idx = None
                for i, p in enumerate(parts):
                    if p == "plot" and i + 1 < len(parts):
                        candidate = parts[i + 1]
                        if candidate.isdigit():
                            plot_idx = candidate
                            break
                if plot_idx is not None:
                    assoc_by_idx[plot_idx] = row

    def _get_plot_idx_from_png(png: Path) -> str:
        """Extract plot index from full_res_mosaic_temp_plot_{N}.png"""
        stem = png.stem  # "full_res_mosaic_temp_plot_3"
        parts = stem.split("_")
        for i, p in enumerate(parts):
            if p == "plot" and i + 1 < len(parts):
                candidate = parts[i + 1]
                if candidate.isdigit():
                    return candidate
        return stem

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for png in pngs:
            idx = _get_plot_idx_from_png(png)
            assoc = assoc_by_idx.get(idx)
            if assoc and str(assoc.get("matched", "")).lower() in ("true", "1"):
                plot_label = assoc.get("plot") or assoc.get("Plot") or idx
                row_val = assoc.get("row") or assoc.get("Row") or ""
                col_val = assoc.get("column") or assoc.get("col") or assoc.get("Col") or ""
                accession = assoc.get("accession") or assoc.get("Accession") or ""
                dest_name = f"plot-{plot_label}_row-{row_val}_col-{col_val}_accession-{accession}.png"
            else:
                dest_name = f"plot_{idx}.png"
            zf.write(png, dest_name)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=stitching_v{version}.zip"},
    )


class RenameStitchingRequest(BaseModel):
    name: str | None = None


@router.patch("/pipeline-runs/{id}/stitchings/{version}/rename")
def rename_stitching(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
    body: RenameStitchingRequest,
) -> dict[str, Any]:
    run = _get_run_or_404(session, id)
    outputs = run.outputs or {}
    stitchings = list(outputs.get("stitchings", []))
    # Backward-compat: synthesize entry from flat stitching_version key
    if not stitchings and outputs.get("stitching_version") and int(outputs["stitching_version"]) == version:
        stitchings = [{"version": version, "name": None, "config": {}, "plot_count": 0, "created_at": None, "dir": ""}]
    entry = next((s for s in stitchings if s["version"] == version), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Stitching v{version} not found")
    entry["name"] = body.name or None
    existing = dict(outputs)
    existing["stitchings"] = stitchings
    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(outputs=existing),
    )
    return {"ok": True}


@router.delete("/pipeline-runs/{id}/stitchings/{version}")
def delete_stitching(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
) -> dict[str, Any]:
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    outputs = run.outputs or {}
    stitchings = list(outputs.get("stitchings", []))

    # Backward-compat: if no stitchings list but flat stitching_version exists, treat it as v1
    if not stitchings and outputs.get("stitching_version") and int(outputs["stitching_version"]) == version:
        stitchings = [{"version": version}]

    entry = next((s for s in stitchings if s["version"] == version), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Stitching v{version} not found")

    # Delete directory
    img_dir = paths.agrowstitch_dir(version)
    if img_dir.exists():
        import shutil as _shutil
        _shutil.rmtree(img_dir, ignore_errors=True)

    # Remove from list
    stitchings = [s for s in stitchings if s["version"] != version]
    existing = dict(outputs)
    existing["stitchings"] = stitchings
    # Update stitching_version to the latest remaining if we deleted the active one
    active_version = int(existing.get("stitching_version", version))
    if active_version == version:
        remaining = sorted(stitchings, key=lambda s: s["version"])
        existing["stitching_version"] = remaining[-1]["version"] if remaining else None
    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(outputs=existing),
    )
    return {"ok": True}


# ── Ground: association versions ─────────────────────────────────────────────

@router.get("/pipeline-runs/{id}/associations")
def list_associations(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> list[dict]:
    """Return all association versions stored in run.outputs['associations']."""
    run = _get_run_or_404(session, id)
    associations = list((run.outputs or {}).get("associations", []))
    return sorted(associations, key=lambda a: a["version"], reverse=True)


@router.delete("/pipeline-runs/{id}/associations/{version}")
def delete_association(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int,
) -> dict[str, Any]:
    """Delete a specific association version and its CSV file."""
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    existing = dict(run.outputs or {})
    associations = list(existing.get("associations", []))
    entry = next((a for a in associations if a["version"] == version), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Association v{version} not found")

    # Delete the CSV file
    rel_path = entry.get("association_path", "")
    if rel_path:
        abs_path = paths.abs(rel_path)
        if abs_path.exists():
            abs_path.unlink()

    associations = [a for a in associations if a["version"] != version]
    existing["associations"] = associations

    # Update active version if we deleted it
    active = int(existing.get("active_association_version", version))
    if active == version:
        remaining = sorted(associations, key=lambda a: a["version"])
        existing["active_association_version"] = remaining[-1]["version"] if remaining else None

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(outputs=existing),
    )
    return {"ok": True}


# ── Ground: stitching outputs (live during run) ───────────────────────────────

@router.get("/pipeline-runs/{id}/stitch-outputs")
def get_stitch_outputs(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    version: int | None = None,
) -> dict[str, Any]:
    """
    Return stitched plot images for a stitching version.
    If version is omitted, returns the active stitching version (used for live polling).
    """
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    if version is not None:
        use_version = version
    else:
        # Prefer the DB-stored stitching_version (written early in run_stitching before
        # mkdir so it's available even during the brief window before the directory exists).
        # Only fall back to the highest FS directory when the DB has no record yet — this
        # avoids picking up stale directories from a different run sharing the same
        # processed_run path.
        db_version = int((run.outputs or {}).get("stitching_version") or 0)
        if db_version > 0:
            fs_versions = []
            fs_version = db_version
        else:
            fs_dirs = [
                p for p in paths.processed_run.glob("AgRowStitch_v*")
                if p.is_dir() and p.name[len("AgRowStitch_v"):].isdigit()
            ]
            fs_versions = sorted(int(p.name[len("AgRowStitch_v"):]) for p in fs_dirs)
            fs_version = fs_versions[-1] if fs_versions else 0
        use_version = max(db_version, fs_version) or 1

        logger.info(
            "[stitch-outputs] run=%s db_version=%s fs_versions=%s → use_version=%s processed_run=%s",
            id, db_version, fs_versions, use_version, paths.processed_run,
        )

    img_dir = paths.agrowstitch_dir(use_version)
    logger.info("[stitch-outputs] img_dir=%s exists=%s", img_dir, img_dir.exists())

    if not img_dir.exists():
        return {"plots": [], "version": use_version, "dir": str(img_dir)}

    # Sort by modification time so live preview reflects stitching order
    # (AgRowStitch doesn't stitch in filename-alphabetical order)
    png_files = sorted(img_dir.glob("*.png"), key=lambda p: p.stat().st_mtime)
    plots = [{"name": f.name, "url": f"/api/v1/files/serve?path={f}"} for f in png_files]

    logger.info("[stitch-outputs] version=%s plot_count=%s", use_version, len(plots))
    return {"plots": plots, "version": use_version, "dir": str(img_dir)}


# ── Ground: inference results summary ────────────────────────────────────────

@router.get("/pipeline-runs/{id}/inference-summary")
def get_inference_results(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> list[dict]:
    """
    Return a summary of each inference CSV stored in run.outputs["inference"].

    Handles both:
    - New list format: [{ label, csv_path, stitch_version, association_version, created_at }]
    - Legacy dict format: { label: rel_path }

    Each returned entry includes: label, csv_rel_path, plot_count, total_predictions, classes,
    stitch_version, association_version, created_at.
    """
    import csv as _csv_mod

    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    raw_inference = (run.outputs or {}).get("inference", [])

    if not raw_inference:
        return []

    # Normalise to list format
    if isinstance(raw_inference, dict):
        entries = [
            {"label": lbl, "csv_path": rel, "stitch_version": None, "association_version": None, "created_at": None}
            for lbl, rel in raw_inference.items()
        ]
    else:
        entries = list(raw_inference)

    results = []
    for entry in entries:
        label = entry.get("label", "")
        rel_path = entry.get("csv_path") or entry.get("csv_rel_path", "")
        abs_path = paths.abs(rel_path) if rel_path else None
        result: dict[str, Any] = {
            "label": label,
            "csv_rel_path": rel_path,
            "stitch_version": entry.get("stitch_version"),
            "association_version": entry.get("association_version"),
            "trait_version": entry.get("trait_version"),
            "created_at": entry.get("created_at"),
            "plot_count": 0,
            "total_predictions": 0,
            "classes": {},
        }
        if abs_path and abs_path.exists():
            try:
                with open(abs_path, newline="") as f:
                    rows = list(_csv_mod.DictReader(f))
                result["total_predictions"] = len(rows)
                result["plot_count"] = len({r.get("image") for r in rows if r.get("image")})
                class_counts: dict[str, int] = {}
                for r in rows:
                    cls = r.get("class", "")
                    if cls:
                        class_counts[cls] = class_counts.get(cls, 0) + 1
                result["classes"] = class_counts
            except Exception:
                pass
        results.append(result)

    return results


@router.delete("/pipeline-runs/{id}/inference-results/{label}")
def delete_inference_result(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    label: str,
) -> dict[str, Any]:
    """Delete the inference CSV and remove the entry from run.outputs. Handles both list and legacy dict format."""
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    existing_outputs = dict(run.outputs or {})
    raw_inference = existing_outputs.get("inference", [])

    # Normalise to list
    if isinstance(raw_inference, dict):
        inference_list = [
            {"label": lbl, "csv_path": rel}
            for lbl, rel in raw_inference.items()
        ]
    else:
        inference_list = list(raw_inference)

    entry = next((e for e in inference_list if e.get("label") == label), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"No inference result for label '{label}'")

    rel_path = entry.get("csv_path") or entry.get("csv_rel_path", "")
    if rel_path:
        abs_path = paths.abs(rel_path)
        if abs_path.exists():
            abs_path.unlink()

    inference_list = [e for e in inference_list if e.get("label") != label]

    if inference_list:
        existing_outputs["inference"] = inference_list
    else:
        existing_outputs.pop("inference", None)
        existing_steps = dict(run.steps_completed or {})
        existing_steps.pop("inference", None)
        update_pipeline_run(
            session=session,
            db_run=run,
            run_in=PipelineRunUpdate(steps_completed=existing_steps, outputs=existing_outputs),
        )
        return {"status": "deleted"}

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(outputs=existing_outputs),
    )
    return {"status": "deleted"}


# ── Shared: download crops as ZIP ────────────────────────────────────────────

@router.get("/pipeline-runs/{id}/download-crops")
def download_crops(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    ortho_version: int | None = None,
) -> StreamingResponse:
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    pipeline = session.get(Pipeline, run.pipeline_id)

    # Ground uses AgRowStitch output dir; aerial uses cropped_images/
    if pipeline and pipeline.type == "aerial":
        outputs = run.outputs or {}
        if ortho_version is not None:
            # Verify this version actually has crops recorded
            versioned_key = f"cropped_images_v{ortho_version}"
            if versioned_key not in outputs and "cropped_images" not in outputs:
                raise HTTPException(status_code=404, detail="No crop images found for this orthomosaic version")
        crop_dir = paths.cropped_images_dir
    else:
        version = int((run.outputs or {}).get("stitching_version") or 1)
        crop_dir = paths.agrowstitch_dir(version)

    # Check if pre-cropped images exist; if not, crop on-demand from the orthomosaic
    images_on_disk = (
        sorted(p for p in crop_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif"})
        if crop_dir.exists()
        else []
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        if images_on_disk:
            for img in images_on_disk:
                zf.write(img, img.name)
        elif pipeline and pipeline.type == "aerial":
            # No pre-cropped images — crop on-demand from the orthomosaic
            from app.processing.aerial import crop_plots_to_stream

            outputs = run.outputs or {}
            # Pick the requested ortho version, or the latest available
            orthos = outputs.get("orthomosaics", [])
            if ortho_version is not None:
                ortho_entry = next((o for o in orthos if o["version"] == ortho_version), None)
            else:
                ortho_entry = orthos[-1] if orthos else None

            if not ortho_entry:
                raise HTTPException(status_code=404, detail="No orthomosaic found. Complete the ODM step first.")

            ortho_path = paths.abs(ortho_entry.get("pyramid") or ortho_entry.get("rgb", ""))
            if not ortho_path.exists():
                raise HTTPException(status_code=404, detail="Orthomosaic file not found on disk.")

            boundary_path = paths.plot_boundary_geojson
            if not boundary_path.exists():
                raise HTTPException(status_code=404, detail="Plot boundaries not found. Complete the Plot Boundaries step first.")

            plot_images = crop_plots_to_stream(ortho_path=ortho_path, boundary_path=boundary_path)
            if not plot_images:
                raise HTTPException(status_code=404, detail="No plots could be cropped from the orthomosaic.")

            for filename, data in plot_images:
                zf.writestr(filename, data)
        else:
            raise HTTPException(status_code=404, detail="No crop images found for this run.")

    buf.seek(0)

    version_suffix = f"_v{ortho_version}" if ortho_version is not None else ""
    filename = f"crops_{run.date}_{run.population}{version_suffix}.zip"
    return StreamingResponse(
        iter([buf.read()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Plot-boundary migration ────────────────────────────────────────────────────

@router.post("/migrate/plot-boundaries")
def migrate_plot_boundaries(
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    """
    One-time migration: move Plot-Boundary / Pop-Boundary files from the old
    workspace-scoped path to the new shared (workspace-independent) path and
    update run.outputs references accordingly.

    Old: Intermediate/{workspace}/{year}/{exp}/{loc}/{pop}/Plot-Boundary-WGS84*.geojson
    New: Intermediate/{year}/{exp}/{loc}/{pop}/Plot-Boundary-WGS84*.geojson

    Safe to run multiple times — skips files that have already been moved.
    """
    from sqlmodel import select as _select

    all_runs: list[PipelineRun] = list(session.exec(_select(PipelineRun)).all())

    moved_files: list[str] = []
    updated_runs: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    # Files that need migration from workspace-scoped to shared path
    _BOUNDARY_GLOB = [
        "Plot-Boundary-WGS84.geojson",
        "Plot-Boundary-WGS84_v*.geojson",
        "Pop-Boundary-WGS84.geojson",
        "field_design.csv",
    ]

    for run in all_runs:
        pipeline = session.get(Pipeline, run.pipeline_id)
        if not pipeline:
            continue
        workspace = session.get(Workspace, pipeline.workspace_id)
        if not workspace:
            continue

        paths = RunPaths.from_db(session=session, run=run, workspace=workspace)
        data_root = paths.data_root

        old_year_dir = paths.intermediate_year      # workspace-scoped (old location)
        new_shared_dir = paths.intermediate_shared_pop  # workspace-independent (new location)

        if not old_year_dir.exists():
            continue

        # Collect boundary files that exist in the old location
        boundary_files: list[Path] = []
        for pattern in _BOUNDARY_GLOB:
            boundary_files.extend(old_year_dir.glob(pattern))

        if not boundary_files:
            continue

        new_shared_dir.mkdir(parents=True, exist_ok=True)
        run_changed = False

        for old_file in boundary_files:
            new_file = new_shared_dir / old_file.name
            if new_file.exists():
                skipped.append(str(old_file.relative_to(data_root)))
                continue
            try:
                shutil.copy2(old_file, new_file)
                old_file.unlink()
                moved_files.append(
                    f"{old_file.relative_to(data_root)} → {new_file.relative_to(data_root)}"
                )
                logger.info("migrate: %s → %s", old_file, new_file)
                run_changed = True
            except Exception as exc:
                errors.append(f"{old_file}: {exc}")
                logger.error("migrate error for %s: %s", old_file, exc)

        if not run_changed:
            continue

        # Update run.outputs paths that point into the old workspace-scoped location
        outputs = dict(run.outputs or {})
        changed_outputs = False

        # plot_boundary_prep (canonical path)
        old_rel = outputs.get("plot_boundary_prep", "")
        if old_rel and old_rel.startswith("Intermediate/" + workspace.name + "/"):
            outputs["plot_boundary_prep"] = paths.rel(paths.plot_boundary_geojson)
            changed_outputs = True

        # per-version geojson_path entries
        versions = [dict(v) for v in outputs.get("plot_boundaries", [])]
        for v in versions:
            vpath = v.get("geojson_path", "")
            if vpath and vpath.startswith("Intermediate/" + workspace.name + "/"):
                fname = Path(vpath).name
                v["geojson_path"] = paths.rel(new_shared_dir / fname)
                changed_outputs = True
        if changed_outputs:
            outputs["plot_boundaries"] = versions

        if changed_outputs:
            update_pipeline_run(
                session=session,
                db_run=run,
                run_in=PipelineRunUpdate(outputs=outputs),
            )
            updated_runs.append(str(run.id))

    # Second pass: pick up files from the previous intermediate shared path format
    # Old shared: Intermediate/{year}/{experiment}/{location}/{population}/
    # These were written by an earlier version of the migration.
    seen_run_ids = set(updated_runs)
    for run in all_runs:
        pipeline = session.get(Pipeline, run.pipeline_id)
        if not pipeline:
            continue
        workspace = session.get(Workspace, pipeline.workspace_id)
        if not workspace:
            continue

        paths = RunPaths.from_db(session=session, run=run, workspace=workspace)
        data_root = paths.data_root

        # Old shared path had no workspace, used experiment in segment
        old_shared_dir = (
            data_root / "Intermediate" / paths._year / paths._pop_seg
        )
        new_shared_dir = paths.intermediate_shared_pop

        if not old_shared_dir.exists() or old_shared_dir == new_shared_dir:
            continue

        boundary_files = []
        for pattern in _BOUNDARY_GLOB:
            boundary_files.extend(old_shared_dir.glob(pattern))

        if not boundary_files:
            continue

        new_shared_dir.mkdir(parents=True, exist_ok=True)
        run_changed = False

        for old_file in boundary_files:
            new_file = new_shared_dir / old_file.name
            if new_file.exists():
                skipped.append(str(old_file.relative_to(data_root)))
                continue
            try:
                shutil.copy2(old_file, new_file)
                old_file.unlink()
                moved_files.append(
                    f"{old_file.relative_to(data_root)} → {new_file.relative_to(data_root)}"
                )
                logger.info("migrate (old-shared): %s → %s", old_file, new_file)
                run_changed = True
            except Exception as exc:
                errors.append(f"{old_file}: {exc}")
                logger.error("migrate error for %s: %s", old_file, exc)

        if run_changed and str(run.id) not in seen_run_ids:
            outputs = dict(run.outputs or {})
            changed_outputs = False
            old_rel = outputs.get("plot_boundary_prep", "")
            # Old shared paths started with Intermediate/{year}/ (no workspace)
            year = paths._year
            if old_rel and old_rel.startswith(f"Intermediate/{year}/"):
                outputs["plot_boundary_prep"] = paths.rel(paths.plot_boundary_geojson)
                changed_outputs = True
            versions = [dict(v) for v in outputs.get("plot_boundaries", [])]
            for v in versions:
                vpath = v.get("geojson_path", "")
                if vpath and vpath.startswith(f"Intermediate/{year}/"):
                    fname = Path(vpath).name
                    v["geojson_path"] = paths.rel(new_shared_dir / fname)
                    changed_outputs = True
            if changed_outputs:
                outputs["plot_boundaries"] = versions
                update_pipeline_run(
                    session=session,
                    db_run=run,
                    run_in=PipelineRunUpdate(outputs=outputs),
                )
                updated_runs.append(str(run.id))

    return {
        "moved_files": moved_files,
        "updated_runs": updated_runs,
        "skipped_already_exists": skipped,
        "errors": errors,
    }
