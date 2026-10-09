---
name: connect-hpc
description: Connect the GEMINI app to the person's HPC cluster from just their SSH command — survey the cluster, decide where each part of the app should run (core, workers, GPU model), write the configuration, install, start and connect. Use for "set up my cluster", "here is my ssh login", "use our HPC for processing".
---

# Connecting a Slurm cluster

## Quick path

1. `hpc_probe` with the person's `ssh` command — a read-only survey.
2. Tell them the plan in plain words: where the core, the workers and the model would run, where the data goes. Wait for a yes.
3. `hpc_configure` with those choices (asks first).
4. `hpc` `sync`, then `hpc` `pull` if images are not installed (about 20 minutes: check `hpc` `logs` with `service` `pull`), then `hpc` `up`. Each asks first.
5. `hpc` `connect` — gives the app's address and login. Tell the person.
Login refused or a password prompt: stop; key-based SSH login has to be set up by the person.

The person gives an SSH login. You find out what the cluster offers, choose
where things run, and bring the app up on it. Tools: `hpc_probe`,
`hpc_configure`, `hpc`. They run on the person's computer with their SSH
access.

Needed from the person: the SSH command (`ssh user@host`), and key-based
login already working (no password prompt). If `hpc_probe` reports it cannot
log in with a key, stop and tell them to set that up (`ssh-keygen`,
`ssh-copy-id user@host`), then try again.

## 1. Survey

```json
{"tool": "hpc_probe", "args": {"ssh": "ssh jdoe@login.cluster.edu"}}
```

Read the result before choosing anything:

| Field | What it tells you |
|---|---|
| `containers` | must show Apptainer or Singularity. "NOT FOUND" = stop: the stack cannot run there; ask the cluster's support how containers are run |
| `my_accounts` | which Slurm account goes with which partition. A job needs a matching pair |
| `partitions_i_can_use` | CPUs, memory, GPUs per partition; `preemptible: true` means jobs there can be killed and requeued |
| `start_estimates_minutes` | how long a job of each kind (`core`, `worker`, `gpu`) would wait per partition/account right now; `"no: …"` = not allowed or impossible |
| `storage` | where there is room; the home directory is usually tiny |
| `internet_from_login_node` | images and model weights are downloaded there; both sites must answer |
| `recommendation` | a starting choice computed from the above |

## 2. Choose where each part runs

Start from `recommendation`, then check it against these rules:

| Part | Needs | Choose |
|---|---|---|
| **Core** (database, storage, API) | 4 CPUs, 16 GB, runs for the whole session, must not be killed | soonest **non-preemptible** partition; a preemptible one only if nothing else starts within the hour |
| **Workers** (extraction, stitching, orthomosaic) | 8–16 CPUs, 32–56 GB, hours | list of up to 4 `partition:account`, soonest first; preemptible is acceptable last (a killed job is resubmitted) |
| **ML worker** (inference) | 8 CPUs; a GPU helps but is not required | same list; `ml_gpu: true` only if a GPU partition starts soon |
| **Model for the agent** (vLLM) | one GPU: ≥ 40 GB memory for the 31B model, 16–24 GB for the small one | GPU partitions with A100 / H100 / A6000-class cards first; on ≤ 24 GB cards set `llm_model` to `google/gemma-4-E4B-it-qat-w4a16-ct` |
| **Data root** | hundreds of GB, shared between nodes | writable project/group/scratch storage with the most free space — **never** the home directory; add a folder of its own, e.g. `…/gemini_app` |

Things to weigh and say out loud to the person:
- An estimate of 0 minutes on a group-owned partition beats a "free for all"
  partition with hours of queue.
- Group partitions have quotas (`QOSGrp…Limit` in an estimate means the
  group's limit is reached). Do not put everything on one small quota.
- GPU cards: memory decides which model fits, not the card's name.
- If the data root you would choose already has a GEMI install
  (`already_installed`), reuse it — nothing needs downloading again.

Present the plan in a short table (part → partition/account → why → wait)
and the data root, and ask the person to confirm **before** writing the
configuration, unless they already told you to go ahead.

## 3. Write the configuration

```json
{"tool": "hpc_configure", "args": {"name": "mycluster", "ssh": "ssh jdoe@login.cluster.edu",
 "data_root": "/project/lab/gemini_app", "core": "gpu-part:labgrp",
 "workers_try": ["gpu-part:labgrp", "shared:general"],
 "llm_try": ["gpu-part:labgrp:gpu:1", "shared:general:gpu:1"]}}
```

## 4. Install (first time only)

| Step | Call | Takes |
|---|---|---|
| copy code and scripts | `hpc` `{"action": "sync"}` | seconds |
| container images | `{"action": "pull"}` | ~20 min (Slurm job) |
| model image + weights | `{"action": "pull_llm"}` | up to 1 h |
| model backends for inference | `{"action": "pull_ml_deps"}` | ~15 min |

Skip what `already_installed` shows is there. Follow a download with
`{"action": "logs", "service": "pull"}` (or `pull-llm`, `pull-mldeps`).

## 5. Start and connect

1. `{"action": "sync"}` (always: it carries the current code).
2. `{"action": "up"}` — waits until the API answers.
3. `{"action": "worker", "workers": ["amiga", "stitch"]}` — only what the
   planned work needs (see `hpc-session` for which worker does what).
4. `{"action": "llm_up"}` if the agent should use the cluster's model; it
   takes ~5 min to load after the job starts (`llm_status`).
5. `{"action": "connect"}` — opens tunnels so the app on this computer
   reaches the cluster. Give the person the returned sign-in (email and
   password) and tell them to open the app and sign in.
6. `{"action": "status"}` to confirm.

## When done

`{"action": "down"}` stops workers and core cleanly (the database is saved)
and closes the tunnels; `{"action": "llm_down"}` stops the model. Always do
this at the end of a session: running jobs use the group's quota.

## Stop and ask

- No container runtime, or no account/partition pair that can start anything.
- The only storage with room is the home directory.
- More than one plausible data root, or an existing install you did not
  expect.
- Anything that would run for many hours on a partition the person did not
  mention.

## What asks the person first

`hpc_configure`, and the `hpc` actions `sync`, `pull`, `pull_llm`,
`pull_ml_deps`, `up`, `llm_up`, `llm_down` and `down`, stop and wait for the
person's approval in the app. That is intended: propose the plan in plain
words first, then make the call, so the approval they see matches what you
told them. The survey (`hpc_probe`) and `status` / `logs` / `connect` do not
ask. See `hpc-session` for the gate and the job limits.
