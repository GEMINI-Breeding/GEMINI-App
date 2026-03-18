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
import piexif
from PIL import Image
from scipy.spatial import KDTree
from sqlmodel import Session

from app.core.paths import RunPaths
from app.models.workspace import Workspace

logger = logging.getLogger(__name__)

_IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
_LOG_EXTS = {".bin", ".log", ".tlog"}


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


def _find_image_dir(paths: RunPaths) -> Path:
    for candidate in [paths.raw / "Images", paths.raw]:
        if candidate.is_dir() and any(
            f.suffix.lower() in _IMAGE_EXTS for f in candidate.iterdir()
        ):
            return candidate
    return paths.raw / "Images"


# ── EXIF extraction ────────────────────────────────────────────────────────────


def _extract_exif(image_path: Path) -> dict[str, Any] | None:
    """
    Open image, extract GPS + timestamp from EXIF, auto-rotate portrait images.
    Returns a dict row for msgs_synced.csv, or None on failure.
    """
    try:
        img = Image.open(image_path)
    except Exception as exc:
        logger.warning("Cannot open %s: %s", image_path.name, exc)
        return None

    width, height = img.size
    do_rotation = height > width

    raw_exif = img._getexif() or {}  # type: ignore[attr-defined]
    try:
        exif_dict = piexif.load(str(image_path))
    except Exception:
        exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": None}

    latitude = longitude = altitude = None
    unix_ts: float | None = None
    time_string: str | None = None
    exif_update = False

    # Standard DateTime tags
    for tag_id in [36867, 36868, 306]:
        if raw_exif.get(tag_id):
            time_string = raw_exif[tag_id]
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
            altitude = float(gps_info.get(6, 0))
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
                # Update EXIF DateTime tags
                exif_dict["0th"][piexif.ImageIFD.DateTime] = time_string
                exif_dict["Exif"][piexif.ExifIFD.DateTimeOriginal] = time_string
                exif_dict["Exif"][piexif.ExifIFD.DateTimeDigitized] = time_string
                exif_update = True
            except Exception as exc:
                logger.debug("GPS time parse error in %s: %s", image_path.name, exc)

    # Save if we need to rotate or update EXIF
    if do_rotation or exif_update:
        try:
            if do_rotation:
                img = img.transpose(Image.ROTATE_270)
                width, height = img.size
                logger.info("Rotated portrait image: %s", image_path.name)
            exif_bytes = piexif.dump(exif_dict)
            img.save(str(image_path), exif=exif_bytes)
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


def _build_msgs_synced(image_dir: Path, out_path: Path, emit: Callable[[dict], None]) -> pd.DataFrame:
    """
    Scan image_dir for drone images, extract EXIF, write msgs_synced.csv.
    Returns the resulting DataFrame.
    """
    files = sorted(
        f for f in image_dir.iterdir() if f.suffix.lower() in _IMAGE_EXTS and "mask" not in f.name
    )
    total = len(files)
    emit({"type": "progress", "step": "data_sync", "message": f"Found {total} images — extracting EXIF…", "pct": 5})

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
        row = _extract_exif(f)
        if row:
            new_rows.append(row)
        if (i + 1) % max(total // 10, 1) == 0:
            pct = 5 + int(40 * (i + 1) / total)
            emit({"type": "progress", "step": "data_sync", "message": f"EXIF {i+1}/{total}", "pct": pct})

    all_rows = existing_rows + new_rows
    df = pd.DataFrame(all_rows)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False)
    emit({"type": "progress", "step": "data_sync", "message": f"msgs_synced.csv written ({len(df)} images)", "pct": 45})
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
        emit({"type": "progress", "step": "data_sync", "message": "No platform logs found — skipping MAVLink sync", "pct": 50})
        return None

    emit({"type": "progress", "step": "data_sync", "message": f"Parsing {len(log_files)} platform log(s)…", "pct": 50})

    existing_ts: set[float] = set()
    existing_rows: list[dict] = []
    if out_path.exists():
        existing_df = pd.read_csv(out_path)
        existing_ts = set(round(float(t), 6) for t in existing_df["timestamp"].dropna())
        existing_rows = existing_df.to_dict("records")

    new_rows: list[dict] = []
    for i, log_path in enumerate(log_files):
        emit({"type": "progress", "step": "data_sync", "message": f"Parsing {log_path.name}…", "pct": 50 + i * 5})
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
    emit({"type": "progress", "step": "data_sync", "message": f"drone_msgs.csv written ({len(df_out)} records)", "pct": 65})
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
    paths = _get_paths(session, run_id)
    paths.intermediate_run.mkdir(parents=True, exist_ok=True)

    emit({"type": "progress", "step": "data_sync", "message": "Starting data sync…", "pct": 0})

    # ── Step 1: Determine base msgs_synced.csv (priority order) ──────────────
    #
    #  1. Intermediate/.../msgs_synced.csv  — already generated (previous run)
    #  2. Raw/.../Metadata/msgs_synced.csv  — user-uploaded pre-synced file
    #  3. Auto-generate from drone image EXIF
    #
    # Regardless of source, platform logs are still parsed and merged if present.

    user_msgs_synced = paths.raw_metadata / "msgs_synced.csv"
    msgs_synced_source: str

    if paths.msgs_synced.exists():
        emit({"type": "progress", "step": "data_sync",
              "message": "Found existing msgs_synced.csv in Intermediate — skipping EXIF extraction.", "pct": 45})
        df_msgs = pd.read_csv(paths.msgs_synced)
        msgs_synced_source = "intermediate"
        logger.info("Loaded existing msgs_synced.csv from Intermediate (%d rows)", len(df_msgs))

    elif user_msgs_synced.exists():
        emit({"type": "progress", "step": "data_sync",
              "message": "Found user-provided msgs_synced.csv in Metadata/ — skipping EXIF extraction.", "pct": 45})
        df_msgs = pd.read_csv(user_msgs_synced)
        df_msgs.to_csv(paths.msgs_synced, index=False)
        msgs_synced_source = "user-provided"
        logger.info("Loaded user-provided msgs_synced.csv from Metadata/ (%d rows)", len(df_msgs))

    else:
        image_dir = _find_image_dir(paths)
        if not image_dir.exists():
            raise FileNotFoundError(
                f"No image directory found at {image_dir}. "
                "Upload drone images before running Data Sync."
            )
        df_msgs = _build_msgs_synced(image_dir, paths.msgs_synced, emit)
        msgs_synced_source = "exif"

    if stop_event.is_set():
        raise RuntimeError("Stopped by user")

    # ── Step 2: MAVLink platform log parsing (always attempted) ──────────────
    df_drone = _build_drone_msgs(paths.raw_metadata, paths.drone_msgs, emit)

    if stop_event.is_set():
        raise RuntimeError("Stopped by user")

    # ── Step 3: Merge drone GPS into msgs_synced ──────────────────────────────
    if df_drone is not None and not df_drone.empty:
        emit({"type": "progress", "step": "data_sync",
              "message": "Merging platform log GPS into image manifest…", "pct": 70})
        df_msgs = _merge_drone_gps(df_msgs, df_drone)
        df_msgs.to_csv(paths.msgs_synced, index=False)

    # ── Step 4: Write geo.txt ─────────────────────────────────────────────────
    emit({"type": "progress", "step": "data_sync", "message": "Writing geo.txt for ODM…", "pct": 90})
    n_written = _write_geo_txt(df_msgs, paths.geo_txt)
    emit({"type": "progress", "step": "data_sync",
          "message": f"geo.txt written ({n_written} images with GPS)", "pct": 95})

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
