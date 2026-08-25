"""
Entry point for the gemi-dji-thermal Docker container.

Runs one DJI Thermal SDK "measure" call against a mounted R-JPEG and writes
the resulting (height, width) float32 temperature array as a .npy file —
the container-side counterpart of the native ctypes path in
backend/app/processing/thermal_utils.py's _convert_dji_rjpeg_native(), used
on hosts (macOS) where DJI provides no native library to load directly.

Usage (inside container):
    python measure_rjpeg.py <rjpeg_path> <out_npy_path> <distance> <humidity> <emissivity> <reflected_temperature>

libdirp.so is expected bind-mounted read-only at /dji_sdk/libdirp.so (see
thermal_utils.py:_convert_dji_rjpeg_docker) — never baked into this image.

All paths are container-side (mounted from the host). Exits 0 on success,
1 on failure (error printed to stderr).
"""

import sys
from pathlib import Path

DJI_SDK_LIB_PATH = "/dji_sdk/libdirp.so"


def main() -> None:
    if len(sys.argv) != 7:
        print(
            "Usage: measure_rjpeg.py <rjpeg> <out_npy> <distance> <humidity> "
            "<emissivity> <reflected_temperature>",
            file=sys.stderr,
        )
        sys.exit(1)

    rjpeg_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    distance, humidity, emissivity, reflected_temperature = (float(a) for a in sys.argv[3:7])

    if not rjpeg_path.exists():
        print(f"Error: R-JPEG not found at {rjpeg_path}", file=sys.stderr)
        sys.exit(1)
    if not Path(DJI_SDK_LIB_PATH).exists():
        print(f"Error: libdirp.so not found at {DJI_SDK_LIB_PATH} (was it mounted?)", file=sys.stderr)
        sys.exit(1)

    import ctypes as CT

    import numpy as np
    from dji_thermal_sdk.dji_sdk import (
        DIRP_HANDLE,
        DIRP_SUCCESS,
        dirp_get_rjpeg_resolution,
        dirp_measure_ex,
        dirp_measurement_params_t,
        dirp_resolution_t,
        dirp_set_measurement_params,
        dji_init,
    )
    from dji_thermal_sdk.utility import getJPEGHandle

    try:
        dji_init(DJI_SDK_LIB_PATH)
    except Exception as exc:
        print(f"Error: failed to initialize DJI Thermal SDK: {exc}", file=sys.stderr)
        sys.exit(1)

    ret = getJPEGHandle(str(rjpeg_path))
    if ret != 0:
        print(f"Error: failed to open {rjpeg_path.name} (DJI SDK error {ret})", file=sys.stderr)
        sys.exit(1)

    sdk_params = dirp_measurement_params_t()
    sdk_params.distance = CT.c_float(distance)
    sdk_params.humidity = CT.c_float(humidity)
    sdk_params.emissivity = CT.c_float(emissivity)
    sdk_params.reflection = CT.c_float(reflected_temperature)

    ret = dirp_set_measurement_params(DIRP_HANDLE, CT.byref(sdk_params))
    if ret != DIRP_SUCCESS:
        print(f"Error: dirp_set_measurement_params failed (error {ret})", file=sys.stderr)
        sys.exit(1)

    resolution = dirp_resolution_t()
    dirp_get_rjpeg_resolution(DIRP_HANDLE, CT.byref(resolution))
    img_h, img_w = resolution.height, resolution.width

    size = img_h * img_w * CT.sizeof(CT.c_float)
    raw_buffer = CT.create_string_buffer(size)
    ret = dirp_measure_ex(DIRP_HANDLE, CT.byref(raw_buffer), size)
    if ret != DIRP_SUCCESS:
        print(f"Error: dirp_measure_ex failed (error {ret})", file=sys.stderr)
        sys.exit(1)

    arr = np.frombuffer(raw_buffer.raw, dtype=np.float32).reshape(img_h, img_w).copy()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    np.save(out_path, arr)


if __name__ == "__main__":
    main()
