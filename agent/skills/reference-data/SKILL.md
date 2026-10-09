---
name: reference-data
description: Work with reference data — field design files and hand-measured trait tables per plot — check what is loaded and how well it matched the plots, and guide the person through an upload. Use for "field design", "ground truth", "reference traits", "why are plots unmatched".
---

# Reference data

## Quick path

1. `reference_datasets` — what is loaded already.
2. A new table: `field_design` with its `path` to see the columns, then `reference_upload` with `path` and a `mapping` of column to role.
3. Report the match numbers it returns (rows matched to plots, rows not matched).

Reference data is a table with one row per plot: the field design (plot,
row/bed, column, genotype) and/or traits measured by hand. The app matches
its rows to plots by plot identity.

## What an agent can do

- List what is loaded: `{"tool": "reference_datasets", "args": {}}` — name,
  experiment, location, population, date, trait columns, plot count.
- Explain a poor match and how to fix the file (below).
- Use a field design to plan plot marking: plots per bed, beds, borders
  (see `ground-plot-marking`).

## What the person does in the app

Uploading needs choosing which column is which, so it is done on screen:

1. Files → Upload → data type **Reference Data**.
2. Pick experiment, site, population and the date the measurements were taken.
3. Drop the file (CSV, TSV or Excel). Choose the sheet and header row if asked.
4. Map columns: plot id (required), then row, column, accession/genotype;
   everything else numeric becomes a trait. Mark columns to ignore.
5. Upload. A match report shows how many rows matched existing plots.

## Getting the file right (most problems are here)

| Problem | Cause | Fix |
|---|---|---|
| Few or no rows matched | plot ids in the file differ from the app's (`1` vs `Plot_001`), or wrong population | make ids identical; check the population chosen |
| Rows skipped as empty | blank lines, or merged header cells | one header row, one plot per row |
| Trait shows as text / not numeric | units or notes inside cells (`12 cm`, `n/a`) | numbers only; leave missing cells empty |
| Same season attached to the wrong experiment | season names repeat across experiments | choose the experiment first, then the season |

## Field design for the ground pipeline

Ask for it before plot marking. From it you need: number of beds (passes),
plots per bed, whether beds have border plots at the ends, plot length, and
the order plots are numbered in (serpentine or not). With that, a bed whose
detected plot count differs from the design is caught immediately.

## Uploading a table

`reference_upload` takes a `.csv` / `.xlsx` on this computer and a `mapping`
from each file column to its role (`plot_id`, `row`, `col`, `accession`, a
trait name, or `__ignore__`). Read the file's columns first with
`field_design` (design files) or ask the person. Always report the match
numbers it returns: a table that matched 0 plots is for another trial.
