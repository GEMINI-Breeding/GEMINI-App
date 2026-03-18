import logging
import uuid
from pathlib import Path

from sqlmodel import Session, col, select

from app.models import FileUpload, FileUploadCreate, FileUploadUpdate

logger = logging.getLogger(__name__)


def create_file_upload(
    *, session: Session, file_in: FileUploadCreate, owner_id: uuid.UUID
) -> FileUpload:
    db_item = FileUpload.model_validate(file_in, update={"owner_id": owner_id})
    session.add(db_item)
    session.commit()
    session.refresh(db_item)

    return db_item


def get_file_upload(*, session: Session, id: uuid.UUID) -> FileUpload | None:
    statement = select(FileUpload).where(FileUpload.id == id)
    selected_file = session.exec(statement).first()

    return selected_file


def get_file_uploads_by_owner(
    *, session: Session, owner_id: uuid.UUID, skip: int = 0, limit: int = 100
) -> list[FileUpload]:
    statement = (
        select(FileUpload)
        .where(FileUpload.owner_id == owner_id)
        .offset(skip)
        .limit(limit)
    )
    selected_files_owner = session.exec(statement).all()

    return selected_files_owner


def update_file_upload(
    *, session: Session, db_file: FileUpload, file_in: FileUploadUpdate
) -> FileUpload:
    file_data = file_in.model_dump(
        exclude_unset=True
    )  # only includes fields that were sent
    db_file.sqlmodel_update(file_data)
    session.add(db_file)
    session.commit()
    session.refresh(db_file)

    return db_file


def delete_file_upload(*, session: Session, id: uuid.UUID) -> None:
    file_upload = session.get(FileUpload, id)
    if not file_upload:
        raise ValueError("FileUpload not found")
    session.delete(file_upload)
    session.commit()


SUGGESTABLE_FIELDS = ["experiment", "location", "population", "platform", "sensor"]

# Fields ordered for cascading: each field is filtered by all preceding fields.
_CASCADE_ORDER = ["experiment", "location", "population", "platform", "sensor"]


def get_distinct_field_values(
    *,
    session: Session,
    data_type: str | None = None,
    experiment: str | None = None,
    location: str | None = None,
    population: str | None = None,
    platform: str | None = None,
    sensor: str | None = None,
) -> dict[str, list[str]]:
    """Return distinct non-empty values for each suggestable field.

    Cascading: for each target field, apply filters from all fields that
    precede it in _CASCADE_ORDER.
    """
    filter_values: dict[str, str | None] = {
        "data_type": data_type,
        "experiment": experiment,
        "location": location,
        "population": population,
        "platform": platform,
        "sensor": sensor,
    }

    result: dict[str, list[str]] = {}

    for field in SUGGESTABLE_FIELDS:
        column = getattr(FileUpload, field)
        stmt = select(column).distinct()

        # Apply filters from all fields that come before this one in cascade order
        for prev_field in _CASCADE_ORDER:
            if prev_field == field:
                break
            prev_value = filter_values.get(prev_field)
            if prev_value:
                prev_column = getattr(FileUpload, prev_field)
                stmt = stmt.where(prev_column == prev_value)

        # Exclude empty / null values
        stmt = stmt.where(col(column).is_not(None), column != "")

        values = list(session.exec(stmt).all())
        values.sort()
        result[field] = values

    return result


def sync_file_uploads(
    *, session: Session, data_root: str
) -> dict[str, int]:
    """Reconcile DB records with files on disk.

    - If a record was already marked "missing" and the directory is still gone,
      delete the record entirely (cleanup stale entries).
    - If a directory has just disappeared, mark the record as "missing" so the
      user sees it on the next sync and it gets cleaned up then.
    - If file counts differ, update them.
    """
    root = Path(data_root)
    records = session.exec(select(FileUpload)).all()

    synced = 0
    removed = 0

    for record in records:
        dir_path = root / record.storage_path
        dir_gone = not dir_path.exists() or not dir_path.is_dir()
        empty = (not dir_gone) and sum(1 for f in dir_path.iterdir() if f.is_file()) == 0

        if dir_gone or empty:
            if record.status == "missing":
                # Already flagged — remove stale record
                logger.info(f"sync: removing stale record – {record.storage_path}")
                session.delete(record)
                removed += 1
            else:
                record.status = "missing"
                session.add(record)
                logger.info(f"sync: marked missing – {record.storage_path}")
                synced += 1
            continue

        actual_count = sum(1 for f in dir_path.iterdir() if f.is_file())
        changed = False
        if record.file_count != actual_count:
            logger.info(
                f"sync: file_count {record.file_count} → {actual_count} – {record.storage_path}"
            )
            record.file_count = actual_count
            changed = True
        if record.status == "missing":
            record.status = "completed"
            changed = True
        if changed:
            session.add(record)
            synced += 1

    session.commit()
    logger.info(f"sync complete: synced={synced}, removed={removed}")
    return {"synced": synced, "removed": removed}
