import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.pipeline import Pipeline


# Shared properties
class WorkspaceBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None, max_length=1000)


# Properties to receive on creation
class WorkspaceCreate(WorkspaceBase):
    pass


# Properties to receive on update
class WorkspaceUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=1000)


# Database model
class Workspace(WorkspaceBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    # Who created
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    owner: "User" = Relationship(back_populates="workspaces")
    pipelines: list["Pipeline"] = Relationship(
        back_populates="workspace", cascade_delete=True
    )

    # Timestamps
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# Properties to return via API
class WorkspacePublic(WorkspaceBase):
    id: uuid.UUID
    owner_id: uuid.UUID
    created_at: str


class WorkspacesPublic(SQLModel):
    data: list[WorkspacePublic]
    count: int
