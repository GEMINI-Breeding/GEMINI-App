import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.crud.app_settings import get_setting
from app.crud.workspace import (
    create_workspace,
    delete_workspace,
    get_workspace,
    get_workspaces_by_owner,
    update_workspace,
)
from app.models.file_upload import FileUpload
from app.models.pipeline import Pipeline, PipelineRun
from app.models import Message
from app.models.workspace import (
    WorkspaceCreate,
    WorkspacePublic,
    WorkspacesPublic,
    WorkspaceUpdate,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.post("/", response_model=WorkspacePublic)
def create(
    *, session: SessionDep, current_user: CurrentUser, workspace_in: WorkspaceCreate
) -> Any:
    workspace = create_workspace(
        session=session, workspace_in=workspace_in, owner_id=current_user.id
    )
    return workspace


@router.get("/", response_model=WorkspacesPublic)
def read_all(
    session: SessionDep, current_user: CurrentUser, skip: int = 0, limit: int = 100
) -> Any:
    workspaces = get_workspaces_by_owner(
        session=session, owner_id=current_user.id, skip=skip, limit=limit
    )
    return WorkspacesPublic(
        data=[WorkspacePublic.model_validate(w) for w in workspaces],
        count=len(workspaces),
    )


@router.get("/stats")
def workspace_stats(
    session: SessionDep, current_user: CurrentUser
) -> dict[str, Any]:
    """
    Return aerial/ground run counts for all workspaces owned by the current user.
    Response: { workspace_id: { aerial: N, ground: N } }
    """
    workspaces = get_workspaces_by_owner(session=session, owner_id=current_user.id)
    result: dict[str, Any] = {}
    for ws in workspaces:
        pipelines = session.exec(select(Pipeline).where(Pipeline.workspace_id == ws.id)).all()
        aerial = 0
        ground = 0
        for pipeline in pipelines:
            run_count = len(session.exec(
                select(PipelineRun).where(PipelineRun.pipeline_id == pipeline.id)
            ).all())
            if pipeline.type == "aerial":
                aerial += run_count
            else:
                ground += run_count
        result[str(ws.id)] = {"aerial": aerial, "ground": ground}
    return result


@router.get("/{id}", response_model=WorkspacePublic)
def read_one(session: SessionDep, current_user: CurrentUser, id: uuid.UUID) -> Any:
    workspace = get_workspace(session=session, id=id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    return workspace


@router.put("/{id}", response_model=WorkspacePublic)
def update(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    workspace_in: WorkspaceUpdate,
) -> Any:
    workspace = get_workspace(session=session, id=id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    workspace = update_workspace(
        session=session, db_workspace=workspace, workspace_in=workspace_in
    )
    return workspace


@router.delete("/{id}")
def delete(session: SessionDep, current_user: CurrentUser, id: uuid.UUID) -> Message:
    workspace = get_workspace(session=session, id=id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    delete_workspace(session=session, id=id)
    return Message(message="Workspace deleted successfully")


_IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


@router.get("/{id}/card-images")
def workspace_card_images(
    session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> list[dict]:
    """
    Return up to 2 images for the workspace card: one from the latest aerial run
    and one from the latest ground run (whichever exist).
    """
    workspace = get_workspace(session=session, id=id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    data_root = Path(get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT)

    pipelines = session.exec(
        select(Pipeline).where(Pipeline.workspace_id == id)
    ).all()

    # Collect runs per pipeline type, sorted by date descending
    runs_by_type: dict[str, list[PipelineRun]] = {"aerial": [], "ground": []}
    for pipeline in pipelines:
        runs = session.exec(
            select(PipelineRun).where(PipelineRun.pipeline_id == pipeline.id)
        ).all()
        runs_by_type[pipeline.type].extend(runs)

    for ptype in runs_by_type:
        runs_by_type[ptype].sort(key=lambda r: r.date or "", reverse=True)

    _AERIAL_DATA_TYPES = {"Image Data", "Orthomosaic"}
    _GROUND_DATA_TYPES = {"Farm-ng Binary File", "Image Data"}

    def _frame_for_latest_run(ptype: str) -> dict | None:
        runs = runs_by_type[ptype]
        data_types = _GROUND_DATA_TYPES if ptype == "ground" else _AERIAL_DATA_TYPES
        for run in runs:
            uploads = session.exec(
                select(FileUpload).where(
                    col(FileUpload.data_type).in_(list(data_types)),
                    FileUpload.experiment == run.experiment,
                    FileUpload.location == run.location,
                    FileUpload.population == run.population,
                    FileUpload.date == run.date,
                )
            ).all()
            frames: list[Path] = []
            for upload in uploads:
                img_dir = data_root / upload.storage_path
                if img_dir.exists() and img_dir.is_dir():
                    frames.extend(
                        p for p in img_dir.rglob("*")
                        if p.is_file() and p.suffix.lower() in _IMAGE_EXTS
                    )
            if frames:
                frames.sort()
                mid = frames[len(frames) // 2]
                return {"url": f"/api/v1/files/serve?path={quote(str(mid))}", "type": ptype}
        return None

    results: list[dict] = []
    for ptype in ("aerial", "ground"):
        frame = _frame_for_latest_run(ptype)
        if frame:
            results.append(frame)

    return results
