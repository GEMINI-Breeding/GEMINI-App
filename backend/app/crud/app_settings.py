from sqlmodel import Session, select

from app.models.app_settings import AppSetting


def get_docker_resource_flags(*, session: Session) -> list[str]:
    """
    Return docker run resource flags based on stored settings.

    Flags included (only when the setting is non-zero):
      --cpus=N           number of CPU cores (float)
      --memory=Nm        RAM limit in MB
      --memory-swap=Nm   total RAM + swap in MB  (memory + swap_extra)

    Returns an empty list when no limits are configured.
    """
    def _f(key: str) -> float | None:
        v = get_setting(session=session, key=key)
        try:
            val = float(v) if v else None
            return val if val and val > 0 else None
        except ValueError:
            return None

    cpus = _f("docker_cpus")
    memory_gb = _f("docker_memory_gb")
    swap_gb = _f("docker_swap_gb")

    flags: list[str] = []
    if cpus:
        flags += [f"--cpus={cpus}"]
    if memory_gb:
        mem_mb = int(memory_gb * 1024)
        flags += [f"--memory={mem_mb}m"]
        if swap_gb:
            # --memory-swap is the TOTAL of RAM + swap
            swap_total_mb = mem_mb + int(swap_gb * 1024)
            flags += [f"--memory-swap={swap_total_mb}m"]
    return flags


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
