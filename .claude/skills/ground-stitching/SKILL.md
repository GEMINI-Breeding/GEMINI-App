---
name: ground-stitching
description: Stitch the marked plots of a rover track into one mosaic each with AgRowStitch, check the result, and tune the settings when plots fail or look wrong. Use after plot marking, or for "stitch", "re-stitch", "stitch failed".
---

# Per-plot stitching (AgRowStitch)

## Quick path

1. `markings` — `problems` empty, `count` as expected.
2. `stitch` with a few `plot_ids` spread over the field; `wait_jobs`; `stitch_result` with the `output_prefix` and two `plot_ids` — look at the previews.
3. Good: `stitch` without `plot_ids` (all plots); `wait_jobs`.
4. `stitch_stats` with the `output_prefix` — report stitched and failed counts, and how many you looked at.
Failed or bad plots: change one setting (table below), re-stitch only those `plot_ids`.

Needs saved plot markings (skill `ground-plot-marking`) and a running stitch
worker. One plot = one mosaic. Every run writes a new version folder
`Processed/…/AgRowStitch_v{N}/`; nothing is overwritten.

## Steps

1. `{"tool": "markings", "args": {"track": "<track>"}}` — `problems` must be
   empty and `count` what you expect.
2. **Try a few plots first** (some from the start, middle and end):
   ```json
   {"tool": "stitch", "args": {"track": "<track>", "plot_ids": [1, 2, 500, 1000]}}
   ```
   Note `job_id` and `output_prefix`.
3. `wait_jobs` on the job, then
   `{"tool": "stitch_result", "args": {"track": "<track>", "output_prefix": "<prefix>", "plot_ids": [1, 500]}}`
   — the manifest lists succeeded and failed plots; the pictures are previews.
4. Look at the previews (see "What good looks like"). If they are fine, run
   all plots: `stitch` without `plot_ids`. Expect about 10–20 s per plot.
5. Check the final manifest: every plot in `succeeded_plots`. Preview a
   sample spread over the field, and every plot AgRowStitch had to retry.

## What good looks like

- The plot appears once: no doubled or ghosted plants, no smeared bands.
- Both ends of the plot are there (stakes, if the field has them).
- The row runs straight through the mosaic, not bending out of the frame.
- Shadows of the rover or a person do not matter by themselves.

"Stitched" in the manifest only means a mosaic was produced. Whether it is
*good* needs a look; say how many you actually looked at.

## Settings and how to tune them

Defaults (Amiga): `forward_limit 4`, `max_reprojection_error 1.0`,
`batch_size 10`, `min_inliers 20`. Override per run:

```json
{"tool": "stitch", "args": {"track": "<track>", "plot_ids": [17], "settings": {"forward_limit": 2}}}
```

Anything else AgRowStitch accepts goes in `custom_options` as YAML text,
e.g. `"custom_options": "camera: partial_affine"`.

| Symptom | Likely cause | Try, one at a time |
|---|---|---|
| Plot fails: no match / too few inliers | frames used are too far apart, or little texture (bare soil, hard shadows) | lower `forward_limit` (4 → 2 → 1); lower `min_inliers` (20 → 12); raise `max_reprojection_error` (1.0 → 2.0–3.0) |
| Doubled / ghosted plants, visible seams | too many frames blended, or loose matches accepted | raise `forward_limit`; lower `max_reprojection_error`; mark fewer frames |
| Mosaic bends, drifts, or one end is cut off | error builds up over many frames | fewer frames per plot (tighter start/end); smaller `batch_size`; `custom_options: "final_straighten: false"` |
| Mirrored, or frames in the wrong order | wrong direction | set the plot's `direction` (camera movement relative to the image) with `mark` |
| Rover shadow, wheels or boots dominate | static content in every frame | mask it: `"settings": {"mask_bottom": 200}` (pixels of the full frame; also `mask_top/left/right`) |
| Very slow or out of memory | large batches with the spherical camera model | smaller `batch_size`; `custom_options: "camera: partial_affine"` |

What the knobs mean:

- `forward_limit` — how many frames ahead AgRowStitch tries to jump when
  matching. Higher = fewer frames used, faster, but each pair overlaps less.
  Raise it for a slow rover (lots of overlap), lower it when overlap is small.
- `max_reprojection_error` — pixel error allowed for a pair to count as
  matched; scales with image resolution. Higher accepts more pairs at the
  cost of seam quality.
- `min_inliers` — matched points needed to accept a pair.
- `batch_size` — frames stitched together before batches are joined.

Stitching does badly on long stretches of bare soil and works best on few
frames. If many plots fail, the markings are the first thing to tighten, not
the settings.

## Reporting

Settings used, plots stitched / failed (with ids and errors), which settings
change fixed which failure, how many mosaics you looked at, and the output
folder.

## Numbers for a stitch run

`stitch_stats` with the version's `output_prefix` gives plots stitched and
failed, frames per plot, and a chart. Use it for the report instead of
counting the manifest by hand.
