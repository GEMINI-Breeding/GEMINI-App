import argparse
import cv2
import os
import json
import torch
import kornia as K
import numpy as np
import pandas as pd
import torch.nn.functional as F
import multiprocessing as mp
from multiprocessing import Pool, Manager
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

from tqdm import tqdm
from pathlib import Path
from datetime import datetime, timezone
from scipy.spatial import KDTree
from scipy.interpolate import interp1d
from google.protobuf import json_format
from kornia_rs import ImageDecoder
from kornia.core import tensor
from typing import List, Dict, Optional

from farm_ng.oak import oak_pb2
from farm_ng.gps import gps_pb2
from farm_ng.core.events_file_reader import build_events_dict
from farm_ng.core.events_file_reader import EventsFileReader
from farm_ng.core.events_file_reader import EventLogPosition

import warnings
warnings.filterwarnings("ignore")
import traceback

# camera positions
CAMERA_POSITIONS = {'oak0': 'top', 'oak1': 'left', 'oak2': 'right'}

# image and gps topics
IMAGE_TYPES = ['rgb']
GPS_TYPES = ['pvt','relposned']
CALIBRATION = ['calibration']
TYPES = IMAGE_TYPES + GPS_TYPES + CALIBRATION

GPS_SCHEMAS = {
    "pvt":  ['stamp','gps_time','longitude','latitude','altitude','heading_motion',
             'heading_accuracy','speed_accuracy','horizontal_accuracy','vertical_accuracy',
             'p_dop','height'],
    "relposned": ['stamp','relative_pose_north','relative_pose_east','relative_pose_down',
                  'relative_pose_heading','relative_pose_length','rel_pos_valid','rel_heading_valid',
                  'accuracy_north','accuracy_east','accuracy_down','accuracy_length','accuracy_heading'],
}
GPS_ORDER = ["pvt", "relposned"]

def enforce_schema(df: pd.DataFrame, kind: str) -> pd.DataFrame:
    schema = GPS_SCHEMAS[kind]
    return df.reindex(columns=schema)

def interpolate_gps(gps_dfs, image_dfs, skip_pointer):
    out_np = {}
    out_df = {}
    timestamps = image_dfs[0][skip_pointer:, 0]

    for key in GPS_ORDER:
        gps = gps_dfs[key]
        fn = interp1d(gps[skip_pointer:, 0], gps[skip_pointer:, 1:], axis=0,
                      kind='linear', fill_value='extrapolate')
        interpolated = fn(timestamps)
        merged = np.hstack([timestamps.reshape(-1,1), interpolated])
        schema = GPS_SCHEMAS[key]
        df = pd.DataFrame(merged, columns=schema)   # first col is stamp already
        df = df.drop_duplicates('stamp').sort_values('stamp').reset_index(drop=True)

        out_np[key] = merged
        out_df[key] = df

    # keep deterministic order
    return [out_np[k] for k in GPS_ORDER], out_df

def process_disparity(
    img: torch.Tensor,
    calibration: dict,
) -> np.ndarray:
    """Process the disparity image.

    Args:
        img (np.ndarray): The disparity image.

    Returns:
        torch.Tensor: The processed disparity image.
    """
    
    # get camera matrix
    intrinsic_data = calibration['cameraData'][2]['intrinsicMatrix']
    fx,fy, cx, cy = intrinsic_data[0], intrinsic_data[4], intrinsic_data[2], intrinsic_data[5]
    camera_matrix = tensor([[fx, 0, cx], [0, fy, cy], [0, 0, 1]])
    
    # unpack disparity map
    disparity_t = torch.from_dlpack(img)
    disparity_t = disparity_t[..., 0].float()
    
    # resize disparity map to match rgb image
    disparity_t = F.interpolate(
        disparity_t.unsqueeze(0).unsqueeze(0), size=(1080, 1920), mode='bilinear', align_corners=False\
    )
    disparity_t = disparity_t.squeeze(0).squeeze(0)
    
    # compute depth image from disparity image
    calibration_baseline = 0.075 #m
    calibration_focal = float(camera_matrix[0, 0])
    depth_t = K.geometry.depth.depth_from_disparity(
        disparity_t, baseline=calibration_baseline, focal=calibration_focal
    )
    
    # compute the point cloud from depth image
    points_xyz = K.geometry.depth.depth_to_3d_v2(depth_t, camera_matrix)
    
    return points_xyz.numpy()

def heading_to_direction(heading):
    if heading is not None:
        # Convert radians to degrees
        heading_deg = np.degrees(heading) % 360  # Ensure 0-360 range
        
        if (heading_deg > 315 or heading_deg <= 45):
            return 'North'
        elif (heading_deg > 45 and heading_deg <= 135):
            return 'East'
        elif (heading_deg > 135 and heading_deg <= 225):
            return 'South'
        elif (heading_deg > 225 and heading_deg <= 315):
            return 'West'
    else:
        return None

