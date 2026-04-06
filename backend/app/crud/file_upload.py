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


def _infer_data_type(platform: str) -> str:
    """Infer data_type from platform directory name."""
    if platform.strip().lower() == "amiga":
        return "Farm-ng Binary File"
    return "Image Data"


def sync_file_uploads(
    *, session: Session, data_root: str, owner_id: uuid.UUID | None = None
) -> dict[str, int]:
    """Reconcile DB records with files on disk.

    - If a record was already marked "missing" and the directory is still gone,
      delete the record entirely (cleanup stale entries).
    - If a directory has just disappeared, mark the record as "missing" so the
      user sees it on the next sync and it gets cleaned up then.
    - If file counts differ, update them.
    - If owner_id is provided, scan Raw/ for platform-level directories that
      have no DB record and create records for them (discovery).
    """
    root = Path(data_root)
    records = session.exec(select(FileUpload)).all()

    synced = 0
    removed = 0

    # Deduplicate: if multiple records share the same storage_path, owner, AND
    # data_type, keep the one with the highest file_count and delete the rest.
    # data_type is included so Orthomosaic (RGB) and Orthomosaic DEM records that
    # share the same directory are NOT merged — they are distinct entries.
    from collections import defaultdict as _dd
    path_groups: dict[tuple, list] = _dd(list)
    for record in records:
        norm = record.storage_path.replace("\\", "/")
        key = (str(record.owner_id) if record.owner_id else "", norm, record.data_type or "")
        path_groups[key].append(record)
    deleted_ids: set = set()
    for key, group in path_groups.items():
        if len(group) <= 1:
            continue
        group.sort(key=lambda r: (r.file_count or 0, str(r.id)), reverse=True)
        for dup in group[1:]:
            logger.info("sync: removing duplicate record for %s (id=%s)", key[1], dup.id)
            session.delete(dup)
            deleted_ids.add(dup.id)
            removed += 1
    if deleted_ids:
        session.commit()

    for record in records:
        if record.id in deleted_ids:
            continue
        dir_path = root / record.storage_path
        dir_gone = not dir_path.exists() or not dir_path.is_dir()
        # Use rglob so subdirectory layouts (e.g. Amiga RGB/Images/) are counted correctly
        empty = (not dir_gone) and sum(1 for f in dir_path.rglob("*") if f.is_file()) == 0

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

        actual_count = sum(1 for f in dir_path.rglob("*") if f.is_file())
        changed = False
        if record.file_count != actual_count:
            logger.info(
                f"sync: file_count {record.file_count} → {actual_count} – {record.storage_path}"
            )
            record.file_count = actual_count
            changed = True
        if record.status in ("missing", "processing"):
            record.status = "completed"
            changed = True
        if changed:
            session.add(record)
            synced += 1

    session.commit()

    # Discovery: scan Raw/{year}/{experiment}/{location}/{population}/{date}/{platform}
    # for directories that have files but no DB record yet.
    discovered = 0
    if owner_id is not None:
        raw_root = root / "Raw"
        if raw_root.is_dir():
            # Normalize existing paths to forward-slash for comparison
            existing_paths = {
                record.storage_path.replace("\\", "/")
                for record in records
            }
            for year_dir in raw_root.iterdir():
                if not year_dir.is_dir():
                    continue
                for exp_dir in year_dir.iterdir():
                    if not exp_dir.is_dir():
                        continue
                    for loc_dir in exp_dir.iterdir():
                        if not loc_dir.is_dir():
                            continue
                        for pop_dir in loc_dir.iterdir():
                            if not pop_dir.is_dir():
                                continue
                            for date_dir in pop_dir.iterdir():
                                if not date_dir.is_dir():
                                    continue
                                for platform_dir in date_dir.iterdir():
                                    if not platform_dir.is_dir():
                                        continue
                                    rel_path = platform_dir.relative_to(root).as_posix()
                                    if rel_path in existing_paths:
                                        continue
                                    # Skip if a deeper record already exists under this path
                                    # (e.g. Raw/.../DJI when Raw/.../DJI/FC6310S/Images exists)
                                    prefix = rel_path + "/"
                                    if any(p.startswith(prefix) for p in existing_paths):
                                        continue
                                    file_count = sum(
                                        1 for f in platform_dir.rglob("*") if f.is_file()
                                    )
                                    if file_count == 0:
                                        continue
                                    platform_name = platform_dir.name
                                    new_record = FileUploadCreate(
                                        data_type=_infer_data_type(platform_name),
                                        experiment=exp_dir.name,
                                        location=loc_dir.name,
                                        population=pop_dir.name,
                                        date=date_dir.name,
                                        platform=platform_name,
                                        storage_path=rel_path,
                                    )
                                    db_item = FileUpload.model_validate(
                                        new_record, update={"owner_id": owner_id}
                                    )
                                    db_item.file_count = file_count
                                    db_item.status = "completed"
                                    session.add(db_item)
                                    logger.info(
                                        f"sync: discovered new record – {rel_path} ({file_count} files)"
                                    )
                                    discovered += 1
            if discovered:
                session.commit()

    # Orthomosaic discovery: scan for {sensor}/Orthomosaic/ directories containing
    # *-RGB.tif and/or *-DEM.tif.  Creates separate "Orthomosaic" and
    # "Orthomosaic DEM" records so both appear in the Manage tab after a Refresh.
    if owner_id is not None:
        raw_root = root / "Raw"
        if raw_root.is_dir():
            # Build lookup keyed on (norm_path, data_type) for fast existence checks
            existing_key_set = {
                (record.storage_path.replace("\\", "/"), record.data_type or "")
                for record in records
            }
            for ortho_dir in raw_root.rglob("Orthomosaic"):
                if not ortho_dir.is_dir():
                    continue
                # Expected layout: Raw/{year}/{exp}/{loc}/{pop}/{date}/{platform}/{sensor}/Orthomosaic
                parts = ortho_dir.relative_to(raw_root).parts
                if len(parts) != 8 or parts[7] != "Orthomosaic":
                    continue
                _, exp, loc, pop, date, platform, sensor, _ = parts
                rel_ortho = ortho_dir.relative_to(root).as_posix()

                type_map = {
                    "Orthomosaic": f"{date}-RGB.tif",
                    "Orthomosaic DEM": f"{date}-DEM.tif",
                }
                for dtype, filename in type_map.items():
                    tif_path = ortho_dir / filename
                    if not tif_path.exists():
                        continue
                    key = (rel_ortho, dtype)
                    if key in existing_key_set:
                        continue
                    new_record = FileUploadCreate(
                        data_type=dtype,
                        experiment=exp,
                        location=loc,
                        population=pop,
                        date=date,
                        platform=platform,
                        sensor=sensor,
                        storage_path=rel_ortho,
                    )
                    db_item = FileUpload.model_validate(
                        new_record, update={"owner_id": owner_id}
                    )
                    db_item.file_count = sum(1 for f in ortho_dir.rglob("*") if f.is_file())
                    db_item.status = "completed"
                    session.add(db_item)
                    existing_key_set.add(key)
                    logger.info(f"sync: discovered orthomosaic record – {rel_ortho} ({dtype})")
                    discovered += 1
        if discovered:
            session.commit()

    logger.info(f"sync complete: synced={synced}, removed={removed}, discovered={discovered}")
    return {"synced": synced, "removed": removed, "discovered": discovered}
