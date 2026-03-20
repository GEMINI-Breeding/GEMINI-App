"""
Runtime hook — fix PROJ/GDAL data paths for frozen PyInstaller bundles.

When pyproj and rasterio are bundled, their data files land inside
sys._MEIPASS but the libraries still look for PROJ_DATA at the path
baked in at build time.  Setting these env vars before any import
of pyproj/rasterio ensures correct operation.

Priority: rasterio's bundled proj_data > pyproj's proj_dir.
Rasterio ships its own PROJ C library so its proj.db must match —
pyproj's proj.db can be an older version that causes MINOR version
mismatch warnings and failures.
"""

import os
import sys

if getattr(sys, "frozen", False):
    _base = sys._MEIPASS  # type: ignore[attr-defined]

    # rasterio bundles its own GDAL data under rasterio/gdal_data/
    _gdal_data = os.path.join(_base, "rasterio", "gdal_data")
    if os.path.isdir(_gdal_data):
        os.environ["GDAL_DATA"] = _gdal_data

    # rasterio PROJ data — must match rasterio's bundled PROJ C library.
    # Prefer this over pyproj's copy to avoid proj.db version mismatches.
    _rasterio_proj = os.path.join(_base, "rasterio", "proj_data")
    if os.path.isdir(_rasterio_proj):
        os.environ["PROJ_DATA"] = _rasterio_proj
        os.environ["PROJ_LIB"] = _rasterio_proj
    else:
        # Fallback: pyproj proj.db (may be an older format version)
        _proj_data = os.path.join(_base, "pyproj", "proj_dir", "share", "proj")
        if os.path.isdir(_proj_data):
            os.environ["PROJ_DATA"] = _proj_data
            os.environ["PROJ_LIB"] = _proj_data
