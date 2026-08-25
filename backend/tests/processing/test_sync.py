"""
Tests for backend/app/processing/sync.py's raw-thermal-image handling.

DJI thermal uploads land _T.JPG (raw radiometric capture) and _V.JPG
(paired RGB) in the same Raw/.../Images/ directory (see Guided Upload's
DJI thermal flow). _build_msgs_synced() must skip the _T.JPG files: they
aren't visible-light photos, their location is already covered by the
paired _V.JPG, and _extract_exif() can re-save a file in place (EXIF-
orientation fix) — doing that to a raw R-JPEG would destroy the
proprietary radiometric payload the DJI SDK needs for conversion.
"""

from pathlib import Path

from PIL import Image

from app.processing.sync import _build_msgs_synced


def _write_jpeg(path: Path, size: tuple[int, int] = (64, 48)) -> None:
    Image.new("RGB", size, color=(100, 150, 200)).save(path, "JPEG")


def test_build_msgs_synced_skips_raw_thermal_images(tmp_path: Path) -> None:
    image_dir = tmp_path / "images"
    image_dir.mkdir()
    _write_jpeg(image_dir / "DJI_20260622094800_0001_T.JPG")
    _write_jpeg(image_dir / "DJI_20260622094800_0001_V.JPG")
    _write_jpeg(image_dir / "DJI_20260622094900_0002_T.JPG")

    events: list[dict] = []
    df = _build_msgs_synced(image_dir, tmp_path / "msgs_synced.csv", events.append)

    names = {Path(p).name for p in df["image_path"]}
    assert names == {"DJI_20260622094800_0001_V.JPG"}


def test_build_msgs_synced_includes_all_when_no_thermal(tmp_path: Path) -> None:
    image_dir = tmp_path / "images"
    image_dir.mkdir()
    _write_jpeg(image_dir / "IMG_0001.JPG")
    _write_jpeg(image_dir / "IMG_0002.JPG")

    events: list[dict] = []
    df = _build_msgs_synced(image_dir, tmp_path / "msgs_synced.csv", events.append)

    names = {Path(p).name for p in df["image_path"]}
    assert names == {"IMG_0001.JPG", "IMG_0002.JPG"}
