"""
Analyze endpoints — read-only views of pipeline run outputs.

GET /api/v1/analyze/runs                              list analyzable runs
GET /api/v1/analyze/runs/{run_id}/traits              GeoJSON + numeric metric columns
GET /api/v1/analyze/runs/{run_id}/ortho-info          mosaic path + WGS84 bounds

GET /api/v1/analyze/trait-records                     list all TraitRecords (with joins)
GET /api/v1/analyze/trait-records/{id}/geojson        serve the versioned GeoJSON + columns
GET /api/v1/analyze/trait-records/{id}/ortho-info     version-specific ortho bounds + preview_url
"""

from __future__ import annotations

import csv as _csv
import json
import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from app.api.deps import CurrentUser, SessionDep
from app.core.paths import RunPaths
from app.crud.pipeline import get_pipeline_run
from app.models.pipeline import Pipeline, PipelineRun
from app.models.workspace import Workspace

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analyze", tags=["analyze"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_paths(session: Session, run: PipelineRun) -> RunPaths:
    pipeline = session.get(Pipeline, run.pipeline_id)
    workspace = session.get(Workspace, pipeline.workspace_id)
    return RunPaths.from_db(session=session, run=run, workspace=workspace)


def _is_analyzable(run: PipelineRun, pipeline: Pipeline) -> bool:
    """True if the run has at least one output we can visualise."""
    outputs = run.outputs or {}
    if pipeline.type == "aerial":
        return bool(outputs.get("traits_geojson") or outputs.get("traits") or outputs.get("orthomosaic") or outputs.get("inference"))
    else:
        return bool(outputs.get("georeferencing") or outputs.get("plot_boundaries_geojson") or outputs.get("inference"))


def _read_tif_bounds(tif: Path) -> list[list[float]] | None:
    """Return [[south, west], [north, east]] from a GeoTIFF using rasterio."""
    try:
        import rasterio
        from rasterio.crs import CRS
        from rasterio.warp import transform_bounds

        with rasterio.open(tif) as src:
            l, b, r, t = transform_bounds(src.crs, CRS.from_epsg(4326), *src.bounds)
        return [[b, l], [t, r]]
    except Exception as exc:
        logger.warning("rasterio bounds failed for %s: %s", tif.name, exc)
        return None


def _numeric_columns(features: list[dict]) -> list[str]:
    """Return sorted list of numeric property keys found across all features."""
    cols: set[str] = set()
    # Identity/positional fields — never treated as metrics regardless of their type.
    # Checked case-insensitively because GeoJSON sources vary ("Col", "column", etc.).
    skip = {"plot_id", "plot", "accession", "col", "row", "column", "tier", "bed"}
    for f in features:
        props = f.get("properties") or {}
        for k, v in props.items():
            if k.lower() in skip:
                continue
            if isinstance(v, (int, float)) and v is not True and v is not False:
                cols.add(k)
    return sorted(cols)


# ── 1. List analyzable runs ───────────────────────────────────────────────────

