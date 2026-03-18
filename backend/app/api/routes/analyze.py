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
        return bool(outputs.get("traits_geojson") or outputs.get("orthomosaic") or outputs.get("inference"))
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
    skip = {"plot_id", "plot", "accession"}
    for f in features:
        props = f.get("properties") or {}
        for k, v in props.items():
            if k in skip:
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
            if outputs.get("traits_geojson"):
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
        traits_rel = outputs.get("traits_geojson")
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

        # Aggregate inference counts per plot image → join on plot_id
        inference_out = outputs.get("inference")
        if inference_out:
            if isinstance(inference_out, str):
                model_paths: dict[str, str] = {"Results": inference_out}
            else:
                model_paths = dict(inference_out)

            # Build {plot_id: {class_label: count}} mapping
            plot_counts: dict[str, dict[str, int]] = {}
            for label, rel_path in model_paths.items():
                csv_path = paths.abs(rel_path)
                if not csv_path.exists():
                    continue
                with open(csv_path, newline="") as f:
                    for row in _csv.DictReader(f):
                        img_name = row.get("image", "")
                        # Image names match stitched plot filenames which encode plot_id
                        # e.g. full_res_mosaic_temp_plot_3.png → plot_id "3"
                        plot_id = _extract_plot_id(img_name)
                        if plot_id is None:
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

    if not img_path.exists():
        raise HTTPException(status_code=404, detail=f"Plot image not found for plot {plot_id}. Re-run trait extraction to regenerate.")

    return FileResponse(str(img_path), media_type="image/png")


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

    # Check remaining records before deleting this one
    remaining = session.exec(
        select(TraitRecord).where(
            TraitRecord.run_id == record.run_id,
            TraitRecord.id != record_id,
        )
    ).all()

    session.delete(record)

    # If no records remain, clean up run outputs and mark step incomplete
    if not remaining:
        existing_outputs = dict(run.outputs or {})
        existing_outputs.pop("traits_geojson", None)
        for key in list(existing_outputs.keys()):
            if key == "cropped_images" or key.startswith("cropped_images_v"):
                existing_outputs.pop(key)
        steps_completed = dict(run.steps_completed or {})
        steps_completed.pop("trait_extraction", None)
        update_pipeline_run(
            session=session,
            db_run=run,
            run_in=PipelineRunUpdate(
                outputs=existing_outputs,
                steps_completed=steps_completed,
            ),
        )
    else:
        session.commit()


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
        tif = paths.aerial_rgb_pyramid if paths.aerial_rgb_pyramid.exists() else paths.aerial_rgb

    if not tif.exists():
        return not_available

    bounds = _read_tif_bounds(tif)
    return {"available": True, "path": str(tif), "bounds": bounds}