def postprocessing(
    msgs_df: pd.DataFrame, 
    images_cols: List[str]
) -> pd.DataFrame:
    
    # convert timestamps into int64
    msgs_df[images_cols] = msgs_df[images_cols].astype('int64')

    # add columns for file names
    images_cols_new = []
    for col in images_cols:
        new_col = f"{col}_file"
        if 'disparity' in col:
            msgs_df[new_col] = col + '-' + msgs_df[col].astype(str) + '.npy'
        else:
            msgs_df[new_col] = col + '-' + msgs_df[col].astype(str) + '.jpg'
        images_cols_new += [col, new_col]

    # convert heading motion to direction
    if 'heading_motion' in msgs_df.columns:
        msgs_df['direction'] = msgs_df['heading_motion'].apply(heading_to_direction)

    # rename lat/lon columns if they exist
    if 'longitude' in msgs_df.columns:
        msgs_df.rename(columns={'longitude': 'lon'}, inplace=True)
    if 'latitude' in msgs_df.columns:
        msgs_df.rename(columns={'latitude': 'lat'}, inplace=True)

    return msgs_df

# Zhenghao Fei, PAIBL 2020 (edited by Earl Ranario, PAIBL 2025)
def sync_msgs(
    msgs: List[np.array], 
    dt_threshold=None,
    apply_dt_threshold=False
) -> List[np.array]:
    """
    Syncs multiple messages based on their time stamps.
    `msgs` should be a list of numpy arrays, each with timestamps in the first column.
    Synchronization is based on the first message in the list.

    Args:
        msgs (list[np.array]): Messages to sync, timestamps in first column.
        dt_threshold (float, optional): Max allowed time difference to accept a match.
        apply_dt_threshold (bool, optional): If False, disables threshold check. Defaults to True.

    Returns:
        list[np.array]: Synced messages.
    """
    # Ensure reference timestamps are sorted
    ref_msg = msgs[0]
    sort_idx = np.argsort(ref_msg[:, 0])
    msgs[0] = ref_msg[sort_idx]
    msg1_t = msgs[0][:, 0]

    # If needed, estimate dt_threshold based on mean period
    if apply_dt_threshold:
        if dt_threshold is None:
            dt_threshold = np.mean(np.diff(msg1_t))

    # Build KDTree for each other message
    timestamps_kd_list = []
    for msg in msgs[1:]:
        timestamps_kd = KDTree(np.asarray(msg[:, 0]).reshape(-1, 1))
        timestamps_kd_list.append(timestamps_kd)

    # Find index matches within threshold (if enabled)
    msgs_idx_synced = []
    for msg1_idx, t in enumerate(msg1_t):
        msg_idx_list = [msg1_idx]
        dt_valid = True
        for timestamps_kd in timestamps_kd_list:
            dt, msg_idx = timestamps_kd.query([t])
            if apply_dt_threshold and abs(dt) > dt_threshold:
                dt_valid = False
                break
            msg_idx_list.append(msg_idx)

        if dt_valid:
            msgs_idx_synced.append(msg_idx_list)

    # Format output
    msgs_idx_synced = np.asarray(msgs_idx_synced).T
    msgs_synced = []
    for i, msg in enumerate(msgs):
        msg_synced = msg[msgs_idx_synced[i]]
        msgs_synced.append(msg_synced)

    return msgs_synced

