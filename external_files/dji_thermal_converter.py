from dji_thermal_sdk.dji_sdk import *
from dji_thermal_sdk.utility import getJPEGHandle
import numpy as np
import ctypes as CT
from ctypes import *
import rasterio
import argparse
import csv
import os
import platform
import shutil
import subprocess
import logging
from datetime import datetime
from concurrent.futures import ProcessPoolExecutor, as_completed
from tqdm import tqdm
import pandas as pd
import warnings
warnings.filterwarnings("ignore")

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')


def parse_args():
    parser = argparse.ArgumentParser(
        description='Convert DJI thermal JPG images to GeoTIFF with Celsius values.'
    )
    parser.add_argument('--input-dir', type=str, default='input_images',
                        help='Folder containing _T.JPG and _V.JPG images. Default: input_images')
    parser.add_argument('--weather-file', type=str, default=None,
                        help='Path to a TOA5 .dat file. When provided, per-image '
                             'humidity and ambient temperature are matched from the '
                             'nearest weather station reading by timestamp.')
    parser.add_argument('--distance', type=float, default=5.0,
                        help='Distance to subject (m). Default: 5.0')
    parser.add_argument('--humidity', type=float, default=70.0,
                        help='Relative humidity (%%). Fallback when --weather-file '
                             'is not provided. Default: 70.0')
    parser.add_argument('--emissivity', type=float, default=1.0,
                        help='Surface emissivity (0–1). Default: 1.0')
    parser.add_argument('--ambient-temperature', type=float, default=25.0,
                        help='Ambient temperature (°C). Also used as reflected '
                             'temperature. Fallback when --weather-file is not '
                             'provided. Default: 25.0')
    parser.add_argument('--workers', type=int, default=os.cpu_count(),
                        help=f'Number of parallel workers. Default: {os.cpu_count()} (all CPUs)')
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Weather helpers
# ---------------------------------------------------------------------------

def load_weather(path: str) -> pd.DataFrame:
    """Parse a Campbell Scientific TOA5 .dat file.

    Returns a DataFrame with columns [TIMESTAMP, AirTC, RH] sorted by
    TIMESTAMP.  TIMESTAMP is a tz-naive pandas Timestamp.

    TOA5 layout:
        Line 1: environment metadata (quoted CSV)
        Line 2: column names (quoted CSV)
        Lines 3-4: units / aggregation (skipped)
        Line 5+: data rows
    """
    with open(path, 'r', encoding='utf-8-sig', newline='') as fh:
        lines = fh.read().splitlines()

    if len(lines) < 5:
        raise ValueError(f"TOA5 file too short: {path}")

    columns = next(csv.reader([lines[1]]))

    data_lines = '\n'.join(lines[4:])
    df = pd.read_csv(
        __import__('io').StringIO(data_lines),
        header=None,
        names=columns,
        na_values=['NAN', 'NaN', 'nan', ''],
        keep_default_na=True,
    )

    if 'TIMESTAMP' not in df.columns:
        raise ValueError(f"No TIMESTAMP column found in {path}. Columns: {df.columns.tolist()}")
    for col in ('AirTC', 'RH'):
        if col not in df.columns:
            raise ValueError(f"Required column '{col}' not found in {path}. "
                             f"Columns: {df.columns.tolist()}")

    # Coerce and normalise timestamps — strip any timezone so comparisons
    # with the filename-derived timestamps (always naive) can't fail.
    df['TIMESTAMP'] = pd.to_datetime(df['TIMESTAMP'], errors='coerce')
    df['TIMESTAMP'] = df['TIMESTAMP'].dt.tz_localize(None)  # ensure tz-naive
    df = df.dropna(subset=['TIMESTAMP']).sort_values('TIMESTAMP').reset_index(drop=True)

    df['AirTC'] = pd.to_numeric(df['AirTC'], errors='coerce')
    df['RH']    = pd.to_numeric(df['RH'],    errors='coerce')

    logging.info(
        f"Loaded {len(df)} weather readings from {os.path.basename(path)} "
        f"({df['TIMESTAMP'].min()} → {df['TIMESTAMP'].max()})"
    )
    return df[['TIMESTAMP', 'AirTC', 'RH']]


