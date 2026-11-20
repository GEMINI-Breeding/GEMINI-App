"""The agent's copy of the GPS placement rules agrees with the worker's."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gemi_agent import placement  # noqa: E402

LAT0, LON0 = 33.9674, -117.3385
KX = 111_320 * math.cos(math.radians(LAT0))


def box(e, n, w=2.0, h=1.0):
    lon, lat = LON0 + e / KX, LAT0 + n / 111_320
    dx, dy = w / 2 / KX, h / 2 / 111_320
    return [[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy], [lon - dx, lat - dy]]


def m(pt):
    return ((pt[0] - LON0) * KX, (pt[1] - LAT0) * 111_320)


_, c = placement.apply({"1": box(-5, 0), "2": box(5, 0)},
                       {"beds": {"a": {"rotate_deg": 90}}, "plot_bed": {"1": "a", "2": "a"}})
assert abs(m(c["1"])[1] - 5) < 1e-3 and abs(m(c["2"])[1] + 5) < 1e-3
_, c = placement.apply({"1": box(0, 0)}, {"shift_m": [1, 2]})
assert abs(m(c["1"])[0] - 1) < 1e-3 and abs(m(c["1"])[1] - 2) < 1e-3
print("placement ok")

# A serpentine turn starts a new pass even when the direction stays the same.
serp = {str(i + 1): {"footprint": box(e, n), "stitching_direction": "DOWN"}
        for i, (e, n) in enumerate([(0, 0), (0, 4), (0, 8), (1.5, 8), (1.5, 4), (1.5, 0)])}
assert list(placement.beds_of(serp).values()) == ["pass 1"] * 3 + ["pass 2"] * 3, placement.beds_of(serp)
print("beds ok")
