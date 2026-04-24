"""
Utilities for splitting composite multispectral images into per-band images.

Each frame captured by a multispectral camera is a single image containing
all spectral bands arranged in a grid (e.g. 4×1 horizontal strip or 2×2 grid).
These utilities crop and optionally transform each band cell.

# FUTURE: support native multi-band GeoTIFF (separate channels per band).
# When `image_path` is a multi-band GeoTIFF, each TIFF band would map to one
# spectral channel; no spatial cropping needed — read via rasterio instead of
# PIL and return each band as a greyscale image.
"""

import base64
import io
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}


def is_image(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_EXTENSIONS


def apply_transform(
    img: Image.Image,
    flip_h: bool,
    flip_v: bool,
    rotate_deg: int,
) -> Image.Image:
    if flip_h:
        img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if flip_v:
        img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    if rotate_deg == 90:
        img = img.transpose(Image.Transpose.ROTATE_90)
    elif rotate_deg == 180:
        img = img.transpose(Image.Transpose.ROTATE_180)
    elif rotate_deg == 270:
        img = img.transpose(Image.Transpose.ROTATE_270)
    return img


def split_bands(
    image_path: Path,
    layout_cols: int,
    layout_rows: int,
    bands: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], Image.Image]]:
    """
    Split a composite image into individual band images.

    Bands are indexed in row-major order: index 0 is top-left, index 1 is the
    next cell to the right, wrapping to the next row.

    Returns list of (band_config, PIL Image) sorted by band index.
    """
    img = Image.open(image_path)
    w, h = img.size
    band_w = w // layout_cols
    band_h = h // layout_rows

    result: list[tuple[dict[str, Any], Image.Image]] = []
    for band in sorted(bands, key=lambda b: b["index"]):
        idx = int(band["index"])
        col = idx % layout_cols
        row = idx // layout_cols
        left = col * band_w
        top = row * band_h
        right = min(left + band_w, w)
        bottom = min(top + band_h, h)
        crop = img.crop((left, top, right, bottom))
        crop = apply_transform(
            crop,
            bool(band.get("flip_h")),
            bool(band.get("flip_v")),
            int(band.get("rotate_deg", 0)),
        )
        result.append((band, crop))
    return result


def image_to_base64(img: Image.Image, fmt: str = "JPEG") -> str:
    buf = io.BytesIO()
    if img.mode in ("RGBA", "LA", "P"):
        img.save(buf, format="PNG")
    elif fmt == "JPEG":
        img.convert("RGB").save(buf, format="JPEG", quality=85)
    else:
        img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# ── Timestamp extraction ──────────────────────────────────────────────────────

# Matches a run of 10–16 digits not surrounded by other digits.
# Covers Unix seconds (10), milliseconds (13), microseconds (16).
UNIX_EPOCH_RE = re.compile(r"(?<!\d)(\d{10,16})(?!\d)")

# Named strptime format strings for common camera filename conventions
NAMED_FORMATS: dict[str, str] = {
    "YYYYMMDD_HHMMSSffffff": "%Y%m%d_%H%M%S%f",
    "YYYYMMDD_HHMMSS": "%Y%m%d_%H%M%S",
    "YYYYMMDD": "%Y%m%d",
    "YYYY-MM-DD": "%Y-%m-%d",
    "YYYY-MM-DDTHH:MM:SS": "%Y-%m-%dT%H:%M:%S",
}


def extract_timestamp_from_filename(filename: str, fmt: str) -> datetime | None:
    stem = Path(filename).stem
    if fmt == "unix_epoch":
        m = UNIX_EPOCH_RE.search(stem)
        if not m:
            return None
        digits = m.group(1)
        n = len(digits)
        v = int(digits)
        if n <= 10:
            return datetime.utcfromtimestamp(v)
        elif n <= 13:
            return datetime.utcfromtimestamp(v / 1_000)
        else:
            return datetime.utcfromtimestamp(v / 1_000_000)

    strptime_fmt = NAMED_FORMATS.get(fmt, fmt)
    # Try exact stem match first
    try:
        return datetime.strptime(stem, strptime_fmt)
    except ValueError:
        pass
    # Scan substrings of the expected length
    example_len = len(datetime(2024, 1, 1, 12, 0, 0).strftime(strptime_fmt))
    for start in range(len(stem) - example_len + 1):
        try:
            return datetime.strptime(stem[start : start + example_len], strptime_fmt)
        except ValueError:
            continue
    return None