def extract_image_timestamp(filename: str) -> pd.Timestamp | None:
    """Parse capture time from a DJI filename.

    Supports the format DJI_YYYYMMDDHHMMSS_NNNN_T.JPG.
    Returns a tz-naive pd.Timestamp, or None if the filename doesn't match.
    """
    parts = filename.split('_')
    if len(parts) < 3:
        return None
    ts_str = parts[1]  # e.g. '20260622094800'
    try:
        dt = datetime.strptime(ts_str, '%Y%m%d%H%M%S')
        return pd.Timestamp(dt)  # tz-naive
    except ValueError:
        return None


def match_weather(
    weather_df: pd.DataFrame,
    filenames: list[str],
    fallback_humidity: float,
    fallback_ambient: float,
) -> pd.DataFrame:
    """Nearest-neighbour timestamp join between image filenames and weather data.

    Both sides are tz-naive before comparison.  For images whose filename
    timestamp cannot be parsed, the CLI fallback values are used.

    Returns a DataFrame indexed by filename with columns:
        image_ts, weather_ts, humidity, ambient_temperature, time_diff_s
    """
    rows = []
    for fname in filenames:
        img_ts = extract_image_timestamp(fname)

        if img_ts is None or weather_df.empty:
            rows.append({
                'filename':            fname,
                'image_ts':            img_ts,
                'weather_ts':          None,
                'humidity':            fallback_humidity,
                'ambient_temperature': fallback_ambient,
                'time_diff_s':         None,
                'source':              'fallback',
            })
            continue

        # Both timestamps are tz-naive — safe to subtract directly
        idx   = (weather_df['TIMESTAMP'] - img_ts).abs().idxmin()
        wrow  = weather_df.iloc[idx]
        diff  = abs((wrow['TIMESTAMP'] - img_ts).total_seconds())

        humidity = wrow['RH']    if pd.notna(wrow['RH'])    else fallback_humidity
        ambient  = wrow['AirTC'] if pd.notna(wrow['AirTC']) else fallback_ambient

        rows.append({
            'filename':            fname,
            'image_ts':            img_ts,
            'weather_ts':          wrow['TIMESTAMP'],
            'humidity':            humidity,
            'ambient_temperature': ambient,
            'time_diff_s':         diff,
            'source':              'weather_file',
        })

    return pd.DataFrame(rows).set_index('filename')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _worker_init(sdk_lib):
    """Called once per worker process to load the SDK library."""
    dji_init(sdk_lib)


