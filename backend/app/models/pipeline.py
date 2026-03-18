import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import Column
from sqlalchemy.types import JSON
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.workspace import Workspace


# ---------------------------------------------------------------------------
# Pipeline — stores reusable config (type, settings). One per field campaign.
# ---------------------------------------------------------------------------

class PipelineBase(SQLModel):
    name: str = Field(max_length=255)
    type: str = Field(max_length=50)  # "ground" | "aerial"
    # Processing settings: stitch direction / ODM options etc.
    config: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))


class PipelineCreate(PipelineBase):
    workspace_id: uuid.UUID


class PipelineUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    config: dict[str, Any] | None = None


class Pipeline(PipelineBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    workspace_id: uuid.UUID = Field(
        foreign_key="workspace.id", nullable=False, ondelete="CASCADE"
    )
    workspace: "Workspace" = Relationship(back_populates="pipelines")
    runs: list["PipelineRun"] = Relationship(
        back_populates="pipeline", cascade_delete=True
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str | None = Field(default=None)


class PipelinePublic(PipelineBase):
    id: uuid.UUID
    workspace_id: uuid.UUID
    created_at: str
    updated_at: str | None


class PipelinesPublic(SQLModel):
    data: list[PipelinePublic]
    count: int


# ---------------------------------------------------------------------------
# PipelineRun — one execution of a pipeline against a specific date's data.
# ---------------------------------------------------------------------------

class PipelineRunBase(SQLModel):
    # Which data date this run processes (matches FileUpload.date)
    date: str = Field(max_length=50)
    # experiment/location/population/platform/sensor — derived from the
    # FileUpload the user selected; stored here so the run is self-contained.
    experiment: str = Field(max_length=255)
    location: str = Field(max_length=255)
    population: str = Field(max_length=255)
    platform: str = Field(max_length=255)
    sensor: str = Field(max_length=255)
    status: str = Field(default="pending", max_length=50)
    current_step: str | None = Field(default=None, max_length=100)
    # e.g. {"plot_marking": true, "stitching": false, ...}
    steps_completed: dict[str, bool] | None = Field(
        default=None, sa_column=Column(JSON)
    )
    # Paths to key output files per step
    outputs: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    error: str | None = Field(default=None, max_length=2000)


class PipelineRunCreate(PipelineRunBase):
    pipeline_id: uuid.UUID
    # Optional link to the FileUpload record for this date's data
    file_upload_id: uuid.UUID | None = None


class PipelineRunUpdate(SQLModel):
    status: str | None = Field(default=None, max_length=50)
    current_step: str | None = None
    steps_completed: dict[str, bool] | None = None
    outputs: dict[str, Any] | None = None
    error: str | None = None
    completed_at: str | None = None


class PipelineRun(PipelineRunBase, table=True):
    __tablename__ = "pipelinerun"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    pipeline_id: uuid.UUID = Field(
        foreign_key="pipeline.id", nullable=False, ondelete="CASCADE"
    )
    # Optional — links to the FileUpload for the source data
    file_upload_id: uuid.UUID | None = Field(
        default=None, foreign_key="fileupload.id", ondelete="SET NULL"
    )
    pipeline: "Pipeline" = Relationship(back_populates="runs")
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    completed_at: str | None = Field(default=None)


class PipelineRunPublic(PipelineRunBase):
    id: uuid.UUID
    pipeline_id: uuid.UUID
    file_upload_id: uuid.UUID | None
    created_at: str
    completed_at: str | None


class PipelineRunsPublic(SQLModel):
    data: list[PipelineRunPublic]
    count: int


# ---------------------------------------------------------------------------
# TraitRecord — provenance for each trait extraction run.
# Tracks which ortho version + boundary version produced a given traits file.
# ---------------------------------------------------------------------------

class TraitRecord(SQLModel, table=True):
    __tablename__ = "traitrecord"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    run_id: uuid.UUID = Field(
        foreign_key="pipelinerun.id", nullable=False, ondelete="CASCADE"
    )
    # Relative path to the GeoJSON file (via RunPaths.rel())
    geojson_path: str = Field(max_length=1000)
    # Ortho version used (aerial only)
    ortho_version: int | None = Field(default=None)
    ortho_name: str | None = Field(default=None, max_length=255)
    # Boundary version used (None = canonical Plot-Boundary-WGS84.geojson)
    boundary_version: int | None = Field(default=None)
    boundary_name: str | None = Field(default=None, max_length=255)
    # Sequential version number within the run (1-based, auto-incremented)
    version: int = Field(default=1)
    # Summary stats computed at extraction time
    plot_count: int = Field(default=0)
    trait_columns: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    vf_avg: float | None = Field(default=None)
    height_avg: float | None = Field(default=None)
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
