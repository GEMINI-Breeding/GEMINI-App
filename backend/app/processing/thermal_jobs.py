"""
Upload-scoped thermal conversion jobs.

A lightweight, in-memory background-job registry for running thermal
conversion directly against an uploaded directory, independent of any
`PipelineRun`. `aerial.run_thermal_conversion()` is `PipelineRun`-scoped
(reads from `RunPaths`), but no `PipelineRun` exists yet at Files-upload
time — a run is only created later, from an already-uploaded `FileUpload`.
This registry lets the Guided Upload flow trigger conversion right away.

Deliberately not `runner.py` — that registry is keyed by `PipelineRun.id`
and drives the SSE progress mechanism used by pipeline steps. This one is
polled instead (`GET /thermal/convert-directory/{job_id}`), and jobs are
transient — in-memory only, lost on backend restart. That's an accepted
trade-off for a short upload-time convenience action, not a durable
pipeline artifact (the resulting GeoTIFFs on disk *are* durable; only the
job's progress bookkeeping is not).

Public API
----------
start_conversion_job(directory, out_dir, platform, ..., weather_file_id) -> job_id
get_job_status(job_id) -> dict | None
"""

from __future__ import annotations

import logging
import threading
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _set_job(job_id: str, **updates: Any) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(updates)


def get_job_status(job_id: str) -> dict[str, Any] | None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job) if job is not None else None


def _mark_file_upload_converted(session: Any, file_upload_id: str, out_dir: Path) -> None:
    from app.models.file_upload import FileUpload

    try:
        record = session.get(FileUpload, uuid.UUID(file_upload_id))
    except ValueError:
        logger.warning("Invalid file_upload_id for conversion marking: %s", file_upload_id)
        return
    if record is None:
        return
    record.thermal_converted = True
    # Durable pointer to the converted GeoTIFFs — this job's own progress
    # bookkeeping is in-memory/transient (lost on backend restart), but a
    # PipelineRun created later from this same upload needs to be able to
    # find these files to adopt them instead of reporting no results.
    record.thermal_converted_dir = str(out_dir)
    session.add(record)
    session.commit()


def _run_job(
    job_id: str,
    directory: Path,
    out_dir: Path,
    platform: str,
    distance: float,
    humidity: float,
    emissivity: float,
    reflected_temperature: float,
    weather_file_id: str | None,
    file_upload_id: str | None,
) -> None:
    from app.processing import runner, thermal_utils

    session = runner.get_background_session()
    try:
        thermal_images = thermal_utils.find_thermal_images(directory, platform=platform)
        if not thermal_images:
            _set_job(
                job_id, status="error",
                error=f"No thermal images found in {directory} for platform '{platform}'.",
            )
            return

        sdk_dir = ""
        if platform == "dji":
            from app.crud.app_settings import get_setting
            sdk_dir = get_setting(session=session, key="dji_thermal_sdk_path") or ""

        weather_matcher = None
        if weather_file_id:
            from app.models.weather_station_file import WeatherStationFile
            weather_record = session.get(WeatherStationFile, uuid.UUID(weather_file_id))
            if weather_record and Path(weather_record.file_path).exists():
                weather_df = thermal_utils.load_weather_file(
                    Path(weather_record.file_path), format=weather_record.format,
                )
                weather_matcher = thermal_utils.build_weather_matcher(
                    weather_df, fallback_humidity=humidity, fallback_ambient=reflected_temperature,
                )

        out_dir.mkdir(parents=True, exist_ok=True)
        total = len(thermal_images)
        _set_job(job_id, status="running", total=total, done=0)

        converted: list[dict[str, Any]] = []
        for i, image_path in enumerate(thermal_images):
            image_humidity, image_ambient = humidity, reflected_temperature
            if weather_matcher:
                ts = thermal_utils.extract_image_timestamp(image_path.name, platform=platform)
                image_humidity, image_ambient, _src = weather_matcher(ts)

            out_path = out_dir / (image_path.stem + ".tif")
            try:
                thermal_utils.convert_thermal_image(
                    image_path, out_path, platform=platform,
                    distance=distance, humidity=image_humidity,
                    emissivity=emissivity, reflected_temperature=image_ambient,
                    sdk_dir=sdk_dir,
                    on_progress=lambda msg: _set_job(job_id, message=msg),
                )
                import rasterio
                with rasterio.open(out_path) as ds:
                    band = ds.read(1)
                converted.append({
                    "name": out_path.name,
                    "path": str(out_path),
                    "min_temp": round(float(band.min()), 2),
                    "max_temp": round(float(band.max()), 2),
                    "mean_temp": round(float(band.mean()), 2),
                })
            except thermal_utils.ThermalConfigError as exc:
                # Config errors (missing SDK, bad params) won't resolve by
                # retrying the next image — abort the whole job with a clear
                # message, same as aerial.run_thermal_conversion().
                _set_job(job_id, status="error", error=str(exc), done=i, images=list(converted))
                return
            except Exception as exc:
                logger.warning("Thermal conversion failed for %s: %s", image_path.name, exc)

            _set_job(job_id, done=i + 1, images=list(converted))

        if file_upload_id:
            _mark_file_upload_converted(session, file_upload_id, out_dir)
        _set_job(job_id, status="done", done=total, images=converted)
    except Exception as exc:
        logger.exception("Thermal conversion job %s failed", job_id)
        _set_job(job_id, status="error", error=str(exc))
    finally:
        session.close()


def start_conversion_job(
    directory: Path,
    out_dir: Path,
    platform: str = "dji",
    distance: float = 5.0,
    humidity: float = 70.0,
    emissivity: float = 1.0,
    reflected_temperature: float = 25.0,
    weather_file_id: str | None = None,
    job_id: str | None = None,
    file_upload_id: str | None = None,
) -> str:
    """
    Start a background thermal-conversion job over `directory`. Returns a
    job_id to poll. Pass `job_id` explicitly if the caller needs to know it
    up front (e.g. to derive `out_dir` from it before starting). Pass
    `file_upload_id` (the source FileUpload record's id) so the record can
    be flagged `thermal_converted=True` on success, letting the Guided
    Upload flow detect it's no longer awaiting conversion.
    """
    job_id = job_id or str(uuid.uuid4())
    with _jobs_lock:
        _jobs[job_id] = {"status": "pending", "total": 0, "done": 0, "images": [], "error": None, "message": None}

    thread = threading.Thread(
        target=_run_job,
        args=(job_id, directory, out_dir, platform, distance, humidity, emissivity, reflected_temperature, weather_file_id, file_upload_id),
        daemon=True,
    )
    thread.start()
    return job_id