def main():
    """
    Converts all thermal JPG images in <input-dir> to GeoTIFF format with
    Celsius temperature values, organises outputs, and optionally matches
    per-image humidity and ambient temperature from a TOA5 weather file.

    Expected input layout:
        <input-dir>/
        ├── DJI_..._T.JPG       — thermal images
        └── DJI_..._V.JPG       — paired RGB images

    Output layout:
        <input-dir>/
        └── rgb_and_thermal_conv/
            ├── thermal_conv/       — converted GeoTIFFs
            ├── rgb/                — copied paired RGB images
            ├── run_params.txt      — fixed parameters used for this run
            └── weather_match.csv   — per-image weather values (if --weather-file)

    Requirements:
        - "dji_thermal_sdk" folder in the repo root containing libdirp.so/.dll
        - "exiftool" on PATH
    """
    args = parse_args()

    input_dir        = args.input_dir
    raw_thermal_dir  = os.path.join(input_dir, 'raw_thermal')
    out_dir          = os.path.join(input_dir, 'rgb_and_thermal_conv')
    thermal_conv_dir = os.path.join(out_dir, 'thermal_conv')
    rgb_dir          = os.path.join(out_dir, 'rgb')

    if not os.path.isdir(input_dir):
        logging.error(f"Input folder not found: {os.path.abspath(input_dir)}")
        return

    # Resolve and check SDK library before processing any files
    if platform.system() == "Windows":
        sdk_lib = "dji_thermal_sdk/utility/bin/windows/release_x64/libdirp.dll"
    else:
        sdk_lib = "dji_thermal_sdk/utility/bin/linux/release_x64/libdirp.so"

    if not os.path.exists(sdk_lib):
        logging.error(
            f"DJI Thermal SDK library not found at: {os.path.abspath(sdk_lib)}\n"
            "Download the SDK (v1.7+) from "
            "https://www.dji.com/global/downloads/softwares/dji-thermal-sdk\n"
            "and extract it so the above path exists."
        )
        return

    os.makedirs(raw_thermal_dir,  exist_ok=True)
    os.makedirs(thermal_conv_dir, exist_ok=True)
    os.makedirs(rgb_dir,          exist_ok=True)

    # Move _T.JPG files into raw_thermal/ and _V.JPG files into rgb/
    for f in os.listdir(input_dir):
        src = os.path.join(input_dir, f)
        if not os.path.isfile(src):
            continue
        if f.endswith('_T.JPG'):
            shutil.move(src, os.path.join(raw_thermal_dir, f))
        elif f.endswith('_V.JPG'):
            shutil.move(src, os.path.join(rgb_dir, f))

    input_files = sorted(f for f in os.listdir(raw_thermal_dir) if f.endswith('_T.JPG'))

    if not input_files:
        logging.warning(f'No _T.JPG thermal images found in {input_dir}')
        return

    # ------------------------------------------------------------------
    # Weather matching
    # ------------------------------------------------------------------
    weather_matches = None
    if args.weather_file:
        try:
            weather_df    = load_weather(args.weather_file)
            weather_matches = match_weather(
                weather_df, input_files,
                fallback_humidity=args.humidity,
                fallback_ambient=args.ambient_temperature,
            )
            logging.info(
                f"Weather matched {(weather_matches['source'] == 'weather_file').sum()} / "
                f"{len(input_files)} images from {os.path.basename(args.weather_file)}"
            )
        except Exception as e:
            logging.error(f"Failed to load weather file: {e}. Falling back to CLI values.")

    def _get_params(filename):
        """Return (humidity, ambient_temperature) for one image."""
        if weather_matches is not None and filename in weather_matches.index:
            row = weather_matches.loc[filename]
            return float(row['humidity']), float(row['ambient_temperature'])
        return args.humidity, args.ambient_temperature

    logging.info(f'Converting {len(input_files)} thermal images...')
    logging.info(
        f"Fixed params — distance: {args.distance} m, emissivity: {args.emissivity}"
    )
    if weather_matches is None:
        logging.info(
            f"Fixed params — humidity: {args.humidity} %, "
            f"ambient temp: {args.ambient_temperature} °C"
        )

    tasks = []
    for f in input_files:
        humidity, ambient_temp = _get_params(f)
        tasks.append((
            f, raw_thermal_dir, thermal_conv_dir,
            args.distance, humidity, args.emissivity, ambient_temp,
        ))

    errors = 0
    with ProcessPoolExecutor(
        max_workers=args.workers,
        initializer=_worker_init,
        initargs=(sdk_lib,),
    ) as pool:
        futures = {pool.submit(jpg_to_thermal_tif, *task): task[0] for task in tasks}
        with tqdm(total=len(futures)) as pbar:
            for future in as_completed(futures):
                filename = futures[future]
                try:
                    future.result()
                except Exception as e:
                    logging.error(f"Error converting {filename}: {e}")
                    errors += 1
                pbar.update(1)

    # Clean up exiftool backup files
    for file in os.listdir(thermal_conv_dir):
        if file.endswith('original'):
            os.remove(os.path.join(thermal_conv_dir, file))

    # Warn for any thermal images with no matching RGB
    rgb_by_index = {}
    for f in os.listdir(rgb_dir):
        if f.endswith('_V.JPG'):
            parts = f.split('_')
            if len(parts) >= 3:
                rgb_by_index[parts[-2]] = f

    rgb_missing = 0
    for thermal_file in input_files:
        index = thermal_file.split('_')[-2]
        if index not in rgb_by_index:
            logging.warning(f"No paired RGB found for {thermal_file} (index {index})")
            rgb_missing += 1

    # Save weather match CSV
    if weather_matches is not None:
        match_csv = os.path.join(out_dir, 'weather_match.csv')
        weather_matches.reset_index().to_csv(match_csv, index=False)
        logging.info(f"Weather match saved to {match_csv}")

    # Save run parameters
    params_file = os.path.join(out_dir, 'run_params.txt')
    with open(params_file, 'w') as f:
        f.write(f"input_dir:            {input_dir}\n")
        f.write(f"raw_thermal_dir:      {raw_thermal_dir}\n")
        f.write(f"thermal_conv_dir:     {thermal_conv_dir}\n")
        f.write(f"rgb_dir:              {rgb_dir}\n")
        f.write(f"weather_file:         {args.weather_file or 'not provided'}\n")
        f.write(f"distance:             {args.distance} m\n")
        f.write(f"humidity:             {'per-image (see weather_match.csv)' if weather_matches is not None else f'{args.humidity} %'}\n")
        f.write(f"emissivity:           {args.emissivity}\n")
        f.write(f"ambient_temp (= reflected_temp): {'per-image (see weather_match.csv)' if weather_matches is not None else f'{args.ambient_temperature} °C'}\n")
        f.write(f"workers:              {args.workers}\n")
        f.write(f"images_converted:     {len(input_files) - errors}\n")
        f.write(f"conversion_errors:    {errors}\n")
        f.write(f"rgb_missing:          {rgb_missing}\n")
    logging.info(f'Parameters saved to {params_file}')

    logging.info(f'Done! {len(input_files) - errors} converted, {errors} errors.')


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

