---
name: upload-data
description: Upload local files or folders (rover .bin logs, images, orthomosaics) into the app from a terminal, in parallel, with progress and resume. Use for "upload", "ingest", "bring this data in".
---

# Uploading data

## Quick path

1. Get from the person: paths, experiment, site, population, date (the collection date), data type. Ask for what is missing.
2. `upload` with `"dry_run": true` — tell them the file count and size.
3. `upload` again without `dry_run` — note the `task_id`.
4. `wait_task` with that `task_id` until `completed`. Report files and failures as numbers.

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
