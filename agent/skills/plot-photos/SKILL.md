---
name: plot-photos
description: Turn a folder of plot photos that have no GPS and no orthomosaic (hand-held, phone, fixed camera, downloaded image sets) into per-plot images tied to the field design, then measure them. Use for "photos of each plot", "images with no GPS", "no georeferencing", "pair the images with the field design".
---

# Plot photos without GPS

## Quick path

1. The photos must be uploaded as `"data_type": "images"` with `"platform": "Handheld"` (or `Phone`, `Camera`), not `Drone` (skill `upload-data`). They are ground data: ground is for rovers and cameras at ground level; aerial is for cameras and sensors on a UAV.
2. `continue_run` with `run` naming the upload. It asks for the field design. If the person has said there is none, record `design_path` = `stand-in` with `run_facts` (a made-up design with one plot per photo is then made: tell the person it is made up) and call `continue_run` again.
3. `continue_run` then shows the pairing: which photo would become which plot and genotype, and the rule used. Nothing is filed yet. Tell the person the rule and the first and last pairs, ask whether it is right, and stop.
4. When the person says the pairing is right: `continue_run` with `run` and `"boundaries_confirmed": true`. It files the plot images.
5. Measure: `canopy_cover` with `run`, or `continue_run` with `run` and `model` for a detector. Report per-plot numbers, and the pairing rule they rest on.

## Why the person must confirm

With GPS, a plot image can be checked against where it was taken. Here nothing in the photo says which plot it is: the only link between a photo and a genotype is the pairing rule. A wrong rule gives every plot the wrong genotype and nothing downstream will show it. So:

- **Best: the design names each plot's photo.** A column called `image`, `file` or `photo` in the field design, holding the file name. Ask the person whether they have that; if they can add it, wait for it.
- **Otherwise: file-name order = design order.** Photo 1 (sorted by name) is the design's first row, and so on. Right only if the photos were taken in the order of the design, with none skipped or retaken. The number of photos must equal the number of plots; if it does not, the tool stops and says the two numbers.
- Never choose a rule the tool did not report, and never tell the person the pairing "was verified": it was shown, and they confirmed it.

The pairing and its rule are saved next to the plot images (`pairing.json`). The plots are placed on a schematic grid from the design's beds and tiers, not at their real positions: the map in Analyze shows the layout, not the field.

## When it does not pair up

- `N photos but M plots`: ask which photos are extra or missing, or for a design with an `image` column.
- `photo X is not among the uploaded files`: a file name in the design is wrong or the photo was not uploaded.
- Several photos per plot: not handled by order; the design needs an `image` column with one row per photo.
