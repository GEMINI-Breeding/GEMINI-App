"""
GPS placement of stitched ground plots (a copy of the stitch worker's
gemini/workers/stitch/corrections.py; the agent does not import the backend,
and the app has the same rules in lib/gpsCorrections.ts). Set on the Plot
Boundary map, or with the gps_placement tool, when the rover's GPS is off: the whole track shifted, and per
bed (one pass of the rover, one lane of it when a frame shows several
plots) straightened onto a line, rotated, and shifted.

Pure geometry on (lon, lat) rings, in metres on a local flat frame, so it
is testable without raster libraries. The app applies the same rules to
draw the corrected footprints (frontend lib/gpsCorrections.ts).

corrections = {
  "shift_m": [east, north],                      # everything
  "beds": {bed: {"shift_m": [e, n], "rotate_deg": d, "straighten": bool}},
  "plot_bed": {stitched plot id: bed},           # which bed each plot is in
}
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

Point = Tuple[float, float]  # (lon, lat)
Ring = List[List[float]]

M_PER_DEG_LAT = 111_320.0


class _Frame:
    """Local metres around a reference point (equirectangular)."""

    def __init__(self, lon0: float, lat0: float):
        self.lon0, self.lat0 = lon0, lat0
        self.kx = M_PER_DEG_LAT * math.cos(math.radians(lat0))

    def to_m(self, lon: float, lat: float) -> Tuple[float, float]:
        return (lon - self.lon0) * self.kx, (lat - self.lat0) * M_PER_DEG_LAT

    def to_deg(self, x: float, y: float) -> Tuple[float, float]:
        return self.lon0 + x / self.kx, self.lat0 + y / M_PER_DEG_LAT


def _centre(ring: Sequence[Sequence[float]]) -> Tuple[float, float]:
    pts = list(ring[:-1]) if len(ring) > 1 and list(ring[0]) == list(ring[-1]) else list(ring)
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def _line_fit(points: List[Tuple[float, float]]):
    """Centroid and unit direction of the best-fit line (principal axis)."""
    n = len(points)
    cx = sum(p[0] for p in points) / n
    cy = sum(p[1] for p in points) / n
    sxx = sum((p[0] - cx) ** 2 for p in points)
    syy = sum((p[1] - cy) ** 2 for p in points)
    sxy = sum((p[0] - cx) * (p[1] - cy) for p in points)
    angle = 0.5 * math.atan2(2 * sxy, sxx - syy)
    return (cx, cy), (math.cos(angle), math.sin(angle))


def apply(
    footprints: Dict[str, Ring], corrections: Optional[dict]
) -> Tuple[Dict[str, Ring], Dict[str, Point]]:
    """Corrected footprints and their centres, {plot id: …}."""
    if not footprints:
        return {}, {}
    if not corrections:
        return (
            {k: [list(p) for p in r] for k, r in footprints.items()},
            {k: _centre(r) for k, r in footprints.items()},
        )
    first = next(iter(footprints.values()))
    frame = _Frame(*_centre(first))
    rings = {k: [list(frame.to_m(*p[:2])) for p in r] for k, r in footprints.items()}

    plot_bed: Dict[str, str] = {str(k): str(v) for k, v in (corrections.get("plot_bed") or {}).items()}
    beds: Dict[str, List[str]] = {}
    for pid in rings:
        if pid in plot_bed:
            beds.setdefault(plot_bed[pid], []).append(pid)

    for bed, pids in beds.items():
        spec = (corrections.get("beds") or {}).get(bed) or {}
        centres = {pid: _centre(rings[pid]) for pid in pids}
        if spec.get("straighten") and len(pids) >= 2:
            (cx, cy), (ux, uy) = _line_fit(list(centres.values()))
            for pid in pids:
                px, py = centres[pid]
                along = (px - cx) * ux + (py - cy) * uy
                tx, ty = cx + along * ux - px, cy + along * uy - py
                rings[pid] = [[x + tx, y + ty] for x, y in rings[pid]]
                centres[pid] = (px + tx, py + ty)
        rot = math.radians(float(spec.get("rotate_deg") or 0.0))
        if rot:
            bx = sum(c[0] for c in centres.values()) / len(centres)
            by = sum(c[1] for c in centres.values()) / len(centres)
            cos_r, sin_r = math.cos(rot), math.sin(rot)
            for pid in pids:
                # Positive degrees turn the bed clockwise, as on a compass.
                rings[pid] = [
                    [bx + (x - bx) * cos_r + (y - by) * sin_r,
                     by - (x - bx) * sin_r + (y - by) * cos_r]
                    for x, y in rings[pid]
                ]
        dx, dy = (spec.get("shift_m") or [0.0, 0.0])[:2]
        if dx or dy:
            for pid in pids:
                rings[pid] = [[x + float(dx), y + float(dy)] for x, y in rings[pid]]

    gx, gy = (corrections.get("shift_m") or [0.0, 0.0])[:2]
    out: Dict[str, Ring] = {}
    for pid, ring in rings.items():
        out[pid] = [list(frame.to_deg(x + float(gx), y + float(gy))) for x, y in ring]
    return out, {k: _centre(r) for k, r in out.items()}


def beds_of(manifest_plots: Dict[str, dict]) -> Dict[str, str]:
    """{stitched plot id: bed}: one bed per lane per rover pass, named as the
    app names them ("lane 1 · pass 2", or "pass 2" with one plot per frame).
    Plots are walked in marked order; a new pass starts where the stitching
    direction changes or the rover's travel turns by more than 60° (the same
    rule as the app's lib/gpsCorrections.bedsOf)."""
    def num(pid: str) -> float:
        try:
            return float(pid)
        except ValueError:
            return float("inf")

    plots = []
    for pid, info in manifest_plots.items():
        lanes = int(info.get("lanes") or 1)
        plots.append((pid, int(info.get("lane") or 1), lanes,
                      str(info.get("stitching_direction") or ""), info.get("footprint") or []))
    plots.sort(key=lambda p: (math.ceil(num(p[0]) / p[2]), p[1]))
    first = plots[0][4][0] if plots and plots[0][4] else [0.0, 0.0]
    lon0, lat0 = first[0], first[1]
    kx = M_PER_DEG_LAT * math.cos(math.radians(lat0))
    stretches = []  # (stretch, direction, x, y)
    for pid, lane, lanes, direction, ring in plots:
        st = math.ceil(num(pid) / lanes)
        if stretches and stretches[-1][0] == st:
            continue
        pts = ring[:-1] if len(ring) > 1 else ring
        if not pts:
            continue
        lon = sum(p[0] for p in pts) / len(pts)
        lat = sum(p[1] for p in pts) / len(pts)
        stretches.append((st, direction, (lon - lon0) * kx, (lat - lat0) * M_PER_DEG_LAT))
    pass_of: Dict[float, int] = {}
    n, heading = 1, None
    for i, (st, direction, x, y) in enumerate(stretches):
        if i:
            _, pdir, px, py = stretches[i - 1]
            dx, dy = x - px, y - py
            length = math.hypot(dx, dy)
            step = (dx / length, dy / length) if length else None
            turned = bool(heading and step and heading[0] * step[0] + heading[1] * step[1] < math.cos(math.pi / 3))
            if direction != pdir or turned:
                n, heading = n + 1, None
            elif heading is None and step:
                heading = step
        pass_of[st] = n
    out: Dict[str, str] = {}
    for pid, lane, lanes, _, _ in plots:
        k = pass_of.get(math.ceil(num(pid) / lanes), 1)
        out[pid] = f"lane {lane} · pass {k}" if lanes > 1 else f"pass {k}"
    return out


def directory(stitch_prefix: str) -> str:
    """Where a stitch version's placement versions are kept (as the app)."""
    return stitch_prefix.rstrip("/") + "/gps-corrections"
