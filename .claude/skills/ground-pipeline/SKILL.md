---
name: ground-pipeline
description: Run the ground pipeline end to end — a rover's .bin logs (extraction) or a handheld pass's photos (positions from their GPS or a GPS log), plot marking, per-plot stitching — and know which step comes next. Use for "process the rover data", "the walked pass", "run the ground pipeline".
---

# Ground pipeline

## Quick path

1. `continue_run` with `run` naming the rover run. It does the steps it can and stops where it needs you or the person.
2. It stops at **Plot marking**: `read_skill` `ground-plot-marking` (one call, `mark_plots_auto`, marks the whole track).
3. It stops at **Plot boundaries**: ask for the field design file and whether GPS can be trusted; record the answers with `run_facts` (no design yet: `design_path` = `stand-in`); `continue_run` again.
4. GPS not trustworthy, or marking recommended `single frames` / `mixed`: follow "From the driving pattern" below (`traversal_layout` first). `continue_run` says so itself.

| # | Step | How | Done when |
|---|---|---|---|
| 1 | Upload `.bin` logs | skill `upload-data`, `data_type: amiga_bin` | upload task `completed` |
| 2 | Extraction | automatic, one EXTRACT_BINARY job per file | all jobs COMPLETED |
| 3 | Plot marking | skill `ground-plot-marking` | markings saved, no problems |
| 4 | Stitching (only plots longer than one camera frame) | skill `ground-stitching` | manifest: all plots succeeded |
| 5 | (optional) inference on the mosaics | skill `inference` | predictions written |

Never skip ahead: each step needs the previous one's output.

## Handheld passes (a phone or camera carried along the rows)

With GPS (the photos' own, or a GPS log), a handheld pass is processed exactly
like a rover's after extraction: positions, plot marking, then plot images.

1. Upload the photos: `upload`, `data_type: images`, `platform: Handheld`,
   the camera as `sensor` (e.g. RGB). iPhone photos must be JPEG: HEIC can't
   be processed (Settings → Camera → Formats → Most Compatible).
2. A GPS log of the walk, if the person carried one (a GPS app's GPX/CSV, an
   NMEA file, an RTK receiver's .pos or CSV): `upload` it with
   `data_type: gps_log` and the photos' own experiment, site, population,
   date, platform and sensor. It is matched to the photos by capture time and
   beats a phone's own GPS (metres off).
3. `sync_positions` with `run`. Its job result says how many photos got a
   position and from where, and whether the camera clock was shifted to line
   up with the log (cameras without a time zone are shifted by whole hours).
4. Then plot marking (`ground-plot-marking`) and plot images as for a rover.

With no GPS at all:

- One photo per plot (a photo taken at each plot): skill `plot-photos`
  (`plots_from_images`, paired with the field design and confirmed).
- A walked pass: mark the plots as usual (by hand), then `ground_plot_frames`
  with `design_path`: the design's rows are paired with the marked plots in
  marking order, so the design must list the plots in the order walked.

## Plot images: the stitch or the raw frames

Either source works for a rover or a handheld pass, once the plots are marked:

- Stitched plots: `stitch`, then `associate_plots` (needs boundaries).
- Raw frames, no stitch: `ground_plot_frames` with `run`. Each plot's frames
  that do not overlap go to `…/PlotFrames/tiles/`; run models on that folder
  (`run_inference`): the counts add up per plot without counting a plant
  twice. `…/PlotFrames/straightened/` holds one image per plot (its middle
  frame). Plots are named from the drone boundaries they were marked from,
  else by GPS inside the active boundaries, else from `design_path`.

## Which way to identify plots

| Situation | Plot identity and boundaries from | Tools |
|---|---|---|
| GPS good, field design available | stitched plots' GPS footprints + the design | `ground_plot_boundaries`, `associate_plots` |
| GPS poor or absent | the driving pattern: start corner + serpentine passes | `traversal_layout`, `traversal_boundaries`, `stitch_units`, `place_plot_images` |
| Field design as a drawn map, several files, or several crops in the field | `field_layout` first; its `saved_as` is the design | then the row above that fits |
| No field design yet | a stand-in | `mock_field_design` (GPS route), or `traversal_layout` without `design_path` |

### From the driving pattern

Ask the person: **which corner of the field the rover started at**, which
way the beds run (north-south or east-west), and whether each image shows
one crop row or two.

1. Mark plots first (`ground-plot-marking`). In fields without stakes,
   where plots are canopy blocks with bare alleys between them, `panorama`
   with `"gaps": true` (and `"crop_rows": [[0,0.45],[0.55,1]]` when two rows
   are in view) proposes a boundary in every alley.
2. `traversal_layout` with `start_corner`, `pass_axis`, `rows_per_pass`
   (and `design_path` if there is a design). Read the result:
   - the field map: does the plot at the start corner match what the
     person expects?
   - `gps_disagrees_with_serpentine_on_passes`: passes whose GPS heading
     contradicts the alternating pattern (two beds driven the same way, or
     a pass missing). Tell the person; use `"direction_source": "gps"`
     only when the GPS headings are believable.
   - warnings about passes with a different plot count.
3. `traversal_boundaries` (nominal `plot_length_m`, `bed_width_m`) saves
   schematic boundaries so results can be shown per plot.
4. `stitch_units` — with two rows per pass, the top and bottom halves of
   the frame are stitched as separate plots (two jobs). Plots whose plants
   fit one camera frame are left out; when that is all of them it starts no
   job and says so.
5. When the stitch jobs (if any) have finished: `place_plot_images`. A
   single-frame plot gets the raw frame that shows it whole, cut to the plot;
   a longer plot gets its mosaic. Both are filed under the plot's number and
   genotype. Then inference on `…/PlotImages/` with `per_plot: true`.

## Finding the track

Steps 3–4 work on a **track**: the dataset folder the upload created.

1. From the upload: the task's `target` is `…/{dataset}/Images`; the track is
   that path without the trailing `Images`.
2. Otherwise: `{"tool": "datasets", "args": {"experiment": "GEMINI"}}` and
   take the dataset's location, or `browse` the scope
   `Raw/{year}/{experiment}/{site}/{population}/{date}/Amiga/RGB/`.
3. Check it: `{"tool": "passes", "args": {"track": "<track>"}}` must list
   passes with frames. If it fails with "msgs_synced.csv", extraction has not
   finished (or failed) — go back to step 2.

## After extraction: what you should see

Under the track: `RGB/Images/top/*.jpg` (the frames used for stitching),
other cameras beside it (`left/`, `right/` when the rover had them), and
`RGB/Metadata/msgs_synced.csv` (one row per top frame with GPS).

`passes` splits the track into passes, one per bed traversal. Sanity check:
the number of passes should match the number of `.bin` files or beds the
person expects, and each pass's length (metres) the bed length.

## Resources

- Extraction: one amiga worker handles files one after another (about 1–2 min
  per 600 MB log). More workers = more in parallel.
- Stitching: a stitch worker handles plots one after another (about 10–20 s
  per small plot on CPU).
- No worker of the needed type → jobs stay PENDING. See `monitor-jobs`, and
  `hpc-session` when running on a cluster.

## Reporting

Per step: counts (files, jobs, passes, plots), failures with ids, and the
saved marking version and stitch output folder.
