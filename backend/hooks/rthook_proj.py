"""
Runtime hook — fix PROJ/GDAL data paths for frozen PyInstaller bundles.

When pyproj and rasterio are bundled, their data files land inside
sys._MEIPASS but the libraries still look for PROJ_DATA at the path
baked in at build time.  Setting these env vars before any import
of pyproj/rasterio ensures correct operation.
"""

import os
import sys

if getattr(sys, "frozen", False):
    _base = sys._MEIPASS  # type: ignore[attr-defined]

    # pyproj proj.db location
    _proj_data = os.path.join(_base, "pyproj", "proj_dir", "share", "proj")
    if os.path.isdir(_proj_data):
        os.environ.setdefault("PROJ_DATA", _proj_data)
        os.environ.setdefault("PROJ_LIB", _proj_data)

    # rasterio bundles its own GDAL data under rasterio/gdal_data/
    _gdal_data = os.path.join(_base, "rasterio", "gdal_data")
    if os.path.isdir(_gdal_data):
        os.environ.setdefault("GDAL_DATA", _gdal_data)

    # rasterio PROJ data (may differ from pyproj's copy)
    _rasterio_proj = os.path.join(_base, "rasterio", "proj_data")
    if os.path.isdir(_rasterio_proj):
        os.environ.setdefault("PROJ_DATA", _rasterio_proj)
        os.environ.setdefault("PROJ_LIB", _rasterio_proj)
