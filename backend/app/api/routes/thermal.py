"""
Thermal conversion API routes.

Global resources (upload / list / delete), not tied to a workspace or
pipeline run — mirrors reference_data.py's global-resource shape:
  POST   /thermal/weather-files
  GET    /thermal/weather-files
  DELETE /thermal/weather-files/{id}
  GET    /thermal/preview          — colorized PNG render of one converted GeoTIFF
  GET    /thermal/scan-directory   — preview thermal/paired-RGB counts before upload
  POST   /thermal/convert-directory        — start an upload-scoped conversion job
  GET    /thermal/convert-directory/{id}   — poll job status/results

Thermal SDK/exiftool availability is reported via the existing shared
GET /utils/capabilities/ endpoint (utils.py), not a separate route here.
"""

import io
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.crud.app_settings import get_setting
from app.models.file_upload import FileUpload
from app.models.weather_station_file import WeatherStationFile, WeatherStationFilePublic
from app.processing import thermal_jobs, thermal_utils

router = APIRouter(prefix="/thermal", tags=["thermal"])


def _weather_data_dir(session: SessionDep) -> Path:
    data_root = Path(get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT)
    return data_root / "weather_data"


def _thermal_converted_dir(session: SessionDep) -> Path:
    data_root = Path(get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT)
    return data_root / "thermal_converted"


@router.post("/weather-files", response_model=WeatherStationFilePublic)
async def upload_weather_file(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    file: UploadFile,
    name: str = Query(..., description="Display name for this weather file"),
    format: str = Query(default="toa5", description="Weather file format — see thermal_utils.SUPPORTED_WEATHER_FORMATS"),
) -> Any:
    content = await file.read()
    filename = file.filename or "weather_upload"

    # Parse from a temp file — the readers work off a real path, matching
    # thermal_utils.load_weather_file's on-disk contract.
    with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        try:
            df = thermal_utils.load_weather_file(tmp_path, format=format)
        except thermal_utils.ThermalConfigError as e:
            raise HTTPException(status_code=422, detail=str(e))
    finally:
        tmp_path.unlink(missing_ok=True)

    if df.empty:
        raise HTTPException(status_code=422, detail="No valid rows found in the uploaded weather file.")

    record = WeatherStationFile(
        name=name,
        format=format,
        original_filename=filename,
        file_path="",  # set below once we know the id
        row_count=len(df),
        start_time=str(df["TIMESTAMP"].min()),
        end_time=str(df["TIMESTAMP"].max()),
    )
    session.add(record)
    session.flush()  # get record.id

    weather_dir = _weather_data_dir(session) / str(record.id)
    weather_dir.mkdir(parents=True, exist_ok=True)
    dest = weather_dir / filename
    dest.write_bytes(content)
    record.file_path = str(dest)

    session.add(record)
    session.commit()
    session.refresh(record)

    return record


@router.get("/weather-files", response_model=list[WeatherStationFilePublic])
def list_weather_files(session: SessionDep, current_user: CurrentUser) -> Any:
    return session.exec(
        select(WeatherStationFile).order_by(WeatherStationFile.created_at.desc())
    ).all()


@router.delete("/weather-files/{id}")
def delete_weather_file(session: SessionDep, current_user: CurrentUser, id: uuid.UUID) -> dict[str, str]:
    record = session.get(WeatherStationFile, id)
    if not record:
        raise HTTPException(status_code=404, detail="Weather file not found")

    if record.file_path:
        file_dir = Path(record.file_path).parent
        if file_dir.exists():
            shutil.rmtree(file_dir, ignore_errors=True)

    session.delete(record)
    session.commit()
    return {"message": "Weather file deleted"}


@router.get("/preview")
def preview_thermal_image(
    session: SessionDep,
    current_user: CurrentUser,
    path: str = Query(..., description="Absolute path, or path relative to data_root, to a converted thermal GeoTIFF"),
    colormap: str = Query(default="inferno", description="Any matplotlib colormap name"),
) -> StreamingResponse:
    """
    Render one converted single-band float32 GeoTIFF as a colorized PNG —
    raw GeoTIFF pixel data isn't directly viewable in a browser `<img>`, so
    this is the "viewable as temperature" piece: min/max/mean temperature
    are returned as response headers alongside the image.

    Only .tif/.tiff under the configured data_root — same extension-allowlist
    pattern as files.py's /files/serve. `path` may be absolute (existing
    Guided Upload callers already pass absolute paths) or relative to
    data_root (PipelineRun.outputs stores orthomosaic/thermal paths as
    data_root-relative strings via RunPaths.rel(), so they stay valid if the
    user changes their data_root setting later).
    """
    import matplotlib
    import numpy as np
    import rasterio

    src = Path(path)
    if not src.is_absolute():
        data_root = Path(get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT)
        src = data_root / src
    if src.suffix.lower() not in (".tif", ".tiff"):
        raise HTTPException(status_code=400, detail=f"File type '{src.suffix}' is not previewable here.")
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    with rasterio.open(src) as ds:
        band = ds.read(1).astype(np.float32)

    finite = band[np.isfinite(band)]
    if finite.size == 0:
        raise HTTPException(status_code=422, detail=f"{src.name} has no valid temperature values.")
    vmin, vmax = float(finite.min()), float(finite.max())

    try:
        cmap = matplotlib.colormaps[colormap]
    except KeyError:
        raise HTTPException(status_code=400, detail=f"Unknown colormap '{colormap}'.")

    normalized = np.zeros_like(band) if vmax == vmin else (band - vmin) / (vmax - vmin)
    rgba = (cmap(normalized) * 255).astype(np.uint8)

    from PIL import Image
    img = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)

    return StreamingResponse(
        buf, media_type="image/png",
        headers={
            "X-Min-Temp-C": str(round(vmin, 2)),
            "X-Max-Temp-C": str(round(vmax, 2)),
            "X-Mean-Temp-C": str(round(float(finite.mean()), 2)),
        },
    )


