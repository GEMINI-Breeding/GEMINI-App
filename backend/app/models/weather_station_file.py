"""
WeatherStationFile — an uploaded weather-station log (e.g. a Campbell
Scientific TOA5 .dat file) used to match per-image humidity/ambient
temperature by nearest timestamp during thermal image conversion.

Global resource, not tied to a workspace or pipeline run — a weather file is
matched to images by timestamp, not by plot identity, so it doesn't fit
ReferenceDataset's workspace-association model. Standalone table, same
shape/precedent as ReferenceDataset (backend/app/models/reference_data.py).
"""

import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class WeatherStationFile(SQLModel, table=True):
    __tablename__ = "weatherstationfile"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    name: str = Field(max_length=255)
    # Parser format key — see thermal_utils.SUPPORTED_WEATHER_FORMATS
    format: str = Field(default="toa5", max_length=50)

    original_filename: str | None = Field(default=None, max_length=500)
    # Stored relative to data_root/weather_data/{id}/
    file_path: str = Field(max_length=1000)

    # Summary populated at upload time
    row_count: int = Field(default=0)
    start_time: str | None = Field(default=None, max_length=50)
    end_time: str | None = Field(default=None, max_length=50)

    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class WeatherStationFilePublic(SQLModel):
    id: uuid.UUID
    name: str
    format: str
    original_filename: str | None
    row_count: int
    start_time: str | None
    end_time: str | None
    created_at: str
