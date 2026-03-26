"""
Data Sync — Step 0 of the aerial pipeline.

What it does
------------
1. Scans Raw/.../Images/ (or Raw/...) for drone JPEGs:
   - Extracts GPS lat/lon/alt + UTC timestamp from EXIF
   - Auto-rotates portrait images 90° clockwise (in-place)
   - Writes/updates Intermediate/.../msgs_synced.csv

2. Scans Raw/.../Metadata/ for ArduPilot platform logs (.bin/.log/.tlog):
   - Parses GPS, LiDAR rangefinder (height AGL), and attitude data via pymavlink
   - KD-tree timestamp-matches rangefinder + attitude to each GPS record
   - Prefers LiDAR height-AGL over GPS MSL altitude
   - Writes Intermediate/.../drone_msgs.csv

3. If drone_msgs.csv was produced, merges it into msgs_synced.csv:
   - KD-tree timestamp match (within 5 s) replaces EXIF lat/lon/alt with
     more accurate platform-log GPS

4. Writes geo.txt for ODM:
   - Format: {image_name} {lon} {lat} {alt} per line (EPSG:4326 header)
"""

from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from PIL import Image
from scipy.spatial import KDTree
from sqlmodel import Session

from app.core.paths import RunPaths
from app.models.workspace import Workspace

logger = logging.getLogger(__name__)

_IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
_LOG_EXTS = {".bin", ".log", ".tlog"}

# Column name aliases for user-provided msgs_synced.csv.
# Farm-ng bundled files use slash-prefixed column names like "/top/rgb_file".
_COL_ALIASES: dict[str, list[str]] = {
    "image_path": ["image_path", "image", "filename", "file", "name", "path",
                   "/top/rgb_file", "/top/rgb", "/left/rgb_file", "/right/rgb_file"],
    "timestamp":  ["timestamp", "unix_time", "unix_ts", "epoch", "posix", "ts"],
    "lat":        ["lat", "latitude"],
    "lon":        ["lon", "long", "longitude"],
    "alt":        ["alt", "altitude", "height", "elevation"],
    "time":       ["time", "datetime", "date_time", "date"],
}


def _normalise_msgs_synced_columns(df: "pd.DataFrame") -> "pd.DataFrame":
    """Rename user CSV columns to the pipeline-expected names using aliases."""
    lower = {c.lower(): c for c in df.columns}
    rename: dict[str, str] = {}
    for target, aliases in _COL_ALIASES.items():
        if target in df.columns:
            continue  # already correct
        for alias in aliases:
            if alias in lower and lower[alias] not in rename.values():
                rename[lower[alias]] = target
                break
    return df.rename(columns=rename) if rename else df


# ── Helpers ────────────────────────────────────────────────────────────────────


