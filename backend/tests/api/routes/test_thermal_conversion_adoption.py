"""
Tests for GET /pipeline-runs/{id}/thermal-conversion's adoption bridge
(backend/app/api/routes/processing.py:_adopt_guided_upload_thermal_conversion).

A dataset's thermal images can be converted two ways: via a pipeline run's
own Thermal Conversion step (aerial.run_thermal_conversion, writes into
run.outputs directly), or earlier/separately via the Files tab's Guided
Upload flow (thermal_jobs.py, writes into FileUpload.thermal_converted_dir
— there's no PipelineRun yet at upload time). A run created later from that
same FileUpload previously had no way to see the second case's results and
incorrectly reported "no thermal conversion results yet" even though the
images already existed on disk. This exercises the bridge that adopts them.

Sets data_root to a temp directory (converted GeoTIFFs must live under it —
RunPaths.rel() requires that) and restores the original value afterward.
"""

from pathlib import Path
from typing import Generator

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin
from sqlmodel import Session, select

from app.core.config import settings
from app.models import User
from app.models.file_upload import FileUpload
from app.models.pipeline import Pipeline, PipelineRun
from app.models.workspace import Workspace


def _write_fake_geotiff(path: Path, mean_temp: float = 21.0) -> None:
    with rasterio.open(
        path, "w", driver="GTiff", height=4, width=4, count=1,
        dtype="float32", transform=from_origin(0, 0, 1, 1),
    ) as dst:
        dst.write(np.full((4, 4), mean_temp, dtype="float32"), 1)


@pytest.fixture()
def isolated_data_root(client: TestClient, tmp_path: Path) -> Generator[Path, None, None]:
    original = client.get(f"{settings.API_V1_STR}/settings/data-root").json()["value"]
    data_root = tmp_path / "data_root"
    data_root.mkdir()
    assert client.put(
        f"{settings.API_V1_STR}/settings/data-root", json={"value": str(data_root)}
    ).status_code == 200
    try:
        yield data_root
    finally:
        client.put(f"{settings.API_V1_STR}/settings/data-root", json={"value": original})


def _make_run_with_thermal_upload(
    db: Session, data_root: Path, *, thermal_converted_dir: Path | None
) -> PipelineRun:
    superuser = db.exec(select(User).where(User.is_superuser == True)).first()  # noqa: E712
    assert superuser

    workspace = Workspace(name="ws1", owner_id=superuser.id)
    db.add(workspace)
    db.commit()
    db.refresh(workspace)

    pipeline = Pipeline(name="Aerial Pipeline", type="aerial", workspace_id=workspace.id)
    db.add(pipeline)
    db.commit()
    db.refresh(pipeline)

    file_upload = FileUpload(
        data_type="Image Data", experiment="Exp1", location="LocA", population="Pop1",
        date="2026-06-22", platform="DJI", sensor="Thermal", image_type="thermal",
        thermal_converted=thermal_converted_dir is not None,
        thermal_converted_dir=str(thermal_converted_dir) if thermal_converted_dir else None,
        storage_path="Raw/2026/Exp1/LocA/Pop1/2026-06-22/DJI/Thermal/Images",
        owner_id=superuser.id,
    )
    db.add(file_upload)
    db.commit()
    db.refresh(file_upload)

    run = PipelineRun(
        date="2026-06-22", experiment="Exp1", location="LocA", population="Pop1",
        platform="DJI", sensor="Thermal",
        pipeline_id=pipeline.id, file_upload_id=file_upload.id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def test_thermal_conversion_results_adopts_guided_upload_conversion(
    client: TestClient, db: Session, isolated_data_root: Path
) -> None:
    converted_dir = isolated_data_root / "thermal_converted" / "job1"
    converted_dir.mkdir(parents=True)
    _write_fake_geotiff(converted_dir / "DJI_20260622094800_0001_T.tif", mean_temp=21.0)
    _write_fake_geotiff(converted_dir / "DJI_20260622094900_0002_T.tif", mean_temp=23.0)

    run = _make_run_with_thermal_upload(db, isolated_data_root, thermal_converted_dir=converted_dir)
    assert not (run.steps_completed or {}).get("thermal_conversion")

    response = client.get(f"{settings.API_V1_STR}/pipeline-runs/{run.id}/thermal-conversion")
    assert response.status_code == 200
    body = response.json()
    assert body["available"] is True
    assert body["source"] == "guided_upload"
    names = {img["name"] for img in body["images"]}
    assert names == {"DJI_20260622094800_0001_T.tif", "DJI_20260622094900_0002_T.tif"}
    # Image paths resolved to real, readable absolute paths under data_root.
    for img in body["images"]:
        assert Path(img["path"]).exists()

    # Adoption persists onto the run — stepper should now show it as done.
    db.refresh(run)
    assert run.steps_completed.get("thermal_conversion") is True
    assert "thermal_conversion" in (run.outputs or {})

    # Second call: already adopted — served straight from run.outputs, not
    # re-adopted (source still "guided_upload", not silently dropped).
    response2 = client.get(f"{settings.API_V1_STR}/pipeline-runs/{run.id}/thermal-conversion")
    assert response2.json()["source"] == "guided_upload"


def test_thermal_conversion_results_no_upload_conversion_reports_unavailable(
    client: TestClient, db: Session, isolated_data_root: Path
) -> None:
    run = _make_run_with_thermal_upload(db, isolated_data_root, thermal_converted_dir=None)

    response = client.get(f"{settings.API_V1_STR}/pipeline-runs/{run.id}/thermal-conversion")
    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False
    assert body["images"] == []


def test_thermal_conversion_results_missing_converted_dir_reports_unavailable(
    client: TestClient, db: Session, isolated_data_root: Path
) -> None:
    # thermal_converted=True but the directory doesn't actually exist
    # (e.g. deleted, or data_root changed since conversion) — must not crash.
    run = _make_run_with_thermal_upload(
        db, isolated_data_root, thermal_converted_dir=isolated_data_root / "does_not_exist"
    )

    response = client.get(f"{settings.API_V1_STR}/pipeline-runs/{run.id}/thermal-conversion")
    assert response.status_code == 200
    assert response.json()["available"] is False
