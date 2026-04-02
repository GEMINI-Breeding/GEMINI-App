"""
Helpers for creating/refreshing PlotRecord rows after trait extraction or inference.

Called from:
  - app.processing.aerial.run_trait_extraction  (aerial)
  - app.processing.ground.run_inference         (ground)

Strategy: delete all existing PlotRecords for a given trait_record_id then bulk
insert fresh ones.  This is correct because each call has the full set of plots
for that TraitRecord.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, select

logger = logging.getLogger(__name__)


def _str(v: Any) -> str | None:
    """Return str(v) unless v is None / NaN / empty."""
    if v is None:
        return None
    s = str(v)
    return s if s not in ("nan", "None", "NaT", "") else None


def upsert_plot_records_from_features(
    *,
    session: Session,
    trait_record_id: uuid.UUID,
    run_id: uuid.UUID,
    pipeline_id: uuid.UUID,
    pipeline_type: str,
    pipeline_name: str,
    workspace_id: uuid.UUID,
    workspace_name: str,
    # Run metadata
    date: str,
    experiment: str,
    location: str,
    population: str,
    platform: str,
    sensor: str,
    # Version info
    trait_record_version: int,
    ortho_version: int | None,
    ortho_name: str | None,
    stitch_version: int | None,
    stitch_name: str | None,
    boundary_version: int | None,
    boundary_name: str | None,
    # Per-plot data
    features: list[dict[str, Any]],   # GeoJSON feature dicts (with "properties" + "geometry")
    cropped_images_rel_dir: str | None = None,  # rel path to cropped_images dir
) -> int:
    """
    Delete old PlotRecords for this trait_record_id, then insert fresh ones.

    Returns the number of rows inserted.
    """
    from app.models.plot_record import PlotRecord

    # Delete existing rows for this trait_record_id
    existing = session.exec(
        select(PlotRecord).where(PlotRecord.trait_record_id == trait_record_id)
    ).all()
    for row in existing:
        session.delete(row)
    if existing:
        session.flush()

    now = datetime.now(timezone.utc).isoformat()
    inserted = 0

    # Deduplicate features by plot_id before inserting — prevents UNIQUE
    # constraint failures when the source GeoJSON contains duplicate entries.
    seen_plot_ids: set[str] = set()

    for feat in features:
        props = feat.get("properties") or {}
        geom = feat.get("geometry")

        # Derive the canonical plot_id
        plot_id = _str(
            props.get("plot_id") or props.get("Plot") or props.get("plot")
            or props.get("id") or props.get("ID")
        )
        if not plot_id:
            continue
        if plot_id in seen_plot_ids:
            logger.debug("plot_record_utils: skipping duplicate plot_id=%s", plot_id)
            continue
        seen_plot_ids.add(plot_id)

        # Accession / label
        accession = _str(
            props.get("Label") or props.get("label")
            or props.get("accession") or props.get("Accession")
        )

        # Column position (Bed / column / col / COL / COLUMN)
        col = _str(
            props.get("Bed") or props.get("bed")
            or props.get("col") or props.get("COL")
            or props.get("column") or props.get("COLUMN")
        )

        # Row position (Tier / tier / row / ROW)
        row = _str(
            props.get("Tier") or props.get("tier")
            or props.get("row") or props.get("ROW")
        )

        # WKT geometry
        geometry_wkt: str | None = None
        if geom:
            try:
                from shapely.geometry import shape as _shape
                geometry_wkt = _shape(geom).wkt
            except Exception:
                try:
                    # Fallback: serialize back to string
                    import json as _json
                    geometry_wkt = _json.dumps(geom)
                except Exception:
                    pass

        # Separate numeric traits from non-numeric extra properties
        NON_PROP = {"plot_id", "Plot", "plot", "id", "ID"}
        traits: dict[str, float] = {}
        extra: dict[str, Any] = {}
        for k, v in props.items():
            if k in NON_PROP:
                continue
            if isinstance(v, (int, float)) and v is not True and v is not False:
                traits[k] = float(v)
            else:
                sv = _str(v)
                if sv is not None:
                    extra[k] = sv

        # Image relative path
        image_rel_path: str | None = None
        if cropped_images_rel_dir:
            image_rel_path = f"{cropped_images_rel_dir}/plot_{plot_id}.png"

        record = PlotRecord(
            trait_record_id=trait_record_id,
            run_id=run_id,
            pipeline_id=str(pipeline_id),
            pipeline_type=pipeline_type,
            pipeline_name=pipeline_name,
            workspace_id=str(workspace_id),
            workspace_name=workspace_name,
            date=date,
            experiment=experiment,
            location=location,
            population=population,
            platform=platform,
            sensor=sensor,
            trait_record_version=trait_record_version,
            ortho_version=ortho_version,
            ortho_name=ortho_name,
            stitch_version=stitch_version,
            stitch_name=stitch_name,
            boundary_version=boundary_version,
            boundary_name=boundary_name,
            plot_id=plot_id,
            accession=accession,
            col=col,
            row=row,
            geometry_wkt=geometry_wkt,
            traits=traits or None,
            extra_properties=extra or None,
            image_rel_path=image_rel_path,
            created_at=now,
        )
        session.add(record)
        inserted += 1

    session.commit()
    logger.info(
        "PlotRecord upsert: trait_record=%s  pipeline=%s(%s)  inserted=%d",
        trait_record_id, pipeline_name, pipeline_type, inserted,
    )
    return inserted


def sync_detection_counts_to_plot_records(
    *,
    session: Session,
    run_id: uuid.UUID,
    predictions: list[dict],
    images: list[dict],
) -> int:
    """
    Populate PlotRecord.detection_count and detection_class_summary from
    inference results for a given run.

    Called lazily (e.g. when the inference-results endpoint is fetched) so the
    DB stays in sync without requiring a separate migration step.

    Returns the number of PlotRecord rows updated.
    """
    from app.models.plot_record import PlotRecord

    if not predictions:
        return 0

    # Build image_name → plot_id mapping from the images list
    img_to_plot: dict[str, str] = {}
    for img in images:
        plot = img.get("plot") or img.get("plot_id") or ""
        name = img.get("name") or img.get("image") or ""
        if plot and name:
            img_to_plot[name] = str(plot)

    if not img_to_plot:
        return 0

    # Aggregate detections per plot_id
    plot_counts: dict[str, int] = {}
    plot_classes: dict[str, dict[str, int]] = {}
    for pred in predictions:
        img_name = pred.get("image", "")
        plot_id = img_to_plot.get(img_name)
        if not plot_id:
            continue
        cls = str(pred.get("class", "unknown"))
        plot_counts[plot_id] = plot_counts.get(plot_id, 0) + 1
        plot_classes.setdefault(plot_id, {})[cls] = plot_classes[plot_id].get(cls, 0) + 1

    if not plot_counts:
        return 0

    # Update matching PlotRecord rows for this run
    records = session.exec(
        select(PlotRecord).where(PlotRecord.run_id == run_id)
    ).all()

    updated = 0
    for record in records:
        pid = record.plot_id
        if pid in plot_counts:
            record.detection_count = plot_counts[pid]
            record.detection_class_summary = plot_classes.get(pid, {})
            session.add(record)
            updated += 1
        elif record.detection_count is None:
            # Mark as "no detections" so we don't keep querying
            record.detection_count = 0
            session.add(record)

    if updated or records:
        session.commit()

    logger.info(
        "sync_detection_counts: run=%s  plots_with_detections=%d  total_updated=%d",
        run_id, updated, len(records),
    )
    return updated


def delete_plot_records_for_trait_record(
    session: Session,
    trait_record_id: uuid.UUID,
) -> int:
    """Delete all PlotRecords for a given trait_record_id. Returns count deleted."""
    from app.models.plot_record import PlotRecord

    rows = session.exec(
        select(PlotRecord).where(PlotRecord.trait_record_id == trait_record_id)
    ).all()
    for row in rows:
        session.delete(row)
    session.commit()
    return len(rows)
