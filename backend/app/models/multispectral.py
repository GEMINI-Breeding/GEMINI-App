import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Column
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel


class MultispectralConfig(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    file_upload_id: uuid.UUID = Field(index=True)
    band_count: int
    layout_cols: int
    layout_rows: int
    bands: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    timestamp_source: str = Field(default="none", max_length=20)  # "exif", "filename", "none"
    timestamp_format: str | None = Field(default=None, max_length=100)
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class MultispectralConfigCreate(SQLModel):
    band_count: int
    layout_cols: int
    layout_rows: int
    bands: list[dict[str, Any]]
    timestamp_source: str = "none"
    timestamp_format: str | None = None


class MultispectralConfigPublic(SQLModel):
    id: uuid.UUID
    file_upload_id: uuid.UUID
    band_count: int
    layout_cols: int
    layout_rows: int
    bands: list[dict[str, Any]]
    timestamp_source: str
    timestamp_format: str | None
    created_at: str
