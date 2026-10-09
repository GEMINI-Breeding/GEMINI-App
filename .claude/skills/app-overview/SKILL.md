---
name: app-overview
description: Start here. What the GEMINI app does, its stages, which skill and tools belong to each stage, and how data is laid out. Read first in any new session.
---

# GEMINI app: overview for an agent

## Quick path

1. `status` — what is in the app and what is running.
2. `next_step` — for each pipeline run, the step that is due and the call for it.
3. `continue_run` with `run` set to words naming one run — does the due steps itself and says what it needs.
4. Before working a stage by hand, `read_skill` for it (the table below says which).

GEMINI turns field imagery of breeding plots into per-plot images and traits.
You operate it through tools; each tool call does one thing and returns JSON
(sometimes with pictures). People use the same app through its web pages, so
what you do shows up there.

## Stages and their skills

| Stage | What happens | Skill | Main tools |
|---|---|---|---|
| Look around | what exists, what is running | `monitor-jobs` | `status`, `entities`, `datasets`, `browse`, `jobs` |
| Upload | local files into the app, in parallel | `upload-data` | `upload`, `tasks`, `cancel_task` |
| Ground: extract | rover `.bin` logs → frames + GPS | `ground-pipeline` | automatic after upload; `jobs`, `wait_jobs` |
| Ground: mark plots | start/end frame of every plot | `ground-plot-marking` | `passes`, `panorama`, `boundary_closeups`, `set_boundaries`, `apply_boundaries`, `save_markings` |
| Ground: stitch | one mosaic per plot | `ground-stitching` | `stitch`, `job_detail`, `stitch_result` |
| Aerial | drone images → orthomosaic → plot traits | `aerial-pipeline` | `run_orthomosaic`, `run_trait_extraction` |
| Inference | run a detection / segmentation / classification model | `inference` | `run_inference` |
| Reference data | field design, hand measurements | `reference-data` | `reference_datasets` (upload is done in the app) |
| Running on a cluster | start the stack, workers and a local model with Slurm | `hpc-session` | shell: `gemi-hpc` |

Call `read_skill` with the skill's name before doing a stage.

## How data is organised

Everything belongs to an **experiment**. Uploads are filed by

    Raw/{year}/{experiment}/{site}/{population}/{date}/{platform}/{sensor}/{dataset}/…

- `site` is also called *location*. `population` is the set of plots (a trial).
- `platform` is the carrier (`Amiga` rover, `Drone`), `sensor` what it carried (`RGB`).
- `{dataset}` is the first 8 characters of the upload batch's id. One upload
  batch = one dataset = one folder.
- Results go under `Processed/…` with the same path parts.

A ground **track** is one dataset folder, e.g.
`Raw/2026/GEMINI/Coachella/Lima/2026-09-17/Amiga/RGB/c0fca235/`. Many ground
tools take it as the `track` argument.

## Jobs and workers

Heavy steps are **jobs** done by **workers** (one worker type per kind of
job). A job goes PENDING → RUNNING → COMPLETED or FAILED.

| Job type | Worker | Started by |
|---|---|---|
| EXTRACT_BINARY | amiga | upload of `.bin` files |
| RUN_STITCH, ASSOCIATE_BOUNDARIES | stitch | `stitch` |
| RUN_ODM | odm | `run_orthomosaic` |
| LOCATE_PLANTS, EXTRACT_TRAITS | ml | `run_inference`, `run_trait_extraction` |
| CREATE_COG, SPLIT_ORTHOMOSAIC, … | geo | pipeline steps in the app |

You do not start workers: submitting a job starts the worker it needs, and
the tool's result has a `workers` note saying so. A job that stays PENDING
is waiting for its worker to come up on the cluster (`processes` shows each
worker's state). Say so; do not resubmit it.

## Not sure what to do next

Call `next_step`. For each pipeline run it names the step that is due, the
skill that covers it, and the tool call to make with every known argument
filled in. Values shown in `<angle brackets>` must come from the person:
ask for them, never invent them.

## The Process tab stays in step

People follow pipelines on the app's **Process** tab: a run per dataset
(scope), with its steps in order. Everything you do with the pipeline tools
is recorded there automatically — a finished upload marks Data Sync done,
saved markings mark Plot Marking done, each submitted job shows as its
step running with live progress. Tool results carry a `process_tab` entry
with the run and the page to open (`open_in_app`).

- `process_runs` lists the runs and every step's state. Use it to see where
  a pipeline stands and what the next step is, and to tell the person which
  page to open.
- An existing run for the same scope is reused, so work continues where the
  person left off; they can also take over from the next step by hand.
- If a result says `process_tab: {"not_updated": …}`, the work itself still
  happened; mention that the Process tab may not show it.

## Rules that always apply

1. Look before acting: `status` first, then the listing for what you need.
2. Never invent names, ids or paths. Copy them from tool results.
3. Start long work, then poll. Do not wait in silence: report progress.
4. Deleting needs the person's approval. Explain what and why.
5. Report failures with the exact error text and the job or task id.
6. Finish with a short summary: what was done, what failed, what is left.
