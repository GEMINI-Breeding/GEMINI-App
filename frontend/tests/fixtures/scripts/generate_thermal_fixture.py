"""Generate ortho/e2e_test_thermal.tif — a thermal orthomosaic covering the
same UTM footprint as ortho/e2e_test_orthophoto.tif, ~20x coarser, holding a
constant 27.5 °C. A constant makes the expected canopy temperature exact for
any plot with vegetation, which is what the canopy-temperature E2E asserts.

Needs rasterio (the ML worker image has it):
    python generate_thermal_fixture.py ../ortho/e2e_test_orthophoto.tif ../ortho/e2e_test_thermal.tif
"""
import sys

import numpy as np
import rasterio
from rasterio.transform import from_bounds

src_path, out_path = sys.argv[1], sys.argv[2]
with rasterio.open(src_path) as s:
    bounds, crs = s.bounds, s.crs
w, h = 56, 68
with rasterio.open(
    out_path, "w", driver="GTiff", width=w, height=h, count=1,
    dtype="float32", crs=crs, transform=from_bounds(*bounds, w, h),
    nodata=-9999.0,
) as d:
    d.write(np.full((1, h, w), 27.5, np.float32))
