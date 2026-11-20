---
name: monitor-jobs
description: Check what the stack is doing — active jobs, failures, busy workers, running uploads — and report or wait for completion. Use for "status", "is it done", "why is it stuck", "what failed".
---

# Monitoring jobs and uploads

## Quick path

1. `status` — active jobs, running uploads, runs on the Process tab.
2. Something waiting or stuck: `processes` — is the worker for it running, queued or stopped?
3. Waiting for jobs: `wait_jobs` with their ids (not repeated `jobs` calls). Uploads: `wait_task`.
4. Something failed: `job_detail` with its id; report the exact error.

## Quick status

1. `status` — experiments, counts of recent jobs by state, active jobs, busy
   workers, running uploads. This answers most "what is happening" questions.
2. For detail on one kind: `jobs` with a filter, e.g.
   `{"tool": "jobs", "args": {"status": "FAILED", "limit": 20}}` or
   `{"tool": "jobs", "args": {"job_type": "RUN_STITCH"}}`.
3. Pipelines: `process_runs` — each run on the Process tab with its steps
   (which are done, which is running, what comes next).
4. One job: `job_detail` with its `job_id` — parameters, result, error message.
5. Uploads: `tasks` (latest batches) or `tasks` with a `task_id`.

## Waiting for work to finish

- Jobs: `wait_jobs` with the ids and a timeout (at most 3600 s per call).
  When it returns with `finished: false`, report progress and call it again.
- Uploads: `wait_task` with the `task_id` (returns on completion or after
  its timeout). `percent`, `mb_per_s` and `eta_min` tell how it is going.

Never poll in a tight loop: the waiting tools exist so that one call covers
minutes.

Between polls, tell the person where things stand in one line.

## Reading what you see

| Observation | Meaning | What to do |
|---|---|---|
| Job PENDING for minutes, `pending_job_types` lists its type | no worker of that type is running | say which worker is needed (see `app-overview`); on a cluster see `hpc-session` |
| Job RUNNING, progress not moving for > 10 min | worker may have died; the app marks such jobs FAILED after 10 min without a heartbeat | wait for that, then report |
| Job FAILED | read `error_message` in `job_detail` | report it verbatim; resubmit only if the cause is fixed |
| Upload task `stalled` | its process stopped (machine slept, session closed) | start the same `upload` again with the same `dataset_id`: finished files are skipped part by part |
| Upload `completed_with_failures` | some files failed | list `failed`, re-run `upload` for just those with the same `dataset_id` |
| Many EXTRACT_BINARY jobs queued | normal: one per uploaded `.bin`, done one at a time per amiga worker | wait, or start more amiga workers |

## Cancelling

- `cancel_job` stops a pending or running job.
- `cancel_task` stops an upload after the parts in flight.
- `delete_job` removes a job record for good and needs approval; cancelling
  is almost always what is wanted instead.

## Reporting

State counts, not adjectives: "102 of 102 extraction jobs completed, 0
failed", "upload 64 %, 17 MB/s, about 20 min left". Name every failure with
its id and error.

## Workers

A job needs the worker for its type. You do not start workers by hand:
submitting a job starts its worker, and the tool's result carries a
`workers` note (`running`, `queued`, `started for this job`).

- `processes` lists the core, each worker and the agent model with state,
  where it runs, and how many jobs wait for it. Use it when a job stays
  PENDING: a worker that is `queued` is waiting for the cluster, not broken.
- `start_process` / `stop_process` start or stop one by name. Stop workers
  that are idle when the work is finished: they hold cluster allocation.
  `stop_process` refuses while the worker has a running job.

## Cleaning up

`delete_job` and `delete_files` remove a job record or stored files for
good. Both stop and ask the person. Say exactly what will be deleted and
why before calling them; never delete to "retry cleanly".