def extract_images(
    image_topics: List[str],
    events_dict: Dict[str, List[EventLogPosition]],
    calibrations: Dict[str, dict],
    output_path: Path,
    current_ts: int,
    progress_tracker: Optional[dict] = None,
) -> bool:
    """Extracts images as jpg and stores timestamps into a csv file where they are synced based
    on their sequence number.

    ASSUMPTION: GPS is not synced with camera capture.

    Args:

        image_topics (list[str]): Topics that contain image information.
        events_dict (dict[str, list[EventLogPosition]]): All events stored in the binary file containing log info.
        disparity_scale (int): Scale for amplifying disparity color mapping. Default: 1.
        output_path (Path): Path to save images and timestamps.
    """

    print('--- image extraction ---')
    
    # initialize save path
    save_path = output_path / 'Metadata'
    if not save_path.exists():
        save_path.mkdir(parents=True, exist_ok=True)
    
    # convert image topics to camera locations
    image_topics_location = [f"/{CAMERA_POSITIONS[topic.split('/')[1]]}/{topic.split('/')[2]}" \
        for topic in image_topics]
    
    cols = ['sequence_num'] + image_topics_location
    ts_df: pd.DataFrame = pd.DataFrame(columns=cols) 
    
    # define image decoder
    image_decoder = ImageDecoder()

    # loop through each topic
    for topic_name in image_topics:
        
        # initialize camera events and event log
        camera_events: list[EventLogPosition] = events_dict[topic_name]
        event_log: EventLogPosition

        # prepare save path
        camera_name = topic_name.split('/')[1]
        camera_name = CAMERA_POSITIONS[camera_name]
        camera_type = topic_name.split('/')[2]
        topic_name_location = f'/{camera_name}/{camera_type}'
        camera_type = 'Disparity' if camera_type == 'disparity' else 'Images'
        camera_path = output_path / camera_type / camera_name
        if not camera_path.exists():
            camera_path.mkdir(parents=True, exist_ok=True)

        # loop through events write to jpg/npy
        for event_log in tqdm(camera_events):
            # parse the iamge
            sample: oak_pb2.OakFrame = event_log.read_message()

            # decode image
            img = cv2.imdecode(np.frombuffer(sample.image_data, dtype="uint8"), cv2.IMREAD_UNCHANGED)

            # extract image metadata
            sequence_num: int = sample.meta.sequence_num
            timestamp: float = sample.meta.timestamp
            updated_ts: int = int((timestamp*1e6) + current_ts)
            if sequence_num not in ts_df['sequence_num'].values:
                new_row = {col: sequence_num if col == 'sequence_num' else np.nan for col in ts_df.columns}
                ts_df = pd.concat([ts_df, pd.DataFrame([new_row])], ignore_index=True)
            ts_df.loc[ts_df['sequence_num'] == sequence_num, topic_name_location] = updated_ts

            # save image
            if "disparity" in topic_name:
                img = image_decoder.decode(sample.image_data)
                
                if calibrations is None or camera_name not in calibrations:
                    # Just save the raw disparity image if no calibration is available
                    img_name: str = f"disparity-{updated_ts}.npy"
                    np.save(str(camera_path / img_name), img)
                else:
                    points_xyz = process_disparity(img, calibrations[camera_name])
                    img_name: str = f"disparity-{updated_ts}.npy"
                    np.save(str(camera_path / img_name), points_xyz)
            else:
                
                if camera_name == 'top' and calibrations and camera_name in calibrations:
                    calibration = calibrations[camera_name]
                    intrinsic = calibration["cameraData"][2]["intrinsicMatrix"]
                    D = np.array(calibration["cameraData"][2]["distortionCoeff"])

                    # adjust K if your image is downscaled!
                    h, w = img.shape[:2]
                    orig_w = calibration["cameraData"][2]["width"]
                    orig_h = calibration["cameraData"][2]["height"]

                    scale_x = w / orig_w
                    scale_y = h / orig_h

                    K = np.array([
                        [intrinsic[0] * scale_x, 0, intrinsic[2] * scale_x],
                        [0, intrinsic[4] * scale_y, intrinsic[5] * scale_y],
                        [0, 0, 1]
                    ])

                    # undistort using remap
                    R = np.eye(3)
                    new_K, roi = cv2.getOptimalNewCameraMatrix(K, D, (w, h), 1, (w, h))
                    map1, map2 = cv2.initUndistortRectifyMap(K, D, R, new_K, (w, h), cv2.CV_16SC2)
                    img = cv2.remap(img, map1, map2, interpolation=cv2.INTER_LINEAR)

                    # CROP to remove black border
                    x, y, w_roi, h_roi = roi
                    img = img[y : y + h_roi, x : x + w_roi]
                
                img_name: str = f"rgb-{updated_ts}.jpg"
                cv2.imwrite(str(camera_path / img_name), img)

            if progress_tracker:
                progress_tracker['events_processed'] += 1
                _write_fractional_progress(progress_tracker)

    # split dataframe based on columns
    dfs = []
    ts_cols_list = []
    images_report = {}
    unique_camera_ids = {s.split('/')[1] for s in image_topics if s.startswith('/oak')}
    for i in unique_camera_ids:
        i = CAMERA_POSITIONS[i]
        ts_cols = [f'/{i}/rgb',f'/{i}/disparity']
        
        # check for missing topics
        existing_cols = [col for col in ts_cols if col in ts_df.columns]
        missing_cols = [col for col in ts_cols if col not in ts_df.columns]
        
        # report existing and missing columns
        images_report[i] = {
            'existing': existing_cols,
            'missing': missing_cols
        }
        
        if missing_cols:
            print(f"Warning: Skipping missing columns for camera '{i}': {missing_cols}")

        if not existing_cols:
            print(f"Warning: No existing timestamp columns found for camera '{i}'. Skipping this camera.")
            continue  # skip this camera completely

        
        ts_df_split = ts_df[existing_cols]
        ts_df_split = ts_df_split.dropna(subset=existing_cols)
        
         # Check if existing timestamps CSV exists
        if (save_path / f"{i}_timestamps.csv").exists():
            ts_df_existing = pd.read_csv(f"{save_path}/{i}_timestamps.csv")
            ts_df_split = pd.concat([ts_df_existing, ts_df_split], ignore_index=True)

        # Output dataframe as CSV
        ts_df_split.to_csv(f"{save_path}/{i}_timestamps.csv", index=False)
        dfs.append(ts_df_split.to_numpy(dtype='float64'))
        ts_cols_list += existing_cols
        
    return dfs, ts_cols_list, images_report