_EXIF_DT_TAGS = (36867, 306, 36868)  # DateTimeOriginal, DateTime, DateTimeDigitized
_EXIF_DT_FMT  = "%Y:%m:%d %H:%M:%S"


def _parse_exif_dt(val: object) -> datetime | None:
    if isinstance(val, (list, tuple)):
        val = val[0]
    try:
        return datetime.strptime(str(val).strip(), _EXIF_DT_FMT)
    except (ValueError, TypeError):
        return None


def extract_timestamp_from_exif(image_path: Path) -> datetime | None:
    """
    Extract a datetime from image metadata, trying multiple mechanisms in order:

    1. Pillow's modern ``getexif()`` API — works for both JPEG and TIFF.
    2. TIFF IFD v2 tags (``img.tag_v2``) — direct IFD access for TIFF files
       whose EXIF sub-IFD is not exposed by ``getexif()``.
    3. Legacy ``_getexif()`` — JPEG-only fallback for older Pillow builds.
    4. Filesystem creation time (``st_birthtime`` on macOS / ``st_ctime``
       elsewhere) — last resort when no metadata timestamp is available.
       Note: filesystem timestamps are reset on copy; use only when the files
       have not been moved since capture.
    """
    try:
        img = Image.open(image_path)

        # ── 1. Modern Pillow API (JPEG + TIFF) ───────────────────────────────
        try:
            exif = img.getexif()
            if exif:
                for tag_id in _EXIF_DT_TAGS:
                    dt = _parse_exif_dt(exif.get(tag_id))
                    if dt:
                        return dt
        except Exception:
            pass

        # ── 2. TIFF IFD v2 direct tag access ─────────────────────────────────
        tag_v2 = getattr(img, "tag_v2", None)
        if tag_v2:
            for tag_id in _EXIF_DT_TAGS:
                dt = _parse_exif_dt(tag_v2.get(tag_id))
                if dt:
                    return dt

        # ── 3. Legacy JPEG-only _getexif() ───────────────────────────────────
        try:
            legacy = getattr(img, "_getexif", lambda: None)()
            if legacy:
                for tag_id in _EXIF_DT_TAGS:
                    dt = _parse_exif_dt(legacy.get(tag_id))
                    if dt:
                        return dt
        except Exception:
            pass

    except Exception:
        pass

    # ── 4. Filesystem creation / modification time (fallback) ─────────────────
    # macOS exposes true birthtime via st_birthtime; other platforms fall back
    # to st_mtime.  This is a best-effort fallback — only accurate if the file
    # has not been copied since original capture.
    try:
        stat = os.stat(image_path)
        ts = getattr(stat, "st_birthtime", None) or stat.st_mtime
        return datetime.utcfromtimestamp(ts)
    except Exception:
        pass

    return None


def detect_timestamp_method(image_path: Path) -> str | None:
    """
    Return the name of the first timestamp extraction method that succeeds
    for the given image, without returning the datetime itself.

    Returns one of: "exif_tag", "tiff_ifd", "legacy_exif", "filesystem", or None.
    Useful for surfacing to the UI which fallback was used.
    """
    try:
        img = Image.open(image_path)
        try:
            exif = img.getexif()
            if exif and any(_parse_exif_dt(exif.get(t)) for t in _EXIF_DT_TAGS):
                return "exif_tag"
        except Exception:
            pass
        tag_v2 = getattr(img, "tag_v2", None)
        if tag_v2 and any(_parse_exif_dt(tag_v2.get(t)) for t in _EXIF_DT_TAGS):
            return "tiff_ifd"
        try:
            legacy = getattr(img, "_getexif", lambda: None)()
            if legacy and any(_parse_exif_dt(legacy.get(t)) for t in _EXIF_DT_TAGS):
                return "legacy_exif"
        except Exception:
            pass
    except Exception:
        pass
    try:
        os.stat(image_path)
        return "filesystem"
    except Exception:
        pass
    return None


def extract_timestamp(
    image_path: Path,
    source: str,
    fmt: str | None,
) -> datetime | None:
    if source == "exif":
        return extract_timestamp_from_exif(image_path)
    if source == "filename" and fmt:
        return extract_timestamp_from_filename(image_path.name, fmt)
    return None