def _get_paths(session: Session, run_id: uuid.UUID) -> RunPaths:
    from app.models.pipeline import Pipeline, PipelineRun

    run = session.get(PipelineRun, run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline:
        raise ValueError(f"Pipeline {run.pipeline_id} not found")
    workspace = session.get(Workspace, pipeline.workspace_id)
    if not workspace:
        raise ValueError(f"Workspace {pipeline.workspace_id} not found")
    return RunPaths.from_db(session=session, run=run, workspace=workspace)


def _find_bundled_msgs_synced(
    session: Session, run_id: uuid.UUID, paths: RunPaths
) -> "Path | None":
    """
    Look up the FileUpload record for this run and return the absolute path to
    the bundled msgs_synced.csv stored in msgs_synced_path, if any.

    Falls back to scanning Raw/.../Images/**/Metadata/msgs_synced.csv so that
    existing uploads that pre-date the msgs_synced_path column still work.
    """
    from app.models.pipeline import PipelineRun
    from app.models.file_upload import FileUpload as _FU
    from sqlmodel import select as _sel
    from app.core.config import settings as _settings
    from app.crud.app_settings import get_setting as _get_setting

    run = session.get(PipelineRun, run_id)
    if run is None:
        return None

    data_root = Path(_get_setting(session=session, key="data_root") or _settings.APP_DATA_ROOT)

    # Check FileUpload record first
    fu = session.exec(
        _sel(_FU).where(
            _FU.experiment == run.experiment,
            _FU.location == run.location,
            _FU.population == run.population,
            _FU.date == run.date,
            _FU.platform == run.platform,
            _FU.sensor == run.sensor,
            _FU.msgs_synced_path.isnot(None),  # type: ignore[attr-defined]
        )
    ).first()

    if fu and fu.msgs_synced_path:
        candidate = data_root / fu.msgs_synced_path
        if candidate.exists():
            return candidate

    # Fallback: scan Raw upload dir for any Metadata/msgs_synced.csv
    for candidate in paths.raw.rglob("Metadata/msgs_synced.csv"):
        return candidate

    return None


def _find_image_dir(paths: RunPaths) -> Path:
    # Standard upload layout: Images/ subdir, then direct files in raw/
    for candidate in [paths.raw / "Images", paths.raw]:
        if candidate.is_dir() and any(
            f.suffix.lower() in _IMAGE_EXTS for f in candidate.iterdir()
        ):
            return candidate
    # Farm-ng extracted layout: nested top/ directory
    top_dirs = [d for d in paths.raw.rglob("top") if d.is_dir()]
    if top_dirs:
        return top_dirs[0]
    return paths.raw / "Images"


# ── EXIF extraction ────────────────────────────────────────────────────────────


def _extract_exif(image_path: Path, rotate: bool = True) -> dict[str, Any] | None:
    """
    Open image, extract GPS + timestamp from EXIF, auto-rotate portrait images.
    Returns a dict row for msgs_synced.csv, or None on failure.

    rotate=False disables all physical image rotation (useful for ground pipelines
    where phone images with inconsistent EXIF tags cause display issues).

    When saving rotated images, PIL's native EXIF object is used instead of piexif
    so that the GPS IFD (coordinates + GPS timestamp) is preserved intact.
    piexif.dump() can silently strip GPS rational types during re-serialization,
    which causes subsequent data-sync runs to lose GPS entirely.
    """
    _ORIENTATION_TAG = 0x0112  # EXIF tag 274

    try:
        img = Image.open(image_path)
    except Exception as exc:
        logger.warning("Cannot open %s: %s", image_path.name, exc)
        return None

    width, height = img.size
    do_rotation = height > width

    # Read EXIF via PIL's _getexif() — returns decoded Python values
    raw_exif = img._getexif() or {}  # type: ignore[attr-defined]

    latitude = longitude = altitude = None
    unix_ts: float | None = None
    time_string: str | None = None

    # Standard DateTime tags (DateTimeOriginal, DateTimeDigitized, DateTime)
    for tag_id in [36867, 36868, 306]:
        val = raw_exif.get(tag_id)
        if val:
            time_string = val if isinstance(val, str) else val.decode("ascii", errors="replace")
            break

    # GPS IFD (tag 34853)
    gps_info = raw_exif.get(34853) or {}
    if gps_info:
        try:
            lat = gps_info[2]
            latitude = float(lat[0] + lat[1] / 60 + lat[2] / 3600)
            if gps_info.get(1) == "S":
                latitude = -latitude
            lon = gps_info[4]
            longitude = float(lon[0] + lon[1] / 60 + lon[2] / 3600)
            if gps_info.get(3) == "W":
                longitude = -longitude
            _alt_raw = gps_info.get(6)
            altitude = float(_alt_raw) if _alt_raw is not None else None
        except (KeyError, IndexError, TypeError, ZeroDivisionError) as exc:
            logger.debug("GPS coordinate parse error in %s: %s", image_path.name, exc)

        # GPS UTC time (tags 29 = date, 7 = time)
        gps_date = gps_info.get(29)
        gps_time_tag = gps_info.get(7)
        if gps_date and gps_time_tag:
            try:
                h = int(gps_time_tag[0].numerator / gps_time_tag[0].denominator)
                m = int(gps_time_tag[1].numerator / gps_time_tag[1].denominator)
                s = int(gps_time_tag[2].numerator / gps_time_tag[2].denominator)
                dt = datetime.strptime(
                    f"{gps_date} {h:02d}:{m:02d}:{s:02d}", "%Y:%m:%d %H:%M:%S"
                ).replace(tzinfo=timezone.utc)
                unix_ts = dt.timestamp()
                time_string = datetime.fromtimestamp(unix_ts).strftime(
                    "%Y:%m:%d %H:%M:%S.%f %z"
                )
            except Exception as exc:
                logger.debug("GPS time parse error in %s: %s", image_path.name, exc)

    # Fallback: parse EXIF DateTime as UTC when GPS time tags are absent
    if unix_ts is None and time_string:
        for fmt in ("%Y:%m:%d %H:%M:%S", "%Y:%m:%d %H:%M:%S.%f %z"):
            try:
                dt = datetime.strptime(time_string.split("+")[0].strip(), fmt.split("%z")[0].strip())
                unix_ts = dt.replace(tzinfo=timezone.utc).timestamp()
                break
            except ValueError:
                continue

    if rotate:
        # Use PIL's native Exif object for saves — it round-trips all IFDs (including
        # GPS) without the lossy re-serialization that piexif.dump() applies.
        pil_exif = img.getexif()
        exif_orientation = pil_exif.get(_ORIENTATION_TAG, 1)

        if exif_orientation not in (None, 1):
            from PIL import ImageOps
            img = ImageOps.exif_transpose(img)   # physically correct orientation
            pil_exif[_ORIENTATION_TAG] = 1       # mark pixels as canonical
            width, height = img.size
            do_rotation = False  # dimension-based rotation no longer needed
            logger.info(
                "Corrected EXIF orientation %d → 1 for %s (now %dx%d)",
                exif_orientation, image_path.name, width, height,
            )

        needs_save = do_rotation or exif_orientation not in (None, 1)
        if needs_save:
            try:
                if do_rotation:
                    img = img.transpose(Image.ROTATE_270)
                    width, height = img.size
                    pil_exif[_ORIENTATION_TAG] = 1
                    logger.info("Rotated portrait image (no EXIF orientation tag): %s", image_path.name)
                img.save(str(image_path), exif=pil_exif.tobytes())
            except Exception as exc:
                logger.warning("Could not save updated image %s: %s", image_path.name, exc)

    return {
        "image_path": str(image_path),
        "time": time_string,
        "timestamp": unix_ts,
        "lat": latitude,
        "lon": longitude,
        "alt": altitude,
        "naturalWidth": width,
        "naturalHeight": height,
    }


def _build_msgs_synced(image_dir: Path, out_path: Path, emit: Callable[[dict], None], rotate: bool = True) -> pd.DataFrame:
    """
    Scan image_dir for drone images, extract EXIF, write msgs_synced.csv.
    Returns the resulting DataFrame.
    """
    files = sorted(
        f for f in image_dir.iterdir() if f.suffix.lower() in _IMAGE_EXTS and "mask" not in f.name
    )
    total = len(files)
    emit({"event": "progress", "message": f"Found {total} images — extracting EXIF…", "progress": 5})

    # Load existing to avoid reprocessing
    existing_paths: set[str] = set()
    existing_rows: list[dict] = []
    if out_path.exists():
        existing_df = pd.read_csv(out_path)
        existing_paths = set(existing_df.get("image_path", pd.Series(dtype=str)).tolist())
        existing_rows = existing_df.to_dict("records")

    new_rows: list[dict] = []
    for i, f in enumerate(files):
        if str(f) in existing_paths:
            continue
        row = _extract_exif(f, rotate=rotate)
        if row:
            new_rows.append(row)
        if (i + 1) % max(total // 10, 1) == 0:
            pct = 5 + int(40 * (i + 1) / total)
            emit({"event": "progress", "message": f"EXIF {i+1}/{total}", "progress": pct})

    all_rows = existing_rows + new_rows
    df = pd.DataFrame(all_rows)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False)
    emit({"event": "progress", "message": f"msgs_synced.csv written ({len(df)} images)", "progress": 45})
    return df


# ── MAVLink parsing ────────────────────────────────────────────────────────────


def _parse_mavlink_log(log_path: Path) -> pd.DataFrame:
    """
    Parse an ArduPilot .bin/.log/.tlog file.
    Returns a DataFrame with columns:
      timestamp, lat, lon, alt, gps_alt, rangefinder_distance,
      alt_source, roll, pitch, yaw
    """
    from pymavlink import mavutil  # lazy import — optional dependency

    mlog = mavutil.mavlink_connection(str(log_path))

    gps_rows: list[dict] = []
    rf_rows: list[dict] = []
    att_rows: list[dict] = []

    mlog.rewind()
    while True:
        msg = mlog.recv_match(blocking=False)
        if msg is None:
            break
        t = msg.get_type()
        if t == "GPS":
            lat = getattr(msg, "Lat", None)
            lon = getattr(msg, "Lng", None)
            if lat and lon:
                gps_rows.append({
                    "timestamp": msg._timestamp,
                    "lat": lat,
                    "lon": lon,
                    "alt": getattr(msg, "Alt", None),
                })
        elif t == "RFND":
            rf_rows.append({"timestamp": msg._timestamp, "distance": getattr(msg, "Dist", None)})
        elif t == "ATT":
            att_rows.append({
                "timestamp": msg._timestamp,
                "roll": getattr(msg, "Roll", None),
                "pitch": getattr(msg, "Pitch", None),
                "yaw": getattr(msg, "Yaw", None),
            })

    if not gps_rows:
        return pd.DataFrame()

    df_gps = pd.DataFrame(gps_rows)
    df_rf = pd.DataFrame(rf_rows) if rf_rows else pd.DataFrame(columns=["timestamp", "distance"])
    df_att = pd.DataFrame(att_rows) if att_rows else pd.DataFrame(columns=["timestamp", "roll", "pitch", "yaw"])

    # Build KD-trees for fast nearest-neighbour lookup
    rf_tree = att_tree = None
    if not df_rf.empty:
        rf_tree = KDTree(df_rf["timestamp"].values.reshape(-1, 1))
    if not df_att.empty:
        att_tree = KDTree(df_att["timestamp"].values.reshape(-1, 1))

    out_rows: list[dict] = []
    for _, row in df_gps.iterrows():
        ts = round(float(row["timestamp"]), 6)

        # Nearest rangefinder
        rf_dist = None
        if rf_tree is not None:
            dists, idxs = rf_tree.query([[ts]], k=1)
            d = float(dists[0][0]) if hasattr(dists[0], "__len__") else float(dists[0])
            if d <= 1.0:
                idx = int(idxs[0][0]) if hasattr(idxs[0], "__len__") else int(idxs[0])
                rf_dist = df_rf.iloc[idx]["distance"]

        # Nearest attitude
        roll = pitch = yaw = None
        if att_tree is not None:
            dists, idxs = att_tree.query([[ts]], k=1)
            d = float(dists[0][0]) if hasattr(dists[0], "__len__") else float(dists[0])
            if d <= 1.0:
                idx = int(idxs[0][0]) if hasattr(idxs[0], "__len__") else int(idxs[0])
                att = df_att.iloc[idx]
                roll, pitch, yaw = att["roll"], att["pitch"], att["yaw"]

        gps_alt = float(row["alt"]) if row["alt"] is not None else None
        if rf_dist is not None and float(rf_dist) > 0:
            alt = round(float(rf_dist), 2)
            alt_source = "rangefinder"
        elif gps_alt is not None:
            alt = round(gps_alt, 2)
            alt_source = "gps"
        else:
            alt = None
            alt_source = None

        out_rows.append({
            "timestamp": ts,
            "lat": round(float(row["lat"]), 8),
            "lon": round(float(row["lon"]), 8),
            "alt": alt,
            "gps_alt": gps_alt,
            "rangefinder_distance": round(float(rf_dist), 2) if rf_dist is not None else None,
            "alt_source": alt_source,
            "roll": round(float(roll), 2) if roll is not None else None,
            "pitch": round(float(pitch), 2) if pitch is not None else None,
            "yaw": round(float(yaw), 2) if yaw is not None else None,
        })

    return pd.DataFrame(out_rows)


def _build_drone_msgs(metadata_dir: Path, out_path: Path, emit: Callable[[dict], None]) -> pd.DataFrame | None:
    """
    Find platform log files in metadata_dir, parse them, write drone_msgs.csv.
    Returns the DataFrame or None if no logs found.
    """
    log_files = [f for f in metadata_dir.iterdir() if f.suffix.lower() in _LOG_EXTS] if metadata_dir.is_dir() else []
    if not log_files:
        emit({"event": "progress", "message": "No platform logs found — skipping MAVLink sync", "progress": 50})
        return None

    emit({"event": "progress", "message": f"Parsing {len(log_files)} platform log(s)…", "progress": 50})

    existing_ts: set[float] = set()
    existing_rows: list[dict] = []
    if out_path.exists():
        existing_df = pd.read_csv(out_path)
        existing_ts = set(round(float(t), 6) for t in existing_df["timestamp"].dropna())
        existing_rows = existing_df.to_dict("records")

    new_rows: list[dict] = []
    for i, log_path in enumerate(log_files):
        emit({"event": "progress", "message": f"Parsing {log_path.name}…", "progress": 50 + i * 5})
        try:
            df = _parse_mavlink_log(log_path)
            for _, row in df.iterrows():
                ts = round(float(row["timestamp"]), 6)
                if ts not in existing_ts:
                    new_rows.append(row.to_dict())
                    existing_ts.add(ts)
        except Exception as exc:
            logger.warning("Failed to parse %s: %s", log_path.name, exc)

    if not new_rows and not existing_rows:
        return None

    all_rows = existing_rows + new_rows
    df_out = pd.DataFrame(all_rows)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df_out.to_csv(out_path, index=False)
    emit({"event": "progress", "message": f"drone_msgs.csv written ({len(df_out)} records)", "progress": 65})
    return df_out


# ── Merge drone GPS into image EXIF GPS ───────────────────────────────────────


def _merge_drone_gps(df_msgs: pd.DataFrame, df_drone: pd.DataFrame, max_diff: float = 5.0) -> pd.DataFrame:
    """
    For each image row in df_msgs that has a valid timestamp, find the nearest
    drone log row (by timestamp) within max_diff seconds and overwrite lat/lon/alt.
    """
    valid_msgs = df_msgs[df_msgs["timestamp"].notna()].copy()
    valid_drone = df_drone[df_drone["timestamp"].notna()].copy()

    if valid_msgs.empty or valid_drone.empty:
        return df_msgs

    drone_ts = valid_drone["timestamp"].values.reshape(-1, 1)
    msgs_ts = valid_msgs["timestamp"].values.reshape(-1, 1)

    tree = KDTree(drone_ts)
    dists, idxs = tree.query(msgs_ts, k=1)

    updates = 0
    for i, (dist, idx) in enumerate(zip(dists.flatten(), idxs.flatten())):
        if float(dist) > max_diff:
            continue
        msgs_row_idx = valid_msgs.index[i]
        drone_row = valid_drone.iloc[int(idx)]
        if pd.notna(drone_row.get("lat")):
            df_msgs.at[msgs_row_idx, "lat"] = drone_row["lat"]
        if pd.notna(drone_row.get("lon")):
            df_msgs.at[msgs_row_idx, "lon"] = drone_row["lon"]
        if pd.notna(drone_row.get("alt")):
            df_msgs.at[msgs_row_idx, "alt"] = drone_row["alt"]
        updates += 1

    logger.info("Merged drone GPS into %d/%d image records", updates, len(valid_msgs))
    return df_msgs


# ── geo.txt writer ─────────────────────────────────────────────────────────────


def _write_geo_txt(df: pd.DataFrame, geo_path: Path) -> int:
    """Write geo.txt for ODM. Returns number of lines written."""
    written = 0
    with open(geo_path, "w") as f:
        f.write("EPSG:4326\n")
        for _, row in df.iterrows():
            if pd.notna(row.get("lat")) and pd.notna(row.get("lon")):
                name = Path(str(row.get("image_path", ""))).name
                lat = row["lat"]
                lon = row["lon"]
                alt = row["alt"] if pd.notna(row.get("alt")) else 0
                f.write(f"{name} {lon} {lat} {alt} 0 0 0 0 0\n")
                written += 1
    return written


# ── Main step entry point ──────────────────────────────────────────────────────


def run_data_sync(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
) -> dict[str, Any]:
    """
    Data Sync step for the aerial pipeline.

    Outputs written:
      - Intermediate/.../msgs_synced.csv
      - Intermediate/.../drone_msgs.csv  (if platform log found)
      - Intermediate/.../geo.txt

    Priority for msgs_synced.csv:
      If Raw/.../Metadata/msgs_synced.csv exists (user-uploaded), it is used
      directly and EXIF extraction + platform log parsing are skipped entirely.
      To fall back to auto-generation, delete the file from Metadata/.
    """
    from app.models.pipeline import Pipeline, PipelineRun

    _run = session.get(PipelineRun, run_id)
    _pipeline = session.get(Pipeline, _run.pipeline_id) if _run else None
    _pipeline_type = (_pipeline.type if _pipeline else None) or ""
    rotate_images = _pipeline_type != "ground"

    paths = _get_paths(session, run_id)
    paths.intermediate_run.mkdir(parents=True, exist_ok=True)

    emit({"event": "progress", "message": "Starting data sync…", "progress": 0})
    logger.info("Data sync — pipeline type: %s, rotate_images: %s", _pipeline_type, rotate_images)

    # ── Step 1: Determine base msgs_synced.csv (priority order) ──────────────
    #
    #  1. FileUpload.msgs_synced_path       — bundled GPS file (Farm-ng binary)
    #  2. Raw/.../Metadata/msgs_synced.csv  — user-uploaded pre-synced file
    #  3. Auto-generate from drone image EXIF
    #
    # Always regenerate from source — never reuse a stale Intermediate file.
    # Reusing the cached Intermediate file caused re-runs to skip EXIF extraction
    # and carry forward any incorrect or outdated GPS data.

    if paths.msgs_synced.exists():
        paths.msgs_synced.unlink()
        logger.info("Removed stale msgs_synced.csv from Intermediate/ — will regenerate.")

    user_msgs_synced = paths.raw_metadata / "msgs_synced.csv"
    msgs_synced_source: str
    df_msgs = None
    msgs_synced_source = ""

    # Farm-ng bundled GPS file via FileUpload record
    if df_msgs is None:
        bundled_gps_path = _find_bundled_msgs_synced(session, run_id, paths)
        if bundled_gps_path is not None and bundled_gps_path.exists():
            emit({"event": "progress",
                  "message": f"Using bundled GPS file from upload: {bundled_gps_path.name}", "progress": 40})
            df_bundled = _normalise_msgs_synced_columns(pd.read_csv(bundled_gps_path))
            # Normalize image_path values to just filename (Farm-ng paths are like /top/rgb-TIMESTAMP.jpg)
            if "image_path" in df_bundled.columns:
                df_bundled["image_path"] = df_bundled["image_path"].apply(
                    lambda v: Path(str(v)).name if pd.notna(v) else v
                )
            df_bundled.to_csv(paths.msgs_synced, index=False)
            df_msgs = df_bundled
            msgs_synced_source = "bundled"
            logger.info("Loaded bundled GPS from %s (%d rows)", bundled_gps_path.name, len(df_msgs))

    # User-provided file in Raw Metadata
    if df_msgs is None and user_msgs_synced.exists():
        emit({"event": "progress",
              "message": "Found user-provided msgs_synced.csv in Metadata/ — skipping EXIF extraction.", "progress": 45})
        df_msgs = _normalise_msgs_synced_columns(pd.read_csv(user_msgs_synced))
        df_msgs.to_csv(paths.msgs_synced, index=False)
        msgs_synced_source = "user-provided"
        logger.info("Loaded user-provided msgs_synced.csv from Metadata/ (%d rows)", len(df_msgs))

    # Fall back to EXIF extraction
    if df_msgs is None:
        image_dir = _find_image_dir(paths)
        if not image_dir.exists():
            raise FileNotFoundError(
                f"No image directory found at {image_dir}. "
                "Upload drone images before running Data Sync."
            )
        df_msgs = _build_msgs_synced(image_dir, paths.msgs_synced, emit, rotate=rotate_images)
        msgs_synced_source = "exif"

    if stop_event.is_set():
        raise RuntimeError("Stopped by user")

    # ── Step 2: MAVLink platform log parsing (always attempted) ──────────────
    df_drone = _build_drone_msgs(paths.raw_metadata, paths.drone_msgs, emit)

    if stop_event.is_set():
        raise RuntimeError("Stopped by user")

    # ── Step 3: Merge drone GPS into msgs_synced ──────────────────────────────
    if df_drone is not None and not df_drone.empty:
        emit({"event": "progress",
              "message": "Merging platform log GPS into image manifest…", "progress": 70})
        df_msgs = _merge_drone_gps(df_msgs, df_drone)
        df_msgs.to_csv(paths.msgs_synced, index=False)

    # ── GPS availability check ────────────────────────────────────────────────
    has_gps = (
        "lat" in df_msgs.columns
        and "lon" in df_msgs.columns
        and df_msgs["lat"].notna().any()
        and df_msgs["lon"].notna().any()
    )
    if not has_gps:
        emit({
            "type": "warning",
            "step": "data_sync",
            "message": (
                "⚠ No GPS data found — images have no EXIF coordinates and no "
                "msgs_synced.csv was uploaded. Stitching and georeferencing will "
                "not have position data."
            ),
        })
        logger.warning("Data sync for run %s: no GPS data available", run_id)

    # ── Step 4: Write geo.txt ─────────────────────────────────────────────────
    emit({"event": "progress", "message": "Writing geo.txt for ODM…", "progress": 90})
    n_written = _write_geo_txt(df_msgs, paths.geo_txt)
    emit({"event": "progress",
          "message": f"geo.txt written ({n_written} images with GPS)", "progress": 95})

    logger.info(
        "Data sync complete for run %s (source=%s): %d images, %d drone log records, %d geo entries",
        run_id, msgs_synced_source, len(df_msgs),
        len(df_drone) if df_drone is not None else 0, n_written,
    )

    outputs: dict[str, Any] = {
        "msgs_synced": paths.rel(paths.msgs_synced),
        "msgs_synced_source": msgs_synced_source,
        "geo_txt": paths.rel(paths.geo_txt),
    }
    if df_drone is not None:
        outputs["drone_msgs"] = paths.rel(paths.drone_msgs)

    return outputs


# ── Lightweight EXIF timestamp extractor (for cross-sensor sync) ───────────────


def _extract_exif_timestamp_only(image_path: Path) -> dict[str, Any]:
    """
    Extract image path + timestamp only from EXIF. No GPS, no rotation, no write.

    Priority:
      1. GPS IFD UTC time (tags 29 = date, 7 = time) — most accurate
      2. EXIF DateTime / DateTimeOriginal / DateTimeDigitized — fallback
    """
    unix_ts: float | None = None
    width = height = None

    try:
        img = Image.open(image_path)
        width, height = img.size
        raw_exif = img._getexif() or {}  # type: ignore[attr-defined]
    except Exception as exc:
        logger.warning("Cannot open %s for timestamp extraction: %s", image_path.name, exc)
        return {"image_path": str(image_path), "timestamp": None, "naturalWidth": None, "naturalHeight": None}

    # Priority 1: GPS IFD UTC time
    gps_info = raw_exif.get(34853) or {}
    gps_date = gps_info.get(29)
    gps_time_tag = gps_info.get(7)
    if gps_date and gps_time_tag:
        try:
            h = int(gps_time_tag[0].numerator / gps_time_tag[0].denominator)
            m = int(gps_time_tag[1].numerator / gps_time_tag[1].denominator)
            s = int(gps_time_tag[2].numerator / gps_time_tag[2].denominator)
            dt = datetime.strptime(
                f"{gps_date} {h:02d}:{m:02d}:{s:02d}", "%Y:%m:%d %H:%M:%S"
            ).replace(tzinfo=timezone.utc)
            unix_ts = dt.timestamp()
        except Exception as exc:
            logger.debug("GPS time parse error in %s: %s", image_path.name, exc)

    # Priority 2: EXIF DateTime tags
    if unix_ts is None:
        time_string: str | None = None
        for tag_id in [36867, 36868, 306]:
            if raw_exif.get(tag_id):
                time_string = raw_exif[tag_id]
                break
        if time_string:
            for fmt in ("%Y:%m:%d %H:%M:%S", "%Y:%m:%d %H:%M:%S.%f"):
                try:
                    dt = datetime.strptime(time_string[:19], fmt[:19]).replace(tzinfo=timezone.utc)
                    unix_ts = dt.timestamp()
                    break
                except ValueError:
                    continue

    return {
        "image_path": str(image_path),
        "timestamp": unix_ts,
        "naturalWidth": width,
        "naturalHeight": height,
    }


# ── Cross-sensor sync step ─────────────────────────────────────────────────────


def run_cross_sensor_sync(
    *,
    session: Session,
    run_id: uuid.UUID,
    source_run_id: str,
    max_extrapolation_sec: float = 30.0,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
) -> dict[str, Any]:
    """
    Sync this run's images to GPS coordinates from a different run's msgs_synced.csv.

    GPS is assigned per image by linearly interpolating the reference sensor's GPS
    track at each target image's capture timestamp.  Images whose timestamps fall
    outside the reference coverage window are handled in three tiers:

      1. Within max_extrapolation_sec of the reference boundary
         → clamp to the nearest endpoint GPS (platform hasn't moved far).
      2. Beyond max_extrapolation_sec but image has its own EXIF GPS
         → fall back to the image's own GPS coordinates.
      3. Beyond max_extrapolation_sec and no EXIF GPS
         → GPS left as NaN (image still kept, just has no position).

    Images with no parseable timestamp always fall through to tier 2/3.
    """
    from scipy.interpolate import interp1d as _interp1d
    from app.models.pipeline import Pipeline, PipelineRun as _PR

    _run = session.get(_PR, run_id)
    _pipeline = session.get(Pipeline, _run.pipeline_id) if _run else None
    _pipeline_type = (_pipeline.type if _pipeline else None) or ""
    rotate_images = _pipeline_type != "ground"
    logger.info("Cross-sensor sync — pipeline type: %s, rotate_images: %s", _pipeline_type, rotate_images)

    paths = _get_paths(session, run_id)
    paths.intermediate_run.mkdir(parents=True, exist_ok=True)

    emit({"event": "progress", "message": "Loading reference GPS data…", "progress": 5})

    # ── Load reference msgs_synced ────────────────────────────────────────────
    source_run_uuid = uuid.UUID(source_run_id)
    source_paths = _get_paths(session, source_run_uuid)

    # Prefer Intermediate (already-synced); fall back to bundled GPS from FileUpload
    ref_gps_file = source_paths.msgs_synced if source_paths.msgs_synced.exists() else None
    if ref_gps_file is None:
        ref_gps_file = _find_bundled_msgs_synced(session, source_run_uuid, source_paths)
    if ref_gps_file is None:
        raise FileNotFoundError(
            f"No msgs_synced.csv found for source run {source_run_id}. "
            "Run Data Sync on the source sensor first, or ensure it has a bundled GPS file."
        )

    df_ref = _normalise_msgs_synced_columns(pd.read_csv(ref_gps_file))
    # Normalize image paths to filenames (Farm-ng bundled files use /top/rgb-... paths)
    if "image_path" in df_ref.columns:
        df_ref["image_path"] = df_ref["image_path"].apply(
            lambda v: Path(str(v)).name if pd.notna(v) else v
        )
    valid_ref = df_ref[
        df_ref.get("timestamp", pd.Series(dtype=float)).notna()
        & df_ref.get("lat", pd.Series(dtype=float)).notna()
        & df_ref.get("lon", pd.Series(dtype=float)).notna()
    ].copy()

    if valid_ref.empty:
        raise ValueError(
            "Reference msgs_synced.csv has no rows with both a valid timestamp and GPS coordinates. "
            "Check that the source run completed Data Sync and has GPS data."
        )

    valid_ref = valid_ref.sort_values("timestamp")
    ref_ts = valid_ref["timestamp"].values.astype(float)
    ref_lat = valid_ref["lat"].values.astype(float)
    ref_lon = valid_ref["lon"].values.astype(float)
    ref_alt = valid_ref["alt"].fillna(0).values.astype(float) if "alt" in valid_ref.columns else np.zeros(len(valid_ref))
    ref_ts_min = float(ref_ts[0])
    ref_ts_max = float(ref_ts[-1])
    ref_span = ref_ts_max - ref_ts_min

    # Interpolators with NaN for out-of-range (no extrapolation — handled below)
    interp_lat = _interp1d(ref_ts, ref_lat, kind="linear", bounds_error=False, fill_value=np.nan)
    interp_lon = _interp1d(ref_ts, ref_lon, kind="linear", bounds_error=False, fill_value=np.nan)
    interp_alt = _interp1d(ref_ts, ref_alt, kind="linear", bounds_error=False, fill_value=np.nan)

    # Endpoint-clamp interpolators used for the threshold buffer zone
    interp_lat_clamp = _interp1d(ref_ts, ref_lat, kind="linear", bounds_error=False,
                                  fill_value=(ref_lat[0], ref_lat[-1]))
    interp_lon_clamp = _interp1d(ref_ts, ref_lon, kind="linear", bounds_error=False,
                                  fill_value=(ref_lon[0], ref_lon[-1]))
    interp_alt_clamp = _interp1d(ref_ts, ref_alt, kind="linear", bounds_error=False,
                                  fill_value=(ref_alt[0], ref_alt[-1]))

    emit({
        "event": "progress",
        "message": (
            f"Reference GPS loaded ({len(valid_ref)} records, span {ref_span:.1f}s, "
            f"threshold ±{max_extrapolation_sec}s). Extracting image timestamps…"
        ),
        "progress": 20,
    })

    if stop_event.is_set():
        raise RuntimeError("Stopped by user")

    # ── Extract timestamps from target images ────────────────────────────────
    # Always scan fresh from EXIF — reusing an existing msgs_synced.csv is unsafe
    # because a previous bad run may have written corrupted/missing timestamps.
    image_dir = _find_image_dir(paths)
    if not image_dir.exists():
        raise FileNotFoundError(
            f"No image directory found at {image_dir}. "
            "Upload images before running Data Sync."
        )

    files = sorted(
        f for f in image_dir.iterdir()
        if f.suffix.lower() in _IMAGE_EXTS and "mask" not in f.name
    )
    total = len(files)
    emit({"event": "progress",
          "message": f"Found {total} images — reading timestamps…", "progress": 25})

    rows: list[dict[str, Any]] = []
    for i, f in enumerate(files):
        rows.append(_extract_exif_timestamp_only(f))
        if (i + 1) % max(total // 10, 1) == 0:
            pct = 25 + int(40 * (i + 1) / total)
            emit({"event": "progress",
                  "message": f"Timestamps {i+1}/{total}", "progress": pct})
        if stop_event.is_set():
            raise RuntimeError("Stopped by user")

    df_target = pd.DataFrame(rows)

    # ── Classify each image and assign GPS ───────────────────────────────────
    emit({"event": "progress",
          "message": "Interpolating GPS positions…", "progress": 70})

    has_ts = df_target["timestamp"].notna()
    n_with_ts = int(has_ts.sum())

    n_interpolated = n_clamped = n_exif_fallback = n_no_gps = 0

    if n_with_ts == 0:
        emit({
            "type": "warning", "step": "data_sync",
            "message": (
                "⚠ None of the target images have a parseable timestamp — "
                "GPS interpolation cannot proceed. Check image EXIF data."
            ),
        })
    else:
        target_ts = df_target.loc[has_ts, "timestamp"].values.astype(float)

        # Distance outside reference window (0 when inside, positive when outside)
        gap = np.maximum(0.0, np.maximum(ref_ts_min - target_ts, target_ts - ref_ts_max))

        in_range   = gap == 0.0
        in_buffer  = (~in_range) & (gap <= max_extrapolation_sec)
        out_of_range = gap > max_extrapolation_sec

        ts_idx = df_target.index[has_ts]

        # Tier 1: in-range → standard interpolation
        if in_range.any():
            ts_in = target_ts[in_range]
            idx_in = ts_idx[in_range]
            df_target.loc[idx_in, "lat"] = interp_lat(ts_in)
            df_target.loc[idx_in, "lon"] = interp_lon(ts_in)
            df_target.loc[idx_in, "alt"] = interp_alt(ts_in)
            n_interpolated = int(in_range.sum())

        # Tier 2: within threshold buffer → clamp to nearest endpoint GPS
        if in_buffer.any():
            ts_buf = target_ts[in_buffer]
            idx_buf = ts_idx[in_buffer]
            df_target.loc[idx_buf, "lat"] = interp_lat_clamp(ts_buf)
            df_target.loc[idx_buf, "lon"] = interp_lon_clamp(ts_buf)
            df_target.loc[idx_buf, "alt"] = interp_alt_clamp(ts_buf)
            n_clamped = int(in_buffer.sum())

        # Tier 3: beyond threshold → EXIF GPS fallback
        if out_of_range.any():
            idx_oor = ts_idx[out_of_range]
            for row_idx in idx_oor:
                img_path = Path(str(df_target.at[row_idx, "image_path"]))
                exif_row = _extract_exif(img_path, rotate=rotate_images)
                if exif_row and pd.notna(exif_row.get("lat")) and pd.notna(exif_row.get("lon")):
                    df_target.at[row_idx, "lat"] = exif_row["lat"]
                    df_target.at[row_idx, "lon"] = exif_row["lon"]
                    if pd.notna(exif_row.get("alt")):
                        df_target.at[row_idx, "alt"] = exif_row["alt"]
                    n_exif_fallback += 1
                else:
                    n_no_gps += 1

    # Images with no timestamp at all → EXIF GPS fallback
    no_ts_idx = df_target.index[~has_ts]
    for row_idx in no_ts_idx:
        img_path = Path(str(df_target.at[row_idx, "image_path"]))
        exif_row = _extract_exif(img_path, rotate=rotate_images)
        if exif_row and pd.notna(exif_row.get("lat")) and pd.notna(exif_row.get("lon")):
            df_target.at[row_idx, "lat"] = exif_row["lat"]
            df_target.at[row_idx, "lon"] = exif_row["lon"]
            if pd.notna(exif_row.get("alt")):
                df_target.at[row_idx, "alt"] = exif_row["alt"]

    # Progress summary
    parts = [f"Interpolated: {n_interpolated}"]
    if n_clamped:
        parts.append(f"clamped (≤{max_extrapolation_sec}s out-of-range): {n_clamped}")
    if n_exif_fallback:
        parts.append(f"EXIF fallback (>{max_extrapolation_sec}s out-of-range): {n_exif_fallback}")
    if n_no_gps:
        parts.append(f"no GPS: {n_no_gps}")
    emit({"event": "progress",
          "message": " · ".join(parts), "progress": 85})

    if n_no_gps:
        emit({
            "type": "warning", "step": "data_sync",
            "message": (
                f"⚠ {n_no_gps} image(s) fell more than {max_extrapolation_sec}s outside the "
                "reference GPS coverage and had no EXIF GPS — they will have no position data. "
                "Consider increasing the threshold or using 'Use own metadata' for this sensor."
            ),
        })

    # ── Write outputs ────────────────────────────────────────────────────────
    df_target.to_csv(paths.msgs_synced, index=False)
    emit({"event": "progress",
          "message": f"msgs_synced.csv written ({len(df_target)} images)", "progress": 90})

    n_written = _write_geo_txt(df_target, paths.geo_txt)
    emit({"event": "progress",
          "message": f"geo.txt written ({n_written} images with GPS)", "progress": 95})

    logger.info(
        "Cross-sensor sync complete for run %s (source=%s): %d images, "
        "%d interpolated, %d clamped, %d exif-fallback, %d no-gps, %d geo entries",
        run_id, source_run_id, len(df_target),
        n_interpolated, n_clamped, n_exif_fallback, n_no_gps, n_written,
    )

    return {
        "msgs_synced": paths.rel(paths.msgs_synced),
        "msgs_synced_source": f"cross_sensor:{source_run_id}",
        "geo_txt": paths.rel(paths.geo_txt),
        "cross_sensor_stats": {
            "interpolated": n_interpolated,
            "clamped": n_clamped,
            "exif_fallback": n_exif_fallback,
            "no_gps": n_no_gps,
            "max_extrapolation_sec": max_extrapolation_sec,
        },
    }
