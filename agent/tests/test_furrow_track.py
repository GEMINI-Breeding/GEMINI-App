"""Furrows found in the elevation model and followed when the beds are not
parallel to the image."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
from PIL import Image, TiffImagePlugin  # noqa: E402

import gemi_agent.tools  # noqa: E402,F401  (import order: tools before field_tools)
from gemi_agent.field_tools import furrow_track  # noqa: E402

mz, pitch, slant = 0.02, 1.52, 0.8          # DSM 2 cm/px; beds drift 0.8 m over the field
w, h = int(20 / mz), int(60 / mz)
x = np.arange(w) * mz
rng = np.random.default_rng(1)
z = np.zeros((h, w), dtype=np.float32)
first = 3.0                                   # a furrow at the top of the image, metres from the left
for i in range(h):
    off = first + slant * i / h
    ph = ((x - off) / pitch) % 1.0
    z[i] = 0.08 * np.minimum(ph, 1 - ph) * 2   # ridges 8 cm above the furrows
z += rng.normal(0, 0.01, z.shape).astype(np.float32)

info = TiffImagePlugin.ImageFileDirectory_v2()
info[33550] = (mz, mz, 0.0)
info[33922] = (0.0, 0.0, 0.0, 600000.0, 4266000.0, 0.0)
f = Path(tempfile.mkdtemp()) / "dsm.tif"
Image.fromarray(z).save(f, tiffinfo=info)


class FakeOrtho:                               # a 4 cm/px overview over the same ground
    zone, px_x, px_y, x0, y0 = 10, 0.04, 0.04, 600000.0, 4266000.0
    metres_per_px = 0.04


m = 0.04
wins = [(int(a / m), int((a + 0.8) / m), "alley") for a in np.arange(2, 58, 4)]
t = furrow_track(f, FakeOrtho(), True, wins, 2 / m, 18 / m)
assert t, t
assert abs(t["pitch_px"] * m - pitch) < 0.02, t
assert abs(t["slope"] * (h * mz / m) * m - slant) < 0.1, t
# A furrow at the top: phase + j*pitch near `first` (to within 5 cm)
d = ((t["phase_px"] * m - first) / pitch) % 1.0
assert min(d, 1 - d) * pitch < 0.05, t
print("furrow track ok", round(t["pitch_px"] * m, 3), round(t["slope"] * h * mz / m * m, 2), t["strength"])
