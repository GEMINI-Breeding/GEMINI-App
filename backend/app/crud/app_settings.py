from sqlmodel import Session, select

from app.models.app_settings import AppSetting


def get_setting(*, session: Session, key: str) -> str | None:
    setting = session.exec(
        select(AppSetting).where(AppSetting.key == key)
    ).first()
    if setting:
        return setting.value
    return None


def set_setting(*, session: Session, key: str, value: str) -> AppSetting:
    setting = session.exec(
        select(AppSetting).where(AppSetting.key == key)
    ).first()
    if setting:
        setting.value = value
    else:
        setting = AppSetting(key=key, value=value)
        session.add(setting)
    session.commit()
    session.refresh(setting)
    return setting
