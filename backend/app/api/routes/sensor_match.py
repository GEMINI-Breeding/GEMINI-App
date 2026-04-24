"""
Timestamp-based cross-sensor matching.

Given a "sensor" upload (Multispectral Data, Thermal Data, or any upload with
extractable per-image timestamps) and an RGB source upload that has an associated
msgs_synced.csv, this module finds the closest-in-time RGB frame for each sensor
image using nearest-neighbour timestamp matching.

Endpoints
---------
GET  /sensor-match/{upload_id}/candidates
    Returns RGB-source uploads (Farm-ng Binary File or Synced Metadata) that share
    the same experiment/location/population/date and have a resolvable msgs_synced.csv.

POST /sensor-match/{upload_id}/match
    Body: { rgb_upload_id, timestamp_source, timestamp_format }
    Runs the nearest-neighbour match and returns per-image pairs with GPS coords
    and time deltas.  Emits a warning when the median or max delta looks suspicious.

# FUTURE: once orthomosaics are stitched and georeferenced, expose a map-tab view
# that overlays matched sensor frames on the RGB orthomosaic using the GPS coords
# stored in each matched pair.  The MatchedPair.lat/lon fields are already populated
# to support this when the map viewer is built out.
"""

import bisect
import csv
import logging
import uuid
from collections import defaultdict
from pathlib import Path
from statistics import median

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.crud.app_settings import get_setting, set_setting
from app.models.file_upload import FileUpload
from app.models.multispectral import MultispectralConfig
from app.processing.multispectral_utils import (
    IMAGE_EXTENSIONS,
    detect_timestamp_method,
    extract_timestamp,
    extract_timestamp_from_exif,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sensor-match", tags=["sensor-match"])

# ── Warning thresholds ────────────────────────────────────────────────────────

# Median delta above which we warn that the datasets may not overlap in time.
_WARN_MEDIAN_MS = 2_000   # 2 s
# Max delta above which we warn even if median is fine (occasional large gaps).
_WARN_MAX_MS    = 5_000   # 5 s

# Data types that can serve as the RGB/GPS source (have msgs_synced.csv).
_RGB_SOURCE_TYPES = {"Farm-ng Binary File", "Synced Metadata", "Image Data"}

# Data types that can be matched as the sensor side.
_SENSOR_TYPES = {"Multispectral Data", "Thermal Data"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _data_root(session: SessionDep) -> Path:
    raw = get_setting(session=session, key="data_root")
    return Path(raw or settings.APP_DATA_ROOT)


def _find_msgs_synced(upload: FileUpload, data_root: Path) -> Path | None:
    """
    Locate the msgs_synced.csv for an RGB-source upload.

    Search order:
      1. upload.msgs_synced_path  (set after Farm-ng binary extraction)
      2. <storage_path>/Metadata/msgs_synced.csv  (extraction output layout)
      3. <storage_path>/../Metadata/msgs_synced.csv  (Images sub-dir variant)
    """
    if upload.msgs_synced_path:
        p = data_root / upload.msgs_synced_path
        if p.exists():
            return p

    base = data_root / upload.storage_path
    for candidate in (
        base / "Metadata" / "msgs_synced.csv",
        base.parent / "Metadata" / "msgs_synced.csv",
    ):
        if candidate.exists():
            return candidate

    return None


def _load_msgs_synced(path: Path) -> list[dict]:
    """
    Load msgs_synced.csv, normalising column names to the canonical set
    (timestamp, lat, lon, alt, rgb_file).

    Supports the Farm-ng column names (/top/rgb_file, /top/rgb, stamp) as well
    as the user-facing aliases used by MsgsSyncedUploadDialog.
    """
    ALIASES: dict[str, str] = {
        # timestamp
        "timestamp": "timestamp", "unix_time": "timestamp", "unix_ts": "timestamp",
        "epoch": "timestamp", "posix": "timestamp", "ts": "timestamp", "stamp": "timestamp",
        # lat
        "lat": "lat", "latitude": "lat",
        # lon
        "lon": "lon", "long": "lon", "longitude": "lon",
        # alt
        "alt": "alt", "altitude": "alt", "height": "alt", "elevation": "alt",
        # rgb image filename  (Farm-ng and user variants)
        "/top/rgb_file": "rgb_file", "/top/rgb": "rgb_file",
        "image_path": "rgb_file", "image": "rgb_file", "filename": "rgb_file",
        "file": "rgb_file", "name": "rgb_file", "path": "rgb_file",
    }

    rows: list[dict] = []
    with open(path, newline="") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            return rows
        col_map = {col: ALIASES.get(col.strip().lower(), col.strip().lower())
                   for col in reader.fieldnames}
        for raw in reader:
            row = {col_map.get(k, k): v for k, v in raw.items()}
            try:
                row["timestamp"] = float(row["timestamp"])
            except (KeyError, ValueError, TypeError):
                continue  # skip rows without a valid timestamp
            rows.append(row)

    rows.sort(key=lambda r: r["timestamp"])
    return rows


def _image_files(upload: FileUpload, data_root: Path) -> list[Path]:
    storage = data_root / upload.storage_path
    return sorted(
        p for p in storage.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )


# ── Pydantic models ───────────────────────────────────────────────────────────

class CandidateRgb(BaseModel):
    upload_id: str
    data_type: str
    experiment: str
    location: str
    population: str
    date: str
    platform: str | None
    sensor: str | None
    file_count: int
    has_msgs_synced: bool


class CandidatesResponse(BaseModel):
    candidates: list[CandidateRgb]


class MatchRequest(BaseModel):
    rgb_upload_id: str
    # Sensor-side timestamp config (only needed if not already stored in
    # MultispectralConfig; for Thermal Data this is always required).
    timestamp_source: str = "exif"   # "exif" | "filename"
    timestamp_format: str | None = None
    # Optional uniform shift applied to every sensor timestamp before matching.
    # Use this to correct a systemic clock offset (e.g. sensor clock drifted or
    # was never synced to GPS time).  Positive = sensor timestamps are shifted
    # later (sensor clock was behind); negative = shifted earlier.
    timestamp_offset_s: float = 0.0


class MatchedPair(BaseModel):
    sensor_rel_path: str        # path relative to sensor upload storage_path
    sensor_filename: str
    sensor_timestamp_iso: str | None
    rgb_filename: str           # filename within the RGB source
    rgb_timestamp: float        # unix seconds
    time_delta_ms: float
    lat: float | None
    lon: float | None
    alt: float | None


class MatchResult(BaseModel):
    matches: list[MatchedPair]
    total_sensor_images: int
    matched_count: int          # images that had an extractable timestamp
    unmatched_count: int        # images where timestamp extraction failed
    median_delta_ms: float | None
    max_delta_ms: float | None
    applied_offset_s: float     # the timestamp_offset_s that produced these matches
    # "exif_tag" | "tiff_ifd" | "filesystem" | "filename" — what actually worked
    timestamp_method: str | None
    warning: str | None         # populated when deltas suggest wrong data selection


# ── Matching helpers ──────────────────────────────────────────────────────────

def _nearest(rows: list[dict], ts: float) -> dict:
    """Binary-search for the row with the closest timestamp."""
    lo, hi = 0, len(rows) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if rows[mid]["timestamp"] < ts:
            lo = mid + 1
        else:
            hi = mid
    if lo > 0 and abs(rows[lo - 1]["timestamp"] - ts) < abs(rows[lo]["timestamp"] - ts):
        return rows[lo - 1]
    return rows[lo]


def _redistribute_collisions(
    raw_matches: list[tuple[float, MatchedPair]],
    rows: list[dict],
) -> list[MatchedPair]:
    """
    When multiple sensor images all nearest-matched to the same RGB frame,
    redistribute them across the k nearest distinct RGB frames in timestamp order.

    This handles both directions of resolution mismatch:

    • RGB has higher resolution (e.g. msgs_synced has microsecond timestamps but
      sensor EXIF only records whole seconds): several sensor images all carry the
      same second-level timestamp and all map to the same nearest RGB frame.

    • Sensor has higher resolution (e.g. multispectral filenames encode microseconds
      but msgs_synced only has second-resolution timestamps): multiple sensor images
      in the same second collapse onto the single nearest RGB row.

    In either case the fix is identical: detect n-to-1 collisions, expand outward
    from the colliding RGB position to collect n distinct RGB rows, then pair sensor
    images to RGB frames in strict timestamp order so temporal sequence is preserved.
    """
    rgb_timestamps = [float(r["timestamp"]) for r in rows]

    groups: dict[float, list[int]] = defaultdict(list)
    for i, (_, pair) in enumerate(raw_matches):
        groups[pair.rgb_timestamp].append(i)

    result: list[MatchedPair] = [pair for _, pair in raw_matches]

    for rgb_ts, idxs in groups.items():
        if len(idxs) <= 1:
            continue

        k = len(idxs)
        pos = bisect.bisect_left(rgb_timestamps, rgb_ts)

        # Expand outward from pos to collect k distinct RGB rows
        candidates: list[dict] = []
        left, right = pos - 1, pos
        while len(candidates) < k and (left >= 0 or right < len(rows)):
            if right < len(rows) and (
                left < 0
                or abs(rgb_timestamps[right] - rgb_ts) <= abs(rgb_timestamps[left] - rgb_ts)
            ):
                candidates.append(rows[right])
                right += 1
            else:
                candidates.append(rows[left])
                left -= 1

        # Pair in timestamp order: earliest sensor image → earliest RGB candidate
        sorted_idxs = sorted(idxs, key=lambda i: raw_matches[i][0])
        sorted_rgb  = sorted(candidates, key=lambda r: float(r["timestamp"]))

        for sensor_i, rgb_row in zip(sorted_idxs, sorted_rgb):
            sensor_unix = raw_matches[sensor_i][0]
            pair = raw_matches[sensor_i][1]
            new_delta = abs(sensor_unix - float(rgb_row["timestamp"])) * 1_000
            result[sensor_i] = MatchedPair(
                sensor_rel_path=pair.sensor_rel_path,
                sensor_filename=pair.sensor_filename,
                sensor_timestamp_iso=pair.sensor_timestamp_iso,
                rgb_filename=rgb_row.get("rgb_file") or "",
                rgb_timestamp=float(rgb_row["timestamp"]),
                time_delta_ms=round(new_delta, 1),
                lat=_safe_float(rgb_row.get("lat")),
                lon=_safe_float(rgb_row.get("lon")),
                alt=_safe_float(rgb_row.get("alt")),
            )

    return result


# ── Offset persistence helpers ────────────────────────────────────────────────

def _offset_key(data_type: str) -> str:
    """AppSetting key for the last-used timestamp offset for a given data type."""
    slug = data_type.lower().replace(" ", "_")
    return f"sensor_match_offset_{slug}"


# ── Endpoints ─────────────────────────────────────────────────────────────────

class OffsetResponse(BaseModel):
    offset_s: float


class OffsetSaveRequest(BaseModel):
    offset_s: float
    data_type: str


@router.get("/last-offset", response_model=OffsetResponse)
def get_last_offset(
    data_type: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> OffsetResponse:
    """Return the last-saved timestamp offset (seconds) for this data type."""
    raw = get_setting(session=session, key=_offset_key(data_type))
    try:
        return OffsetResponse(offset_s=float(raw) if raw else 0.0)
    except (ValueError, TypeError):
        return OffsetResponse(offset_s=0.0)


@router.post("/save-offset", response_model=OffsetResponse)
def save_last_offset(
    body: OffsetSaveRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> OffsetResponse:
    """Persist the timestamp offset for this data type for future sessions."""
    set_setting(session=session, key=_offset_key(body.data_type), value=str(body.offset_s))
    return OffsetResponse(offset_s=body.offset_s)


@router.get("/{upload_id}/candidates", response_model=CandidatesResponse)
def get_candidates(
    upload_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
) -> CandidatesResponse:
    """
    Return uploads that could serve as the RGB/GPS source for timestamp matching.

    Matches on experiment + location + population + date from the sensor upload,
    filtered to data types that carry a msgs_synced.csv.
    """
    sensor = session.get(FileUpload, upload_id)
    if not sensor:
        raise HTTPException(status_code=404, detail="Upload not found")
    if not current_user.is_superuser and sensor.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    data_root = _data_root(session)

    stmt = select(FileUpload).where(
        FileUpload.experiment == sensor.experiment,
        FileUpload.location   == sensor.location,
        FileUpload.population == sensor.population,
        FileUpload.date       == sensor.date,
        FileUpload.data_type.in_(_RGB_SOURCE_TYPES),  # type: ignore[union-attr]
        FileUpload.id         != sensor.id,
    )
    candidates = session.exec(stmt).all()

    result: list[CandidateRgb] = []
    for c in candidates:
        has_msgs = _find_msgs_synced(c, data_root) is not None
        result.append(CandidateRgb(
            upload_id=str(c.id),
            data_type=c.data_type,
            experiment=c.experiment,
            location=c.location,
            population=c.population,
            date=c.date,
            platform=c.platform,
            sensor=c.sensor,
            file_count=c.file_count,
            has_msgs_synced=has_msgs,
        ))

    # Sort: uploads with msgs_synced first, then by data_type
    result.sort(key=lambda x: (not x.has_msgs_synced, x.data_type))
    return CandidatesResponse(candidates=result)


@router.post("/{upload_id}/match", response_model=MatchResult)
def match_sensors(
    upload_id: uuid.UUID,
    body: MatchRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> MatchResult:
    """
    Nearest-neighbour timestamp match between sensor images and RGB frames.

    For each sensor image:
      1. Extract a UTC timestamp (from MultispectralConfig if stored, else body params).
      2. Binary-search msgs_synced.csv for the closest RGB frame by unix timestamp.
      3. Record the match with GPS coords and time delta.

    A warning is returned when:
      - median delta  > 2 s  (datasets probably don't overlap in time)
      - max delta     > 5 s  (at least one frame is very far from its match)
    """
    sensor = session.get(FileUpload, upload_id)
    if not sensor:
        raise HTTPException(status_code=404, detail="Upload not found")
    if not current_user.is_superuser and sensor.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    rgb_upload = session.get(FileUpload, uuid.UUID(body.rgb_upload_id))
    if not rgb_upload:
        raise HTTPException(status_code=404, detail="RGB upload not found")

    data_root = _data_root(session)

    # ── 1. Load msgs_synced.csv ───────────────────────────────────────────────
    msgs_path = _find_msgs_synced(rgb_upload, data_root)
    if not msgs_path:
        raise HTTPException(
            status_code=422,
            detail=(
                "No msgs_synced.csv found for the selected RGB source. "
                "Make sure the Farm-ng binary extraction completed or a Synced "
                "Metadata CSV was uploaded for this date/location."
            ),
        )

    rows = _load_msgs_synced(msgs_path)
    if not rows:
        raise HTTPException(
            status_code=422,
            detail="msgs_synced.csv is empty or has no valid timestamp rows.",
        )

    # ── 2. Resolve timestamp config for the sensor upload ────────────────────
    ts_source = body.timestamp_source
    ts_format = body.timestamp_format

    # For Multispectral Data, prefer the stored MultispectralConfig if available
    if sensor.data_type == "Multispectral Data":
        cfg = session.exec(
            select(MultispectralConfig).where(
                MultispectralConfig.file_upload_id == sensor.id
            )
        ).first()
        if cfg and cfg.timestamp_source not in ("none", None):
            ts_source = cfg.timestamp_source
            ts_format = cfg.timestamp_format

    if ts_source in ("none", None):
        raise HTTPException(
            status_code=422,
            detail=(
                "No timestamp source configured for this upload. "
                "Open the band configuration dialog and set a timestamp source first."
            ),
        )

    # ── 3. Extract timestamps for all sensor images ───────────────────────────
    storage_dir = data_root / sensor.storage_path
    image_paths = _image_files(sensor, data_root)

    if not image_paths:
        raise HTTPException(status_code=422, detail="No image files found in upload.")

    raw_matches: list[tuple[float, MatchedPair]] = []
    unmatched = 0

    for img_path in image_paths:
        dt = extract_timestamp(img_path, ts_source, ts_format)
        if dt is None:
            unmatched += 1
            continue

        sensor_unix = dt.timestamp() + body.timestamp_offset_s
        best = _nearest(rows, sensor_unix)
        rgb_unix = float(best["timestamp"])
        delta_ms = abs(sensor_unix - rgb_unix) * 1_000

        try:
            rel = img_path.relative_to(storage_dir)
        except ValueError:
            rel = Path(img_path.name)

        raw_matches.append((sensor_unix, MatchedPair(
            sensor_rel_path=rel.as_posix(),
            sensor_filename=img_path.name,
            sensor_timestamp_iso=dt.isoformat(),
            rgb_filename=best.get("rgb_file") or "",
            rgb_timestamp=rgb_unix,
            time_delta_ms=round(delta_ms, 1),
            lat=_safe_float(best.get("lat")),
            lon=_safe_float(best.get("lon")),
            alt=_safe_float(best.get("alt")),
        )))

    if not raw_matches:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Could not extract timestamps from any of the {len(image_paths)} "
                f"sensor images using source='{ts_source}'. "
                "Check the timestamp configuration in the band config dialog."
            ),
        )

    # Redistribute n-to-1 collisions across adjacent RGB frames
    matches = _redistribute_collisions(raw_matches, rows)

    # ── 4. Detect which timestamp method was used (sample first matched image) ──
    ts_method: str | None = None
    if matches:
        # find the absolute path for the first matched image
        first_rel = matches[0].sensor_rel_path
        first_abs = storage_dir / first_rel
        if first_abs.exists():
            ts_method = detect_timestamp_method(first_abs)

    # ── 5. Compute stats and warning ─────────────────────────────────────────
    deltas = [m.time_delta_ms for m in matches]
    med = round(median(deltas), 1)
    mx  = round(max(deltas), 1)

    warning: str | None = None
    if ts_method == "filesystem":
        warning = (
            "Timestamps were read from filesystem creation times because no embedded "
            "EXIF/TIFF metadata was found in these images. Filesystem timestamps are "
            "reset when files are copied, so matches may be inaccurate if the files "
            "were transferred after capture. Consider using filename-based timestamps "
            "if the filenames contain capture times."
        )
    elif med > _WARN_MEDIAN_MS:
        warning = (
            f"The median time difference between matched frames is {med / 1000:.1f} s "
            f"(max {mx / 1000:.1f} s). This is unusually large — make sure you selected "
            "the correct RGB source for this sensor dataset. Matches may be unreliable."
        )
    elif mx > _WARN_MAX_MS:
        warning = (
            f"Most matches look good (median {med / 1000:.1f} s), but the largest "
            f"gap is {mx / 1000:.1f} s. A few sensor images may not have a close RGB "
            "counterpart — check the matched pairs manually."
        )

    logger.info(
        "Sensor match: upload=%s rgb=%s images=%d matched=%d unmatched=%d "
        "median_delta=%.0f ms max_delta=%.0f ms",
        upload_id, body.rgb_upload_id, len(image_paths), len(matches), unmatched,
        med, mx,
    )

    return MatchResult(
        matches=matches,
        total_sensor_images=len(image_paths),
        matched_count=len(matches),
        unmatched_count=unmatched,
        median_delta_ms=med,
        max_delta_ms=mx,
        applied_offset_s=body.timestamp_offset_s,
        timestamp_method=ts_method,
        warning=warning,
    )


def _safe_float(val: object) -> float | None:
    try:
        f = float(val)  # type: ignore[arg-type]
        return f if f == f else None   # exclude NaN
    except (TypeError, ValueError):
        return None
