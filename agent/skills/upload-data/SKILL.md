---
name: upload-data
description: Upload local files or folders (rover .bin logs, images, orthomosaics) into the app from a terminal, in parallel, with progress and resume. Use for "upload", "ingest", "bring this data in".
---

# Uploading data

## Quick path

0. When the person names a **folder**, look at it first:
   `{"tool": "look_at_folder", "args": {"path": "<the folder they named>"}}`
   It lists which sub-folders hold images, rover `.bin` logs or `.tif` maps, and advises the calls that fit. Tell the person in one sentence what is there. If it mixes kinds (images and `.bin` logs), each kind is its own upload with its own `data_type` and paths. If several sub-folders hold data, ask what they stand for (runs of the same day, treatments, separate dates, or one batch). If the path is wrong, it says what is in the nearest folder that exists: ask the person which one they meant, using those names.
1. Call `upload` now with `"dry_run": true` and what the person gave you. The shape (drone photos; for rover `.bin` logs use `"data_type": "amiga_bin"` and leave `platform` out):
   `{"tool": "upload", "args": {"paths": ["<the folder or file they named>"], "experiment": "<experiment>", "site": "<site>", "population": "<population>", "date": "<YYYY-MM-DD>", "data_type": "images", "platform": "Drone", "dry_run": true}}`
   Replace every `<…>` with the person's own words: in "the wheat trial at Fargo, flown 3 May 2025" the population is the crop or trial, the site is the place, the date is when the data was collected (never today). Leave out a label they did not give: do not invent one.
2. If the tool says a label is missing, or that the person has not given one: ask the person for exactly those labels and stop. A folder name is not a label.
3. It returns a file count: tell the person the count and where the files will be filed, ask them to confirm, and stop.
4. On their yes: the same `upload` call without `dry_run`, then `wait_task` with the `task_id` it returns. Report files done and failed as numbers.

## Data already on the cluster

When the files sit on the cluster's storage (a session runs there), do not copy them here. Ask the person for the folder's full path on the cluster (or its parent): never search the cluster's storage for data. Then:

1. `{"tool": "cluster_folder", "args": {"folder": "<the path they named>"}}` shows what is in it (two levels).
2. `{"tool": "cluster_folder", "args": {"folder": "<path>", "upload": true, "experiment": "…", "site": "…", "population": "…", "date": "YYYY-MM-DD", "platform": "Drone", "sensor": "RGB", "data_type": "images"}}` submits a cluster job that uploads it as one batch (asks the person first). Add `"name_ends": "_V.JPG"` to keep only some files. Names with spaces are fine.

## Data in online storage (Box, Google Drive, Dropbox, S3, WebDAV, a web folder, SFTP)

Never download it to this computer first. The person connects the storage once on the Files page (Upload > Online storage > Connect storage; Box, Google Drive and Dropbox sign in in their browser). Then:

1. `{"tool": "online_storage", "args": {"action": "list"}}`: the connections. None yet: tell the person where to connect, and stop.
2. `{"tool": "online_storage", "args": {"action": "browse", "name": "<connection>", "path": "<folder they named>"}}` shows that folder (browse up from the top if the path is unclear; ask, do not guess).
3. `{"tool": "online_storage", "args": {"action": "copy", "name": "…", "path": "…", "experiment": "…", "site": "…", "population": "…", "date": "YYYY-MM-DD", "platform": "…", "sensor": "…", "data_type": "orthomosaic"}}` copies it to where the stack runs (on a cluster, a cluster job copies straight from the storage) and uploads it as one batch (asks first). An orthomosaic folder may hold the DEM too: files named …DEM / DSM are filed as the elevation model.
4. `{"tool": "online_storage", "args": {"action": "state", "id": "<id>"}}` until it is done; one copy per date.
3. Follow it with `hpc` action=logs service=upload; the run then shows on the Process tab.

Only folders under the cluster's data roots (`GEMI_DATA_ROOTS` in its launch.conf) are accepted.

## One day, several parts: runs of the day and treatments

