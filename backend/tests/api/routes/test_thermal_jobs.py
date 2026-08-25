"""
Tests for the upload-scoped thermal conversion job routes
(GET /thermal/scan-directory, POST/GET /thermal/convert-directory).

No real DJI R-JPEG sample or SDK library is available in this environment,
so these exercise the routes' own logic (directory validation, job
creation/polling, 404s) and the job's early-exit paths (no thermal images
found, missing SDK) — not the actual SDK-backed conversion, same caveat as
test_thermal_utils.py.
"""

import time
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import User
from app.models.file_upload import FileUpload
from app.processing import thermal_utils


def _poll_until_terminal(client: TestClient, job_id: str, timeout_s: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        response = client.get(f"{settings.API_V1_STR}/thermal/convert-directory/{job_id}")
        assert response.status_code == 200
        status = response.json()
        if status["status"] in ("done", "error"):
            return status
        time.sleep(0.1)
    raise AssertionError(f"Job {job_id} did not reach a terminal state within {timeout_s}s")


def test_scan_directory(client: TestClient, tmp_path: Path) -> None:
    t1 = tmp_path / "DJI_20260622094800_0001_T.JPG"
    v1 = tmp_path / "DJI_20260622094800_0001_V.JPG"
    t2 = tmp_path / "DJI_20260622094900_0002_T.JPG"
    extraneous = tmp_path / "notes.txt"
    t1.touch()
    v1.touch()
    t2.touch()
    extraneous.touch()

    response = client.get(
        f"{settings.API_V1_STR}/thermal/scan-directory",
        params={"path": str(tmp_path), "platform": "dji"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total_count"] == 4
    assert body["thermal_count"] == 2
    assert body["paired_count"] == 1
    assert body["other_count"] == 1
    assert set(body["thermal_paths"]) == {str(t1), str(t2)}
    assert set(body["rgb_paths"]) == {str(v1)}


def test_scan_directory_not_found(client: TestClient) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/thermal/scan-directory",
        params={"path": "/nonexistent/directory/path"},
    )
    assert response.status_code == 404


def test_convert_directory_not_found(client: TestClient) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/thermal/convert-directory",
        json={"path": "/nonexistent/directory/path"},
    )
    assert response.status_code == 404


def test_convert_directory_no_thermal_images(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "readme.txt").touch()

    response = client.post(
        f"{settings.API_V1_STR}/thermal/convert-directory",
        json={"path": str(tmp_path), "platform": "dji"},
    )
    assert response.status_code == 200
    job_id = response.json()["job_id"]

    status = _poll_until_terminal(client, job_id)
    assert status["status"] == "error"
    assert "No thermal images found" in status["error"]


def test_convert_directory_missing_sdk(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Isolate from whatever may actually be vendored on the machine running
    # this test (e.g. a dev box that's vendored the real SDK to test
    # conversion for real) — this test is specifically about the
    # nothing-vendored case, which is otherwise no longer reliably true.
    monkeypatch.setattr(thermal_utils, "_bundled_dji_sdk_dir", lambda: tmp_path / "does_not_exist")

    source_dir = tmp_path / "source"
    source_dir.mkdir()
    (source_dir / "DJI_20260622094800_0001_T.JPG").write_bytes(b"fake")

    response = client.post(
        f"{settings.API_V1_STR}/thermal/convert-directory",
        json={"path": str(source_dir), "platform": "dji"},
    )
    job_id = response.json()["job_id"]

    status = _poll_until_terminal(client, job_id)
    assert status["status"] == "error"
    assert status["total"] == 1
    assert "DJI Thermal SDK" in status["error"]


def test_convert_directory_status_404_for_unknown_job(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/thermal/convert-directory/{uuid.uuid4()}")
    assert response.status_code == 404


def _make_thermal_upload(db: Session, directory: Path, *, image_type: str = "thermal") -> FileUpload:
    superuser = db.exec(select(User).where(User.is_superuser == True)).first()  # noqa: E712
    assert superuser
    record = FileUpload(
        data_type="Image Data",
        experiment="Exp1",
        location="LocA",
        population="Pop1",
        date="2026-06-22",
        platform="DJI",
        sensor="Thermal",
        image_type=image_type,
        storage_path=str(directory),
        owner_id=superuser.id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def test_pending_conversions_lists_unconverted_thermal_upload(
    client: TestClient, db: Session, tmp_path: Path
) -> None:
    directory = tmp_path / "pending"
    directory.mkdir()
    (directory / "DJI_20260622094800_0001_T.JPG").write_bytes(b"fake")

    record = _make_thermal_upload(db, directory)

    response = client.get(f"{settings.API_V1_STR}/thermal/pending-conversions")
    assert response.status_code == 200
    body = response.json()
    match = next((r for r in body if r["file_upload_id"] == str(record.id)), None)
    assert match is not None
    assert match["thermal_count"] == 1
    assert match["experiment"] == "Exp1"


def test_pending_conversions_excludes_rgb_and_missing_directory(
    client: TestClient, db: Session, tmp_path: Path
) -> None:
    rgb_dir = tmp_path / "rgb_only"
    rgb_dir.mkdir()
    (rgb_dir / "DJI_20260622094800_0001_T.JPG").write_bytes(b"fake")
    rgb_record = _make_thermal_upload(db, rgb_dir, image_type="rgb")

    missing_record = _make_thermal_upload(db, tmp_path / "does_not_exist")

    response = client.get(f"{settings.API_V1_STR}/thermal/pending-conversions")
    ids = {r["file_upload_id"] for r in response.json()}
    assert str(rgb_record.id) not in ids
    assert str(missing_record.id) not in ids


def test_convert_directory_marks_file_upload_converted(
    client: TestClient, db: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin

    def _fake_convert(image_path, out_path, platform="dji", **params) -> None:
        with rasterio.open(
            out_path, "w", driver="GTiff", height=4, width=4, count=1,
            dtype="float32", transform=from_origin(0, 0, 1, 1),
        ) as dst:
            dst.write(np.full((4, 4), 20.0, dtype="float32"), 1)

    monkeypatch.setattr(thermal_utils, "convert_thermal_image", _fake_convert)

    directory = tmp_path / "to_convert"
    directory.mkdir()
    (directory / "DJI_20260622094800_0001_T.JPG").write_bytes(b"fake")
    record = _make_thermal_upload(db, directory)

    response = client.post(
        f"{settings.API_V1_STR}/thermal/convert-directory",
        json={"path": str(directory), "platform": "dji", "file_upload_id": str(record.id)},
    )
    job_id = response.json()["job_id"]
    status = _poll_until_terminal(client, job_id)
    assert status["status"] == "done"

    db.refresh(record)
    assert record.thermal_converted is True

    pending = client.get(f"{settings.API_V1_STR}/thermal/pending-conversions").json()
    assert str(record.id) not in {r["file_upload_id"] for r in pending}
