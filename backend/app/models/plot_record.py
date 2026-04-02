"""
PlotRecord — one row per individual plot extracted from any pipeline run.

Tracks every plot that has been processed by trait extraction (aerial) or
inference/association (ground), with full provenance and trait values baked in.

Design goals:
  - Each trait extraction / inference run upserts rows here so the table always
    reflects the current extracted state.
  - The table is queryable independently of GeoJSON files — useful for CLI
    analysis, cross-run comparisons, and future UI features.
  - Records are deleted (via cascade helper) when the parent TraitRecord is
    deleted from the Analyze tab.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Column, UniqueConstraint
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel


class PlotRecord(SQLModel, table=True):
    __tablename__ = "plotrecord"

    __table_args__ = (
        UniqueConstraint(
            "trait_record_id", "plot_id",
            name="uq_plotrecord_trait_plot",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    # ── Provenance ────────────────────────────────────────────────────────────
    trait_record_id: uuid.UUID = Field(index=True)   # → traitrecord.id
    run_id: uuid.UUID = Field(index=True)             # → pipelinerun.id
    pipeline_id: str = Field(max_length=100)
    pipeline_type: str = Field(max_length=20)         # "aerial" | "ground"
    pipeline_name: str = Field(max_length=255)
    workspace_id: str = Field(max_length=100)
    workspace_name: str = Field(max_length=255)

    # ── Upload / run metadata (copied from PipelineRun) ───────────────────────
    date: str = Field(max_length=50)
    experiment: str = Field(default="", max_length=255)
    location: str = Field(default="", max_length=255)
    population: str = Field(default="", max_length=255)
    platform: str = Field(default="", max_length=255)
    sensor: str = Field(default="", max_length=255)

    # ── Version info ──────────────────────────────────────────────────────────
    trait_record_version: int = Field(default=1)
    ortho_version: int | None = Field(default=None)
    ortho_name: str | None = Field(default=None, max_length=255)
    stitch_version: int | None = Field(default=None)
    stitch_name: str | None = Field(default=None, max_length=255)
    boundary_version: int | None = Field(default=None)
    boundary_name: str | None = Field(default=None, max_length=255)

    # ── Plot identity ─────────────────────────────────────────────────────────
    plot_id: str = Field(max_length=255, index=True)
    accession: str | None = Field(default=None, max_length=255, index=True)
    col: str | None = Field(default=None, max_length=100)   # column / bed
    row: str | None = Field(default=None, max_length=100)   # row / tier

    # ── Spatial (WGS84 WKT polygon) ───────────────────────────────────────────
    geometry_wkt: str | None = Field(default=None)

    # ── Trait values — numeric fields from extraction ─────────────────────────
    traits: dict[str, Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )

    # ── All other (non-numeric) properties from the boundary/GeoJSON ─────────
    extra_properties: dict[str, Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )

    # ── Relative path to cropped plot image ───────────────────────────────────
    image_rel_path: str | None = Field(default=None, max_length=1000)

    # ── Detection / inference results (populated after inference step) ─────────
    # Number of detections above the applied confidence threshold for this plot.
    # Non-null when inference has been run and synced; None means unknown.
    detection_count: int | None = Field(default=None)
    # Per-class detection counts: {"classA": 3, "classB": 1} — JSON dict.
    detection_class_summary: dict[str, Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )

    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str | None = Field(default=None)
