# Fixture generators

Scripts that produce the binary fixtures committed under `frontend/tests/fixtures/`.
Re-run them only when you want fresh data (e.g. a new drone image set, a
regenerated AMIGA binary).

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install pillow piexif
```

## `generate_drone_fixtures.py`

Downscales a set of full-resolution drone JPGs to ~25% so they commit cheaply
while preserving GPS EXIF — the `FilesService.extractMetadata` code path on
`POST /api/v1/files/extract-metadata` reads those tags for the auto-fill of
date/platform/sensor in the upload form.

```bash
python generate_drone_fixtures.py \
  --src /path/to/full-res/drone \
  --dst ../images/drone
```

## `generate-amiga-fixture.py`

Produces a small synthetic AMIGA/farm-ng binary file for the Farm-ng Binary
File upload path. The generated file is ~1.3 MB — enough to exercise the
extraction code without committing real flight logs.

```bash
python generate-amiga-fixture.py --out ../binary/test_amiga.0000.bin
```

## `generate_thermal_fixture.py`

Writes `ortho/e2e_test_thermal.tif`: a constant 27.5 °C thermal orthomosaic
over the same footprint as `ortho/e2e_test_orthophoto.tif`, for the
canopy-temperature trait-extraction spec. Needs rasterio.
