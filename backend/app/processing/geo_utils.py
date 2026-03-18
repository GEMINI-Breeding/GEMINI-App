"""
Georeferencing helper functions for ground-pipeline stitched plot images.

Ported from the old Flask app's stitch_utils.py.  Uses rasterio + pyproj;
no GDAL/osgeo dependency.

Public API
----------
georeference_plot(plot_index, plot_data, out_dir) → bool
combine_utm_tiffs_to_mosaic(out_dir, plot_ids) → bool
build_plot_boundaries_geojson(out_dir, plot_ids, plot_borders_csv) → Path | None
"""

from __future__ import annotations

import math
import shutil
import traceback
import logging
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageFile

logger = logging.getLogger(__name__)

# ── Coordinate helpers ────────────────────────────────────────────────────────

def pick_utm_epsg(lon: float, lat: float) -> int:
    zone = int((lon + 180) // 6) + 1
    return (32700 if lat < 0 else 32600) + zone


def fit_angle_pca(x: np.ndarray, y: np.ndarray) -> float:
    pts = np.column_stack([x, y]) - np.column_stack([x, y]).mean(axis=0)
    _, _, v = np.linalg.svd(pts, full_matrices=False)
    vx, vy = v[0]
    return math.atan2(vy, vx)


def compute_axes_extents(
    xs: np.ndarray,
    ys: np.ndarray,
    theta: float,
    buffer_frac: float = 0.05,
) -> tuple[float, float, float, float, float, float]:
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    u_vec = np.array([cos_t, sin_t])
    v_vec = np.array([-sin_t, cos_t])

    cx, cy = xs.mean(), ys.mean()
    pts = np.column_stack([xs - cx, ys - cy])
    u_proj = pts @ u_vec
    v_proj = pts @ v_vec

    u_min, u_max = u_proj.min(), u_proj.max()
    v_min, v_max = v_proj.min(), v_proj.max()
    u_len = u_max - u_min
    v_len = v_max - v_min
    u_min -= u_len * buffer_frac * 0.5
    u_max += u_len * buffer_frac * 0.5
    v_min -= v_len * buffer_frac * 0.5
    v_max += v_len * buffer_frac * 0.5

    return u_min, u_max, v_min, v_max, u_max - u_min, v_max - v_min


def build_rotated_affine(
    u_min: float, v_max: float,
    width_m: float, height_m: float,
    theta: float, px: float, py: float,
    gps_cx: float, gps_cy: float,
) -> Any:  # rasterio.Affine
    from rasterio.transform import Affine

    tc = theta + math.pi
    cos_t, sin_t = math.cos(tc), math.sin(tc)

    x_offset = u_min * cos_t + v_max * (-sin_t)
    y_offset = u_min * sin_t + v_max * cos_t

    c = gps_cx + x_offset
    f = gps_cy + y_offset

    a = px * cos_t
    d = px * sin_t
    b = py * sin_t
    e = -py * cos_t

    return Affine(a, b, c, d, e, f)


def determine_stitch_direction(xs: np.ndarray, ys: np.ndarray) -> str:
    dx, dy = xs[-1] - xs[0], ys[-1] - ys[0]
    if abs(dx) > abs(dy):
        return "RIGHT" if dx > 0 else "LEFT"
    return "UP" if dy > 0 else "DOWN"


def estimate_cross_track(
    xs: np.ndarray,
    ys: np.ndarray,
    theta: float,
    h_pixels: int,
    px_along: float,
    fixed_min: float = 1.0,
) -> tuple[float, float, float]:
    """Return (height_m_axis, v_min_centered, v_max_centered) for a fixed cross-track strategy."""
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    v_vec = np.array([-sin_t, cos_t])
    cx, cy = xs.mean(), ys.mean()
    v_vals = np.column_stack([xs - cx, ys - cy]) @ v_vec
    v_min, v_max = v_vals.min(), v_vals.max()
    height_gps = v_max - v_min
    height_need = max(height_gps, fixed_min)
    if height_need > height_gps:
        v_center = 0.5 * (v_min + v_max)
        v_min = v_center - height_need / 2.0
        v_max = v_center + height_need / 2.0
    return height_need, v_min, v_max


# ── Per-plot georeferencing ────────────────────────────────────────────────────

DIRECTION_MAP = {
    "down":  "DOWN",
    "up":    "UP",
    "left":  "LEFT",
    "right": "RIGHT",
    # legacy values from older saves
    "north_to_south": "DOWN",
    "south_to_north": "UP",
    "east_to_west":   "LEFT",
    "west_to_east":   "RIGHT",
}


def georeference_plot(
    plot_index: int | str,
    plot_data: Any,            # pandas DataFrame with lat/lon columns
    out_dir: Path,
    ui_direction: str = "down",
) -> bool:
    """
    Georeference the stitched mosaic for one plot using GPS data.

    Reads:
        out_dir/full_res_mosaic_temp_plot_{plot_index}.png
        (or AgRowStitch_plot-id-{plot_index}.png)

    Writes:
        out_dir/georeferenced_plot_{plot_index}_utm.tif

    Returns True on success.
    """
    import pandas as pd
    import rasterio
    from rasterio.crs import CRS
    from pyproj import Transformer

    ImageFile.LOAD_TRUNCATED_IMAGES = True
    Image.MAX_IMAGE_PIXELS = None

    # Find mosaic file
    candidates = [
        out_dir / f"full_res_mosaic_temp_plot_{plot_index}.png",
        out_dir / f"full_res_mosaic_temp_plot_{plot_index}.tif",
        out_dir / f"AgRowStitch_plot-id-{plot_index}.png",
        out_dir / f"AgRowStitch_plot-id-{plot_index}.tif",
    ]
    src_file = next((p for p in candidates if p.exists()), None)
    if src_file is None:
        logger.warning("[Plot %s] No mosaic found in %s", plot_index, out_dir)
        return False

    # GPS
    rgb_col = "/top/rgb_file" if "/top/rgb_file" in plot_data.columns else None
    df = (plot_data.sort_values(rgb_col) if rgb_col else plot_data.sort_index())

    lats = df["lat"].dropna().to_numpy()
    lons = df["lon"].dropna().to_numpy()
    if lats.size < 2:
        logger.warning("[Plot %s] Not enough GPS points (%d)", plot_index, lats.size)
        return False

    # UTM projection
    center_lat = (lats.min() + lats.max()) / 2.0
    center_lon = (lons.min() + lons.max()) / 2.0
    utm_epsg = pick_utm_epsg(center_lon, center_lat)
    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{utm_epsg}", always_xy=True)
    xs, ys = transformer.transform(lons, lats)

    # Load mosaic
    with Image.open(src_file) as im:
        if im.mode != "RGB":
            im = im.convert("RGB")
        img_array = np.array(im)
    h, w = img_array.shape[:2]

    # PCA heading
    theta = fit_angle_pca(xs, ys)
    # Ensure left→right ordering
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    if (cos_t * xs[-1] + sin_t * ys[-1]) < (cos_t * xs[0] + sin_t * ys[0]):
        theta += math.pi

    # Along-track extent (use direct GPS distance for robustness)
    direct_dist = float(np.sqrt((xs[-1] - xs[0]) ** 2 + (ys[-1] - ys[0]) ** 2))
    width_m = max(direct_dist, 0.5)

    u_min, u_max, v_min, v_max, _, _ = compute_axes_extents(xs, ys, theta, buffer_frac=0.0)
    gps_cx, gps_cy = xs.mean(), ys.mean()

    # Scale u extents to corrected width
    u_center = (u_min + u_max) / 2.0
    u_min = u_center - width_m / 2.0
    u_max = u_center + width_m / 2.0

    px_along = width_m / w
    height_m, v_min, v_max = estimate_cross_track(xs, ys, theta, h, px_along, fixed_min=1.0)

    px = width_m / w
    py = height_m / h

    transform = build_rotated_affine(u_min, v_max, width_m, height_m, theta, px, py, gps_cx, gps_cy)

    utm_out = out_dir / f"georeferenced_plot_{plot_index}_utm.tif"
    with rasterio.open(
        str(utm_out), "w",
        driver="GTiff",
        height=h, width=w,
        count=3,
        dtype=img_array.dtype,
        crs=CRS.from_epsg(utm_epsg),
        transform=transform,
        compress="lzw",
        tiled=True, blockxsize=512, blockysize=512,
    ) as dst:
        for i in range(3):
            dst.write(img_array[:, :, i], i + 1)

    logger.info("[Plot %s] Wrote %s", plot_index, utm_out.name)
    return True


# ── Mosaic combining ──────────────────────────────────────────────────────────

def combine_utm_tiffs_to_mosaic(out_dir: Path, plot_ids: list) -> bool:
    """
    Merge per-plot UTM GeoTIFFs into a single combined mosaic (UTM + WGS84).

    Writes:
        out_dir/combined_mosaic_utm.tif
        out_dir/combined_mosaic.tif  (WGS84)
    """
    import rasterio
    from rasterio.crs import CRS
    from rasterio.warp import reproject, calculate_default_transform, Resampling

    utm_files = [
        str(out_dir / f"georeferenced_plot_{pid}_utm.tif")
        for pid in plot_ids
        if (out_dir / f"georeferenced_plot_{pid}_utm.tif").exists()
    ]
    if not utm_files:
        logger.warning("No UTM files found; skipping mosaic.")
        return False

    combined_utm = str(out_dir / "combined_mosaic_utm.tif")

    if len(utm_files) == 1:
        shutil.copy2(utm_files[0], combined_utm)
    else:
        srcs = [rasterio.open(f) for f in utm_files]
        try:
            bounds_list = [s.bounds for s in srcs]
            min_x = min(b[0] for b in bounds_list)
            min_y = min(b[1] for b in bounds_list)
            max_x = max(b[2] for b in bounds_list)
            max_y = max(b[3] for b in bounds_list)

            pixel_sizes = []
            for s in srcs:
                ps_x = abs(s.transform.a) if abs(s.transform.a) > 1e-10 else (max_x - min_x) / s.width
                ps_y = abs(s.transform.e) if abs(s.transform.e) > 1e-10 else (max_y - min_y) / s.height
                pixel_sizes.append(min(ps_x, ps_y))

            output_px = min(pixel_sizes)
            out_w = int((max_x - min_x) / output_px)
            out_h = int((max_y - min_y) / output_px)

            # Safety cap at 5000 px per dimension
            if out_w > 5000 or out_h > 5000:
                output_px = max((max_x - min_x) / 5000, (max_y - min_y) / 5000)
                out_w = int((max_x - min_x) / output_px)
                out_h = int((max_y - min_y) / output_px)

            out_transform = rasterio.transform.from_bounds(min_x, min_y, max_x, max_y, out_w, out_h)
            mosaic = np.full((3, out_h, out_w), 255, dtype=np.uint8)

            for src in srcs:
                tmp = np.full((3, out_h, out_w), 255, dtype=np.uint8)
                for band in range(3):
                    reproject(
                        source=rasterio.band(src, band + 1),
                        destination=tmp[band],
                        src_transform=src.transform,
                        src_crs=src.crs,
                        dst_transform=out_transform,
                        dst_crs=src.crs,
                        resampling=Resampling.bilinear,
                        dst_nodata=0,
                    )
                for band in range(3):
                    mask = tmp[band] != 0
                    mosaic[band][mask] = tmp[band][mask]

            meta = srcs[0].meta.copy()
            meta.update(driver="GTiff", height=out_h, width=out_w,
                        transform=out_transform, crs=srcs[0].crs,
                        compress="lzw", tiled=True, blockxsize=512,
                        blockysize=512, count=3, dtype="uint8")
            with rasterio.open(combined_utm, "w", **meta) as dst:
                dst.write(mosaic)
        except Exception:
            logger.error("Mosaic creation failed:\n%s", traceback.format_exc())
            return False
        finally:
            for s in srcs:
                s.close()

    # Reproject to WGS84
    combined_wgs84 = str(out_dir / "combined_mosaic.tif")
    try:
        with rasterio.open(combined_utm) as src:
            dst_crs = CRS.from_epsg(4326)
            transform, w, h = calculate_default_transform(
                src.crs, dst_crs, src.width, src.height, *src.bounds
            )
            meta = src.meta.copy()
            meta.update(crs=dst_crs, transform=transform, width=w, height=h)
            with rasterio.open(combined_wgs84, "w", **meta) as dst:
                for i in range(1, src.count + 1):
                    reproject(
                        source=rasterio.band(src, i),
                        destination=rasterio.band(dst, i),
                        src_transform=src.transform,
                        src_crs=src.crs,
                        dst_transform=transform,
                        dst_crs=dst_crs,
                        resampling=Resampling.bilinear,
                    )
    except Exception:
        logger.error("WGS84 reproject failed:\n%s", traceback.format_exc())
        return False

    logger.info("Combined mosaic written: %s", combined_wgs84)
    return True


# ── Plot boundaries GeoJSON ───────────────────────────────────────────────────

def build_plot_boundaries_geojson(
    out_dir: Path,
    plot_ids: list,
    plot_borders_csv: Path | None = None,
) -> Path | None:
    """
    Build a WGS84 GeoJSON FeatureCollection from the footprints of georeferenced
    plot TIFs.  Each feature is the actual (potentially rotated) plot polygon with
    properties from plot_borders.csv (plot_id, plot label, accession).

    Writes:
        out_dir/plot_boundaries.geojson

    Returns the path on success, None on failure.
    """
    import json
    import rasterio
    from pyproj import Transformer

    # Load plot metadata from plot_borders.csv if present.
    # The CSV may have columns: plot_id, Plot, Accession (and others).
    # We use whatever is available — missing columns are simply omitted.
    plot_meta: dict[str, dict] = {}
    if plot_borders_csv and plot_borders_csv.exists():
        try:
            import csv as _csv
            with open(plot_borders_csv, newline="") as f:
                reader = _csv.DictReader(f)
                for row in reader:
                    pid = str(row.get("plot_id", "")).strip()
                    if pid:
                        plot_meta[pid] = {
                            "plot":      row.get("Plot") or row.get("plot") or None,
                            "accession": row.get("Accession") or row.get("accession") or None,
                        }
        except Exception:
            logger.warning("Could not read plot_borders.csv — boundaries will have plot_id only")

    features = []
    for pid in plot_ids:
        utm_tif = out_dir / f"georeferenced_plot_{pid}_utm.tif"
        if not utm_tif.exists():
            logger.warning("[Plot %s] UTM TIF not found, skipping boundary", pid)
            continue

        try:
            with rasterio.open(str(utm_tif)) as src:
                w, h = src.width, src.height
                t = src.transform
                utm_epsg = src.crs.to_epsg()

                # Extract the 4 corner coordinates using the affine transform.
                # This captures rotated plots correctly (not just axis-aligned bounds).
                corners_utm = [
                    t * (0, 0),
                    t * (w, 0),
                    t * (w, h),
                    t * (0, h),
                ]

            transformer = Transformer.from_crs(
                f"EPSG:{utm_epsg}", "EPSG:4326", always_xy=True
            )
            # always_xy=True → transform returns (lon, lat)
            corners_wgs84 = [
                list(transformer.transform(x, y)) for x, y in corners_utm
            ]
            # Close the ring
            corners_wgs84.append(corners_wgs84[0])

            meta = plot_meta.get(str(pid), {})
            properties: dict = {"plot_id": pid}
            if meta.get("plot"):
                properties["plot"] = meta["plot"]
            if meta.get("accession"):
                properties["accession"] = meta["accession"]

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [corners_wgs84],
                },
                "properties": properties,
            })

        except Exception:
            logger.warning("[Plot %s] Failed to build boundary polygon:\n%s", pid, traceback.format_exc())

    if not features:
        logger.warning("No plot boundary features built — skipping GeoJSON write")
        return None

    geojson_path = out_dir / "plot_boundaries.geojson"
    with open(geojson_path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)

    logger.info("Wrote plot_boundaries.geojson with %d plots → %s", len(features), geojson_path)
    return geojson_path
