#!/bin/bash -l
# submit-worker.sh <worker>   (runs where sbatch works: login or compute node)
# Tries each "partition:account" in WORKER_TRY in order and submits to the
# first one Slurm says could start within GEMI_FALLBACK_MINUTES (default 10);
# if none can, submits to the last (the fallback). Skips if one is already
# queued or running for this user.
source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
source "$HPC/clusters/current/launch.conf"
# A placement chosen for this one submit (the app's Compute panel) wins over the configured list.
WORKER_TRY=${GEMI_WORKER_TRY:-$WORKER_TRY}

W=${1:?worker name}
NAME=$JOB_PREFIX-worker-$W
if squeue -h -u "$USER" -n "$NAME" -o %i | grep -q .; then
  echo "$NAME already queued/running: $(squeue -h -u "$USER" -n "$NAME" -o '%i %P %T' | tr '\n' ';')"; exit 0
fi

RES_VAR=WORKER_RES_$W; eval "${!RES_VAR:-cpus=4 mem=16G gpus=0}"
allowed_place "$WORKER_TRY" || { echo "placement not in launch.conf: $WORKER_TRY" >&2; exit 77; }
check_job "$cpus" "$mem" "$gpus" "$WORKER_TIME" || exit 77
LIMIT=$(( ${GEMI_FALLBACK_MINUTES:-10} * 60 ))
now=$(date +%s)
common=(--job-name="$NAME" --cpus-per-task="$cpus" --mem="$mem" --time="$WORKER_TIME"
        --output="$LOGS/worker-$W-%j.log" --export=ALL,GEMI_HPC_ROOT="$GEMI_HPC_ROOT",GEMI_WORKER="$W",GEMI_GPUS="$gpus")

chosen=""
for entry in $WORKER_TRY; do
  part=${entry%%:*} acct=${entry#*:}
  opts=(--partition="$part" --account="$acct")
  [ "$gpus" -gt 0 ] && opts+=(--gres=gpu:"$gpus")
  est=$(sbatch --test-only "${opts[@]}" "${common[@]}" "$HPC/remote/worker.sbatch" 2>&1)
  start=$(echo "$est" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}' | head -1)
  if [ -z "$start" ]; then echo "  $part: not usable ($(echo "$est" | head -1 | cut -c1-90))"; continue; fi
  wait_s=$(( $(date -d "$start" +%s) - now ))
  echo "  $part: could start in ~$(( wait_s > 0 ? wait_s / 60 : 0 )) min"
  chosen="$part:$acct"
  [ "$wait_s" -le "$LIMIT" ] && break
done
[ -n "$chosen" ] || { echo "no partition accepted worker $W"; exit 1; }

part=${chosen%%:*} acct=${chosen#*:}
opts=(--partition="$part" --account="$acct")
[ "$gpus" -gt 0 ] && opts+=(--gres=gpu:"$gpus")
sbatch "${opts[@]}" "${common[@]}" "$HPC/remote/worker.sbatch" | sed "s/$/ ($NAME on $part)/"