def extract_gps(
    gps_topics: List[str],
    events_dict: Dict[str, List[EventLogPosition]],
    output_path: Path,
    current_ts: int,
    progress_tracker: Optional[dict] = None,
) -> bool:
    """Extracts camera extrinsics/intrinsics from calibration event.

    Args:
        gps_topics (list[str]): Topics that contain gps information.
        events_dict (dict[str, list[EventLogPosition]]): All events stored in the binary file containing log info.
        output_path (Path): Path to save images and timestamps.
        current_ts (int): Base timestamp in microseconds.
    """ 

    print('--- gps extraction ---')
    
    df = {}
    gps_df_dict = {}
    gps_metric_summary = {}
    
    # initialize save path
    save_path = output_path / 'Metadata'
    if not save_path.exists():
        save_path.mkdir(parents=True, exist_ok=True)

    # loop through each topic
    for topic_name in gps_topics:
        
        gps_name = topic_name.split('/')[2]

        if gps_name not in GPS_SCHEMAS:
            print(f"Unknown gps topic: {gps_name}")
            return False

        csv_path = save_path / f"gps_{gps_name}.csv"
        if csv_path.exists():
            gps_df = pd.read_csv(csv_path)
        else:
            gps_df = pd.DataFrame(columns=GPS_SCHEMAS[gps_name])

        gps_df = enforce_schema(gps_df, gps_name)          # keep column order

        gps_events: list[EventLogPosition] = events_dict[topic_name]

        for event_log in tqdm(gps_events):
            if gps_name == 'pvt':
                sample: gps_pb2.GpsFrame = event_log.read_message()
            elif gps_name == 'relposned':
                sample: gps_pb2.RelativePositionFrame = event_log.read_message()
            else:
                print('Unknown protocol message.')
                return False
            
            # Updated timestamp based on current_ts and message timestamp delta
            updated_ts = int(current_ts + (sample.stamp.stamp * 1e6))

            # Create row for GPS data
            if gps_name == 'pvt':
                # --- Convert utc_stamp to epoch time (in microseconds) ---
                utc = sample.utc_stamp

                # Handle potentially negative nano field
                nanos = max(utc.nano, 0)
                dt = datetime(
                    utc.year, utc.month, utc.day,
                    utc.hour, utc.min, utc.sec,
                    nanos // 1000,  # convert nanoseconds to microseconds
                    tzinfo=timezone.utc
                )
                gps_epoch_us = int(dt.timestamp() * 1e6)
                
                new_row = {
                    'stamp': [updated_ts], 'gps_time': [gps_epoch_us],
                    'longitude': [sample.longitude], 'latitude': [sample.latitude],
                    'altitude': [sample.altitude], 'heading_motion': [sample.heading_motion], 
                    'heading_accuracy': [sample.heading_accuracy], 'speed_accuracy': [sample.speed_accuracy], 
                    'horizontal_accuracy': [sample.horizontal_accuracy], 'vertical_accuracy': [sample.vertical_accuracy], 
                    'p_dop': [sample.p_dop], 'height': [sample.height]
                }
            elif gps_name == 'relposned':
                new_row = {
                    'stamp': [updated_ts],
                    'relative_pose_north': [sample.relative_pose_north], 'relative_pose_east': [sample.relative_pose_east],
                    'relative_pose_down': [sample.relative_pose_down], 'relative_pose_heading': [sample.relative_pose_heading],
                    'relative_pose_length': [sample.relative_pose_length], 'rel_pos_valid': [sample.rel_pos_valid],
                    'rel_heading_valid': [sample.rel_heading_valid], 'accuracy_north': [sample.accuracy_north],
                    'accuracy_east': [sample.accuracy_east], 'accuracy_down': [sample.accuracy_down],
                    'accuracy_length': [sample.accuracy_length], 'accuracy_heading': [sample.accuracy_heading]
                }

            new_df = pd.DataFrame(new_row)
            new_df.reset_index(inplace=True, drop=True)
            gps_df.reset_index(inplace=True, drop=True)
            gps_df = pd.concat([gps_df, new_df], ignore_index=True)

        gps_df.replace({'True': 1, 'False': 0}, inplace=True)
        gps_df = gps_df.apply(pd.to_numeric, errors='coerce')
        gps_df = enforce_schema(gps_df, gps_name)
        # gps_df.to_csv(save_path / f"gps_{gps_name}.csv", index=False)
        # gps_df.to_csv(f"{save_path}/gps_{gps_name}.csv", index=False)
        df[gps_name] = gps_df.to_numpy(dtype='float64')
        gps_df_dict[gps_name] = gps_df

        # record gps metric summary (average values)
        if gps_name == 'pvt':
            gps_metric_summary['pvt'] = {
                'avg_heading_accuracy': gps_df['heading_accuracy'].mean(),
                'avg_speed_accuracy': gps_df['speed_accuracy'].mean(),
                'avg_horizontal_accuracy': gps_df['horizontal_accuracy'].mean(),
                'avg_vertical_accuracy': gps_df['vertical_accuracy'].mean(),
            }
        elif gps_name == 'relposned':
            gps_metric_summary['relposned'] = {
                'avg_accuracy_north': gps_df['accuracy_north'].mean(),
                'avg_accuracy_east': gps_df['accuracy_east'].mean(),
                'avg_accuracy_down': gps_df['accuracy_down'].mean(),
                'avg_accuracy_length': gps_df['accuracy_length'].mean(),
                'avg_accuracy_heading': gps_df['accuracy_heading'].mean()
            }

    return df, gps_df_dict, gps_metric_summary

