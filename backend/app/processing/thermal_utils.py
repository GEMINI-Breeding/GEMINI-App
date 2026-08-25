"""
Thermal image conversion utilities.

Converts proprietary radiometric thermal images (e.g. DJI R-JPEG) into
single-band float32 GeoTIFFs where each pixel holds the temperature in
degrees Celsius, optionally using per-image humidity/ambient-temperature
values matched from a weather-station file by nearest timestamp.

Public API
----------
convert_thermal_image(image_path, out_path, platform, **params) -> None
get_thermal_capabilities(sdk_dir) -> dict
load_weather_file(path, format) -> pd.DataFrame
build_weather_matcher(weather_df, fallback_humidity, fallback_ambient) -> Callable
extract_image_timestamp(filename, platform) -> pd.Timestamp | None

Flexible by design: both the platform-specific converters and the
weather-file-format readers are small registries keyed by string — matching
inference_utils.py's `source` dispatch pattern, not a class hierarchy. Only
"dji" (platform) and "toa5" (weather format) are implemented; adding another
drone/camera platform or weather-logger format is a new registry entry, not
a redesign.
"""

from __future__ import annotations

import csv
import hashlib
import io
import logging
import platform as _platform
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from scipy.spatial import KDTree

logger = logging.getLogger(__name__)


class ThermalConfigError(RuntimeError):
    """Raised when thermal conversion fails due to a config/capability error
    (missing SDK, unsupported platform, bad measurement params, etc) — mirrors
    inference_utils.py's _InferenceConfigError so it surfaces the same way in
    the SSE log panel rather than as an unhandled traceback."""


# ── DJI platform converter ───────────────────────────────────────────────
#
# The DJI Thermal SDK's native library (libdirp.so/.dll) is bundled with the
# app (vendored, execution-form-only — DJI's EULA explicitly permits
# distributing the SDK's object code as part of an Application: "distribute
# such object code ... in execution form only ... as a part of your
# Applications ... not distribute any portion of the SDK that is not object
# code" — https://developer.dji.com/policies/eula/), same vendoring pattern
# already used for AgRowStitch/LightGlue (see gemi-backend.spec). Users
# should not need to install anything separately. `dji_thermal_sdk_path` in
# Settings is an *optional override* (e.g. to test a newer SDK version), not
# a required setup step.


def _dji_sdk_relative_lib_path() -> Path:
    """
    Path to libdirp.{so,dll} relative to a DJI Thermal SDK root folder.

    DJI only ships Windows and Linux binaries — there is no macOS build.
    This still resolves to the Linux binary on macOS (and anything else
    that isn't Windows): on Linux it's loaded natively, and on macOS it's
    the same file, just bind-mounted into a Docker container instead of
    loaded directly on the host (see _dji_native_supported() /
    _convert_dji_rjpeg_docker() below) — ctypes can never load a Linux ELF
    .so via macOS's dyld, so this path is never used for a native load
    there.
    """
    if _platform.system() == "Windows":
        return Path("utility") / "bin" / "windows" / "release_x64" / "libdirp.dll"
    return Path("utility") / "bin" / "linux" / "release_x64" / "libdirp.so"


def _dji_native_supported() -> bool:
    """True on the two platforms DJI actually ships a Thermal SDK binary for."""
    return _platform.system() in ("Windows", "Linux")


def _bundled_dji_sdk_dir() -> Path:
    """
    Vendored SDK root — `vendor/dji_thermal_sdk/` alongside the backend
    package in dev, or inside the PyInstaller bundle root (sys._MEIPASS) in a
    frozen build. Same frozen/dev resolution already used for AgRowStitch/
    bin_to_images (see ground.py:_docker_build_context()).
    """
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)  # type: ignore[attr-defined]
    else:
        base = Path(__file__).parent.parent.parent  # backend/
    return base / "vendor" / "dji_thermal_sdk"


