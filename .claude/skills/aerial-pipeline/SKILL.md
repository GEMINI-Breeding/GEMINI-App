---
name: aerial-pipeline
description: Run the aerial (drone) pipeline — upload images, build the orthomosaic with ODM, then extract per-plot traits from the orthomosaic and plot boundaries. Use for "process the drone flight", "make the orthomosaic", "extract traits".
---

# Aerial pipeline

## Quick path

1. `continue_run` with `run` naming the drone run — builds the orthomosaic, waits, and goes on.
2. It stops at **Plot boundaries** needing the person: the field design file, which end the first tier is at, which side the first bed is on. Record their answers with `run_facts`, then `continue_run` again.
3. It returns an overlay picture: show it and ask if every box sits on one plot. Yes: `continue_run` with `boundaries_confirmed` true.
4. It then cuts plot images and measures canopy cover. Models: `read_skill` `inference`.
An orthomosaic takes 30 minutes to a few hours: when `continue_run` says "still running", tell the person and call it again later.

Drone images of a field become an orthomosaic, then per-plot traits.

| # | Step | How | Needs |
|---|---|---|---|
| 1 | Upload images | skill `upload-data`, `data_type: images`, `platform: Drone`, `sensor: RGB` | — |
| 2 | Ground control points (optional) | in the app: Process → run → GCP selection | a person |
| 3 | Orthomosaic | `run_orthomosaic` (RUN_ODM) | odm worker + NodeODM |
| 4 | Plot boundaries | `field_design` + `plot_boundaries` (from the orthomosaic and the field design file), or drawn in the app | field design file |
| 4b | Plot images | `split_plots` (SPLIT_ORTHOMOSAIC) | geo worker |
| 5 | Trait extraction | `run_trait_extraction` (EXTRACT_TRAITS) | ml worker |

Step 2 is interactive in the app today; tell the person which screen to open.

## 1. Upload: one flight, one kind of image

- One orthomosaic comes from **one flight over one field**. Camera folders
  (`DCIM/DJI_…_001`) are usually one flight each; a flight split over two
  consecutive folders belongs together. Ask if unsure.
- Dual-sensor drones write several files per shot (DJI: `…_V.JPG` visible,
  `…_T.JPG` thermal). Upload only one kind per dataset:
  `"name_contains": "_V"` for RGB. Mixing them ruins the reconstruction.
- The date is the flight date (in the folder and file names), `YYYY-MM-DD`.

## 2. Ground control points

Needs the surveyed coordinates of the markers (`gcp_locations.csv`: Label,
Lat_dec, Lon_dec, Altitude) uploaded in the app's GCP step, then each marker
picked in the images. If the person has not provided that file, **say so and
run without GCPs** (`skip_gcps: true`): the orthomosaic is then positioned by
the drone's own GPS (decimetres with RTK, metres without). Picking markers
(e.g. ArUco plates) with the agent is not built yet.

## 3. Orthomosaic

The scope is the six path parts of the upload:

```json
{"tool": "run_orthomosaic", "args": {"experiment": "GEMINI", "location": "Davis", "population": "Cowpea",
 "date": "2026-07-01", "platform": "Drone", "sensor": "RGB", "skip_gcps": true}}
```

- `skip_gcps: true` when no ground control points were picked.
- `reconstruction_quality`: `Standard` unless asked otherwise; higher is
  much slower.
- `dataset_short_ids`: restrict to given upload batches (8-character ids).
- `custom_options`: raw ODM options as text.

Then `wait_jobs` (ODM takes from tens of minutes to hours). Output:
`Processed/{year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/odm_orthophoto.tif`.
Confirm with `browse` on that folder.

### If the orthomosaic job fails

Do not conclude "bad data" from ODM's closing message ("strange values in
the reconstruction", "Cannot process dataset") — it prints that for every
kind of failure. Read the log first: `browse` the Processed folder, then
look at `odm_log.txt` (path is in the job's error message), or ask the
person to open it.

| In the log | Meaning | Do |
|---|---|---|
| `joblib will operate in serial mode` near the top, later `queue.Full` | the ODM container has no usable shared memory; an installation fault, not the data | report it as a setup problem (cluster: see `hpc-session`) |
| `Not enough overlap` / few matches / `could not align` | flight really lacks overlap, or mixed image types | check that only one image kind was uploaded; ask about the flight |
| `MemoryError`, `Killed`, `std::bad_alloc` | ran out of memory | lower `reconstruction_quality`, or give the odm worker more memory |
| job ran minutes, not hours, then failed at start | images missing at the scope | `browse` the Raw folder; re-check the upload |

A normal run of ~450 images at Standard quality takes about 25 minutes on
16 cores. After it completes, a follow-up CREATE_COG job (map tiles) is
queued; it needs the `geo` worker and is not required for trait extraction.

## 4. Plot boundaries from the field design

1. `{"tool": "field_design", "args": {"path": "<file on this computer>"}}` — beds,
   tiers, bed blocks, and which plot sits at each corner of the design.
2. Decide which of the design's beds are on **this** orthomosaic. A design
   often spans several flights (for example a well-watered block and a
   drought block flown separately): give only that block's bed numbers as
   `beds`. Ask the person which block is where (east/west) if they have not said.
3. Preview: `plot_boundaries` with `"preview": true`. It finds the tier
   strips from the vegetation, divides the block into beds, and returns an
   overlay picture plus `plots_at_corners`. Check:
   - every box sits on one plot's canopy, with the alleys between boxes;
   - `layout.note` has no WARNING (the strip count matched the design's tiers);
   - the corner plots are where the person says they are. If north and
     south are swapped use `"first_tier_at": "north"`; if east and west,
     `"first_bed_at": "east"`.
   Never guess the orientation: if the person has not said which end tier 1
   (or the lowest plot number) is at, ask.
4. Save: the same call without `preview`. For a second flight of the same
   field and date add `"add_to_active": true`, so both blocks end up in one
   boundary version.
5. `split_plots` with the orthomosaic path cuts it into
   `…/PlotImages/plot_{n}_accession_{genotype}.png` (one job per orthomosaic).

Plot labels that are not numbers (check plots such as `KW7`) get a numeric
alias in `plot` and keep the label in `plot_label`; say so when reporting.

`boundaries_geojson` writes the active boundaries to a GeoJSON file in
storage (trait extraction needs that path).

## 5. Trait extraction

Simplest trait: `canopy_cover` on the `…/PlotImages/` folder (green cover per
plot, no worker needed). The full extraction is below.


Needs the orthomosaic and a boundary file
(`…/plot-boundaries/v{N}.geojson` in the same Processed folder; find it with
`browse`).

```json
{"tool": "run_trait_extraction", "args": {
 "orthomosaic_path": "Processed/…/odm_orthophoto.tif",
 "boundary_geojson_path": "Processed/…/plot-boundaries/v1.geojson",
 "output_traits_geojson_path": "Processed/…/traits/v1.geojson"}}
```

Optional: `dem_path` (heights), `thermal_path`, `exg_threshold` (vegetation
threshold, default chosen by the worker).

## Stop and ask when

- No boundary file exists: boundaries must be drawn or imported in the app.
- The orthomosaic job fails for lack of overlap or GPS: report the error; the
  flight data may be the problem.
- More than one orthomosaic or boundary version exists and it is not clear
  which to use.

## Status of this skill

Steps 1 and 3 were run end to end by an agent on the cluster (454 images,
orthomosaic in 25 min, no GCPs). Trait extraction has not been run by an
agent yet; treat a first run as a test and report closely.
