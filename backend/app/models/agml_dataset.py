"""
SelectedAgmlDataset

Tracks which public AgML datasets a researcher has marked as interesting for
future training. Dataset metadata itself is never persisted here — it is
always read live from the `agml` package (a local, offline lookup) via
`app.processing.agml_utils`; this table only stores the selection itself.

Not workspace-scoped: there is no actual training pipeline to associate a
selection with yet, so the selected-dataset set is global for now.
"""

from datetime import datetime, timezone
from typing import Any

from sqlmodel import Field, SQLModel


class SelectedAgmlDataset(SQLModel, table=True):
    __tablename__ = "selectedagmldataset"

    # The AgML dataset name is the natural key (mirrors AppSetting's
    # key-as-primary-key style) — there's exactly one selection row per
    # dataset name, so a synthetic UUID would add nothing.
    dataset_name: str = Field(primary_key=True, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)
    selected_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


# ---------------------------------------------------------------------------
# Response DTOs — not tables
# ---------------------------------------------------------------------------

class AgmlDatasetLocation(SQLModel):
    continent: str | None = None
    country: str | None = None


class AgmlDatasetPublic(SQLModel):
    name: str
    ml_task: str | None = None
    ag_task: str | None = None
    location: AgmlDatasetLocation | None = None
    n_images: int | None = None
    sensor_modality: str | None = None
    platform: str | None = None
    real_synthetic: str | None = None
    # Most datasets report a single format string, but some report a list
    # (e.g. ['jpg', 'png', 'jpeg', 'JPG']) — confirmed across the full catalog.
    input_data_format: str | list[str] | None = None
    annotation_format: str | None = None
    docs_url: str | None = None
    # Usually a flat {index: label} map, but multi-task datasets (e.g.
    # regression + classification) nest it as {subtask: {index: label}} —
    # confirmed across the full catalog, so this stays untyped at the leaf.
    classes: dict[str, Any] | None = None
    parent_dataset: str | None = None
    selected: bool = False


class SimilarDatasetsPublic(SQLModel):
    source: str
    candidates: list[AgmlDatasetPublic]


class SelectedAgmlDatasetCreate(SQLModel):
    dataset_name: str
    notes: str | None = None


class SelectedAgmlDatasetPublic(SQLModel):
    dataset_name: str
    notes: str | None
    selected_at: str
    # None if agml can no longer resolve this name (e.g. removed/renamed in a
    # later agml version) — degrade gracefully rather than 500 the whole list.
    # Named dataset_metadata, not metadata — SQLModel/SQLAlchemy reserves the
    # `metadata` attribute name on every model class, table or not.
    dataset_metadata: AgmlDatasetPublic | None = None


class LeaderboardPublic(SQLModel):
    """
    Model leaderboard. Currently sourced from agml's own bundled prior
    benchmark data (`source="agml-bundled"`) — a small (~80 row), fully
    offline set of previously-run model results shipped inside the `agml`
    package itself. AgML's own hosted leaderboard is not yet published as a
    fetchable feed; when it is, this same contract can be repointed at that
    URL (`source="agml-github"`) without a breaking response-shape change.
    """
    status: str = "ok"
    source: str | None = "agml-bundled"
    updated_at: str | None = None
    models: list[dict] = Field(default_factory=list)
