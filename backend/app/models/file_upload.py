import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.user import User


# Shared properties
class FileUploadBase(SQLModel):
    data_type: str = Field(max_length=100)  # "Image Data", "Weather Data", etc.
    experiment: str = Field(max_length=255)
    location: str = Field(max_length=255)
    population: str = Field(max_length=255)
    date: str = Field(max_length=50)
    platform: str | None = Field(default=None, max_length=255)
    sensor: str | None = Field(default=None, max_length=255)
    storage_path: str = Field(max_length=1000)  # where files are stored


# Properties to receive on creation
class FileUploadCreate(FileUploadBase):
    pass


# Properties to receive on update
class FileUploadUpdate(SQLModel):
    data_type: str | None = Field(default=None, max_length=100)
    experiment: str | None = Field(default=None, max_length=255)
    location: str | None = Field(default=None, max_length=255)
    population: str | None = Field(default=None, max_length=255)
    date: str | None = Field(default=None, max_length=50)
    platform: str | None = Field(default=None, max_length=255)
    sensor: str | None = Field(default=None, max_length=255)
    storage_path: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, max_length=50)
    file_count: int | None = None
    notes: str | None = Field(default=None, max_length=1000)


# Database model
class FileUpload(FileUploadBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    # Who uploaded
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    owner: "User" = Relationship(back_populates="file_uploads")

    # Additional useful fields
    original_filename: str | None = Field(default=None, max_length=500)
    file_count: int = Field(default=1)  # number of files in batch
    file_size_bytes: int | None = Field(default=None)  # total size
    status: str = Field(default="pending", max_length=50)  # pending, processing, completed, failed
    notes: str | None = Field(default=None, max_length=1000)

    # Timestamps
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str | None = Field(default=None)


# Properties to return via API
class FileUploadPublic(FileUploadBase):
    id: uuid.UUID
    owner_id: uuid.UUID
    original_filename: str | None
    file_count: int
    file_size_bytes: int | None
    status: str
    notes: str | None
    created_at: str


class FileUploadsPublic(SQLModel):
    data: list[FileUploadPublic]
    count: int
