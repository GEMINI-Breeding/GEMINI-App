---
name: hpc-session
description: Run the GEMINI stack, its workers and a local language model on a Slurm cluster with Apptainer using the gemi-hpc command — start, check, add workers, serve a model, shut down. Use for "start it on the cluster", "start a worker", "bring up the model", "shut down".
---

# Running on a Slurm cluster (`gemi-hpc`)

## Quick path

1. `processes` — the core, each worker and the model with their state.
2. Nothing running: `hpc` with `action` `up` (asks the person), then `hpc` with `action` `connect`.
3. Workers: none to start by hand; a submitted job starts its worker. `stop_process` an idle one when the work is done.
4. End of the day: `hpc` with `action` `down` (asks the person). Data stays on the cluster.

These are **shell commands** run from the repository root on the person's
computer (Git Bash on Windows), not agent tools. `gemi-hpc` talks to the
cluster over SSH. Cluster settings: `hpc/clusters/<name>/launch.conf`.

A *session* is one core job (database, storage, API) plus worker jobs. Data
persists on the cluster's group storage between sessions.

## Start a session

```bash
bash hpc/gemi-hpc sync            # copy current code + scripts to the cluster
bash hpc/gemi-hpc up              # core job; waits until the API answers
bash hpc/gemi-hpc worker amiga    # workers as needed: amiga stitch geo ml odm
bash hpc/gemi-hpc status          # jobs of this session and where the core is
```

Which worker for which step:

| Step | Worker |
|---|---|
| extract uploaded rover logs | `amiga` |
| stitch plots | `stitch` |
| inference, trait extraction | `ml` |
| orthomosaic | `odm` (starts its own NodeODM beside it) |

Workers go to the first partition that can start soon and fall back to
weaker ones; the command prints the estimated wait for each.

From the agent's tools: `processes` shows the core, every worker and the
model with their state; `start_process` / `stop_process` start or stop one
(`where` picks a placement from the cluster's list). Submitting a job starts
its worker by itself, so `start_process` is rarely needed. Stop idle workers
when the work is done: `bash hpc/gemi-hpc stop odm`, or `stop_process`.

## Use it

```bash
bash hpc/gemi-hpc app             # tunnel + the app on free local ports; prints URL and login
bash hpc/gemi-hpc tunnel 7777     # or only the API, e.g. for terminal agents (GEMI_API=http://127.0.0.1:7777)
bash hpc/gemi-hpc logs worker-stitch   # tail a log: core, rest-api, worker-<name>, llm, pull-llm
```

## Local language model (vLLM)

```bash
bash hpc/gemi-hpc llm pull        # once: container image + model weights (Slurm job, can take an hour)
bash hpc/gemi-hpc llm up          # start the model on a GPU; prints wait estimates per partition
bash hpc/gemi-hpc llm status      # queued / running, address once it answers
bash hpc/gemi-hpc llm tunnel 8000 # reach it at http://localhost:8000/v1 from this computer
bash hpc/gemi-hpc llm down
```

The model's name, address and key are written to `run/llm.env` on the
cluster; the agent service started with the session picks them up by
itself. Model and partitions: `LLM_*` in `launch.conf`.

## Shut down

```bash
bash hpc/gemi-hpc down            # stops workers, then the core; the database is saved
bash hpc/gemi-hpc llm down
```

Always shut down when done: running jobs count against the group's quota.

## When things go wrong

| Symptom | Cause | Do |
|---|---|---|
| `up` waits a long time | partition queue | `status` shows the reason; change `CORE_PARTITION` in `launch.conf` |
| job PENDING in the app forever | no worker of that type | `gemi-hpc worker <name>` |
| worker gone, its job FAILED | preempted on a low-priority partition | start the worker again, resubmit the job |
| `status` errors with "Unable to contact slurm controller" | scheduler briefly down | running jobs are unaffected; retry later |
| app shows connection errors after the core restarted | core moved to another node | stop and re-run `gemi-hpc app` |
| `llm up` says no vllm.sif | image not pulled | `gemi-hpc llm pull` first |

## Reporting

Job ids, partitions and wait estimates as printed; what is running at the
end; and whether anything was left running on purpose.

## Safety: the gate, the limits, what asks first

The cluster's storage is shared and not backed up. Three rules follow, and
none of them may be worked around; if one blocks you, report it.

1. **Only through the gate.** `gemi-hpc` never sends shell text to the
   cluster. Each action runs `hpc/remote/gemi-gate` there, which has a fixed
   menu, acts only inside the GEMI directory, and logs every call
   (`bash hpc/gemi-hpc logs gate`). Never write raw `ssh`, `scp`, `rsync`,
   `sbatch` or `scancel` commands, and never call ssh from a script to get
   around this.
2. **Job limits.** The gate refuses a job over the limits (by default 32
   CPUs, 128 GB, 1 GPU, 2 days, 10 GEMI jobs at once) and a placement the
   cluster's `launch.conf` does not name. Only the person changes those, in
   `launch.conf`.
3. **What asks the person first.** Reading is free, and so is routine work
   inside the configured setup (pipeline jobs, starting a worker). Asking
   first: `sync`, `pull…`, `up`, `down`, starting or stopping the model,
   writing the cluster configuration, stopping a worker that is busy, and
   anything that deletes data. Say what will happen and why before the call.

`bash hpc/gemi-hpc doctor` checks all of it: the connection, that the gate
refuses commands off its menu, the limits, and what is in flight.
