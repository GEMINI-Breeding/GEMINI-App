# Thermal Image Converter

Converts DJI drone thermal JPEG images (R-JPEG) into single-band GeoTIFF files where each pixel holds the temperature value in degrees Celsius. Supports per-image humidity and ambient temperature from a Campbell Scientific TOA5 weather station file.

## Table of Contents
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Options](#options)
- [Output Layout](#output-layout)
- [Example](#example)
- [License](#license)

## Requirements
- Python 3.11+
- [DJI Thermal SDK v1.7+](https://www.dji.com/global/downloads/softwares/dji-thermal-sdk) — v1.7 or later required for Matrice 4T support (not included)
- `exiftool` — handled automatically by `setup.sh` on Linux/WSL; included as `exiftool.exe` for Windows

## Installation

1. **Clone the repository:**
   ```sh
   git clone https://github.com/eranario/thermal-image-converter.git
   cd thermal-image-converter
   ```

2. **Run the setup script** (installs exiftool, creates the Python environment, checks for the DJI SDK):
   ```sh
   bash setup.sh
   ```

3. **Download [DJI Thermal SDK v1.7+](https://www.dji.com/global/downloads/softwares/dji-thermal-sdk) and place its contents in a `dji_thermal_sdk/` folder:**
   ```
   dji_thermal_sdk/
   └── utility/
       └── bin/
           ├── linux/
           │   └── release_x64/
           │       └── libdirp.so      ← required on Linux / WSL
           └── windows/
               └── release_x64/
                   └── libdirp.dll     ← required on Windows
   ```

4. **Activate the environment:**
   ```sh
   source .venv/bin/activate
   ```

## Usage

```sh
python dji_thermal_converter.py --input-dir <path> [OPTIONS]
```

Point `--input-dir` at a folder containing raw DJI images (`_T.JPG` thermal and `_V.JPG` RGB). The script organises them into subfolders and writes converted TIFFs alongside copied RGB images.

### With a weather file

When `--weather-file` is provided, humidity and ambient temperature are pulled from the nearest weather station reading (by timestamp) for each image rather than using fixed CLI values. The `--humidity` and `--ambient-temperature` flags act as fallbacks only.

```sh
python dji_thermal_converter.py \
  --input-dir /mnt/d/2026/flight_001 \
  --weather-file /mnt/d/2026/Well-watered_TOA5_83014.Table1_2026_06_22_0000.dat \
  --distance 7 \
  --emissivity 0.95
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--input-dir` | `input_images` | Folder containing `_T.JPG` and `_V.JPG` images |
| `--weather-file` | _(none)_ | Path to a Campbell Scientific TOA5 `.dat` file for per-image humidity and ambient temperature |
| `--distance` | `5.0` | Distance to subject (m) |
| `--humidity` | `70.0` | Relative humidity (%). Fallback when `--weather-file` is not provided |
| `--emissivity` | `1.0` | Surface emissivity (0–1) |
| `--ambient-temperature` | `25.0` | Ambient temperature (°C), also used as reflected temperature. Fallback when `--weather-file` is not provided |
| `--workers` | all CPUs | Number of parallel conversion workers |

> **Note:** Reflected temperature is always set equal to ambient temperature, matching standard practice for field thermal surveys.

> **Note:** The DJI Thermal SDK v1.7+ is required for Matrice 4T (M4T) support. Older SDK versions will fail to parse M4T RJPEG files.

## Output Layout

```
<input-dir>/
├── raw_thermal/                 ← thermal source images (_T.JPG), moved here automatically
└── rgb_and_thermal_conv/
    ├── thermal_conv/            ← converted GeoTIFFs (float32, °C per pixel)
    │   └── DJI_..._T.tif
    ├── rgb/                     ← paired RGB images (_V.JPG), moved here automatically
    │   └── DJI_..._V.JPG
    ├── run_params.txt           ← fixed parameters used for this run
    └── weather_match.csv        ← per-image matched weather values (if --weather-file used)
```

### `weather_match.csv` columns

| Column | Description |
|--------|-------------|
| `filename` | Thermal image filename |
| `image_ts` | Timestamp parsed from filename |
| `weather_ts` | Nearest weather station reading timestamp |
| `humidity` | Matched RH (%) applied to this image |
| `ambient_temperature` | Matched AirTC (°C) applied to this image |
| `time_diff_s` | Difference in seconds between image and weather timestamps |
| `source` | `weather_file` or `fallback` |

## Example

```sh
# Fixed parameters
python dji_thermal_converter.py \
  --input-dir /mnt/d/2026/Davis/Sorghum/2026-06-22/DJI/DJI_202606220929_003 \
  --distance 7 \
  --humidity 50 \
  --emissivity 0.95 \
  --ambient-temperature 26.0

# Per-image humidity and temperature from weather station
python dji_thermal_converter.py \
  --input-dir /mnt/d/2026/Davis/Sorghum/2026-06-22/DJI/DJI_202606220929_003 \
  --weather-file /mnt/d/2026/Davis/Sorghum/2026-06-22/Well-watered_TOA5_83014.Table1_2026_06_22_0000.dat \
  --distance 7 \
  --emissivity 0.95
```

## License
GNU General Public License v3.0 — see [LICENSE](LICENSE).