def _resolve_dji_sdk_lib(sdk_dir_override: str = "") -> tuple[Path, str]:
    """
    Resolve the DJI Thermal SDK native library path.

    Prefers the bundled/vendored copy so the app works with zero user setup;
    `sdk_dir_override` (from the optional Settings field) is only consulted
    if the bundled copy isn't present. Returns (path, source) where source is
    "bundled" or "override", for capability reporting.
    """
    bundled = _bundled_dji_sdk_dir() / _dji_sdk_relative_lib_path()
    if bundled.exists():
        return bundled, "bundled"
    if sdk_dir_override:
        return Path(sdk_dir_override) / _dji_sdk_relative_lib_path(), "override"
    return bundled, "bundled"  # doesn't exist — still the expected/default path for error messages


_dji_initialized_lib: str | None = None
_dji_init_lock = threading.Lock()


def _ensure_dji_initialized(sdk_dir_override: str) -> None:
    """
    dji_init() loads the native library into the process globally via
    ctypes — only needs to happen once per unique library path. Guarded by a
    lock since the SDK's global handle isn't safe for concurrent init calls.
    """
    global _dji_initialized_lib

    lib_path, source = _resolve_dji_sdk_lib(sdk_dir_override)
    if not lib_path.exists():
        raise ThermalConfigError(
            f"DJI Thermal SDK library not found at {lib_path}. This should be "
            "bundled with the app — if you're running from source, see "
            "backend/vendor/dji_thermal_sdk/README.md to vendor it locally, or "
            "set an override path in Settings → Thermal."
        )

    with _dji_init_lock:
        if _dji_initialized_lib == str(lib_path):
            return
        try:
            from dji_thermal_sdk.dji_sdk import dji_init
            dji_init(str(lib_path))
        except Exception as exc:
            raise ThermalConfigError(f"Failed to initialize DJI Thermal SDK: {exc}") from exc
        _dji_initialized_lib = str(lib_path)
        logger.info("DJI Thermal SDK initialized from %s library at %s", source, lib_path)


def _convert_dji_rjpeg_native(image_path: Path, params: dict[str, Any]) -> np.ndarray:
    """
    Return a (height, width) float32 array of temperatures in Celsius, using
    the DJI Thermal SDK (ctypes bindings via the `dji_thermal_sdk` package;
    the actual proprietary libdirp.so/.dll must be supplied by the user).
    Only called on Windows/Linux — see _convert_dji_rjpeg() for the macOS
    (Docker-backed) alternative.

    params: distance (m), humidity (%), emissivity (0-1),
    reflected_temperature (°C, also used as ambient), sdk_dir (str, folder
    containing the downloaded DJI Thermal SDK).
    """
    _ensure_dji_initialized(str(params.get("sdk_dir") or ""))

    import ctypes as CT

    from dji_thermal_sdk.dji_sdk import (
        DIRP_HANDLE,
        DIRP_SUCCESS,
        dirp_get_rjpeg_resolution,
        dirp_measure_ex,
        dirp_measurement_params_t,
        dirp_resolution_t,
        dirp_set_measurement_params,
    )
    from dji_thermal_sdk.utility import getJPEGHandle

    ret = getJPEGHandle(str(image_path))
    if ret != 0:
        raise ThermalConfigError(f"Failed to open {image_path.name} (DJI SDK error {ret})")

    sdk_params = dirp_measurement_params_t()
    sdk_params.distance = CT.c_float(float(params.get("distance", 5.0)))
    sdk_params.humidity = CT.c_float(float(params.get("humidity", 70.0)))
    sdk_params.emissivity = CT.c_float(float(params.get("emissivity", 1.0)))
    # SDK field "reflection" = reflected/apparent temperature for atmosphere correction
    sdk_params.reflection = CT.c_float(float(params.get("reflected_temperature", 25.0)))

    ret = dirp_set_measurement_params(DIRP_HANDLE, CT.byref(sdk_params))
    if ret != DIRP_SUCCESS:
        raise ThermalConfigError(f"dirp_set_measurement_params failed (error {ret}) for {image_path.name}")

    resolution = dirp_resolution_t()
    dirp_get_rjpeg_resolution(DIRP_HANDLE, CT.byref(resolution))
    img_h, img_w = resolution.height, resolution.width

    size = img_h * img_w * CT.sizeof(CT.c_float)
    raw_buffer = CT.create_string_buffer(size)
    ret = dirp_measure_ex(DIRP_HANDLE, CT.byref(raw_buffer), size)
    if ret != DIRP_SUCCESS:
        raise ThermalConfigError(f"dirp_measure_ex failed (error {ret}) for {image_path.name}")

    # .copy() — raw_buffer is a ctypes buffer that goes out of scope after this call
    return np.frombuffer(raw_buffer.raw, dtype=np.float32).reshape(img_h, img_w).copy()


