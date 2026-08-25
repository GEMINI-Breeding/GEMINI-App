"""
Tests for the thermal-orthophoto additions to backend/app/processing/aerial.py.

Real ODM/Docker execution isn't exercised here (needs Docker + real drone
imagery + a long runtime) — same caveat as the rest of this codebase's
ODM-dependent code, which has no test coverage at all prior to this file.
This covers what's realistically testable without Docker: RunPaths'
thermal-specific paths, save_gcp_selection's thermal file writing, the
EXIF-GPS fallback reader, and _run_thermal_orthomosaic_pass's no-images
early-return path.
"""

import threading
from pathlib import Path

import piexif
import pytest
from PIL import Image

from app.core.paths import RunPaths
from app.processing import aerial


def _make_paths(tmp_path: Path) -> RunPaths:
    return RunPaths(
        data_root=tmp_path,
        workspace_name="ws1",
        experiment="Exp1",
        location="LocA",
        population="Pop1",
        date="2026-06-22",
        platform="DJI",
        sensor="Thermal",
    )


# ── RunPaths thermal properties ──────────────────────────────────────────

def test_run_paths_thermal_properties(tmp_path: Path) -> None:
    paths = _make_paths(tmp_path)
    assert paths.gcp_list_thermal == paths.intermediate_run / "gcp_list_thermal.txt"
    assert paths.geo_txt_thermal == paths.intermediate_run / "geo_thermal.txt"
    assert paths.thermal_converted_dir == paths.intermediate_run / "thermal_converted"
    assert paths.odm_working_dir_thermal == paths.intermediate_run / "temp_thermal"
    # Kept separate from the RGB working dir so a thermal run can't clobber
    # an in-progress/completed RGB run's ODM working directory.
    assert paths.odm_working_dir_thermal != paths.odm_working_dir


# ── save_gcp_selection thermal fields ────────────────────────────────────

def test_save_gcp_selection_writes_thermal_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    paths = _make_paths(tmp_path)
    monkeypatch.setattr(aerial, "_get_paths", lambda session, run_id: paths)

    aerial.save_gcp_selection(
        session=None,  # unused once _get_paths is monkeypatched
        run_id=None,
        gcp_selections=[
            {"label": "GCP1", "image": "rgb_0001.jpg", "pixel_x": 100, "pixel_y": 200,
             "lat": 33.1, "lon": -111.9, "alt": 380.0},
        ],
        image_gps=[{"image": "rgb_0001.jpg", "lat": 33.1, "lon": -111.9, "alt": 380.0}],
        thermal_gcp_selections=[
            {"label": "GCP1", "image": "DJI_0001_T.tif", "pixel_x": 40, "pixel_y": 30,
             "lat": 33.1, "lon": -111.9, "alt": 380.0},
        ],
        thermal_image_gps=[{"image": "DJI_0001_T.tif", "lat": 33.1, "lon": -111.9, "alt": 380.0}],
    )

    assert paths.gcp_list.exists()
    assert paths.gcp_list_thermal.exists()
    thermal_gcp_lines = paths.gcp_list_thermal.read_text().splitlines()
    assert thermal_gcp_lines[0] == "EPSG:4326"
    assert "DJI_0001_T.tif" in thermal_gcp_lines[1]
    assert "GCP1" in thermal_gcp_lines[1]

    geo_thermal_lines = paths.geo_txt_thermal.read_text().splitlines()
    assert geo_thermal_lines[0] == "EPSG:4326"
    assert "DJI_0001_T.tif" in geo_thermal_lines[1]


def test_save_gcp_selection_omits_thermal_files_when_not_given(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = _make_paths(tmp_path)
    monkeypatch.setattr(aerial, "_get_paths", lambda session, run_id: paths)

    aerial.save_gcp_selection(
        session=None, run_id=None,
        gcp_selections=[], image_gps=[],
    )

    assert paths.gcp_list.exists()
    assert not paths.gcp_list_thermal.exists()
    assert not paths.geo_txt_thermal.exists()


# ── _read_gps_exif ────────────────────────────────────────────────────────

def _write_jpeg_with_gps(path: Path, lat: float, lon: float) -> None:
    def _deg_to_dms_rational(deg: float) -> tuple:
        d = int(deg)
        m_float = (deg - d) * 60
        m = int(m_float)
        s = round((m_float - m) * 60 * 100)
        return ((d, 1), (m, 1), (s, 100))

    gps_ifd = {
        piexif.GPSIFD.GPSLatitudeRef: "N" if lat >= 0 else "S",
        piexif.GPSIFD.GPSLatitude: _deg_to_dms_rational(abs(lat)),
        piexif.GPSIFD.GPSLongitudeRef: "E" if lon >= 0 else "W",
        piexif.GPSIFD.GPSLongitude: _deg_to_dms_rational(abs(lon)),
    }
    exif_dict = {"GPS": gps_ifd}
    exif_bytes = piexif.dump(exif_dict)
    Image.new("RGB", (32, 24), color=(10, 20, 30)).save(path, "JPEG", exif=exif_bytes)


def test_read_gps_exif_extracts_real_coordinates(tmp_path: Path) -> None:
    img_path = tmp_path / "with_gps.jpg"
    _write_jpeg_with_gps(img_path, lat=33.123, lon=-111.456)

    result = aerial._read_gps_exif(img_path)
    assert result["lat"] is not None and result["lon"] is not None
    assert result["lat"] == pytest.approx(33.123, abs=1e-3)
    assert result["lon"] == pytest.approx(-111.456, abs=1e-3)


def test_read_gps_exif_no_gps_returns_none_dict(tmp_path: Path) -> None:
    img_path = tmp_path / "no_gps.jpg"
    Image.new("RGB", (32, 24)).save(img_path, "JPEG")

    result = aerial._read_gps_exif(img_path)
    assert result == {"lat": None, "lon": None, "alt": None}


def test_read_gps_exif_missing_file_returns_none_dict(tmp_path: Path) -> None:
    result = aerial._read_gps_exif(tmp_path / "does_not_exist.jpg")
    assert result == {"lat": None, "lon": None, "alt": None}


# ── _run_thermal_orthomosaic_pass: no-images early return ───────────────

def test_thermal_orthomosaic_pass_no_images_returns_none(tmp_path: Path) -> None:
    paths = _make_paths(tmp_path)
    events: list[dict] = []

    result = aerial._run_thermal_orthomosaic_pass(
        session=None, run_id=None, paths=paths,
        odm_options="--dsm --skip-report",
        container_data_root=str(tmp_path), host_data_root=str(tmp_path),
        stop_event=threading.Event(), emit=events.append,
        progress_range=(50, 95),
    )

    assert result is None
    assert any("No converted thermal images found" in e.get("message", "") for e in events)
