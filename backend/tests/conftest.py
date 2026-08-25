import os
import tempfile
from collections.abc import Generator
from pathlib import Path

# Must run before any `app.*` import: `app.core.config.settings` is a
# module-level singleton, so whatever SQLITE_DB_PATH/APP_DATA_ROOT are set to
# at that first import become fixed for the whole test session. Previously
# unset, so tests silently shared the developer's real gemi.db/GEMI-Data —
# and the session-scoped `db` fixture below deletes all Users at teardown,
# which orphaned every real FileUpload/Workspace row (owner_id kept pointing
# at a superuser that got deleted then recreated with a fresh UUID by the
# next `init_db` call), making previously-uploaded files disappear from the
# app despite the rows still existing on disk. Isolate the whole test
# session in a throwaway temp dir instead.
_TEST_STATE_DIR = Path(tempfile.mkdtemp(prefix="gemi-test-"))
os.environ.setdefault("SQLITE_DB_PATH", str(_TEST_STATE_DIR / "test.db"))
os.environ.setdefault("APP_DATA_ROOT", str(_TEST_STATE_DIR / "data"))

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core.config import settings
from app.core.db import engine, init_db
from app.main import app
from app.models import Item, User
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        init_db(session)
        yield session
        statement = delete(Item)
        session.execute(statement)
        statement = delete(User)
        session.execute(statement)
        session.commit()


@pytest.fixture(scope="module")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
