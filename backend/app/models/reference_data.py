"""
ReferenceDataset / ReferencePlot / WorkspaceReferenceDataset

Reference Data is hand-measured field data uploaded by the user (CSV or Excel).
It has no plot boundaries — it is matched to PlotRecords at query time by:
  (experiment, location, population, plot_id)  OR  (experiment, location, population, col, row)

A ReferenceDataset is workspace-agnostic on upload; it is associated with one
or more workspaces via the WorkspaceReferenceDataset join table.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Column, UniqueConstraint
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel


# ---------------------------------------------------------------------------
# ReferenceDataset — one upload batch (e.g. "LAI Hand Measurements Apr 2024")
# ---------------------------------------------------------------------------

class ReferenceDataset(SQLModel, table=True):
    __tablename__ = "referencedataset"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    # User-assigned name (required at upload time)
    name: str = Field(max_length=255)

    # Metadata from upload form — used for workspace association filtering
    experiment: str = Field(default="", max_length=255)
    location: str = Field(default="", max_length=255)
    population: str = Field(default="", max_length=255)
    date: str = Field(default="", max_length=50)  # metadata only — not a match key

    # Maps original file column name → canonical field (plot_id / col / row / accession / trait name)
    column_mapping: dict[str, str] | None = Field(
        default=None, sa_column=Column(JSON)
    )

    # Summary — populated after parsing
    plot_count: int = Field(default=0)
    trait_columns: list[str] = Field(default_factory=list, sa_column=Column(JSON))

    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class ReferenceDatasetPublic(SQLModel):
    id: uuid.UUID
    name: str
    experiment: str
    location: str
    population: str
    date: str
    plot_count: int
    trait_columns: list[str]
    created_at: str


# ---------------------------------------------------------------------------
# ReferencePlot — one row per plot in a ReferenceDataset
# ---------------------------------------------------------------------------

class ReferencePlot(SQLModel, table=True):
    __tablename__ = "referenceplot"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    dataset_id: uuid.UUID = Field(
        foreign_key="referencedataset.id", nullable=False, ondelete="CASCADE", index=True
    )

    # Plot identity (from column mapping)
    plot_id: str = Field(default="", max_length=255, index=True)
    col: str | None = Field(default=None, max_length=100)
    row: str | None = Field(default=None, max_length=100)
    accession: str | None = Field(default=None, max_length=255)

    # Numeric trait measurements: { trait_name: float }
    traits: dict[str, Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )


class ReferencePlotPublic(SQLModel):
    id: uuid.UUID
    dataset_id: uuid.UUID
    plot_id: str
    col: str | None
    row: str | None
    accession: str | None
    traits: dict[str, Any] | None


# ---------------------------------------------------------------------------
# WorkspaceReferenceDataset — join table linking datasets to workspaces
# ---------------------------------------------------------------------------

class WorkspaceReferenceDataset(SQLModel, table=True):
    __tablename__ = "workspacereferencedataset"

    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "dataset_id",
            name="uq_workspace_refdataset",
        ),
    )

    workspace_id: uuid.UUID = Field(
        foreign_key="workspace.id", primary_key=True, ondelete="CASCADE"
    )
    dataset_id: uuid.UUID = Field(
        foreign_key="referencedataset.id", primary_key=True, ondelete="CASCADE"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class MatchReport(SQLModel):
    """Returned after upload or association to show how many plots matched."""
    total: int
    matched: int
    unmatched: int
    unmatched_plots: list[dict[str, str]]  # list of {plot_id, col, row} for unmatched rows


class ReferenceDatasetWithMatch(ReferenceDatasetPublic):
    match_report: MatchReport | None = None


class ReferencePlotsPublic(SQLModel):
    data: list[ReferencePlotPublic]
    count: int
