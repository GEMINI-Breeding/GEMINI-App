"""
Tests for the thermal conversion engine (backend/app/processing/thermal_utils.py).

No real DJI R-JPEG sample is available in this environment, so the actual
SDK-backed conversion path (_convert_dji_rjpeg / convert_thermal_image) is
NOT exercised here — only the platform-agnostic pieces that don't need a
real thermal image: TOA5 parsing, nearest-timestamp weather matching,
filename timestamp parsing, thermal-file discovery, and the capabilities
check. This should be flagged as a real gap, not silently treated as full
coverage of the conversion path.
"""

from pathlib import Path

import pandas as pd
import pytest

from app.processing import thermal_utils

TOA5_SAMPLE = """\
"TOA5","83014","CR1000","83014","CR1000.Std.32.02","CPU:Program.CR1","12345","Table1"
"TIMESTAMP","RECORD","AirTC","RH"
"TS","RN","Deg C","%"
"","","Smp","Smp"
"2026-06-22 09:00:00",1,24.5,55.2
"2026-06-22 09:15:00",2,25.1,53.8
"2026-06-22 09:30:00",3,26.3,50.1
"2026-06-22 09:45:00",4,27.0,48.5
"""


@pytest.fixture
def toa5_path(tmp_path: Path) -> Path:
    path = tmp_path / "weather.dat"
    path.write_text(TOA5_SAMPLE)
    return path


def test_load_toa5(toa5_path: Path) -> None:
    df = thermal_utils.load_weather_file(toa5_path, format="toa5")
    assert list(df.columns) == ["TIMESTAMP", "AirTC", "RH"]
    assert len(df) == 4
    assert df["AirTC"].iloc[0] == 24.5
    assert df["RH"].iloc[-1] == 48.5
    # sorted by TIMESTAMP ascending
    assert df["TIMESTAMP"].is_monotonic_increasing


def test_load_weather_file_unsupported_format(toa5_path: Path) -> None:
    with pytest.raises(thermal_utils.ThermalConfigError):
        thermal_utils.load_weather_file(toa5_path, format="not_a_real_format")


def test_load_toa5_too_short(tmp_path: Path) -> None:
    path = tmp_path / "short.dat"
    path.write_text('"a"\n"b"\n')
    with pytest.raises(thermal_utils.ThermalConfigError):
        thermal_utils.load_weather_file(path, format="toa5")


def test_build_weather_matcher_near_match(toa5_path: Path) -> None:
    df = thermal_utils.load_weather_file(toa5_path, format="toa5")
    matcher = thermal_utils.build_weather_matcher(df, fallback_humidity=70.0, fallback_ambient=25.0)

    humidity, ambient, source = matcher(pd.Timestamp("2026-06-22 09:16:00"))
    assert source == "weather_file"
    assert humidity == 53.8
    assert ambient == 25.1


def test_build_weather_matcher_falls_back_outside_threshold(toa5_path: Path) -> None:
    df = thermal_utils.load_weather_file(toa5_path, format="toa5")
    matcher = thermal_utils.build_weather_matcher(df, fallback_humidity=70.0, fallback_ambient=25.0)

    humidity, ambient, source = matcher(pd.Timestamp("2026-06-22 15:00:00"))
    assert source == "fallback"
    assert humidity == 70.0
    assert ambient == 25.0


def test_build_weather_matcher_no_timestamp(toa5_path: Path) -> None:
    df = thermal_utils.load_weather_file(toa5_path, format="toa5")
    matcher = thermal_utils.build_weather_matcher(df, fallback_humidity=70.0, fallback_ambient=25.0)

    humidity, ambient, source = matcher(None)
    assert source == "fallback"
    assert humidity == 70.0
    assert ambient == 25.0


def test_build_weather_matcher_empty_df() -> None:
    empty = pd.DataFrame(columns=["TIMESTAMP", "AirTC", "RH"])
    matcher = thermal_utils.build_weather_matcher(empty, fallback_humidity=70.0, fallback_ambient=25.0)
    humidity, ambient, source = matcher(pd.Timestamp("2026-06-22 09:16:00"))
    assert source == "fallback"


def test_extract_image_timestamp_dji() -> None:
    ts = thermal_utils.extract_image_timestamp("DJI_20260622094800_0001_T.JPG", platform="dji")
    assert ts == pd.Timestamp("2026-06-22 09:48:00")


def test_extract_image_timestamp_unparseable() -> None:
    assert thermal_utils.extract_image_timestamp("not_a_dji_filename.jpg", platform="dji") is None


def test_extract_image_timestamp_unknown_platform() -> None:
    assert thermal_utils.extract_image_timestamp("DJI_20260622094800_0001_T.JPG", platform="flir") is None


def test_find_thermal_images(tmp_path: Path) -> None:
    (tmp_path / "DJI_20260622094800_0001_T.JPG").touch()
    (tmp_path / "DJI_20260622094800_0001_V.JPG").touch()
    (tmp_path / "DJI_20260622094900_0002_T.JPG").touch()
    (tmp_path / "readme.txt").touch()

    found = thermal_utils.find_thermal_images(tmp_path, platform="dji")
    names = sorted(f.name for f in found)
    assert names == ["DJI_20260622094800_0001_T.JPG", "DJI_20260622094900_0002_T.JPG"]


