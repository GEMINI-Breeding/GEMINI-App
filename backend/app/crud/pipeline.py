import uuid
from datetime import datetime, timezone

from sqlmodel import Session, select

from app.models.pipeline import (
    Pipeline,
    PipelineCreate,
    PipelineRun,
    PipelineRunCreate,
    PipelineRunUpdate,
    PipelineUpdate,
)


# ---------------------------------------------------------------------------
# Pipeline CRUD
# ---------------------------------------------------------------------------

def create_pipeline(*, session: Session, pipeline_in: PipelineCreate) -> Pipeline:
    db_pipeline = Pipeline.model_validate(pipeline_in)
    session.add(db_pipeline)
    session.commit()
    session.refresh(db_pipeline)
    return db_pipeline


def get_pipeline(*, session: Session, id: uuid.UUID) -> Pipeline | None:
    return session.get(Pipeline, id)


def get_pipelines_by_workspace(
    *, session: Session, workspace_id: uuid.UUID, skip: int = 0, limit: int = 100
) -> list[Pipeline]:
    statement = (
        select(Pipeline)
        .where(Pipeline.workspace_id == workspace_id)
        .offset(skip)
        .limit(limit)
    )
    return list(session.exec(statement).all())


def update_pipeline(
    *, session: Session, db_pipeline: Pipeline, pipeline_in: PipelineUpdate
) -> Pipeline:
    update_data = pipeline_in.model_dump(exclude_unset=True)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    db_pipeline.sqlmodel_update(update_data)
    session.add(db_pipeline)
    session.commit()
    session.refresh(db_pipeline)
    return db_pipeline


def delete_pipeline(*, session: Session, id: uuid.UUID) -> None:
    pipeline = session.get(Pipeline, id)
    if not pipeline:
        raise ValueError("Pipeline not found")
    session.delete(pipeline)
    session.commit()


# ---------------------------------------------------------------------------
# PipelineRun CRUD
# ---------------------------------------------------------------------------

def create_pipeline_run(
    *, session: Session, run_in: PipelineRunCreate
) -> PipelineRun:
    db_run = PipelineRun.model_validate(run_in)
    session.add(db_run)
    session.commit()
    session.refresh(db_run)
    return db_run


def get_pipeline_run(*, session: Session, id: uuid.UUID) -> PipelineRun | None:
    return session.get(PipelineRun, id)


def get_runs_by_pipeline(
    *, session: Session, pipeline_id: uuid.UUID, skip: int = 0, limit: int = 100
) -> list[PipelineRun]:
    statement = (
        select(PipelineRun)
        .where(PipelineRun.pipeline_id == pipeline_id)
        .offset(skip)
        .limit(limit)
    )
    return list(session.exec(statement).all())


def update_pipeline_run(
    *, session: Session, db_run: PipelineRun, run_in: PipelineRunUpdate
) -> PipelineRun:
    update_data = run_in.model_dump(exclude_unset=True)
    db_run.sqlmodel_update(update_data)
    session.add(db_run)
    session.commit()
    session.refresh(db_run)
    return db_run


def delete_pipeline_run(*, session: Session, id: uuid.UUID) -> None:
    run = session.get(PipelineRun, id)
    if not run:
        raise ValueError("PipelineRun not found")
    session.delete(run)
    session.commit()