def jpg_to_thermal_tif(
    filename: str,
    input_folder: str,
    out_folder: str,
    distance: float,
    humidity: float,
    emissivity: float,
    reflected_temperature: float,
) -> None:
    """
    Converts an RJPEG thermal image to TIF format with a single layer containing
    temperature values in Celsius, applying custom measurement parameters.

    Runs inside a worker process — dji_init has already been called by _worker_init.
    """
    filepath     = os.path.join(input_folder, filename)
    out_filepath = os.path.join(out_folder, os.path.splitext(filename)[0] + '.tif')

    ret = getJPEGHandle(filepath)
    if ret != 0:
        raise ValueError(f"Failed to open {filepath} (error {ret})")

    params            = dirp_measurement_params_t()
    params.distance   = CT.c_float(distance)
    params.humidity   = CT.c_float(humidity)
    params.emissivity = CT.c_float(emissivity)
    # SDK field "reflection" = reflected/apparent temperature for atmosphere correction
    params.reflection = CT.c_float(reflected_temperature)

    ret = dirp_set_measurement_params(DIRP_HANDLE, CT.byref(params))
    if ret != DIRP_SUCCESS:
        raise ValueError(f"dirp_set_measurement_params failed (error {ret})")

    resolution = dirp_resolution_t()
    dirp_get_rjpeg_resolution(DIRP_HANDLE, CT.byref(resolution))
    img_h, img_w = resolution.height, resolution.width

    size       = img_h * img_w * CT.sizeof(CT.c_float)
    raw_buffer = CT.create_string_buffer(size)
    ret        = dirp_measure_ex(DIRP_HANDLE, CT.byref(raw_buffer), size)
    if ret != DIRP_SUCCESS:
        raise ValueError(f"dirp_measure_ex failed (error {ret})")

    img = np.frombuffer(raw_buffer.raw, dtype=np.float32).reshape(img_h, img_w)

    with rasterio.open(
        out_filepath, 'w',
        driver='GTiff',
        height=img_h, width=img_w,
        count=1, dtype=rasterio.float32,
    ) as dst:
        dst.write(img, 1)

    subprocess.run(
        ['exiftool', '-tagsfromfile', filepath, out_filepath],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )


if __name__ == '__main__':
    main()
