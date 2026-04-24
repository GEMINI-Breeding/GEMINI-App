from fastapi import APIRouter

from app.api.routes import analyze, app_settings, files, items, login, pipelines, private, processing, users, utils, workspaces
from app.api.routes.reference_data import router as reference_data_router, workspace_ref_router
from app.api.routes.multispectral import router as multispectral_router
from app.api.routes.sensor_match import router as sensor_match_router
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
api_router.include_router(files.router)
api_router.include_router(app_settings.router)
api_router.include_router(workspaces.router)
api_router.include_router(pipelines.router)
api_router.include_router(processing.router)
api_router.include_router(analyze.router)
api_router.include_router(reference_data_router)
api_router.include_router(workspace_ref_router)
api_router.include_router(multispectral_router)
api_router.include_router(sensor_match_router)


if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