def extract_calibrations(
    calib_topics: List[str],
    events_dict: Dict[str, List[EventLogPosition]],
    output_path: Path,
    progress_tracker: Optional[dict] = None,
) -> bool:
    """Extracts camera extrinsics/intrinsics from calibration event.

    Args:

        calib_topics (list[str]): Topics that contain image calibration information.
        events_dict (dict[str, list[EventLogPosition]]): All events stored in the binary file containing log info.
        output_path (Path): Path to save images and timestamps.
    """ 

    print('--- calibration extraction ---')
    # initialize save path
    save_path = output_path / 'Metadata'
    if not save_path.exists():
        save_path.mkdir(parents=True, exist_ok=True)

    calibrations = {}
    for topic_name in calib_topics:
        camera_name = topic_name.split('/')[1]
        calib_events: list[EventLogPosition] = events_dict[topic_name]
        for event_log in tqdm(calib_events):  # calibration events typically few
            calib_msg = event_log.read_message()
            json_data: dict = json_format.MessageToDict(calib_msg)
            camera_name_pos = CAMERA_POSITIONS[camera_name]
            json_name = f'{camera_name_pos}_calibration.json'
            json_path = save_path / json_name
            calibrations[camera_name_pos] = json_data
            if not json_path.exists():
                with open(json_path, "w") as json_file:
                    json.dump(json_data, json_file, indent=4)
            if progress_tracker:
                progress_tracker['events_processed'] += 1
                _write_fractional_progress(progress_tracker)
    return calibrations

def _write_fractional_progress(progress_tracker: dict):
    """Write fractional progress (completed files + current file fraction) to progress file."""
    try:
        ep = progress_tracker['events_processed']
        te = progress_tracker['total_events'] or 1
        fi = progress_tracker['file_index']
        progress_value = fi + (ep / te)
        progress_tracker['progress_path'].write_text(f"{progress_value:.4f}")
    except Exception:
        pass

