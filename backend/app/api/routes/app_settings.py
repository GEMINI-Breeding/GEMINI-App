from typing import Any

from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.crud.app_settings import get_setting, set_setting
from app.models.app_settings import AppSettingPublic, AppSettingUpdate

router = APIRouter(prefix="/settings", tags=["settings"])

DATA_ROOT_KEY = "data_root"


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