def test_find_thermal_images_unknown_platform(tmp_path: Path) -> None:
    (tmp_path / "DJI_20260622094800_0001_T.JPG").touch()
    assert thermal_utils.find_thermal_images(tmp_path, platform="flir") == []


def test_find_thermal_images_missing_dir(tmp_path: Path) -> None:
    assert thermal_utils.find_thermal_images(tmp_path / "does_not_exist", platform="dji") == []


def test_convert_thermal_image_unsupported_platform(tmp_path: Path) -> None:
    with pytest.raises(thermal_utils.ThermalConfigError):
        thermal_utils.convert_thermal_image(
            tmp_path / "fake.jpg", tmp_path / "out.tif", platform="not_a_real_platform",
        )


def test_get_thermal_capabilities_reports_missing_sdk(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Isolate from whatever may actually be vendored on the machine running
    # this test (e.g. a dev box that's vendored the real SDK to test
    # conversion for real) — this test is specifically about the
    # nothing-vendored-anywhere case.
    monkeypatch.setattr(thermal_utils, "_bundled_dji_sdk_dir", lambda: tmp_path / "does_not_exist")
    caps = thermal_utils.get_thermal_capabilities(sdk_dir="")
    assert caps["platforms"]["dji"]["native_lib_configured"] is False
    assert caps["platforms"]["dji"]["available"] is False
    assert "exiftool_available" in caps


def test_get_thermal_capabilities_reports_missing_native_lib(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(thermal_utils, "_bundled_dji_sdk_dir", lambda: tmp_path / "does_not_exist")
    override_dir = tmp_path / "override"
    caps = thermal_utils.get_thermal_capabilities(sdk_dir=str(override_dir))
    assert caps["platforms"]["dji"]["native_lib_configured"] is True
    assert caps["platforms"]["dji"]["native_lib_available"] is False
    assert caps["platforms"]["dji"]["available"] is False


# ── Bundled-vs-override SDK resolution ──────────────────────────────────
#
# The app should work with zero user configuration when the SDK is vendored
# (bundled with a packaged build) — the Settings path is only an override,
# consulted solely when the bundled copy is absent.

def _make_fake_lib(root: Path) -> None:
    rel = thermal_utils._dji_sdk_relative_lib_path()
    lib_path = root / rel
    lib_path.parent.mkdir(parents=True, exist_ok=True)
    lib_path.write_bytes(b"fake lib")


def test_resolve_prefers_bundled_over_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    bundled_root = tmp_path / "bundled"
    override_root = tmp_path / "override"
    _make_fake_lib(bundled_root)
    _make_fake_lib(override_root)
    monkeypatch.setattr(thermal_utils, "_bundled_dji_sdk_dir", lambda: bundled_root)

    path, source = thermal_utils._resolve_dji_sdk_lib(str(override_root))
    assert source == "bundled"
    assert path == bundled_root / thermal_utils._dji_sdk_relative_lib_path()


def test_resolve_falls_back_to_override_when_bundled_absent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    override_root = tmp_path / "override"
    _make_fake_lib(override_root)
    monkeypatch.setattr(thermal_utils, "_bundled_dji_sdk_dir", lambda: tmp_path / "does_not_exist")

    path, source = thermal_utils._resolve_dji_sdk_lib(str(override_root))
    assert source == "override"
    assert path == override_root / thermal_utils._dji_sdk_relative_lib_path()


def test_resolve_no_bundled_no_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(thermal_utils, "_bundled_dji_sdk_dir", lambda: tmp_path / "does_not_exist")

    path, source = thermal_utils._resolve_dji_sdk_lib("")
    assert source == "bundled"  # default expected path, for a clear error message
    assert not path.exists()


# ── macOS Docker fallback ────────────────────────────────────────────────
#
# DJI ships no native macOS build, so on macOS the same vendored Linux
# libdirp.so is run inside Docker instead of loaded via ctypes on the host.
# No real docker build/run is exercised here (same as ground.py's analogous
# Docker-image-build helpers, which also have no unit test coverage) — only
# the deterministic, no-subprocess pieces: platform dispatch and path/hash
# resolution. The actual container round trip is verified manually.

def test_dji_native_supported_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(thermal_utils._platform, "system", lambda: "Windows")
    assert thermal_utils._dji_native_supported() is True


def test_dji_native_supported_linux(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(thermal_utils._platform, "system", lambda: "Linux")
    assert thermal_utils._dji_native_supported() is True


def test_dji_native_supported_macos(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(thermal_utils._platform, "system", lambda: "Darwin")
    assert thermal_utils._dji_native_supported() is False


def test_dji_docker_build_context_dev_mode() -> None:
    build_dir = thermal_utils._dji_docker_build_context()
    assert build_dir == Path(thermal_utils.__file__).parent.parent.parent / "docker" / "dji-thermal"


def test_dji_docker_build_context_frozen_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(thermal_utils.sys, "frozen", True, raising=False)
    monkeypatch.setattr(thermal_utils.sys, "_MEIPASS", str(tmp_path), raising=False)
    assert thermal_utils._dji_docker_build_context() == tmp_path / "docker" / "dji-thermal"


def test_dji_dockerfile_hash_changes_with_content(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "Dockerfile").write_text("FROM python:3.10-slim\n")
    (tmp_path / "measure_rjpeg.py").write_text("print('v1')\n")
    monkeypatch.setattr(thermal_utils, "_dji_docker_build_context", lambda: tmp_path)
    hash_v1 = thermal_utils._dji_dockerfile_hash()

    (tmp_path / "measure_rjpeg.py").write_text("print('v2')\n")
    hash_v2 = thermal_utils._dji_dockerfile_hash()

    assert hash_v1 != hash_v2
    # stable for unchanged content
    assert hash_v2 == thermal_utils._dji_dockerfile_hash()


# ── exiftool resolution ──────────────────────────────────────────────────
#
# exiftool is vendored directly (unlike the DJI SDK — freely redistributable,
# no manual per-machine download needed), with a real-system-install
# fallback for dev machines that happen to already have it (e.g. before it
# was vendored here). All isolated from whatever's actually vendored/
# installed on the machine running these tests via monkeypatch.

def test_resolve_exiftool_bundled_macos_linux(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(thermal_utils._platform, "system", lambda: "Darwin")
    monkeypatch.setattr(thermal_utils, "_bundled_exiftool_dir", lambda: tmp_path)
    script = tmp_path / "macos_linux" / "exiftool"
    script.parent.mkdir(parents=True)
    script.write_text("#!/usr/bin/env perl\n")
    monkeypatch.setattr(thermal_utils.shutil, "which", lambda name: "/usr/bin/perl" if name == "perl" else None)

    cmd, source = thermal_utils._resolve_exiftool_cmd()
    assert source == "bundled"
    assert cmd == ["/usr/bin/perl", str(script)]


def test_resolve_exiftool_bundled_windows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(thermal_utils._platform, "system", lambda: "Windows")
    monkeypatch.setattr(thermal_utils, "_bundled_exiftool_dir", lambda: tmp_path)
    exe = tmp_path / "windows" / "exiftool(-k).exe"
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"fake")

    cmd, source = thermal_utils._resolve_exiftool_cmd()
    assert source == "bundled"
    assert cmd == [str(exe)]


def test_resolve_exiftool_falls_back_to_path_when_not_vendored(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(thermal_utils._platform, "system", lambda: "Darwin")
    monkeypatch.setattr(thermal_utils, "_bundled_exiftool_dir", lambda: tmp_path / "does_not_exist")
    monkeypatch.setattr(
        thermal_utils.shutil, "which",
        lambda name: "/usr/local/bin/exiftool" if name == "exiftool" else None,
    )

    cmd, source = thermal_utils._resolve_exiftool_cmd()
    assert source == "path"
    assert cmd == ["/usr/local/bin/exiftool"]


def test_resolve_exiftool_macos_linux_bundled_but_no_perl_falls_back(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Bundled script present, but no perl on PATH — must not return an
    # unusable [None, script] command; falls back to a system exiftool if
    # one exists, per the same precedence as the "not vendored" case.
    monkeypatch.setattr(thermal_utils._platform, "system", lambda: "Linux")
    monkeypatch.setattr(thermal_utils, "_bundled_exiftool_dir", lambda: tmp_path)
    script = tmp_path / "macos_linux" / "exiftool"
    script.parent.mkdir(parents=True)
    script.write_text("#!/usr/bin/env perl\n")
    monkeypatch.setattr(
        thermal_utils.shutil, "which",
        lambda name: "/usr/local/bin/exiftool" if name == "exiftool" else None,
    )

    cmd, source = thermal_utils._resolve_exiftool_cmd()
    assert source == "path"
    assert cmd == ["/usr/local/bin/exiftool"]


def test_resolve_exiftool_unavailable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(thermal_utils._platform, "system", lambda: "Darwin")
    monkeypatch.setattr(thermal_utils, "_bundled_exiftool_dir", lambda: tmp_path / "does_not_exist")
    monkeypatch.setattr(thermal_utils.shutil, "which", lambda name: None)

    cmd, source = thermal_utils._resolve_exiftool_cmd()
    assert cmd is None
    assert source == "unavailable"


# ── is_raw_thermal_image ─────────────────────────────────────────────────

def test_is_raw_thermal_image_matches_dji_suffix() -> None:
    assert thermal_utils.is_raw_thermal_image("DJI_20260622094800_0001_T.JPG") is True
    assert thermal_utils.is_raw_thermal_image("dji_20260622094800_0001_t.jpg") is True  # case-insensitive


def test_is_raw_thermal_image_excludes_paired_rgb() -> None:
    assert thermal_utils.is_raw_thermal_image("DJI_20260622094800_0001_V.JPG") is False


def test_is_raw_thermal_image_excludes_unrelated_files() -> None:
    assert thermal_utils.is_raw_thermal_image("regular_photo.jpg") is False
    assert thermal_utils.is_raw_thermal_image("notes.txt") is False
