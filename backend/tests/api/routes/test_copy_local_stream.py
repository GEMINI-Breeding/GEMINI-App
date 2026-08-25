"""
Tests for POST /files/copy-local-stream (backend/app/api/routes/files.py),
focused on two bugs surfaced by the Guided Upload thermal flow:

1. A batch where every source file was already present at the destination
   (skipped as a duplicate, not an error) must still report success with a
   usable destination directory in the "complete" SSE event — a caller
   can't rely on any individual file's dest_path to find out where the
   batch landed if nothing was actually copied.
2. Re-uploading into an existing FileUpload record's directory with a new
   image_type must update that record's tag, not silently leave it
   untagged forever (which would hide it from thermal conversion resume
   detection — see GET /thermal/pending-conversions).

Sets data_root to a temp directory for the duration of each test and
restores the original value afterward, since these tests actually copy
files into it.
"""

import json
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings


def _sse_events(text: str) -> list[dict]:
    return [
        json.loads(line[len("data: "):])
        for line in text.splitlines()
        if line.startswith("data: ")
    ]


@pytest.fixture()
def isolated_data_root(client: TestClient, tmp_path: Path) -> Generator[Path, None, None]:
    original = client.get(f"{settings.API_V1_STR}/settings/data-root").json()["value"]
    data_root = tmp_path / "data_root"
    data_root.mkdir()
    response = client.put(
        f"{settings.API_V1_STR}/settings/data-root", json={"value": str(data_root)}
    )
    assert response.status_code == 200
    try:
        yield data_root
    finally:
        client.put(f"{settings.API_V1_STR}/settings/data-root", json={"value": original})


def _upload(client: TestClient, file_paths: list[str], **overrides) -> dict:
    body = {
        "file_paths": file_paths,
        "data_type": "Image Data",
        "target_root_dir": "Raw/2026/Exp1/LocA/Pop1/2026-06-22/DJI/Thermal/Images",
        "experiment": "Exp1",
        "location": "LocA",
        "population": "Pop1",
        "date": "2026-06-22",
        "platform": "DJI",
        "sensor": "Thermal",
        **overrides,
    }
    response = client.post(f"{settings.API_V1_STR}/files/copy-local-stream", json=body)
    assert response.status_code == 200
    events = _sse_events(response.text)
    complete = next(e for e in events if e["event"] == "complete")
    return complete


def test_complete_event_reports_dest_dir_and_file_upload_id(
    client: TestClient, isolated_data_root: Path, tmp_path: Path
) -> None:
    src = tmp_path / "DJI_20260622094800_0001_T.JPG"
    src.write_bytes(b"fake")

    complete = _upload(client, [str(src)], image_type="thermal")

    assert complete["has_errors"] is False
    assert complete["count"] == 1
    assert complete["file_upload_id"]
    assert complete["dest_dir"] == str(
        isolated_data_root / "Raw/2026/Exp1/LocA/Pop1/2026-06-22/DJI/Thermal/Images"
    )


def test_all_files_already_present_still_succeeds_with_dest_dir(
    client: TestClient, isolated_data_root: Path, tmp_path: Path
) -> None:
    src = tmp_path / "DJI_20260622094800_0001_T.JPG"
    src.write_bytes(b"fake")

    first = _upload(client, [str(src)], image_type="thermal")
    assert first["count"] == 1

    # Re-run over the same source — every file is already at the
    # destination, so nothing gets (re-)copied this time.
    second = _upload(client, [str(src)], image_type="thermal")
    assert second["has_errors"] is False
    assert second["count"] == 0
    assert second["skipped"] == ["DJI_20260622094800_0001_T.JPG"]
    assert second["dest_dir"] == first["dest_dir"]
    assert second["file_upload_id"] == first["file_upload_id"]


def test_reupload_with_image_type_tags_existing_untagged_record(
    client: TestClient, isolated_data_root: Path, tmp_path: Path
) -> None:
    src = tmp_path / "DJI_20260622094800_0001_T.JPG"
    src.write_bytes(b"fake")

    # First upload has no image_type (e.g. the plain Upload tab, or a
    # directory uploaded before this tag existed).
    first = _upload(client, [str(src)], image_type=None)

    # A later Guided Upload pass over the same directory tags it thermal —
    # the existing record (matched by storage_path) should pick up the tag.
    second = _upload(client, [str(src)], image_type="thermal")
    assert second["file_upload_id"] == first["file_upload_id"]

    from app.crud.file_upload import get_file_upload
    from app.api.deps import get_db
    with next(get_db()) as session:
        import uuid
        record = get_file_upload(session=session, id=uuid.UUID(second["file_upload_id"]))
        assert record is not None
        assert record.image_type == "thermal"
