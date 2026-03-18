from collections.abc import Generator
from typing import Annotated

from fastapi import Depends, HTTPException
from sqlmodel import Session, select

from app.core.db import engine
from app.models import User


def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]


def get_current_user(session: SessionDep) -> User:
    user = session.exec(
        select(User).where(User.is_superuser == True).limit(1)
    ).first()
    if not user:
        raise HTTPException(status_code=500, detail="No superuser found in database")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_active_superuser(current_user: CurrentUser) -> User:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="The user doesn't have enough privileges"
        )
    return current_user