@router.get("/runs")
def list_runs(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[dict[str, Any]]:
    """
    Return all pipeline runs that have at least one analyzable output.
    Includes workspace name, pipeline name/type, run date, and a list of
    available output types (badges).
    """
    runs = session.exec(select(PipelineRun)).all()

    result = []
    for run in runs:
        pipeline = session.get(Pipeline, run.pipeline_id)
        if not pipeline:
            continue
        if not _is_analyzable(run, pipeline):
            continue

        workspace = session.get(Workspace, pipeline.workspace_id)
        outputs = run.outputs or {}

        available: list[str] = []
        if pipeline.type == "aerial":
            if outputs.get("traits_geojson") or outputs.get("traits"):
                available.append("traits")
            if outputs.get("orthomosaic"):
                available.append("orthomosaic")
        else:
            if outputs.get("plot_boundaries_geojson"):
                available.append("boundaries")
            if outputs.get("georeferencing"):
                available.append("mosaic")
        if outputs.get("inference"):
            available.append("inference")

        result.append({
            "run_id": str(run.id),
            "pipeline_id": str(pipeline.id),
            "pipeline_name": pipeline.name,
            "pipeline_type": pipeline.type,
            "workspace_id": str(pipeline.workspace_id) if pipeline else "",
            "workspace_name": workspace.name if workspace else "",
            "date": run.date,
            "experiment": run.experiment,
            "location": run.location,
            "population": run.population,
            "platform": run.platform,
            "sensor": run.sensor,
            "status": run.status,
            "available": available,
            "created_at": run.created_at,
        })

    result.sort(key=lambda r: r["created_at"], reverse=True)
    return result


# ── 2. Traits GeoJSON ─────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/traits")
def get_traits(
    session: SessionDep,
    current_user: CurrentUser,
    run_id: uuid.UUID,
) -> dict[str, Any]:
    """
    Return a GeoJSON FeatureCollection with plot polygons + numeric properties.

    Aerial: reads traits_geojson directly.
    Ground: joins plot_boundaries.geojson with inference CSVs — aggregates
            per-class detection counts per plot so both pipeline types share
            the same response shape.

    Response also includes `metric_columns` — sorted list of numeric property
    keys for the MetricSelector dropdown.
    """
    run = session.get(PipelineRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    pipeline = session.get(Pipeline, run.pipeline_id)
    paths = _get_paths(session, run)
    outputs = run.outputs or {}

    if pipeline and pipeline.type == "aerial":
        traits_rel = outputs.get("traits_geojson") or outputs.get("traits")
        if not traits_rel:
            raise HTTPException(status_code=404, detail="No traits GeoJSON for this run")
        traits_path = paths.abs(traits_rel)
        if not traits_path.exists():
            raise HTTPException(status_code=404, detail=f"Traits file not found: {traits_rel}")
        geojson = json.loads(traits_path.read_text())

    else:
        # Ground: build from plot_boundaries.geojson + inference CSVs
        geo_rel = outputs.get("plot_boundaries_geojson")
        if not geo_rel:
            raise HTTPException(status_code=404, detail="No plot boundaries for this run. Complete georeferencing first.")
        geo_path = paths.abs(geo_rel)
        if not geo_path.exists():
            raise HTTPException(status_code=404, detail="plot_boundaries.geojson not found on disk")

        geojson = json.loads(geo_path.read_text())

        # Aggregate inference counts per plot → join on plot_id (association label).
        # inference output is stored as a list of {label, csv_path, …} entries.
        inference_out = outputs.get("inference")
        if inference_out:
            # Normalise: str (legacy) → {Results: path}, dict (old) → as-is,
            # list (new)  → {entry["label"]: entry["csv_path"]}
            if isinstance(inference_out, str):
                model_paths: dict[str, str] = {"Results": inference_out}
            elif isinstance(inference_out, list):
                model_paths = {
                    e["label"]: e["csv_path"]
                    for e in inference_out
                    if isinstance(e, dict) and e.get("csv_path")
                }
            else:
                model_paths = dict(inference_out)

            # Build {plot_label: {col_key: count}} mapping.
            # Prefer the explicit plot_label column (association label, e.g. "101");
            # fall back to extracting from the image filename (TIF index, e.g. "3").
            plot_counts: dict[str, dict[str, int]] = {}
            for label, rel_path in model_paths.items():
                csv_path = paths.abs(rel_path)
                if not csv_path.exists():
                    continue
                with open(csv_path, newline="") as f:
                    for row in _csv.DictReader(f):
                        plot_id = row.get("plot_label") or _extract_plot_id(row.get("image", ""))
                        if not plot_id:
                            continue
                        cls = row.get("class", label)
                        col_key = f"{label}_{cls}_count" if len(model_paths) > 1 else f"{cls}_count"
                        plot_counts.setdefault(plot_id, {})[col_key] = (
                            plot_counts.get(plot_id, {}).get(col_key, 0) + 1
                        )

            # Add detection count columns to each feature's properties
            for feature in geojson.get("features", []):
                pid = str(feature.get("properties", {}).get("plot_id", ""))
                counts = plot_counts.get(pid, {})
                feature.setdefault("properties", {}).update(counts)
                if counts:
                    feature["properties"]["total_detections"] = sum(counts.values())

    features = geojson.get("features", [])
    metric_columns = _numeric_columns(features)

    return {
        "geojson": geojson,
        "metric_columns": metric_columns,
        "feature_count": len(features),
    }


# ── 4. List TraitRecords ──────────────────────────────────────────────────────

@router.get("/trait-records")
def list_trait_records(
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: uuid.UUID | None = None,
    pipeline_id: uuid.UUID | None = None,
    run_id: uuid.UUID | None = None,
) -> list[dict[str, Any]]:
    """
    Return all TraitRecords with workspace / pipeline / run metadata joined in.
    Optionally filter by workspace_id or pipeline_id.
    """
    from app.models.pipeline import TraitRecord

    records = session.exec(
        select(TraitRecord).order_by(TraitRecord.created_at.desc())
    ).all()

    result = []
    for record in records:
        run = session.get(PipelineRun, record.run_id)
        if not run:
            continue
        pipeline = session.get(Pipeline, run.pipeline_id)
        if not pipeline:
            continue
        if run_id and record.run_id != run_id:
            continue
        if workspace_id and pipeline.workspace_id != workspace_id:
            continue
        if pipeline_id and pipeline.id != pipeline_id:
            continue
        workspace = session.get(Workspace, pipeline.workspace_id)
        run_outputs = run.outputs or {}
        # For ground pipelines, derive stitch version from run outputs
        if pipeline.type == "ground":
            stitch_v = int(run_outputs.get("stitching_version") or 0) or None
            stitchings = run_outputs.get("stitchings") or []
            stitch_entry = next((s for s in stitchings if s.get("version") == stitch_v), None)
            stitch_name = stitch_entry.get("name") if stitch_entry else None
        else:
            stitch_v = None
            stitch_name = None
        result.append({
            "id": str(record.id),
            "run_id": str(record.run_id),
            "pipeline_id": str(pipeline.id),
            "pipeline_name": pipeline.name,
            "pipeline_type": pipeline.type,
            "workspace_id": str(pipeline.workspace_id),
            "workspace_name": workspace.name if workspace else "",
            "date": run.date,
            "experiment": run.experiment,
            "location": run.location,
            "population": run.population,
            "platform": run.platform,
            "sensor": run.sensor,
            "version": record.version,
            "ortho_version": record.ortho_version,
            "ortho_name": record.ortho_name,
            "stitch_version": stitch_v,
            "stitch_name": stitch_name,
            "boundary_version": record.boundary_version,
            "boundary_name": record.boundary_name,
            "plot_count": record.plot_count,
            "trait_columns": record.trait_columns or [],
            "created_at": record.created_at,
        })
    return result


# ── 5. TraitRecord GeoJSON ────────────────────────────────────────────────────

@router.get("/trait-records/{record_id}/geojson")
def get_trait_record_geojson(
    session: SessionDep,
    current_user: CurrentUser,
    record_id: uuid.UUID,
) -> dict[str, Any]:
    """Return the GeoJSON FeatureCollection for a specific TraitRecord."""
    from app.models.pipeline import TraitRecord

    record = session.get(TraitRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Trait record not found")

    run = session.get(PipelineRun, record.run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    pipeline = session.get(Pipeline, run.pipeline_id)
    workspace = session.get(Workspace, pipeline.workspace_id)
    paths = RunPaths.from_db(session=session, run=run, workspace=workspace)

    geojson_path = paths.abs(record.geojson_path)
    if not geojson_path.exists():
        raise HTTPException(status_code=404, detail="GeoJSON file not found on disk")

    geojson = json.loads(geojson_path.read_text())
    features = geojson.get("features", [])
    return {
        "geojson": geojson,
        "metric_columns": _numeric_columns(features),
        "feature_count": len(features),
    }


# ── 6. TraitRecord ortho info (version-specific) ──────────────────────────────

@router.get("/trait-records/{record_id}/ortho-info")
def get_trait_record_ortho_info(
    session: SessionDep,
    current_user: CurrentUser,
    record_id: uuid.UUID,
) -> dict[str, Any]:
    """
    Return ortho bounds and a preview URL for the specific ortho version
    that was used when this TraitRecord was created.

    preview_url is the /pipeline-runs/{id}/orthomosaics/{v}/preview endpoint
    (returns a downscaled JPEG, much faster than serving the full TIF).
    """
    from app.models.pipeline import TraitRecord

    record = session.get(TraitRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Trait record not found")

    run = session.get(PipelineRun, record.run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    pipeline = session.get(Pipeline, run.pipeline_id)
    workspace = session.get(Workspace, pipeline.workspace_id)
    paths = RunPaths.from_db(session=session, run=run, workspace=workspace)
    outputs = run.outputs or {}

    not_available: dict[str, Any] = {"available": False, "bounds": None, "preview_url": None}

    if pipeline and pipeline.type == "aerial":
        orthos = outputs.get("orthomosaics", [])
        target_v = record.ortho_version
        ortho = next((o for o in orthos if o["version"] == target_v), None)
        if not ortho:
            return not_available
        tif_rel = ortho.get("pyramid") or ortho.get("rgb")
        if not tif_rel:
            return not_available
        tif = paths.abs(tif_rel)
        if not tif.exists():
            return not_available
        preview_url = f"/api/v1/pipeline-runs/{run.id}/orthomosaics/{target_v}/preview"
    else:
        geo_rel = outputs.get("georeferencing")
        if not geo_rel:
            return not_available
        stitch_v = int(outputs.get("stitching_version") or 1)
        tif = paths.abs(geo_rel) / "combined_mosaic.tif"
        if not tif.exists():
            return not_available
        preview_url = f"/api/v1/pipeline-runs/{run.id}/mosaic-preview?stitch_version={stitch_v}"

    bounds = _read_tif_bounds(tif)
    return {"available": True, "bounds": bounds, "preview_url": preview_url}


# ── 7. TraitRecord plot image ─────────────────────────────────────────────────

@router.get("/trait-records/{record_id}/plot-image/{plot_id}")
def get_trait_record_plot_image(
    session: SessionDep,
    current_user: CurrentUser,
    record_id: uuid.UUID,
    plot_id: str,
) -> FileResponse:
    """
    Serve the cropped PNG for a single plot from the trait record's run.
    Image is at Processed/.../cropped_images/plot_{plot_id}.png
    """
    from app.models.pipeline import TraitRecord

    record = session.get(TraitRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Trait record not found")

    run = session.get(PipelineRun, record.run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    pipeline = session.get(Pipeline, run.pipeline_id)
    workspace = session.get(Workspace, pipeline.workspace_id)
    paths = RunPaths.from_db(session=session, run=run, workspace=workspace)

    crop_dir = paths.cropped_images_dir
    img_path = crop_dir / f"plot_{plot_id}.png"

    # If exact match not found, search for any file whose stem ends with the plot_id
    # (handles edge cases like "plot_1_1.png" for plot id "1_1")
    if not img_path.exists() and crop_dir.exists():
        matches = list(crop_dir.glob(f"*{plot_id}*.png"))
        if matches:
            img_path = matches[0]

    # For ground pipelines, images live in the AgRowStitch_v{N}/ directory, not cropped_images/.
    # plot_id may be the association label (e.g. "101"); the actual file uses the TIF
    # sequential index (e.g. "3").  Resolve via the enriched plot_boundaries.geojson
    # which stores tif_index alongside plot_id, then fall back to glob patterns.
    if not img_path.exists() and pipeline and pipeline.type == "ground":
        _outputs = run.outputs or {}

        # Try to resolve association label → TIF index via plot_boundaries.geojson
        _tif_index: str | None = None
        _geo_rel = _outputs.get("plot_boundaries_geojson")
        if _geo_rel:
            _geo_path = paths.abs(_geo_rel)
            if _geo_path.exists():
                try:
                    import json as _json
                    _bc = _json.loads(_geo_path.read_text())
                    for _feat in _bc.get("features", []):
                        _props = _feat.get("properties") or {}
                        if str(_props.get("plot_id", "")) == plot_id:
                            _tif_index = str(_props.get("tif_index", "")) or None
                            break
                except Exception:
                    pass

        # Gather all stitch versions to search (most recent first)
        _stitch_versions: list[int] = []
        _stitchings = _outputs.get("stitchings") or []
        for _s in reversed(_stitchings):
            v = _s.get("version")
            if v is not None:
                _stitch_versions.append(int(v))
        _cur_v = _outputs.get("stitching_version")
        if _cur_v is not None and int(_cur_v) not in _stitch_versions:
            _stitch_versions.insert(0, int(_cur_v))
        if not _stitch_versions:
            _stitch_versions = [1]

        for _v in _stitch_versions:
            _stitch_dir = paths.agrowstitch_dir(_v)
            if not _stitch_dir.exists():
                continue
            # Try resolved TIF index first (association label → index mapping)
            for _pid in ([_tif_index, plot_id] if _tif_index and _tif_index != plot_id else [plot_id]):
                if not _pid:
                    continue
                _candidate = _stitch_dir / f"full_res_mosaic_temp_plot_{_pid}.png"
                if _candidate.exists():
                    img_path = _candidate
                    break
                _matches = sorted(_stitch_dir.glob(f"*_{_pid}.png"))
                if _matches:
                    img_path = _matches[0]
                    break
            if img_path.exists():
                break

    if not img_path.exists():
        raise HTTPException(status_code=404, detail=f"Plot image not found for plot {plot_id}. Re-run trait extraction to regenerate.")

    return FileResponse(str(img_path), media_type="image/png")


@router.get("/trait-records/{record_id}/image-plot-ids")
def get_trait_record_image_plot_ids(
    session: SessionDep,
    current_user: CurrentUser,
    record_id: uuid.UUID,
) -> dict:
    """
    Return the list of plot_ids that have a cropped image on disk for this trait record.
    Used by the frontend to highlight which plots have image data available.
    """
    from app.models.pipeline import TraitRecord

    record = session.get(TraitRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Trait record not found")

    run = session.get(PipelineRun, record.run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    pipeline = session.get(Pipeline, run.pipeline_id)
    workspace = session.get(Workspace, pipeline.workspace_id)
    paths = RunPaths.from_db(session=session, run=run, workspace=workspace)

    import re as _re

    crop_dir = paths.cropped_images_dir
    plot_ids: list[str] = []
    if crop_dir.exists():
        for p in sorted(crop_dir.glob("*.png")):
            stem = p.stem  # e.g. "plot_1_1"
            if stem.startswith("plot_"):
                plot_ids.append(stem[5:])  # strip leading "plot_"

    # For ground pipelines, images live in AgRowStitch_v{N}/ directories
    if not plot_ids and pipeline and pipeline.type == "ground":
        _outputs = run.outputs or {}
        _stitch_versions: list[int] = []
        _stitchings = _outputs.get("stitchings") or []
        for _s in _stitchings:
            v = _s.get("version")
            if v is not None:
                _stitch_versions.append(int(v))
        _cur_v = _outputs.get("stitching_version")
        if _cur_v is not None and int(_cur_v) not in _stitch_versions:
            _stitch_versions.append(int(_cur_v))
        if not _stitch_versions:
            _stitch_versions = [1]
        seen: set[str] = set()
        for _v in _stitch_versions:
            _stitch_dir = paths.agrowstitch_dir(_v)
            if not _stitch_dir.exists():
                continue
            for _p in sorted(_stitch_dir.glob("*.png")):
                _m = _re.search(r"_(\d+)$", _p.stem)
                if _m:
                    pid = _m.group(1)
                    if pid not in seen:
                        seen.add(pid)
                        plot_ids.append(pid)

    return {"plot_ids": plot_ids}


@router.delete("/trait-records/{record_id}", status_code=200)
def delete_trait_record(
    session: SessionDep,
    current_user: CurrentUser,
    record_id: uuid.UUID,
) -> None:
    from app.models.pipeline import TraitRecord, PipelineRunUpdate
    from app.crud.pipeline import update_pipeline_run

    record = session.get(TraitRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Trait record not found")

    run = session.get(PipelineRun, record.run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    pipeline = session.get(Pipeline, run.pipeline_id)
    workspace = session.get(Workspace, pipeline.workspace_id)
    paths = RunPaths.from_db(session=session, run=run, workspace=workspace)

    # Delete the GeoJSON file
    paths.abs(record.geojson_path).unlink(missing_ok=True)

    # Delete associated PlotRecords (SQLite doesn't cascade FKs automatically)
    try:
        from app.processing.plot_record_utils import delete_plot_records_for_trait_record
        deleted_pr = delete_plot_records_for_trait_record(session, record_id)
        logger.info("Deleted %d PlotRecord(s) for trait_record %s", deleted_pr, record_id)
    except Exception as _e:
        logger.warning("Could not delete PlotRecords for %s: %s", record_id, _e)

    # Delete any inference results linked to this trait version.
    # Aerial pipelines store inference in run.outputs["inference"] as a list of
    # entries, each with a trait_version field matching the TraitRecord version.
    existing_outputs = dict(run.outputs or {})
    raw_inference = existing_outputs.get("inference", [])
    if isinstance(raw_inference, dict):
        inference_list = [{"label": lbl, "csv_path": rel} for lbl, rel in raw_inference.items()]
    else:
        inference_list = list(raw_inference)
    kept_inference = []
    for entry in inference_list:
        if entry.get("trait_version") == record.version:
            rel_path = entry.get("csv_path") or entry.get("csv_rel_path", "")
            if rel_path:
                paths.abs(rel_path).unlink(missing_ok=True)
            logger.info("Deleted inference result '%s' for trait_version %s", entry.get("label"), record.version)
        else:
            kept_inference.append(entry)
    if kept_inference:
        existing_outputs["inference"] = kept_inference
    elif raw_inference:
        existing_outputs.pop("inference", None)

    # Check remaining records before deleting this one
    remaining = session.exec(
        select(TraitRecord).where(
            TraitRecord.run_id == record.run_id,
            TraitRecord.id != record_id,
        )
    ).all()

    session.delete(record)

    # Build updated steps / outputs
    steps_completed = dict(run.steps_completed or {})
    if not remaining:
        existing_outputs.pop("traits_geojson", None)
        for key in list(existing_outputs.keys()):
            if key == "cropped_images" or key.startswith("cropped_images_v"):
                existing_outputs.pop(key)
        steps_completed.pop("trait_extraction", None)
    # If inference was cleared, also mark the inference step incomplete
    if not kept_inference and raw_inference:
        steps_completed.pop("inference", None)

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(
            outputs=existing_outputs,
            steps_completed=steps_completed,
        ),
    )


def _extract_plot_id(filename: str) -> str | None:
    """Extract numeric plot_id from stitched image filename."""
    import re
    # full_res_mosaic_temp_plot_3.png  or  AgRowStitch_plot-id-3.png
    m = re.search(r"plot[_\-](?:id[_\-])?(\d+)", filename)
    return m.group(1) if m else None


# ── 3. Ortho info (mosaic path + bounds for map overlay) ─────────────────────

@router.get("/runs/{run_id}/ortho-info")
def get_ortho_info(
    session: SessionDep,
    current_user: CurrentUser,
    run_id: uuid.UUID,
) -> dict[str, Any]:
    """
    Return the path and WGS84 bounds of the mosaic image for map display.

    Aerial: {date}-RGB.tif (or Pyramid.tif)
    Ground: combined_mosaic.tif from georeferencing output dir

    Response:
        { available, path, bounds: [[s,w],[n,e]] }
    """
    run = session.get(PipelineRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    pipeline = session.get(Pipeline, run.pipeline_id)
    paths = _get_paths(session, run)
    outputs = run.outputs or {}

    not_available = {"available": False, "path": None, "bounds": None}

    if pipeline and pipeline.type == "ground":
        geo_rel = outputs.get("georeferencing")
        if not geo_rel:
            return not_available
        stitch_v = int(outputs.get("stitching_version") or 1)
        tif = paths.abs(geo_rel) / "combined_mosaic.tif"
        if not tif.exists():
            return not_available
        bounds = _read_tif_bounds(tif)
        preview_url = f"/api/v1/pipeline-runs/{run.id}/mosaic-preview?stitch_version={stitch_v}"
        return {"available": True, "path": None, "bounds": bounds, "preview_url": preview_url}
    else:
        # Resolve the active versioned ortho from run outputs, falling back to
        # legacy unversioned paths for backward compatibility.
        orthos = outputs.get("orthomosaics", [])
        active_v = outputs.get("active_ortho_version")
        active_ortho = next((o for o in orthos if o["version"] == active_v), None)
        if active_ortho:
            # Prefer pyramid (downsampled) for display; fall back to full RGB
            pyramid_rel = active_ortho.get("pyramid") or active_ortho.get("rgb")
            tif = paths.abs(pyramid_rel) if pyramid_rel else paths.aerial_rgb_pyramid
        else:
            # Legacy: single unversioned file
            tif = paths.aerial_rgb_pyramid if paths.aerial_rgb_pyramid.exists() else paths.aerial_rgb

    if not tif.exists():
        return not_available

    bounds = _read_tif_bounds(tif)
    return {"available": True, "path": str(tif), "bounds": bounds}


# ── 8. PlotRecord query ───────────────────────────────────────────────────────

@router.get("/plot-records")
def list_plot_records(
    session: SessionDep,
    current_user: CurrentUser,
    # Provenance filters
    workspace_name: str | None = None,
    pipeline_name: str | None = None,
    pipeline_type: str | None = None,
    date: str | None = None,
    experiment: str | None = None,
    location: str | None = None,
    # Plot identity filters
    plot_id: str | None = None,
    accession: str | None = None,
    col: str | None = None,
    row: str | None = None,
    # Limit / offset for pagination
    limit: int = 500,
    offset: int = 0,
) -> dict[str, Any]:
    """
    Query the PlotRecord table with optional filters.

    All string filters are case-insensitive substring matches.
    Returns matching rows plus total count.

    Example CLI usage (with httpie):
        http GET :8000/api/v1/analyze/plot-records \
            accession==ABC123 \
            "Authorization:Bearer <token>"

    Or with curl:
        curl -s -H "Authorization: Bearer <token>" \
            "http://localhost:8000/api/v1/analyze/plot-records?accession=ABC123" | python3 -m json.tool
    """
    from app.models.plot_record import PlotRecord

    stmt = select(PlotRecord)

    # Apply filters
    def _ilike(col_attr: Any, val: str | None):
        """SQLite LIKE is case-insensitive for ASCII by default."""
        if val:
            return col_attr.like(f"%{val}%")
        return None

    filters = [
        _ilike(PlotRecord.workspace_name, workspace_name),
        _ilike(PlotRecord.pipeline_name, pipeline_name),
        (PlotRecord.pipeline_type == pipeline_type) if pipeline_type else None,
        _ilike(PlotRecord.date, date),
        _ilike(PlotRecord.experiment, experiment),
        _ilike(PlotRecord.location, location),
        _ilike(PlotRecord.plot_id, plot_id),
        _ilike(PlotRecord.accession, accession),
        _ilike(PlotRecord.col, col),
        _ilike(PlotRecord.row, row),
    ]
    for f in filters:
        if f is not None:
            stmt = stmt.where(f)

    total = len(session.exec(stmt).all())
    rows = session.exec(stmt.offset(offset).limit(limit)).all()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "results": [
            {
                "id": str(r.id),
                "plot_id": r.plot_id,
                "accession": r.accession,
                "col": r.col,
                "row": r.row,
                "pipeline_type": r.pipeline_type,
                "pipeline_name": r.pipeline_name,
                "workspace_name": r.workspace_name,
                "date": r.date,
                "experiment": r.experiment,
                "location": r.location,
                "population": r.population,
                "platform": r.platform,
                "sensor": r.sensor,
                "trait_record_version": r.trait_record_version,
                "ortho_version": r.ortho_version,
                "stitch_version": r.stitch_version,
                "boundary_version": r.boundary_version,
                "traits": r.traits,
                "extra_properties": r.extra_properties,
                "image_rel_path": r.image_rel_path,
                "geometry_wkt": r.geometry_wkt,
                "trait_record_id": str(r.trait_record_id),
                "run_id": str(r.run_id),
                "created_at": r.created_at,
            }
            for r in rows
        ],
    }

# ── 9. Master Table ───────────────────────────────────────────────────────────

@router.get("/workspaces/{workspace_id}/master-table")
def get_master_table(
    workspace_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    """
    Workspace-level master table.

    Returns one row per unique (experiment, location, population, plot_id) identity
    found in PlotRecords for this workspace.  For each identity:
      - The most recent PlotRecord per pipeline contributes trait columns prefixed
        with  "<PipelineName>·<trait>".
      - Matched ReferencePlot rows from associated datasets contribute columns
        prefixed with  "<DatasetName>·<trait>".

    Response shape:
    {
      "pipelines":          [{ id, name, type, color }],
      "reference_datasets": [{ id, name, experiment, location, population }],
      "columns": [
        { "key": "PipeA·height", "group": "pipeline",   "pipeline_id": "...",   "label": "height" },
        { "key": "RefDS·lai",    "group": "reference",  "dataset_id": "...",    "label": "lai"    },
      ],
      "rows": [
        {
          "experiment": "...", "location": "...", "population": "...", "plot_id": "...",
          "accession": "...", "col": "...", "row": "...",
          "pipeline_ids": ["..."],
          "PipeA·height": 42.1,
          "RefDS·lai": 3.7,
        }
      ]
    }
    """
    from collections import defaultdict

    from app.models.plot_record import PlotRecord
    from app.models.reference_data import (
        ReferenceDataset,
        ReferencePlot,
        WorkspaceReferenceDataset,
    )

    ws_id_str = str(workspace_id)

    # ── Fetch all PlotRecords for this workspace ──────────────────────────────
    records = session.exec(
        select(PlotRecord).where(PlotRecord.workspace_id == ws_id_str)
    ).all()

    if not records:
        return {
            "pipelines": [],
            "reference_datasets": [],
            "columns": [],
            "rows": [],
        }

    # ── Collect pipeline metadata ─────────────────────────────────────────────
    def _pipeline_color(pipeline_type: str) -> str:
        if pipeline_type == "aerial":
            return "#3B82F6"  # blue
        if pipeline_type == "ground":
            return "#10B981"  # green
        return "#8B5CF6"      # violet fallback

    # Fetch live pipeline names — PlotRecord.pipeline_name is written at creation
    # and won't reflect renames, so prefer the current name from the Pipeline table.
    pipeline_ids = {rec.pipeline_id for rec in records}
    live_pipeline_names: dict[str, str] = {}
    for pid_str in pipeline_ids:
        try:
            p = session.get(Pipeline, uuid.UUID(pid_str))
            if p:
                live_pipeline_names[pid_str] = p.name
        except Exception:
            pass

    pipeline_meta: dict[str, dict] = {}

    for rec in records:
        pid = rec.pipeline_id
        if pid not in pipeline_meta:
            pipeline_meta[pid] = {
                "id": pid,
                "name": live_pipeline_names.get(pid, rec.pipeline_name),
                "type": rec.pipeline_type,
                "color": _pipeline_color(rec.pipeline_type),
            }

    # ── Group records by plot identity ────────────────────────────────────────
    # identity key → { pipeline_id → most-recent PlotRecord }
    # Date is included so pipelines from different dates are never merged.
    PlotKey = tuple  # (experiment, location, population, date, plot_id)

    identity_map: dict[tuple, dict[str, Any]] = defaultdict(dict)

    for rec in records:
        key = (
            rec.experiment or "",
            rec.location or "",
            rec.population or "",
            rec.date or "",
            rec.plot_id or "",
        )
        pid = rec.pipeline_id
        existing = identity_map[key].get(pid)
        if existing is None or rec.created_at > existing.created_at:
            identity_map[key][pid] = rec

    # ── Collect all trait column names per pipeline ───────────────────────────
    # Exclude identity-level fields that are already shown as dedicated columns.
    _IDENTITY_FIELDS = {"experiment", "location", "population", "date", "plot_id", "accession", "col", "row"}

    pipeline_traits: dict[str, set[str]] = defaultdict(set)
    for pipeline_records in identity_map.values():
        for pid, rec in pipeline_records.items():
            for trait_name in (rec.traits or {}).keys():
                if trait_name.lower() not in _IDENTITY_FIELDS:
                    pipeline_traits[pid].add(trait_name)

    # Build ordered pipeline column defs
    column_defs: list[dict[str, str]] = []
    for pid, meta in pipeline_meta.items():
        for trait in sorted(pipeline_traits.get(pid, [])):
            col_key = f"{meta['name']}·{trait}"
            column_defs.append({
                "key": col_key,
                "group": "pipeline",
                "pipeline_id": pid,
                "label": trait,
            })

    # ── Fetch associated reference datasets ───────────────────────────────────
    wrd_rows = session.exec(
        select(WorkspaceReferenceDataset).where(
            WorkspaceReferenceDataset.workspace_id == workspace_id
        )
    ).all()
    dataset_ids = [r.dataset_id for r in wrd_rows]

    ref_datasets: list[Any] = []
    ref_traits: dict[uuid.UUID, set[str]] = defaultdict(set)

    if dataset_ids:
        ref_datasets = session.exec(
            select(ReferenceDataset).where(ReferenceDataset.id.in_(dataset_ids))  # type: ignore[attr-defined]
        ).all()
        for ds in ref_datasets:
            for col in ds.trait_columns or []:
                ref_traits[ds.id].add(col)

    # Build reference column defs — key includes dataset id to avoid collisions
    # when multiple datasets share the same name (e.g. same trial, different dates).
    ref_column_defs: list[dict[str, str]] = []
    for ds in ref_datasets:
        for trait in sorted(ref_traits.get(ds.id, [])):
            col_key = f"ref:{ds.id}:{trait}"
            ref_column_defs.append({
                "key": col_key,
                "group": "reference",
                "dataset_id": str(ds.id),
                "dataset_date": ds.date or "",
                "label": trait,
            })

    # ── Pre-load reference plots for efficient matching ───────────────────────
    # dataset_id → { plot_id → ReferencePlot }
    ref_plot_by_pid: dict[uuid.UUID, dict[str, Any]] = defaultdict(dict)
    # dataset_id → { (col, row) → ReferencePlot } (col+row fallback)
    ref_plot_by_colrow: dict[uuid.UUID, dict[tuple, Any]] = defaultdict(dict)

    if dataset_ids:
        ref_plots = session.exec(
            select(ReferencePlot).where(ReferencePlot.dataset_id.in_(dataset_ids))  # type: ignore[attr-defined]
        ).all()
        for rp in ref_plots:
            ref_plot_by_pid[rp.dataset_id][rp.plot_id] = rp
            if rp.col and rp.row:
                ref_plot_by_colrow[rp.dataset_id][(rp.col, rp.row)] = rp

    # ── Build rows ────────────────────────────────────────────────────────────
    rows: list[dict[str, Any]] = []

    for (exp, loc, pop, date, plot_id), pipeline_records in sorted(identity_map.items()):
        rep_rec = next(iter(pipeline_records.values()))

        row: dict[str, Any] = {
            "experiment": exp,
            "location": loc,
            "population": pop,
            "date": date,
            "plot_id": plot_id,
            "accession": rep_rec.accession,
            "col": rep_rec.col,
            "row": rep_rec.row,
            "pipeline_ids": list(pipeline_records.keys()),
            # Per-pipeline provenance for the Merged Plot Viewer (prefixed __ to exclude from CSV)
            "__records__": {
                pid: {
                    "trait_record_id": str(rec.trait_record_id),
                    "run_id": str(rec.run_id),
                    "pipeline_name": pipeline_meta[pid]["name"],
                }
                for pid, rec in pipeline_records.items()
            },
        }

        # Pipeline traits
        for pid, rec in pipeline_records.items():
            pipe_name = pipeline_meta[pid]["name"]
            for trait, value in (rec.traits or {}).items():
                row[f"{pipe_name}·{trait}"] = value

        # Reference traits — match by plot_id, then col+row fallback
        for ds in ref_datasets:
            rp = ref_plot_by_pid[ds.id].get(plot_id)
            if rp is None and rep_rec.col and rep_rec.row:
                rp = ref_plot_by_colrow[ds.id].get((rep_rec.col, rep_rec.row))
            if rp and rp.traits:
                for trait, value in rp.traits.items():
                    row[f"ref:{ds.id}:{trait}"] = value

        rows.append(row)

    return {
        "pipelines": list(pipeline_meta.values()),
        "reference_datasets": [
            {
                "id": str(ds.id),
                "name": ds.name,
                "experiment": ds.experiment,
                "location": ds.location,
                "population": ds.population,
                "date": ds.date or "",
                "trait_columns": ds.trait_columns or [],
            }
            for ds in ref_datasets
        ],
        "columns": column_defs + ref_column_defs,
        "rows": rows,
    }