def process_single_binary_file(args):
    # updated to accept progress tracking
    file_name, output_path, file_index, total_files, progress_meta = args
    print(f"Processing file {file_index + 1}/{total_files}: {file_name}")
    try:
        reader = EventsFileReader(file_name)
        if not reader.open():
            raise RuntimeError(f"Failed to open events file: {file_name}")
        # Try to get the index with error handling for malformed URI queries
        try:
            events_index = reader.get_index()
        except ValueError as e:
            if "dictionary update sequence element" in str(e) and "has length 1; 2 is required" in str(e):
                print(f"Warning: Malformed URI query in file {file_name}. This may be due to corrupted binary data.")
                print("Attempting to continue with available data...")
                
                # Try to patch the farm_ng library function temporarily
                import farm_ng.core.uri as uri_module
                original_func = uri_module.uri_query_to_dict
                
                def patched_uri_query_to_dict(uri):
                    try:
                        # Handle malformed query parameters by filtering out invalid ones
                        params = []
                        for x in uri.query.split("&"):
                            if "=" in x:
                                params.append(x.split("=", 1))  # Split only on first "="
                            else:
                                # Skip malformed parameters or treat as key with empty value
                                if x.strip():  # Only if not empty
                                    params.append([x, ""])
                        return dict(params)
                    except Exception:
                        return {}
                
                # Temporarily patch the function
                uri_module.uri_query_to_dict = patched_uri_query_to_dict
                
                try:
                    events_index = reader.get_index()
                finally:
                    # Restore original function
                    uri_module.uri_query_to_dict = original_func
            else:
                raise

        events_dict = build_events_dict(events_index)
        topics = [t for t in events_dict if any(tp in t.lower() for tp in TYPES)]
        calib_topics = [t for t in topics if 'calibration' in t.lower()]
        gps_topics = [t for t in topics if any(g in t.lower() for g in GPS_TYPES)]
        image_topics = [t for t in topics if any(i in t.lower() for i in IMAGE_TYPES)]
        # count events for progress granularity (only in sequential mode where progress_meta present)
        progress_tracker = None
        if progress_meta:
            total_events = 0
            for t in calib_topics + gps_topics + image_topics:
                total_events += len(events_dict.get(t, []))
            progress_tracker = {
                'events_processed': 0,
                'total_events': total_events,
                'file_index': file_index,
                'progress_path': progress_meta['progress_path']
            }
        # base ts
        parts = os.path.basename(file_name).split('_')
        if len(parts) < 7:
            raise RuntimeError("File name is not compatible with this script.")
        date_string = '_'.join(parts[:7])
        date_object = datetime.strptime(date_string, '%Y_%m_%d_%H_%M_%S_%f').replace(tzinfo=timezone.utc)
        current_ts = int(date_object.timestamp() * 1e6)
        calibrations = extract_calibrations(calib_topics, events_dict, output_path, progress_tracker) or None
        gps_dfs, gps_cols, _ = extract_gps(gps_topics, events_dict, output_path, current_ts, progress_tracker)
        if not gps_dfs:
            raise RuntimeError(f"Failed to extract gps event file for {file_name}")
        image_dfs, images_cols, _ = extract_images(image_topics, events_dict, calibrations, output_path, current_ts, progress_tracker)
        if not image_dfs:
            raise RuntimeError(f"Failed to extract image event file for {file_name}")
        # finalize progress for file
        if progress_tracker:
            progress_tracker['events_processed'] = progress_tracker['total_events']
            _write_fractional_progress(progress_tracker)
        # interpolate GPS
        skip_pointer = 0
        gps_np_list, gps_df_dict = interpolate_gps(gps_dfs, image_dfs, skip_pointer)
        gps_arrays = []
        gps_cols_flat = []
        for i, name in enumerate(GPS_ORDER):
            arr = gps_np_list[i]
            schema = GPS_SCHEMAS[name]
            if i == 0:
                # keep the first GPS block completely (includes stamp)
                gps_arrays.append(arr)
                gps_cols_flat += schema
            else:
                # drop just the first column (stamp) for subsequent GPS blocks
                gps_arrays.append(arr[:, 1:])
                gps_cols_flat += schema[1:]
        msgs = image_dfs + gps_arrays
        msgs_synced = sync_msgs(msgs)
        file_mat = np.concatenate(msgs_synced, axis=1)
        final_cols = images_cols + gps_cols_flat
        assert file_mat.shape[1] == len(final_cols), f"col mismatch {file_mat.shape[1]} vs {len(final_cols)}"
        file_df = pd.DataFrame(file_mat, columns=final_cols).reset_index(drop=True)
        file_df = postprocessing(file_df, images_cols)

        return file_df, gps_df_dict, images_cols, file_index
        
    except Exception as e:
        print(f"Error processing file {file_name}: {e}")
        # Return empty/minimal data to allow other files to continue processing
        empty_df = pd.DataFrame()
        empty_gps = {k: pd.DataFrame(columns=GPS_SCHEMAS[k]) for k in GPS_ORDER}
        return empty_df, empty_gps, [], file_index

def cleanup_output_files(output_path):
    """Clean up any partially created files and directories."""
    import shutil
    try:
        if output_path.exists():
            # Remove entire output directory and all its contents
            shutil.rmtree(output_path)
            print(f"Cleaned up output directory: {output_path}")
    except Exception as e:
        print(f"Warning: Could not clean up output directory: {e}")