# ── DJI via Docker (macOS — DJI ships no native macOS build) ────────────────
#
# Same vendored Linux libdirp.so used natively on Linux (_convert_dji_rjpeg_native
# above), bind-mounted read-only into a small Linux container instead of
# ctypes-loaded on the host. Mirrors the Docker pattern ground.py already uses
# for .bin extraction on Windows (_ensure_docker_ready/_run_docker_container),
# but simpler: a plain blocking `docker run --rm` per image (the
# detached-run+`docker wait` dance ground.py uses works around a WSL2-specific
# hang that doesn't apply on macOS) and the image itself contains no
# proprietary code — the .so is mounted at run time, not baked in at build
# time, so the image never needs rebuilding when the vendored SDK changes.

_DJI_DOCKER_IMAGE = "gemi-dji-thermal:latest"
# DJI's Linux SDK is x86-64 only (no arm64/aarch64 build) — force amd64 so
# this also runs correctly under emulation on Apple Silicon Docker Desktop,
# which otherwise defaults to a native-arm64 container that can't dlopen an
# x86-64 libdirp.so (surfaces as a confusing "cannot open shared object
# file" error, not an obvious architecture-mismatch message).
_DJI_DOCKER_PLATFORM = "linux/amd64"

_dji_docker_build_lock = threading.Lock()
_dji_docker_build_in_progress = threading.Event()


def _dji_docker_build_context() -> Path:
    """
    Directory containing docker/dji-thermal/{Dockerfile,measure_rjpeg.py} —
    extracted alongside the binary in a PyInstaller bundle, or in the
    backend/ source tree in dev. Same frozen/dev resolution as
    _bundled_dji_sdk_dir() / ground.py's _docker_build_context().
    """
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)  # type: ignore[attr-defined]
    else:
        base = Path(__file__).parent.parent.parent  # backend/
    return base / "docker" / "dji-thermal"


def _dji_dockerfile_hash() -> str:
    """Short MD5 of Dockerfile + measure_rjpeg.py — detects when a rebuild is needed."""
    build_dir = _dji_docker_build_context()
    content = (build_dir / "Dockerfile").read_bytes()
    content += (build_dir / "measure_rjpeg.py").read_bytes()
    return hashlib.md5(content).hexdigest()[:16]  # noqa: S324


