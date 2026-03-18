import uuid

from sqlmodel import Session, col, select

from app.models import Workspace, WorkspaceCreate, WorkspaceUpdate


def create_workspace(
    *, session: Session, workspace_in: WorkspaceCreate, owner_id: uuid.UUID
) -> Workspace:
    db_item = Workspace.model_validate(workspace_in, update={"owner_id": owner_id})
    session.add(db_item)
    session.commit()
    session.refresh(db_item)
    return db_item


def get_workspace(*, session: Session, id: uuid.UUID) -> Workspace | None:
    return session.exec(select(Workspace).where(Workspace.id == id)).first()


def get_workspaces_by_owner(
    *, session: Session, owner_id: uuid.UUID, skip: int = 0, limit: int = 100
) -> list[Workspace]:
    statement = (
        select(Workspace)
        .where(Workspace.owner_id == owner_id)
        .offset(skip)
        .limit(limit)
    )
    return list(session.exec(statement).all())


def update_workspace(
    *, session: Session, db_workspace: Workspace, workspace_in: WorkspaceUpdate
) -> Workspace:
    update_data = workspace_in.model_dump(exclude_unset=True)
    db_workspace.sqlmodel_update(update_data)
    session.add(db_workspace)
    session.commit()
    session.refresh(db_workspace)
    return db_workspace


def delete_workspace(*, session: Session, id: uuid.UUID) -> None:
    workspace = session.get(Workspace, id)
    if not workspace:
        raise ValueError("Workspace not found")
    session.delete(workspace)
    session.commit()