def extract_binary(file_names, output_path, granular_progress: bool = True) -> None:
    """Read an events file and extracts relevant information from it.

    Args:
        file_names (List[Path]): List of paths to the events files.
        output_path (Path): The path to the folder where the converted data will be written.
    """
    # print out file names
    print(f"Extracting {len(file_names)} files.")
    
    # make output directory
    base = 'RGB'
    output_path = output_path / base
    if not output_path.exists():
        output_path.mkdir(parents=True, exist_ok=True)
    
    # write progress text file
    with open(f"{output_path}/progress.txt", "w") as f:
        f.write("0")
        
    # create a report file
    report_path = output_path / 'report.txt'
    with open(report_path, "w") as f:
        f.write("Report of the conversion process:\n")
        f.write(f"Number of files: {len(file_names)}\n")
        f.write(f"Output path: {output_path}\n")
    
    # Determine whether to use multiprocessing or threading
    # Check if we're running in a daemon process (which can't spawn child processes)
    current_process = mp.current_process()
    is_daemon = current_process.daemon if hasattr(current_process, 'daemon') else False
    use_parallel = len(file_names) > 1 and not granular_progress  # disable parallel when granular progress desired
    use_multiprocessing = use_parallel and not is_daemon
    use_threading = use_parallel and is_daemon
    
    # Determine optimal number of workers
    cpu_count = mp.cpu_count()
    max_workers = min(len(file_names), cpu_count, 2)  # Cap at 2 workers max

    if use_multiprocessing:
        print(f"Using multiprocessing with {max_workers} processes for {len(file_names)} files.")
        try:
            total = len(file_names)
            progress_path = output_path / "progress.txt"

            counter = mp.Value('i', 0)
            lock = mp.Lock()
            async_results = []

            def _on_done(_res):
                with lock:
                    counter.value += 1
                    progress_path.write_text(f"{counter.value}")

            process_args = [(f, output_path, i, total) for i, f in enumerate(file_names)]

            with Pool(processes=max_workers) as pool:
                for args in process_args:
                    ar = pool.apply_async(process_single_binary_file, (args,), callback=_on_done)
                    async_results.append(ar)
                pool.close()
                pool.join()

            # -------- collect & merge --------
            all_file_dfs = []
            all_gps_parts = {k: [] for k in GPS_ORDER}
            images_cols = None

            for ar in async_results:
                file_df, gps_df_dict, img_cols, file_index = ar.get()
                all_file_dfs.append(file_df)
                for k in GPS_ORDER:
                    all_gps_parts[k].append(gps_df_dict[k])
                if images_cols is None:
                    images_cols = img_cols

            if all_file_dfs:
                save_path = output_path / 'Metadata'
                save_path.mkdir(parents=True, exist_ok=True)

                # msgs_synced.csv
                msgs_df = pd.concat(all_file_dfs, ignore_index=True)
                msgs_df.to_csv(save_path / "msgs_synced.csv", index=False)

                # gps_*.csv (optional but safe now)
                for k in GPS_ORDER:
                    gps_full = (pd.concat(all_gps_parts[k], ignore_index=True)
                                .drop_duplicates('stamp')
                                .sort_values('stamp'))
                    gps_full = enforce_schema(gps_full, k)
                    gps_full.to_csv(save_path / f"gps_{k}.csv", index=False)

                print("Successfully created msgs_synced.csv (and gps_*.csv) from multiprocessed data")
            else:
                print("Warning: No valid synced messages found for final output")

        except Exception as e:
            print(f"Multiprocessing failed: {e}")
            print("Cleaning up partially created files and terminating...")
            cleanup_output_files(output_path)
            raise RuntimeError(f"Binary extraction failed in multiprocessing mode: {e}")
    
    elif use_threading:
        print(f"Using threading with {max_workers} threads for {len(file_names)} files (daemon process detected).")

        try:
            process_args = [(f, output_path, i, len(file_names)) for i, f in enumerate(file_names)]

            progress_path = output_path / "progress.txt"
            total = len(file_names)
            progress_lock = threading.Lock()
            progress_done = 0

            all_file_dfs = []
            all_gps_parts = {k: [] for k in GPS_ORDER}
            images_cols = None

            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [executor.submit(process_single_binary_file, a) for a in process_args]

                for fut in as_completed(futures):
                    try:
                        file_df, gps_df_dict, img_cols, file_index = fut.result()
                        
                        # Only add to results if we got valid data
                        if not file_df.empty:
                            all_file_dfs.append(file_df)
                            for k in GPS_ORDER:
                                all_gps_parts[k].append(gps_df_dict[k])
                            if images_cols is None:
                                images_cols = img_cols
                        else:
                            print(f"Warning: Skipping file {file_index} due to processing errors")

                        with progress_lock:
                            progress_done += 1
                            progress_path.write_text(f"{progress_done}")
                        
                    except Exception as e:
                        print(f"Error processing one of the files: {e}")
                        # Continue with other files
                        with progress_lock:
                            progress_done += 1
                            progress_path.write_text(f"{progress_done}")
                        continue

            if all_file_dfs:
                save_path = output_path / 'Metadata'
                save_path.mkdir(parents=True, exist_ok=True)

                msgs_df = pd.concat(all_file_dfs, ignore_index=True)
                msgs_df.to_csv(save_path / "msgs_synced.csv", index=False)

                # optional GPS csvs
                for k in GPS_ORDER:
                    gps_full = (pd.concat(all_gps_parts[k], ignore_index=True)
                                .drop_duplicates('stamp')
                                .sort_values('stamp'))
                    gps_full = enforce_schema(gps_full, k)
                    gps_full.to_csv(save_path / f"gps_{k}.csv", index=False)

                print("Successfully created msgs_synced.csv (and gps_*.csv) from threaded data")
            else:
                print("Warning: No valid synced messages found for final output")

        except Exception as e:
            print(f"Threading failed: {e}")
            print("Cleaning up partially created files and terminating...")
            cleanup_output_files(output_path)
            raise RuntimeError(f"Binary extraction failed in threading mode: {e}")
    
    else:
        # Sequential processing with granular progress
        if is_daemon and len(file_names) > 1 and granular_progress:
            print("Granular progress enabled in daemon process - forcing sequential processing for multiple files.")
        elif len(file_names) == 1:
            print("Using sequential processing for single file (granular progress).")
        else:
            print("Using sequential processing (granular progress enabled).")
        all_file_dfs = []
        all_gps_parts = {k: [] for k in GPS_ORDER}
        images_cols = None
        progress_path = output_path / "progress.txt"
        counter = 0
        total_files = len(file_names)
        for file_name in tqdm(file_names):
            with open(report_path, "a") as f:
                f.write(f"\n--- File: {file_name} ---\n")
            # pass progress meta for fractional updates
            progress_meta = { 'progress_path': progress_path }
            file_df, gps_df_dict, img_cols, _ = process_single_binary_file(
                (file_name, output_path, counter, total_files, progress_meta)
            )
            all_file_dfs.append(file_df)
            for k in GPS_ORDER:
                all_gps_parts[k].append(gps_df_dict[k])
            if images_cols is None:
                images_cols = img_cols
            counter += 1
            # ensure progress shows completed file count precisely
            progress_path.write_text(f"{counter}")
        if all_file_dfs:
            save_path = output_path / 'Metadata'
            save_path.mkdir(parents=True, exist_ok=True)
            msgs_df = pd.concat(all_file_dfs, ignore_index=True)
            msgs_df.to_csv(save_path / "msgs_synced.csv", index=False)
            for k in GPS_ORDER:
                gps_full = (pd.concat(all_gps_parts[k], ignore_index=True)
                            .drop_duplicates('stamp')
                            .sort_values('stamp'))
                gps_full = enforce_schema(gps_full, k)
                gps_full.to_csv(save_path / f"gps_{k}.csv", index=False)
            print("Successfully created msgs_synced.csv (and gps_*.csv) with granular progress")
        else:
            print("Warning: No valid synced messages found for final output")

