import os
from typing import Any

import psutil
from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.crud.app_settings import get_setting, set_setting
from app.models.app_settings import AppSettingPublic, AppSettingUpdate

router = APIRouter(prefix="/settings", tags=["settings"])

DATA_ROOT_KEY = "data_root"
DOCKER_CPUS_KEY = "docker_cpus"
DOCKER_MEMORY_GB_KEY = "docker_memory_gb"
DOCKER_SWAP_GB_KEY = "docker_swap_gb"


@router.get("/data-root", response_model=AppSettingPublic)
def read_data_root(session: SessionDep, current_user: CurrentUser) -> Any:
    value = get_setting(session=session, key=DATA_ROOT_KEY)
    if value is None:
        value = settings.APP_DATA_ROOT
    return AppSettingPublic(key=DATA_ROOT_KEY, value=value)


@router.put("/data-root", response_model=AppSettingPublic)
def update_data_root(
    *, session: SessionDep, current_user: CurrentUser, setting_in: AppSettingUpdate
) -> Any:
    setting = set_setting(
        session=session, key=DATA_ROOT_KEY, value=setting_in.value
    )
    return setting


class DockerResourcesPublic(BaseModel):
    cpus: float | None = None        # None = no limit
    memory_gb: float | None = None   # None = no limit
    swap_gb: float | None = None     # extra swap on top of memory; None = Docker default (2× RAM)


class DockerResourcesUpdate(BaseModel):
    cpus: float | None = None
    memory_gb: float | None = None
    swap_gb: float | None = None


class SystemInfoPublic(BaseModel):
    cpu_count: int
    total_ram_gb: float


@router.get("/system-info", response_model=SystemInfoPublic)
def read_system_info(current_user: CurrentUser) -> Any:
    cpu_count = os.cpu_count() or 1
    total_ram_gb = round(psutil.virtual_memory().total / (1024 ** 3), 1)
    return SystemInfoPublic(cpu_count=cpu_count, total_ram_gb=total_ram_gb)


@router.get("/docker-resources", response_model=DockerResourcesPublic)
def read_docker_resources(session: SessionDep, current_user: CurrentUser) -> Any:
    def _float(key: str) -> float | None:
        v = get_setting(session=session, key=key)
        try:
            return float(v) if v else None
        except ValueError:
            return None

    return DockerResourcesPublic(
        cpus=_float(DOCKER_CPUS_KEY),
        memory_gb=_float(DOCKER_MEMORY_GB_KEY),
        swap_gb=_float(DOCKER_SWAP_GB_KEY),
    )


@router.put("/docker-resources", response_model=DockerResourcesPublic)
def update_docker_resources(
    *, session: SessionDep, current_user: CurrentUser, body: DockerResourcesUpdate
) -> Any:
    def _save(key: str, val: float | None) -> None:
        if val is not None and val > 0:
            set_setting(session=session, key=key, value=str(val))
        else:
            # Store empty string to mean "no limit"
            set_setting(session=session, key=key, value="")

    _save(DOCKER_CPUS_KEY, body.cpus)
    _save(DOCKER_MEMORY_GB_KEY, body.memory_gb)
    _save(DOCKER_SWAP_GB_KEY, body.swap_gb)

    return DockerResourcesPublic(
        cpus=body.cpus if body.cpus and body.cpus > 0 else None,
        memory_gb=body.memory_gb if body.memory_gb and body.memory_gb > 0 else None,
        swap_gb=body.swap_gb if body.swap_gb and body.swap_gb > 0 else None,
    )