@router.get("/scan-directory")
def scan_directory(
    current_user: CurrentUser,
    path: str = Query(..., description="Absolute path to a directory to scan"),
    platform: str = Query(default="dji"),
) -> dict[str, Any]:
    """
    Preview thermal/paired-RGB image counts (+ resolved file paths) for a
    picked directory before the user commits to uploading it — the
    "detected with _T and _V" check.
    """
    directory = Path(path)
    if not directory.is_dir():
        raise HTTPException(status_code=404, detail=f"Directory not found: {path}")
    return thermal_utils.scan_thermal_directory(directory, platform=platform)


class ConvertDirectoryRequest(BaseModel):
    path: str
    platform: str = "dji"
    distance: float = 5.0
    humidity: float = 70.0
    emissivity: float = 1.0
    reflected_temperature: float = 25.0
    weather_file_id: str | None = None
    # The source FileUpload record's id (if this directory came from a
    # tracked upload) — lets the job flag it thermal_converted=True on
    # success so it drops off GET /thermal/pending-conversions.
    file_upload_id: str | None = None


@router.post("/convert-directory")
def convert_directory(
    session: SessionDep,
    current_user: CurrentUser,
    body: ConvertDirectoryRequest,
) -> dict[str, str]:
    """
    Start an upload-scoped thermal conversion job over a directory — not
    tied to any PipelineRun (see thermal_jobs.py). Returns immediately with
    a job_id to poll via GET /thermal/convert-directory/{job_id}.
    """
    directory = Path(body.path)
    if not directory.is_dir():
        raise HTTPException(status_code=404, detail=f"Directory not found: {body.path}")

    job_id = str(uuid.uuid4())
    out_dir = _thermal_converted_dir(session) / job_id
    thermal_jobs.start_conversion_job(
        directory, out_dir,
        platform=body.platform,
        distance=body.distance,
        humidity=body.humidity,
        emissivity=body.emissivity,
        reflected_temperature=body.reflected_temperature,
        weather_file_id=body.weather_file_id,
        job_id=job_id,
        file_upload_id=body.file_upload_id,
    )
    return {"job_id": job_id}


@router.get("/pending-conversions")
def pending_conversions(session: SessionDep, current_user: CurrentUser) -> list[dict[str, Any]]:
    """
    Thermal-tagged uploads that haven't been converted yet — lets the
    Guided Upload flow offer to resume conversion for a directory that was
    already uploaded (e.g. the user navigated away, or closed the app,
    before starting/finishing the conversion step), instead of requiring a
    fresh directory pick every time.
    """
    records = session.exec(
        select(FileUpload).where(
            (FileUpload.owner_id == current_user.id)
            & (FileUpload.data_type == "Image Data")
            & (FileUpload.image_type == "thermal")
            & (FileUpload.thermal_converted.is_(False))
        ).order_by(FileUpload.created_at.desc())
    ).all()

    data_root = Path(get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT)
    results: list[dict[str, Any]] = []
    for record in records:
        directory = Path(record.storage_path)
        if not directory.is_absolute():
            directory = data_root / record.storage_path
        if not directory.is_dir():
            continue
        scan = thermal_utils.scan_thermal_directory(directory, platform="dji")
        if scan["thermal_count"] == 0:
            continue
        results.append({
            "file_upload_id": str(record.id),
            "storage_path": str(directory),
            "experiment": record.experiment,
            "location": record.location,
            "population": record.population,
            "date": record.date,
            "platform": record.platform,
            "sensor": record.sensor,
            "thermal_count": scan["thermal_count"],
            "paired_count": scan["paired_count"],
            "created_at": record.created_at,
        })
    return results


@router.get("/convert-directory/{job_id}")
def convert_directory_status(current_user: CurrentUser, job_id: str) -> dict[str, Any]:
    """Poll an upload-scoped conversion job's progress/results."""
    status = thermal_jobs.get_job_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail=f"No conversion job found for id '{job_id}'")
    return status