Data for the same experiment, site, population, date, platform and sensor sometimes comes in parts. Each part is kept as its own upload and gets its own pipeline run, told apart by two optional labels:

- `run_of_day`: only for **diurnal data**, when the field was covered more than once that day ("the morning and the afternoon flight", "run 2"). Do not set it for an ordinary single run.
- `treatment`: only when collection was split by treatment ("the drought block", "irrigated").

Use a label only when the person said it. When the path holds **several folders**, `upload` stops and returns their names: ask the person what the folders stand for, then call again with `folders_are`: `runs` (each folder is a run of the same day), `treatments` (each folder is a treatment), or `one` (ignore the folders, one batch). Folders named `run1`, `run2`, `flight_3` give the run number; any other name is used as it is. A label given alongside applies to every folder (`folders_are: treatments` with `run_of_day: 2` = the second run, split by treatment).

Afterwards the runs are named with their label, e.g. "Davis Cowpea 2026-09-17, run 2 · drought", and that is how to refer to them in `continue_run`.

`upload` sends files from the machine the agent runs on into the app's
storage. It runs in the background and survives the tool call; you poll it.

## Before you start: get these from the person

| Needed | Example | Notes |
|---|---|---|
| paths | `D:/field-data/rover` | files or folders; folders are filtered by the data type's extensions |
| experiment | `GEMINI` | created if missing |
| site | `Coachella` | where the field is |
| population | `Lima` | which trial / set of plots |
| date | `2026-09-17` | collection date, `YYYY-MM-DD` — **not** today's date |
| data_type | `amiga_bin` | `amiga_bin` (rover `.bin`), `images`, `orthomosaic` |
| platform, sensor | `Amiga`, `RGB` | defaults for rover data; ask for drone data |

If the person did not give site, population or date, **ask**. A wrong one
files the data in the wrong place. File names often contain the date
(`2026_09_17_…bin`); when a folder holds several dates, upload each date
separately with `name_contains`.

Check existing names first so you reuse them instead of creating near-duplicates:
`{"tool": "entities", "args": {"kind": "sites"}}` (also `experiments`, `populations`).

## Steps

1. Dry run — confirm what would go up:
   ```json
   {"tool": "upload", "args": {"paths": ["D:/field-data/rover"], "experiment": "GEMINI", "site": "Coachella",
    "population": "Lima", "date": "2026-09-17", "data_type": "amiga_bin",
    "name_contains": "2026_09_17", "dry_run": true}}
   ```
   Tell the person the file count and total size. Continue if it matches
   what they expect.
2. Start it (same arguments without `dry_run`). Note `task_id` and
   `dataset_id` from the result.
3. Wait with `{"tool": "wait_task", "args": {"task_id": "…", "timeout_s": 300}}`.
   It returns when the upload finishes or after the timeout; if still
   `running`, note percent, speed and time left, and call it again. Do not
   call `tasks` in a loop.
4. When `status` is `completed`:
   - `amiga_bin`: one extraction job per file was queued
     (`extraction_jobs`). Wait for them with `wait_jobs`, then continue with
     the `ground-pipeline` skill.
   - other types: done; report the `target` folder.

## Parallelism

`parallel` = files in flight at once (1–8, default 3); each file also sends
4 parts at a time. More is not faster once the network link is full: watch
`mb_per_s`. If it does not rise with a higher `parallel`, the link is the
limit — leave it at 3. Use 1–2 on a weak connection.

## When something goes wrong

- `stalled` or the session died: run `upload` again with the same arguments
  **plus the same `dataset_id`**. Parts already on the server are skipped.
  Without `dataset_id` a second, separate dataset is created — do not do that
  to finish a batch.
- `completed_with_failures`: `failed` lists the files and errors. Re-run for
  those files only (give their paths) with the same `dataset_id`.
- A file uploaded but its extraction job is missing: submit it by hand with
  `submit_job` (`EXTRACT_BINARY`, parameters `files`, `localDirPath` =
  the task's `target`, `experiment_id`, `dataset_id`).

## Done when

Every file is `done`, and for rover logs every extraction job is COMPLETED.
Report: files, total size, time taken, dataset id, target folder, failures.
