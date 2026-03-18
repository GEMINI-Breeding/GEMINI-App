import os
import secrets
import sys
import warnings
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import (
    AnyUrl,
    BeforeValidator,
    EmailStr,
    HttpUrl,
    computed_field,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing_extensions import Self


def parse_cors(v: Any) -> list[str] | str:
    if isinstance(v, str) and not v.startswith("["):
        return [i.strip() for i in v.split(",") if i.strip()]
    elif isinstance(v, list | str):
        return v
    raise ValueError(v)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Use top level .env file (one level above ./backend/)
        env_file="../.env",
        env_ignore_empty=True,
        extra="ignore",
    )
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = secrets.token_urlsafe(32)
    # 60 minutes * 24 hours * 8 days = 8 days
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    FRONTEND_HOST: str = "http://localhost:5173"
    ENVIRONMENT: Literal["local", "staging", "production", "desktop"] = (
        "local"  # ← Added "desktop"
    )

    BACKEND_CORS_ORIGINS: Annotated[
        list[AnyUrl] | str, BeforeValidator(parse_cors)
    ] = []

    @computed_field  # type: ignore[prop-decorator]
    @property
    def all_cors_origins(self) -> list[str]:
        base_origins = [
            str(origin).rstrip("/") for origin in self.BACKEND_CORS_ORIGINS
        ] + [self.FRONTEND_HOST]

        # ← ADD THIS:  Extra origins for desktop/Tauri mode
        if self.ENVIRONMENT == "desktop":
            base_origins.extend(
                [
                    "tauri://localhost",
                    "http://tauri.localhost",
                    "https://tauri.localhost",
                ]
            )

        return base_origins

    # Required fields with defaults for desktop mode
    PROJECT_NAME: str = "GEMI"
    FIRST_SUPERUSER: EmailStr = "admin@example.com"
    FIRST_SUPERUSER_PASSWORD: str = "adminpassword"

    SENTRY_DSN: HttpUrl | None = None

    # SQLite database path (if None, uses platform-specific app data directory)
    SQLITE_DB_PATH: str | None = None

    # app data root (storage)
    APP_DATA_ROOT: str = str(Path.home() / "GEMI-Data")

    def _get_default_sqlite_path(self) -> str:
        """Get platform-specific default SQLite path."""
        if sys.platform == "darwin":
            base = Path.home() / "Library" / "Application Support" / "GEMI"
        elif sys.platform == "win32":
            base = Path(os.environ.get("APPDATA", str(Path.home()))) / "GEMI"
        else:
            base = Path.home() / ".local" / "share" / "gemi"

        base.mkdir(parents=True, exist_ok=True)
        return str(base / "gemi.db")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        db_path = self.SQLITE_DB_PATH or self._get_default_sqlite_path()
        return f"sqlite:///{db_path}"

    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: int = 587
    SMTP_HOST: str | None = None
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    EMAILS_FROM_EMAIL: EmailStr | None = None
    EMAILS_FROM_NAME: str | None = None

    @model_validator(mode="after")
    def _set_default_emails_from(self) -> Self:
        if not self.EMAILS_FROM_NAME:
            self.EMAILS_FROM_NAME = self.PROJECT_NAME
        return self

    EMAIL_RESET_TOKEN_EXPIRE_HOURS: int = 48

    @computed_field  # type: ignore[prop-decorator]
    @property
    def emails_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.EMAILS_FROM_EMAIL)

    EMAIL_TEST_USER: EmailStr = "test@example.com"

    def _check_default_secret(self, var_name: str, value: str | None) -> None:
        if value == "changethis":
            message = (
                f'The value of {var_name} is "changethis", '
                "for security, please change it, at least for deployments."
            )
            if self.ENVIRONMENT == "local":
                warnings.warn(message, stacklevel=1)
            else:
                raise ValueError(message)

    @model_validator(mode="after")
    def _enforce_non_default_secrets(self) -> Self:
        # Don't enforce for local/desktop environments
        if self.ENVIRONMENT not in ("local", "desktop"):
            self._check_default_secret("SECRET_KEY", self.SECRET_KEY)
            self._check_default_secret(
                "FIRST_SUPERUSER_PASSWORD", self.FIRST_SUPERUSER_PASSWORD
            )

        return self


settings = Settings()  # type: ignore
