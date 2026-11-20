"""Beds are found from the furrows between them, even when the detected
block is too wide (a weedy border beside the trial)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402

import gemi_agent.tools  # noqa: E402,F401  (import order: tools before field_tools)
from gemi_agent.field_tools import fit_beds  # noqa: E402

m = 0.02                      # metres per pixel
pitch_m, beds = 2.07, 5
px = int(pitch_m / m)         # ~103 px per bed
start = 300
prof = np.zeros(1200)
rng = np.random.default_rng(0)
for k in range(beds):         # each bed: plants in its middle 70 %
    a = start + k * px
    prof[a + int(0.15 * px): a + int(0.85 * px)] = 0.8
prof[start + beds * px + 20: start + beds * px + 130] = 0.5   # weedy strip east of the trial
prof += rng.normal(0, 0.05, prof.size)
# The detected block takes in the weeds: 5 beds across it would be ~2.5 m each.
fit = fit_beds(prof, start, start + beds * px + 130, beds, m)
assert fit["method"] == "furrows", fit
assert abs(fit["pitch_px"] * m - pitch_m) < 0.15, fit["pitch_px"] * m
for k, e in enumerate(fit["edges"]):
    assert abs(e - (start + k * px)) < 0.15 * px, (k, e, start + k * px)
print("fit_beds ok", round(fit["pitch_px"] * m, 2), [int(e) for e in fit["edges"]])

# Closed canopy over a block of 7 beds (1.52 m, a border bed each side of
# the design's 5): no furrows inside the plots, but the bare ground at the
# field's ends shows them (ridges light, furrows dark).
from gemi_agent.field_tools import furrow_grid  # noqa: E402

mf = 0.012                                     # the finer overview's metres per pixel
k = m / mf
bed = 1.52
first = 4.0                                    # the block's west furrow, metres
soil = np.full(int(22 / mf), 0.6)
for j in range(-2, 12):
    c = int((first + j * bed) / mf)
    soil[max(0, c - 8): c + 8] = 0.35
soil += rng.normal(0, 0.05, soil.size)
soil[: int(1.0 / mf)] = np.nan                 # no bare ground at the image edge
g = furrow_grid(soil, mf)
assert g and abs(g["pitch_px"] * mf - bed) < 0.02, g
grid = {"pitch_px": g["pitch_px"] / k, "phase_px": g["phase_px"] / k}
u0, u1 = int(first / m) + 3, int((first + 7 * bed) / m) - 2     # block edges a little off the furrows
closed = np.zeros(int(22 / m))
closed[int(first / m): int((first + 7 * bed) / m)] = 0.9
fit = fit_beds(closed, u0, u1, 5, m, grid=grid)
assert fit["beds_in_block"] == 7 and fit["border_beds"] == [1, 1], fit
for j, e in enumerate(fit["edges"]):
    want = (first + (j + 1) * bed) / m
    assert abs(e - want) < 0.05 / m, (j, e, want)
print("field-end furrows ok", round(g["pitch_px"] * mf, 3), [round(e * m, 2) for e in fit["edges"]])

# Six planted beds, the east one thinner: one border bed, on the east.
six = np.zeros(int(22 / m))
six[int(first / m): int((first + 6 * bed) / m)] = 0.9
six[int((first + 5 * bed) / m): int((first + 6 * bed) / m)] = 0.6
fit = fit_beds(six, u0, int((first + 6 * bed) / m), 5, m, grid=grid)
assert fit["beds_in_block"] == 6 and fit["border_beds"] == [0, 1], fit
assert abs(fit["edges"][0] - first / m) < 0.05 / m, fit["edges"]
fit = fit_beds(six, u0, int((first + 6 * bed) / m), 5, m, grid=grid, border_beds=[1, 0])
assert abs(fit["edges"][0] - (first + bed) / m) < 0.05 / m, fit["edges"]
print("border beds ok")

# Spacing known from an earlier date, furrows not seen: design's beds in the block's middle.
fit = fit_beds(closed, u0, u1, 5, m, pitch_m=bed)
assert abs(fit["pitch_px"] * m - bed) < 1e-6 and fit["method"] == "known spacing"
assert abs((fit["edges"][0] + fit["edges"][-1]) / 2 - (u0 + u1) / 2) < 1
print("known spacing ok", [round(e * m, 2) for e in fit["edges"]])

# Border beds said to be on the west (the block's outer edge).
fit = fit_beds(closed, u0, u1, 5, m, grid=grid, border_side=0)
assert fit["border_beds"] == [2, 0] and abs(fit["edges"][-1] - (first + 7 * bed) / m) < 0.05 / m, fit
print("border side ok")