def _cleanup_files(file_paths):
    global extraction_status
    for p in file_paths:
        try:
            os.remove(p)
        except OSError:
            pass

def extraction_worker(file_paths, output_path):
    global extraction_status, extraction_error_message

    try:
        extraction_status = "in_progress"
        extraction_error_message = None
        extract_binary(file_paths, output_path)
        
        # cleanup files
        _cleanup_files(file_paths)
        extraction_status = "done"
    except EOFError as e:
        error_msg = f"EOFError during binary extraction: {e}"
        print(error_msg)
        extraction_status = "failed"
        extraction_error_message = error_msg
    except Exception as e:
        error_msg = f"Extraction failed: {e}"
        print(f"[ERROR] {error_msg}")
        # print full traceback
        traceback.print_exc()
        extraction_status = "failed"
        extraction_error_message = error_msg

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--file_names', type=str, nargs='+', required=True,
                    help='List of paths to the event files.')
    ap.add_argument('--output_path', type=str, required=True,
                    help='Path to the folder where the converted data will be written.')

    args = ap.parse_args()
    file_names = [Path(f) for f in args.file_names]
    output_path = Path(args.output_path)

    # Check that all file paths exist
    for f in file_names:
        if not f.exists():
            raise RuntimeError(f"File {f} does not exist.")
    
    # Make output directory
    if not output_path.exists():
        output_path.mkdir(parents=True, exist_ok=True)

    # Extract binary files
    extract_binary(file_names, output_path)


