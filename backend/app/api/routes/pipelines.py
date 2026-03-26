import logging
import shutil
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import select

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
    Pipeline,
    PipelineCreate,
    PipelinePublic,
    PipelinesPublic,
    PipelineRun,
    PipelineRunCreate,
    PipelineRunPublic,
    PipelineRunsPublic,
    PipelineRunUpdate,
    PipelineUpdate,
)

logger = logging.getLogger(__name__)

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
    # Block duplicate: same dataset already linked to a run in this pipeline
    if run_in.file_upload_id:
        duplicate = session.exec(
            select(PipelineRun).where(
                PipelineRun.pipeline_id == pipeline_id,
                PipelineRun.file_upload_id == run_in.file_upload_id,
            )
        ).first()
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail="This dataset is already added to this pipeline. Delete the existing run first.",
            )
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

    # ── Safe file cleanup ──────────────────────────────────────────────────
    # Only delete intermediate_run and processed_run if no other pipeline run
    # in the same workspace shares the same date/platform/sensor/exp/loc/pop.
    # The shared intermediate_shared_pop directory (plot boundaries, field design)
    # is NEVER deleted here.
    try:
        from app.core.paths import RunPaths

        pipeline = session.get(Pipeline, run.pipeline_id)
        workspace = get_workspace(session=session, id=pipeline.workspace_id) if pipeline else None
        if workspace:
            paths = RunPaths.from_db(session=session, run=run, workspace=workspace)

            # Find all OTHER runs in this workspace with the same path segment.
            # We join Pipeline → PipelineRun and filter by workspace_id + run metadata.
            sibling_runs = session.exec(
                select(PipelineRun)
                .join(Pipeline, PipelineRun.pipeline_id == Pipeline.id)
                .where(
                    Pipeline.workspace_id == workspace.id,
                    PipelineRun.id != run.id,
                    PipelineRun.date == run.date,
                    PipelineRun.platform == run.platform,
                    PipelineRun.sensor == run.sensor,
                    PipelineRun.experiment == run.experiment,
                    PipelineRun.location == run.location,
                    PipelineRun.population == run.population,
                )
            ).all()

            if not sibling_runs:
                # Safe: this run owns these directories exclusively.
                for dir_path in (paths.intermediate_run, paths.processed_run):
                    if dir_path.exists() and dir_path.is_dir():
                        shutil.rmtree(dir_path)
                        logger.info("Deleted run directory: %s", dir_path)
            else:
                logger.info(
                    "Skipping file cleanup for run %s — %d sibling run(s) share the same path",
                    id, len(sibling_runs),
                )
    except Exception:
        logger.exception("File cleanup failed for run %s — DB record will still be deleted", id)

    delete_pipeline_run(session=session, id=id)
    return Message(message="PipelineRun deleted successfully")
