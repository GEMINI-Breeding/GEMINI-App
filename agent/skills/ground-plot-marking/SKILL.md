---
name: ground-plot-marking
description: Mark the start and end frame of every plot on a ground-rover (Amiga) track in the GEMINI app, QA markings carried over from another date, and run/tune the per-plot AgRowStitch stitch. Use when asked to do the ground pipeline's Plot Marking step, check plot markings, or stitch plots.
---

# Ground plot marking (and stitching) for an agent

## Quick path

1. `passes` — the passes (bed traversals) of the track.
2. For each pass N: `panorama` with `pass` N and `redetect` true — proposed boundaries on the whole bed.
3. For each boundary: `boundary_closeup` with `pass` N and `index` I — read the offset of the stake from the ruler.
4. One `set_boundaries` for the pass with all offsets in `shift` (no fixes needed: `set_boundaries` with only `pass`).
5. After all passes: `apply_boundaries`, then `markings` (its `problems` must be empty), then `save_markings`.
No stake visible at a boundary: leave it unshifted and say so. Never guess.

You are doing the job a person does in the app's **Plot Marking** step with the
← / → keys and S (start), E (end), N (next plot): step through the rover's
top-camera frames and record, for each plot, its first frame, its last frame
and the stitching direction. Your markings are saved to the same place the
app's are, so the person sees them in Plot Marking and the stitch step uses
them.

Tools come from `agent/` in the GEMINI-App repo, either as MCP tools
(`gemi-agent` server) or on the command line — same names, same arguments:

```bash
cd agent
export GEMI_TRACK=Raw/2026/EXP/SITE/POP/2026-09-17/Amiga/RGB/c0fca235/
python -m gemi_agent tools            # list them
python -m gemi_agent panorama --pass 3
```

Results are JSON; `images` lists pictures to open and look at. Frames are
addressed by **index** (position in capture order), not file name.

## What a correct marking is

One plot = one stitch. The stitch works best on few frames, and must not
show the neighbouring plots:

- **Start frame**: the plot's first plant has been in view and is about to
  leave the image — it sits at the *exit* edge. Nothing of the previous plot
  is in the frame.
- **End frame**: the plot's last plant has just fully come into view at the
  *entry* edge, one frame before bare ground or the next plot's first plant
  would appear behind it. (Step one frame forward to see it appear, then go
  back one.)
- **Plot dividers are usually stakes** in the ground (often with a paint
  mark). When plants are too small or sparse to give clean edges, use the
  stakes: the stretch between two consecutive stakes is one plot.
- Number of plots per bed is normally the same for every bed. A bed that
  comes out with a different count is the first thing to re-check. If a field
  design file is provided, its plot count per bed is the reference.
- **Direction** is the camera's movement relative to the image
  (`up`/`down`/`left`/`right`), not a compass heading. The scene moves the
  opposite way: if new ground enters from the left, the camera is moving
  `left`. `panorama` reports it as `camera_direction`.
- Do not trust GPS for where plots are. Rover GPS is unreliable on some
  data; that is why this step is done by looking. `panorama` says
  `gps_ok: false` when a pass's GPS disagreed with the image motion (it then
  ignores GPS).

## Procedure

1. `passes` — the track split into passes (one bed traversal each; the rover
   stops recording or turns between them). Note frame ranges and headings.
2. Establish the layout on the first pass or two with `panorama --pass N`:
   the whole bed in one picture (travel left to right, wrapped into rows,
   ground-x ruler above each row), proposed boundaries as numbered magenta
   lines (`?` = inferred, not seen). Count the stakes. Ask (or read from the
   field design) what lies outside the staked plots; the usual layout is
   **one border plot at each end of the bed**, not marked by stakes — leave
   borders out unless told to stitch them.
3. For every pass: `panorama --pass N --redetect true` (proposal), then
   place each boundary on its stake from close-ups, and correct with
   `set_boundaries --pass N --shift '{"3": -40, "7": 12}'` (this also marks the
   pass reviewed; with nothing to fix, `set_boundaries --pass N`).

   Two close-up tools; the ruler on top is the offset in px from where the
   boundary is now:
   - `boundary_closeup --pass N --index I` — **one** boundary, large. Use
     this, one boundary after another (index 0 to the last), unless you are a
     large hosted model. For each: find where the stake enters the ground,
     note the ruler offset. If no stake is visible, do **not** guess: leave
     that boundary unshifted and list it as unsure.
   - `boundary_closeups --pass N` — all boundaries on one sheet. Quicker, but
     smaller models misread it: in testing, Gemma 4 31B invented shifts from
     the sheet (errors up to 80 px) yet read single close-ups to about 10 px.
   Collect all offsets, then make **one** `set_boundaries` call with them.
   Where the proposal comes from, best first:
   - *stakes seen*: wooden stakes detected by colour (works when the bed is
     evenly lit). Extra or missing lines at the bed ends are common: keep the
     real ones with `--keep '[i, j]'`.
   - *carried over by GPS from reviewed passes*: plots line up across beds, so
     once a few beds of each heading are reviewed, the rest are proposed from
     them, snapped to paint marks where there are any. Expect to shift most
     of them by 0–100 px; GPS is only that good.
   - nothing usable: read two stakes off the panorama and use
     `set_boundaries --pass N --grid '[x_first, x_last, plots_between]'`.
   The bed is in the upper or lower half of the frame depending on the side
   the rover drove; if the close-ups show a wheel track instead of the bed,
   repeat with `--band '[0.5, 1]'` (or `'[0, 0.5]'`).
4. Sanity checks before moving on: the plot lengths printed by
   `set_boundaries` should be within a few percent of each other and the
   count equal to the other beds'. One long and one short neighbour = a
   boundary on the wrong object.
5. `apply_boundaries` turns all reviewed passes into numbered plots.
   - Plants fill the stake-to-stake stretch: no options (start = stake at the
     exit edge, end = next stake at the entry edge).
   - Plants cover only part of it and the rest is bare alley (stitching does
     badly on plain soil): `--planted_fraction 0.62` (measure it on a
     panorama) keeps only the planted part plus a small margin. Which end
     the plants are at is worked out per heading.
6. Spot-check with `panorama --pass N --markings true` (each plot drawn as
   `[id … id]`) and `plot_view --plot_id K`; adjust single plots with
   `mark --plot_id K --start i --end j`.
7. `markings` (problems must be empty), then `save_markings --name "…"`.

No stakes or irregular plots: skip 2–5 and mark by hand — find edges on the
panorama (`--plain true`), confirm on `sheet`, then `mark` each plot.

### QA of markings carried over from another date

The app moves saved markings onto a new date's track by GPS. To check them:
`pull_markings`, then per pass `panorama --pass N --markings` — each plot is
drawn as `[id … id]` on the bed. Every bracket pair should enclose exactly one
plot, stake to stake. Fix with `mark`, then `save_markings`.

## Looking closer

- `frame` shows one frame large, when a close-up is not enough to tell a
  stake from a weed.
- `profile` gives green cover per frame for a range: dips are the gaps
  between plots. Useful where there are no stakes.

## Next: stitching

Once markings are saved, continue with the `ground-stitching` skill (try a
few plots first; it also explains how to tune AgRowStitch when plots fail).

## Reporting

Say how many passes and plots were marked, which passes needed corrections
or still look doubtful (and why), the saved version number, and for stitching
the settings used and which plots failed.
