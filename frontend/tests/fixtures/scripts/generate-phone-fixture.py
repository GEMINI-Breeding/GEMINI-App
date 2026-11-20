"""
Cut the phone-camera fixture for the cross-sensor Data Sync spec:
images/phone/240715_IMG_*.jpg.

A phone rode the Amiga on 2024-07-15 (ExampleDatasets/Subset Amiga Data/
2024-07-15/Phone/rgb_jpeg). These seven frames were taken during the
Amiga track fixture's 12 s window (binary/2024_07_15_15_49_18_998387_
track-fixture.0000.bin, 15:50:14–15:50:26 UTC) — six inside it and one
(00749) about 2 s before it — so their positions can be interpolated from
the rover's RTK track. Downscaled to 480x640 to keep the repo small; the
EXIF (GPS position and GPS time) is kept, since that is what Data Sync
reads.

    python generate-phone-fixture.py "<ExampleDatasets>/Subset Amiga Data/2024-07-15/Phone/rgb_jpeg"
"""
import sys
from pathlib import Path

from PIL import Image

FRAMES = ["00749", "00754", "00757", "00760", "00765", "00770", "00775"]
OUT = Path(__file__).resolve().parent.parent / "images" / "phone"


def main(src: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for n in FRAMES:
        name = f"240715_IMG_{n}.jpg"
        with Image.open(Path(src) / name) as im:
            exif = im.info["exif"]
            im.resize((480, 640)).save(OUT / name, quality=85, exif=exif)
        print(OUT / name)


if __name__ == "__main__":
    main(sys.argv[1])