def _dji_docker_image_needs_rebuild() -> bool:
    """True if the gemi-dji-thermal image doesn't exist or was built from an older Dockerfile."""
    result = subprocess.run(
        [
            "docker", "image", "inspect",
            "--format", '{{index .Config.Labels "gemi.hash"}}',
            _DJI_DOCKER_IMAGE,
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return True  # image doesn't exist
    return result.stdout.strip() != _dji_dockerfile_hash()


def _build_dji_docker_image(on_progress: Callable[[str], None] | None = None) -> None:
    """
    Build gemi-dji-thermal from docker/dji-thermal/Dockerfile — small (no
    proprietary code, no heavy ML deps: just python:3.10-slim + libgomp1 +
    two pip packages), typically under a minute even on a cold cache.
    Streams `docker build` output line-by-line via `on_progress` (if given)
    so a caller can show live status instead of a silent multi-second
    blocking call — same idea as ground.py's _build_bin_extractor_image.
    """
    build_dir = _dji_docker_build_context()
    if not (build_dir / "Dockerfile").exists():
        raise ThermalConfigError(
            "Docker build context for DJI thermal conversion not found inside "
            "the GEMI installation. This is a packaging issue — please reinstall GEMI."
        )

    def _emit(msg: str) -> None:
        logger.info(msg)
        if on_progress:
            on_progress(msg)

    _emit(
        "Building DJI thermal conversion tool (one-time, usually under a "
        "minute — longer on a slow connection or external drive)…"
    )

    cmd = [
        "docker", "build",
        "--platform", _DJI_DOCKER_PLATFORM,
        "--build-arg", f"GEMI_HASH={_dji_dockerfile_hash()}",
        "-t", _DJI_DOCKER_IMAGE,
        str(build_dir),
    ]
    logger.info("Building %s: %s", _DJI_DOCKER_IMAGE, " ".join(cmd))

    start = time.monotonic()
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert proc.stdout is not None
    tail: list[str] = []
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        tail.append(line)
        tail = tail[-40:]  # keep enough for a useful error, not the whole log
        # Buildx/BuildKit step lines look like "#3 [2/4] RUN apt-get update..."
        if line.startswith("#") or line.lower().startswith("step "):
            elapsed = time.monotonic() - start
            _emit(f"Building conversion tool… {line}  ({elapsed:.0f}s elapsed)")
    proc.wait()

    if proc.returncode != 0:
        raise ThermalConfigError(
            "Failed to build the gemi-dji-thermal Docker image.\n"
            "Make sure Docker Desktop is running and you have an internet "
            "connection, then try the conversion again.\n" + "\n".join(tail[-20:])
        )
    _emit(f"Conversion tool built successfully ({time.monotonic() - start:.0f}s).")


def _docker_daemon_reachable() -> bool:
    try:
        subprocess.run(["docker", "info"], capture_output=True, timeout=15, check=True)
        return True
    except Exception:
        return False


def _ensure_dji_docker_ready(on_progress: Callable[[str], None] | None = None) -> None:
    """
    Check Docker is reachable and gemi-dji-thermal is built (building it if
    missing/outdated). Raises ThermalConfigError with a user-readable message
    on any failure — explicitly framed around "DJI has no macOS build" so
    it's not read as a generic Docker complaint.
    """
    if not _docker_daemon_reachable():
        raise ThermalConfigError(
            "DJI's Thermal SDK has no macOS build, so GEMI runs it inside "
            "Docker on macOS — but Docker isn't reachable.\n"
            "1. Install Docker Desktop: https://www.docker.com/products/docker-desktop/\n"
            "2. Start Docker Desktop and wait for it to finish loading.\n"
            "3. Retry — GEMI will build the small conversion image automatically (one-time)."
        )

    if _dji_docker_image_needs_rebuild():
        with _dji_docker_build_lock:
            if _dji_docker_image_needs_rebuild():
                _dji_docker_build_in_progress.set()
                try:
                    _build_dji_docker_image(on_progress)
                finally:
                    _dji_docker_build_in_progress.clear()
    elif _dji_docker_build_in_progress.is_set():
        if on_progress:
            on_progress("Conversion tool is being built (started by another conversion) — waiting…")
        _dji_docker_build_in_progress.wait(timeout=600)


def _convert_dji_rjpeg_docker(image_path: Path, params: dict[str, Any]) -> np.ndarray:
    """
    macOS counterpart to _convert_dji_rjpeg_native() — same measurement,
    run inside a Docker container since DJI ships no native macOS library.
    """
    on_progress: Callable[[str], None] | None = params.get("on_progress")

    lib_path, _source = _resolve_dji_sdk_lib(str(params.get("sdk_dir") or ""))
    if not lib_path.exists():
        raise ThermalConfigError(
            f"DJI Thermal SDK library not found at {lib_path}. This should be "
            "bundled with the app — if you're running from source, see "
            "backend/vendor/dji_thermal_sdk/README.md to vendor it locally, or "
            "set an override path in Settings → Thermal. (On macOS this file "
            "is run inside Docker, not loaded natively — see "
            "_convert_dji_rjpeg_docker.)"
        )

    _ensure_dji_docker_ready(on_progress)
    if on_progress:
        # Build-status messages only apply while the image is being built —
        # clear so a stale "still building" message doesn't linger once
        # per-image conversion is actually running.
        on_progress("")

    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp)
        out_npy = out_dir / "result.npy"
        cmd = [
            "docker", "run", "--rm",
            "--platform", _DJI_DOCKER_PLATFORM,
            "-v", f"{lib_path.parent}:/dji_sdk:ro",
            "-v", f"{image_path.parent}:/input:ro",
            "-v", f"{out_dir}:/output",
            _DJI_DOCKER_IMAGE,
            f"/input/{image_path.name}", "/output/result.npy",
            str(params.get("distance", 5.0)),
            str(params.get("humidity", 70.0)),
            str(params.get("emissivity", 1.0)),
            str(params.get("reflected_temperature", 25.0)),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0 or not out_npy.exists():
            detail = result.stderr.strip() or result.stdout.strip() or "no output from container"
            raise ThermalConfigError(
                f"DJI thermal conversion failed inside Docker for {image_path.name}:\n{detail}"
            )
        return np.load(out_npy)


def _convert_dji_rjpeg(image_path: Path, params: dict[str, Any]) -> np.ndarray:
    """
    Return a (height, width) float32 array of temperatures in Celsius.
    Dispatches to the native ctypes path on Windows/Linux (where DJI ships a
    library) or the Docker-backed path on macOS (where it doesn't).
    """
    if _dji_native_supported():
        return _convert_dji_rjpeg_native(image_path, params)
    return _convert_dji_rjpeg_docker(image_path, params)


def _dji_image_timestamp(filename: str) -> pd.Timestamp | None:
    """Parse capture time from a DJI filename: DJI_YYYYMMDDHHMMSS_NNNN_T.JPG."""
    parts = filename.split("_")
    if len(parts) < 3:
        return None
    try:
        return pd.Timestamp(datetime.strptime(parts[1], "%Y%m%d%H%M%S"))
    except ValueError:
        return None


_THERMAL_PLATFORM_CONVERTERS: dict[str, Callable[[Path, dict[str, Any]], np.ndarray]] = {
    "dji": _convert_dji_rjpeg,
}

_TIMESTAMP_PARSERS: dict[str, Callable[[str], "pd.Timestamp | None"]] = {
    "dji": _dji_image_timestamp,
}

SUPPORTED_THERMAL_PLATFORMS = tuple(_THERMAL_PLATFORM_CONVERTERS)


def extract_image_timestamp(filename: str, platform: str = "dji") -> pd.Timestamp | None:
    """Parse a capture timestamp from an image filename, per-platform convention."""
    parser = _TIMESTAMP_PARSERS.get(platform)
    return parser(filename) if parser else None


# Case-insensitive glob per platform for identifying raw thermal files within
# a folder that may also contain paired RGB/other images (e.g. DJI's
# _T.JPG thermal + _V.JPG visual pairs land in the same upload folder).
_THERMAL_FILE_SUFFIXES: dict[str, str] = {
    "dji": "_T.JPG",
}


def find_thermal_images(image_dir: Path, platform: str = "dji") -> list[Path]:
    """Return raw thermal image files in image_dir, per-platform naming convention."""
    suffix = _THERMAL_FILE_SUFFIXES.get(platform)
    if suffix is None or not image_dir.is_dir():
        return []
    suffix_lower = suffix.lower()
    return sorted(
        f for f in image_dir.iterdir()
        if f.is_file() and f.name.lower().endswith(suffix_lower)
    )


def is_raw_thermal_image(filename: str) -> bool:
    """
    True if `filename` matches any registered platform's raw-thermal-file
    naming convention (e.g. DJI's `..._T.JPG`).

    For callers that scan a directory containing both RGB and raw thermal
    images uploaded together (see Guided Upload's DJI thermal flow, which
    uploads `_T.JPG`/`_V.JPG` pairs into the same Images/ folder) and need
    to skip the raw thermal files when treating the directory as "a folder
    of ordinary photos" — e.g. EXIF/GPS metadata sync (sync.py), or feeding
    images into photogrammetry. Raw thermal captures aren't visible-light
    photos, their capture location is already represented by their paired
    RGB image where one exists, and naively re-saving one (e.g. an EXIF-
    orientation fix that decodes+re-encodes the JPEG) destroys the
    proprietary radiometric payload the DJI SDK needs for conversion.
    Checks against every registered platform, not just "dji", so this stays
    correct if another platform's suffix is added later.
    """
    name_lower = filename.lower()
    return any(name_lower.endswith(suffix.lower()) for suffix in _THERMAL_FILE_SUFFIXES.values())


# Paired visual/RGB image suffix per platform — e.g. DJI's DJI_..._T.JPG
# thermal capture is paired with DJI_..._V.JPG in the same directory.
_THERMAL_PAIR_SUFFIXES: dict[str, str] = {
    "dji": "_V.JPG",
}


def scan_thermal_directory(image_dir: Path, platform: str = "dji") -> dict[str, Any]:
    """
    Preview a picked directory before committing to upload. A raw DJI
    capture folder typically holds three kinds of files mixed together:
    thermal (_T.JPG), their paired RGB/visual shot (_V.JPG), and anything
    else (logs, sidecar files, unrelated images) that should be left
    behind. This walks the folder once and buckets accordingly, returning
    the resolved absolute paths of the thermal and paired-RGB files
    separately — so the caller can upload each bucket under its own
    image_type tag without a second directory listing round-trip, and
    without ever touching the "anything else" bucket.
    """
    thermal_images = find_thermal_images(image_dir, platform=platform)
    pair_suffix = _THERMAL_PAIR_SUFFIXES.get(platform)
    thermal_suffix = _THERMAL_FILE_SUFFIXES.get(platform, "")

    thermal_paths: list[str] = []
    rgb_paths: list[str] = []
    for f in thermal_images:
        thermal_paths.append(str(f))
        stem = f.name[: -len(thermal_suffix)] if thermal_suffix else f.stem
        if pair_suffix:
            pair_path = f.parent / f"{stem}{pair_suffix}"
            if pair_path.exists():
                rgb_paths.append(str(pair_path))

    total_count = sum(1 for f in image_dir.iterdir() if f.is_file()) if image_dir.is_dir() else 0
    other_count = total_count - len(thermal_paths) - len(rgb_paths)

    return {
        "total_count": total_count,
        "thermal_count": len(thermal_paths),
        "paired_count": len(rgb_paths),
        "other_count": other_count,
        "thermal_paths": thermal_paths,
        "rgb_paths": rgb_paths,
    }


# ── exiftool (vendored — GPS/timestamp EXIF copy) ────────────────────────
#
# Unlike the DJI SDK, exiftool is GPL/Artistic-licensed and freely
# redistributable, so it's vendored directly rather than requiring a manual
# per-machine download (see vendor/exiftool/README.md). Same bundled-first,
# fallback-second shape as the DJI SDK resolution above, but the fallback
# here is a real system install on PATH (common on dev machines) rather
# than a user-configured override.


def _bundled_exiftool_dir() -> Path:
    """Vendored exiftool root — same frozen/dev resolution as _bundled_dji_sdk_dir()."""
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)  # type: ignore[attr-defined]
    else:
        base = Path(__file__).parent.parent.parent  # backend/
    return base / "vendor" / "exiftool"


def _resolve_exiftool_cmd() -> tuple[list[str] | None, str]:
    """
    Resolve the argv prefix to invoke exiftool with.

    Returns (argv_prefix, source): argv_prefix is None if exiftool isn't
    available at all (bundled or on PATH) — callers should skip the EXIF
    copy rather than fail the whole conversion. source is "bundled" (the
    vendored copy — the expected case for most users), "path" (a real
    system install, e.g. this dev machine before vendoring), or
    "unavailable".

    The macOS/Linux vendored copy is a portable Perl script — invoked as
    `perl <script> ...` rather than executed directly, so it doesn't need
    to be marked executable or discoverable on PATH itself, only a `perl`
    binary (present by default on macOS and virtually every Linux distro).
    The Windows vendored copy bundles its own portable Perl, so it needs
    nothing else.
    """
    bundled_dir = _bundled_exiftool_dir()
    if _platform.system() == "Windows":
        bundled_exe = bundled_dir / "windows" / "exiftool(-k).exe"
        if bundled_exe.exists():
            return [str(bundled_exe)], "bundled"
    else:
        bundled_script = bundled_dir / "macos_linux" / "exiftool"
        perl_bin = shutil.which("perl")
        if bundled_script.exists() and perl_bin:
            return [perl_bin, str(bundled_script)], "bundled"

    system_bin = shutil.which("exiftool")
    if system_bin:
        return [system_bin], "path"
    return None, "unavailable"


def convert_thermal_image(
    image_path: Path | str,
    out_path: Path | str,
    platform: str = "dji",
    **params: Any,
) -> None:
    """
    Convert one proprietary thermal image into a single-band float32 GeoTIFF
    (temperature in Celsius), then copy GPS/timestamp EXIF from the source
    onto the output via exiftool (if available — logs a warning and skips
    otherwise, rather than failing the whole conversion).

    `params` also accepts an optional `on_progress: Callable[[str], None]` —
    only consulted on macOS, where the first conversion in a while may need
    to build the Docker-based conversion tool first (a few seconds to a
    minute); called with status strings during that build, and once with
    `""` right after to clear it once real conversion starts. No-op on
    Windows/Linux (native path never needs it).

    Raises ThermalConfigError on an unsupported platform, missing/misconfigured
    SDK, or a conversion failure for this specific image.
    """
    import rasterio

    image_path = Path(image_path)
    out_path = Path(out_path)

    converter = _THERMAL_PLATFORM_CONVERTERS.get(platform)
    if converter is None:
        raise ThermalConfigError(
            f"Unsupported thermal platform '{platform}'. Supported: "
            f"{', '.join(SUPPORTED_THERMAL_PLATFORMS)}."
        )

    img = converter(image_path, params)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        out_path, "w",
        driver="GTiff",
        height=img.shape[0], width=img.shape[1],
        count=1, dtype=rasterio.float32,
    ) as dst:
        dst.write(img, 1)

    exiftool_cmd, _exiftool_source = _resolve_exiftool_cmd()
    if exiftool_cmd:
        subprocess.run(
            [*exiftool_cmd, "-tagsfromfile", str(image_path), str(out_path), "-overwrite_original"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    else:
        logger.warning(
            "exiftool not available (bundled or on PATH) — %s was converted but has "
            "no GPS/timestamp EXIF copied from the source image.", out_path.name,
        )


def get_thermal_capabilities(sdk_dir: str = "") -> dict[str, Any]:
    """
    Report availability of thermal-conversion dependencies, for the frontend
    to check before offering the Thermal Conversion step — same "report,
    don't crash" pattern as utils.py's docker-check/capabilities routes.

    `sdk_dir` is the optional user-configured override; the bundled/vendored
    copy is checked first and is expected to be present in a normal install,
    so most users should see `available: true` with no configuration at all.
    """
    dji_sdk_importable = False
    try:
        import dji_thermal_sdk.dji_sdk  # noqa: F401
        dji_sdk_importable = True
    except ImportError:
        pass

    lib_path, lib_source = _resolve_dji_sdk_lib(sdk_dir)
    lib_available = lib_path.exists()

    # DJI ships no macOS build — on macOS the same vendored/overridden Linux
    # binary is run inside Docker instead of loaded natively (see
    # _convert_dji_rjpeg_docker), so availability there also depends on
    # Docker being reachable.
    execution_mode = "native" if _dji_native_supported() else "docker"
    docker_available = None if execution_mode == "native" else _docker_daemon_reachable()

    available = dji_sdk_importable and lib_available
    if execution_mode == "docker":
        available = available and bool(docker_available)

    return {
        "platforms": {
            "dji": {
                "sdk_package_available": dji_sdk_importable,
                "native_lib_source": lib_source,  # "bundled" or "override"
                "native_lib_configured": bool(sdk_dir),
                "native_lib_path": str(lib_path),
                "native_lib_available": lib_available,
                "execution_mode": execution_mode,  # "native" or "docker" (macOS)
                "docker_available": docker_available,  # only meaningful when execution_mode == "docker"
                "available": available,
            },
        },
        "exiftool_available": _resolve_exiftool_cmd()[0] is not None,
    }


# ── Weather station file readers ─────────────────────────────────────────

def _load_toa5(path: Path) -> pd.DataFrame:
    """
    Parse a Campbell Scientific TOA5 .dat file.

    Returns a DataFrame with columns [TIMESTAMP, AirTC, RH] sorted by
    TIMESTAMP. TIMESTAMP is a tz-naive pandas Timestamp.

    TOA5 layout: line 1 = environment metadata, line 2 = column names,
    lines 3-4 = units/aggregation (skipped), line 5+ = data rows.
    """
    with open(path, encoding="utf-8-sig", newline="") as fh:
        lines = fh.read().splitlines()

    if len(lines) < 5:
        raise ThermalConfigError(f"TOA5 file too short: {path.name}")

    columns = next(csv.reader([lines[1]]))
    data_lines = "\n".join(lines[4:])
    df = pd.read_csv(
        io.StringIO(data_lines),
        header=None, names=columns,
        na_values=["NAN", "NaN", "nan", ""], keep_default_na=True,
    )

    if "TIMESTAMP" not in df.columns:
        raise ThermalConfigError(f"No TIMESTAMP column found in {path.name}.")
    for col in ("AirTC", "RH"):
        if col not in df.columns:
            raise ThermalConfigError(f"Required column '{col}' not found in {path.name}.")

    df["TIMESTAMP"] = pd.to_datetime(df["TIMESTAMP"], errors="coerce")
    df["TIMESTAMP"] = df["TIMESTAMP"].dt.tz_localize(None)
    df = df.dropna(subset=["TIMESTAMP"]).sort_values("TIMESTAMP").reset_index(drop=True)

    df["AirTC"] = pd.to_numeric(df["AirTC"], errors="coerce")
    df["RH"] = pd.to_numeric(df["RH"], errors="coerce")

    return df[["TIMESTAMP", "AirTC", "RH"]]


_WEATHER_FORMAT_READERS: dict[str, Callable[[Path], pd.DataFrame]] = {
    "toa5": _load_toa5,
}

SUPPORTED_WEATHER_FORMATS = tuple(_WEATHER_FORMAT_READERS)


def load_weather_file(path: Path | str, format: str = "toa5") -> pd.DataFrame:
    """Parse a weather-station file into a normalized [TIMESTAMP, AirTC, RH] DataFrame."""
    reader = _WEATHER_FORMAT_READERS.get(format)
    if reader is None:
        raise ThermalConfigError(
            f"Unsupported weather file format '{format}'. Supported: "
            f"{', '.join(SUPPORTED_WEATHER_FORMATS)}."
        )
    return reader(Path(path))


def build_weather_matcher(
    weather_df: pd.DataFrame,
    fallback_humidity: float,
    fallback_ambient: float,
    max_diff_s: float = 3600.0,
) -> Callable[[Any], tuple[float, float, str]]:
    """
    Return a callable(image_timestamp) -> (humidity, ambient_temperature, source)
    that does nearest-timestamp matching against weather_df.

    Builds one KDTree up front (same approach as sync.py's ArduPilot-log GPS
    matching) so repeated per-image lookups in a pipeline run's loop are fast,
    rather than re-scanning the whole weather DataFrame for every image.
    `source` is "weather_file" when a match within max_diff_s was found,
    else "fallback".
    """
    valid = weather_df.dropna(subset=["TIMESTAMP"])
    if valid.empty:
        def _no_match(_ts: Any) -> tuple[float, float, str]:
            return fallback_humidity, fallback_ambient, "fallback"
        return _no_match

    ts_epoch = valid["TIMESTAMP"].astype("int64").to_numpy().reshape(-1, 1) / 1e9
    tree = KDTree(ts_epoch)

    def _match(image_timestamp: Any) -> tuple[float, float, str]:
        if image_timestamp is None:
            return fallback_humidity, fallback_ambient, "fallback"
        query = np.array([[pd.Timestamp(image_timestamp).value / 1e9]])
        dist, idx = tree.query(query, k=1)
        if float(dist[0]) > max_diff_s:
            return fallback_humidity, fallback_ambient, "fallback"
        row = valid.iloc[int(idx[0])]
        humidity = float(row["RH"]) if pd.notna(row["RH"]) else fallback_humidity
        ambient = float(row["AirTC"]) if pd.notna(row["AirTC"]) else fallback_ambient
        return humidity, ambient, "weather_file"

    return _match
