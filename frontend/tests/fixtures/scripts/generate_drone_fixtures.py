#!/usr/bin/env python3
"""
Generate downscaled drone image fixtures for E2E testing.

Takes 5 consecutive overlapping DJI drone images, downscales to 25% resolution,
preserves GPS EXIF metadata, and saves as compressed JPEGs suitable for
committing to the repo (~150-250KB each).

Usage:
    python generate_drone_fixtures.py [source_dir] [output_dir]

Defaults:
    source_dir: ~/Downloads/Subset Drone Data/2022-06-27-DavisCowpeaSubset
    output_dir: ./images/drone/
"""

import json
import os
import sys

import piexif
from PIL import Image

# 5 consecutive images from the same flight line (good overlap)
SOURCE_IMAGES = [
    "2022-06-27_100MEDIA_DJI_0876.JPG",
    "2022-06-27_100MEDIA_DJI_0877.JPG",
    "2022-06-27_100MEDIA_DJI_0878.JPG",
    "2022-06-27_100MEDIA_DJI_0879.JPG",
    "2022-06-27_100MEDIA_DJI_0880.JPG",
]

SCALE_FACTOR = 0.25
JPEG_QUALITY = 60


def exif_gps_to_decimal(gps_info):
    """Convert EXIF GPS rational tuples to decimal degrees."""
    def rational_to_float(rational):
        if isinstance(rational, tuple):
            return rational[0] / rational[1] if rational[1] != 0 else 0
        return float(rational)

    lat = gps_info.get(piexif.GPSIFD.GPSLatitude)
    lat_ref = gps_info.get(piexif.GPSIFD.GPSLatitudeRef, b"N")
    lon = gps_info.get(piexif.GPSIFD.GPSLongitude)
    lon_ref = gps_info.get(piexif.GPSIFD.GPSLongitudeRef, b"W")
    alt = gps_info.get(piexif.GPSIFD.GPSAltitude)

    if lat and lon:
        lat_dec = rational_to_float(lat[0]) + rational_to_float(lat[1]) / 60 + rational_to_float(lat[2]) / 3600
        lon_dec = rational_to_float(lon[0]) + rational_to_float(lon[1]) / 60 + rational_to_float(lon[2]) / 3600
        if lat_ref == b"S":
            lat_dec = -lat_dec
        if lon_ref == b"W":
            lon_dec = -lon_dec
        result = {"lat": lat_dec, "lon": lon_dec}
        if alt:
            result["alt_m"] = rational_to_float(alt)
        return result
    return None


def main():
    default_source = os.path.expanduser(
        "~/Downloads/Subset Drone Data/2022-06-27-DavisCowpeaSubset"
    )
    source_dir = sys.argv[1] if len(sys.argv) > 1 else default_source
    output_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(__file__), "images", "drone"
    )

    os.makedirs(output_dir, exist_ok=True)

    metadata = {"source": source_dir, "scale_factor": SCALE_FACTOR, "images": []}

    for filename in SOURCE_IMAGES:
        src_path = os.path.join(source_dir, filename)
        if not os.path.exists(src_path):
            print(f"ERROR: Source image not found: {src_path}")
            sys.exit(1)

        img = Image.open(src_path)
        orig_w, orig_h = img.size
        new_w = int(orig_w * SCALE_FACTOR)
        new_h = int(orig_h * SCALE_FACTOR)

        # Extract EXIF before resize
        exif_bytes = img.info.get("exif", b"")
        if exif_bytes:
            exif_dict = piexif.load(exif_bytes)
        else:
            print(f"WARNING: No EXIF data in {filename}")
            exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}}

        # Resize
        resized = img.resize((new_w, new_h), Image.LANCZOS)

        # Update EXIF image dimensions
        exif_dict["0th"][piexif.ImageIFD.ImageWidth] = new_w
        exif_dict["0th"][piexif.ImageIFD.ImageLength] = new_h
        if piexif.ExifIFD.PixelXDimension in exif_dict["Exif"]:
            exif_dict["Exif"][piexif.ExifIFD.PixelXDimension] = new_w
        if piexif.ExifIFD.PixelYDimension in exif_dict["Exif"]:
            exif_dict["Exif"][piexif.ExifIFD.PixelYDimension] = new_h

        # Remove thumbnail (causes issues with piexif after resize)
        exif_dict["1st"] = {}
        exif_dict.pop("thumbnail", None)

        new_exif_bytes = piexif.dump(exif_dict)

        # Save
        out_path = os.path.join(output_dir, filename)
        resized.save(out_path, "JPEG", quality=JPEG_QUALITY, exif=new_exif_bytes)

        file_size = os.path.getsize(out_path)
        gps_info = exif_gps_to_decimal(exif_dict.get("GPS", {}))

        metadata["images"].append({
            "filename": filename,
            "original_size": [orig_w, orig_h],
            "downscaled_size": [new_w, new_h],
            "file_size_bytes": file_size,
            "gps": gps_info,
        })

        print(f"  {filename}: {orig_w}x{orig_h} -> {new_w}x{new_h}, "
              f"{file_size / 1024:.0f}KB, GPS: {gps_info}")

    # Write metadata
    meta_path = os.path.join(output_dir, "metadata.json")
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)

    total_size = sum(m["file_size_bytes"] for m in metadata["images"])
    print(f"\nDone! {len(metadata['images'])} images, {total_size / 1024:.0f}KB total")
    print(f"Metadata: {meta_path}")


if __name__ == "__main__":
    main()
