---
name: ground-pipeline
description: Run the ground (rover) pipeline end to end — upload .bin logs, extraction, plot marking, per-plot stitching — and know which step comes next. Use for "process the rover data", "run the ground pipeline".
---

# Ground pipeline

## Quick path

1. `continue_run` with `run` naming the rover run — it stitches, files plots and stops where it needs you or the person.
2. It stops at **Plot marking**: `read_skill` `ground-plot-marking` and work it pass by pass.
3. It stops at **Plot boundaries**: ask for the field design file and whether GPS can be trusted; record with `run_facts`; `continue_run` again.
4. GPS not trustworthy: follow "From the driving pattern" below (`traversal_layout` first).

Rover (Amiga) logs become one stitched image per plot. Steps, in order:

| # | Step | How | Done when |
|---|---|---|---|
| 1 | Upload `.bin` logs | skill `upload-data`, `data_type: amiga_bin` | upload task `completed` |
| 2 | Extraction | automatic, one EXTRACT_BINARY job per file | all jobs COMPLETED |
| 3 | Plot marking | skill `ground-plot-marking` | markings saved, no problems |
| 4 | Stitching | skill `ground-stitching` | manifest: all plots succeeded |
| 5 | (optional) inference on the mosaics | skill `inference` | predictions written |

Never skip ahead: each step needs the previous one's output.

## Which way to identify plots

| Situation | Plot identity and boundaries from | Tools |
|---|---|---|
| GPS good, field design available | stitched plots' GPS footprints + the design | `ground_plot_boundaries`, `associate_plots` |
| GPS poor or absent | the driving pattern: start corner + serpentine passes | `traversal_layout`, `traversal_boundaries`, `stitch_units`, `place_plot_images` |
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
   the frame are stitched as separate plots (two jobs).
5. When the stitch jobs have finished: `place_plot_images`, then inference
   on `…/PlotImages/` with `per_plot: true`.

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
