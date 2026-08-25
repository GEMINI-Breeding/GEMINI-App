"""
Tests for the thermal weather-file routes (backend/app/api/routes/thermal.py).
No mocking needed — TOA5 parsing runs against a real sample file on disk.
"""

import io
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import settings

TOA5_SAMPLE = b"""\
"TOA5","83014","CR1000","83014","CR1000.Std.32.02","CPU:Program.CR1","12345","Table1"
"TIMESTAMP","RECORD","AirTC","RH"
"TS","RN","Deg C","%"
"","","Smp","Smp"
"2026-06-22 09:00:00",1,24.5,55.2
"2026-06-22 09:15:00",2,25.1,53.8
"""


def _upload(client: TestClient, name: str = "Test Weather Station") -> dict:
    response = client.post(
        f"{settings.API_V1_STR}/thermal/weather-files",
        params={"name": name, "format": "toa5"},
        files={"file": ("weather.dat", io.BytesIO(TOA5_SAMPLE), "text/plain")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_upload_weather_file(client: TestClient) -> None:
    content = _upload(client)
    assert content["name"] == "Test Weather Station"
    assert content["format"] == "toa5"
    assert content["row_count"] == 2
    assert content["original_filename"] == "weather.dat"


def test_upload_invalid_format(client: TestClient) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/thermal/weather-files",
        params={"name": "Bad", "format": "not_a_real_format"},
        files={"file": ("weather.dat", io.BytesIO(TOA5_SAMPLE), "text/plain")},
    )
    assert response.status_code == 422


def test_upload_unparseable_toa5(client: TestClient) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/thermal/weather-files",
        params={"name": "Bad", "format": "toa5"},
        files={"file": ("weather.dat", io.BytesIO(b"not a toa5 file"), "text/plain")},
    )
    assert response.status_code == 422


def test_list_and_delete_weather_file(client: TestClient) -> None:
    created = _upload(client, name="List-Delete Test")
    file_id = created["id"]

    list_response = client.get(f"{settings.API_V1_STR}/thermal/weather-files")
    assert list_response.status_code == 200
    ids = [item["id"] for item in list_response.json()]
    assert file_id in ids

    delete_response = client.delete(f"{settings.API_V1_STR}/thermal/weather-files/{file_id}")
    assert delete_response.status_code == 200

    list_response_after = client.get(f"{settings.API_V1_STR}/thermal/weather-files")
    ids_after = [item["id"] for item in list_response_after.json()]
    assert file_id not in ids_after


def test_delete_nonexistent_weather_file(client: TestClient) -> None:
    import uuid

    response = client.delete(f"{settings.API_V1_STR}/thermal/weather-files/{uuid.uuid4()}")
    assert response.status_code == 404


def test_capabilities_includes_thermal(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/utils/capabilities/")
    assert response.status_code == 200
    content = response.json()
    assert "thermal" in content
    assert "dji" in content["thermal"]["platforms"]


# ── /thermal/preview — absolute vs data_root-relative paths ─────────────
#
# PipelineRun.outputs (see aerial.run_orthomosaic's thermal ortho, and
# RunPaths.rel()) stores paths relative to data_root so they stay valid if
# the user changes their data_root setting; Guided Upload's existing
# callers pass absolute paths. /thermal/preview needs to accept both.

def _write_fake_geotiff(path: Path) -> None:
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin

    with rasterio.open(
        path, "w", driver="GTiff", height=4, width=4, count=1,
        dtype="float32", transform=from_origin(0, 0, 1, 1),
    ) as dst:
        dst.write(np.full((4, 4), 22.5, dtype="float32"), 1)


def test_preview_thermal_image_absolute_path(client: TestClient, tmp_path: Path) -> None:
    tif_path = tmp_path / "thermal.tif"
    _write_fake_geotiff(tif_path)

    response = client.get(
        f"{settings.API_V1_STR}/thermal/preview", params={"path": str(tif_path)}
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["X-Mean-Temp-C"] == "22.5"


def test_preview_thermal_image_relative_to_data_root(client: TestClient, tmp_path: Path) -> None:
    original = client.get(f"{settings.API_V1_STR}/settings/data-root").json()["value"]
    data_root = tmp_path / "data_root"
    data_root.mkdir()
    assert client.put(
        f"{settings.API_V1_STR}/settings/data-root", json={"value": str(data_root)}
    ).status_code == 200
    try:
        rel_dir = data_root / "Processed" / "ws1"
        rel_dir.mkdir(parents=True)
        _write_fake_geotiff(rel_dir / "thermal.tif")

        response = client.get(
            f"{settings.API_V1_STR}/thermal/preview",
            params={"path": "Processed/ws1/thermal.tif"},
        )
        assert response.status_code == 200
        assert response.headers["X-Mean-Temp-C"] == "22.5"
    finally:
        client.put(f"{settings.API_V1_STR}/settings/data-root", json={"value": original})


def test_preview_thermal_image_not_found(client: TestClient, tmp_path: Path) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/thermal/preview",
        params={"path": str(tmp_path / "does_not_exist.tif")},
    )
    assert response.status_code == 404
