import uuid
from typing import Any

from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUser, SessionDep
from app.crud.pipeline import (
    create_pipeline,
    create_pipeline_run,
    delete_pipeline,
    delete_pipeline_run,
    get_pipeline,
    get_pipeline_run,
    get_pipelines_by_workspace,
    get_runs_by_pipeline,
    update_pipeline,
    update_pipeline_run,
)
from app.crud.workspace import get_workspace
from app.models import Message
from app.models.pipeline import (
    PipelineCreate,
    PipelinePublic,
    PipelinesPublic,
    PipelineRunCreate,
    PipelineRunPublic,
    PipelineRunsPublic,
    PipelineRunUpdate,
    PipelineUpdate,
)

router = APIRouter(tags=["pipelines"])


# ---------------------------------------------------------------------------
# Pipeline endpoints
# ---------------------------------------------------------------------------

@router.post("/workspaces/{workspace_id}/pipelines", response_model=PipelinePublic)
def create(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: uuid.UUID,
    pipeline_in: PipelineCreate,
) -> Any:
    workspace = get_workspace(session=session, id=workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    # Ensure workspace_id from the URL is used
    pipeline_in.workspace_id = workspace_id
    return create_pipeline(session=session, pipeline_in=pipeline_in)


@router.get("/workspaces/{workspace_id}/pipelines", response_model=PipelinesPublic)
def read_all(
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
) -> Any:
    workspace = get_workspace(session=session, id=workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    pipelines = get_pipelines_by_workspace(
        session=session, workspace_id=workspace_id, skip=skip, limit=limit
    )
    return PipelinesPublic(
        data=[PipelinePublic.model_validate(p) for p in pipelines],
        count=len(pipelines),
    )


@router.get("/pipelines/{id}", response_model=PipelinePublic)
def read_one(session: SessionDep, current_user: CurrentUser, id: uuid.UUID) -> Any:
    pipeline = get_pipeline(session=session, id=id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    workspace = get_workspace(session=session, id=pipeline.workspace_id)
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    return pipeline


@router.put("/pipelines/{id}", response_model=PipelinePublic)
def update(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    pipeline_in: PipelineUpdate,
) -> Any:
    pipeline = get_pipeline(session=session, id=id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    workspace = get_workspace(session=session, id=pipeline.workspace_id)
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    return update_pipeline(session=session, db_pipeline=pipeline, pipeline_in=pipeline_in)


@router.delete("/pipelines/{id}")
def delete(
    session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Message:
    pipeline = get_pipeline(session=session, id=id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    workspace = get_workspace(session=session, id=pipeline.workspace_id)
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    delete_pipeline(session=session, id=id)
    return Message(message="Pipeline deleted successfully")


# ---------------------------------------------------------------------------
# PipelineRun endpoints
# ---------------------------------------------------------------------------

@router.post("/pipelines/{pipeline_id}/runs", response_model=PipelineRunPublic)
def create_run(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    pipeline_id: uuid.UUID,
    run_in: PipelineRunCreate,
) -> Any:
    pipeline = get_pipeline(session=session, id=pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    workspace = get_workspace(session=session, id=pipeline.workspace_id)
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    run_in.pipeline_id = pipeline_id
    return create_pipeline_run(session=session, run_in=run_in)


@router.get("/pipelines/{pipeline_id}/runs", response_model=PipelineRunsPublic)
def read_runs(
    session: SessionDep,
    current_user: CurrentUser,
    pipeline_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
) -> Any:
    pipeline = get_pipeline(session=session, id=pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    workspace = get_workspace(session=session, id=pipeline.workspace_id)
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    runs = get_runs_by_pipeline(
        session=session, pipeline_id=pipeline_id, skip=skip, limit=limit
    )
    return PipelineRunsPublic(
        data=[PipelineRunPublic.model_validate(r) for r in runs],
        count=len(runs),
    )


@router.get("/pipeline-runs/{id}", response_model=PipelineRunPublic)
def read_run(session: SessionDep, current_user: CurrentUser, id: uuid.UUID) -> Any:
    run = get_pipeline_run(session=session, id=id)
    if not run:
        raise HTTPException(status_code=404, detail="PipelineRun not found")
    return run


@router.put("/pipeline-runs/{id}", response_model=PipelineRunPublic)
def update_run(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    run_in: PipelineRunUpdate,
) -> Any:
    run = get_pipeline_run(session=session, id=id)
    if not run:
        raise HTTPException(status_code=404, detail="PipelineRun not found")
    return update_pipeline_run(session=session, db_run=run, run_in=run_in)


@router.delete("/pipeline-runs/{id}")
def delete_run(
    session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Message:
    run = get_pipeline_run(session=session, id=id)
    if not run:
        raise HTTPException(status_code=404, detail="PipelineRun not found")
    delete_pipeline_run(session=session, id=id)
    return Message(message="PipelineRun deleted successfully")
