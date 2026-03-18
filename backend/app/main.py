import logging
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI
from fastapi.routing import APIRoute
from sqlmodel import Session
from starlette.middleware.cors import CORSMiddleware

from app.api.main import api_router
from app.core.config import settings
from app.core.db import create_db_and_tables, engine, init_db
from app.crud.app_settings import get_setting
from app.crud.file_upload import sync_file_uploads

logger = logging.getLogger(__name__)


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


def _reset_stuck_runs(session: Session) -> int:
    """
    Reset any pipeline runs still marked 'running' to 'failed'.

    These are runs whose background thread was killed when the app was closed
    mid-process. They can never resume, so mark them failed on next startup so
    the user can re-run them.
    """
    from sqlmodel import select
    from app.models.pipeline import PipelineRun, TraitRecord  # noqa: F401 — ensures table is created

    stuck = session.exec(
        select(PipelineRun).where(PipelineRun.status == "running")
    ).all()
    for run in stuck:
        run.status = "failed"
        run.error = "Process was interrupted (app closed while running)"
        session.add(run)
    if stuck:
        session.commit()
        logger.warning("Reset %d stuck pipeline run(s) to 'failed' on startup", len(stuck))
    return len(stuck)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables and initialize database
    create_db_and_tables()
    # Add columns introduced after initial schema (SQLite ALTER TABLE is idempotent via try/except)
    with engine.connect() as _conn:
        for _stmt in [
            "ALTER TABLE traitrecord ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
        ]:
            try:
                _conn.execute(__import__("sqlalchemy").text(_stmt))
                _conn.commit()
            except Exception:
                pass  # Column already exists
    with Session(engine) as session:
        init_db(session)
        _reset_stuck_runs(session)
        # Sync file upload records with disk
        data_root = get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT
        result = sync_file_uploads(session=session, data_root=data_root)
        logger.info(f"Startup sync: {result}")
    yield
    # Shutdown: nothing to do


if settings.SENTRY_DSN and settings.ENVIRONMENT != "local":
    sentry_sdk.init(dsn=str(settings.SENTRY_DSN), enable_tracing=True)

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
    lifespan=lifespan,
)

# Set all CORS enabled origins
if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix=settings.API_V1_STR)
