#!/bin/bash -l
# submit-worker.sh <worker>   (runs where sbatch works: login or compute node)
# Tries each "partition:account" in WORKER_TRY in order and submits to the
# first one Slurm says could start within GEMI_FALLBACK_MINUTES (default 10);
# if none can, submits to the last (the fallback). Skips if one is already
# queued or running for this user, unless WORKER_MAX_<worker> in launch.conf
# allows more copies: then another is submitted only when a placement could
# start it now (within GEMI_FALLBACK_MINUTES), never into a long wait.
source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
source "$HPC/clusters/current/launch.conf"
# A placement chosen for this one submit (the app's Compute panel) wins over the configured list.
WORKER_TRY=${GEMI_WORKER_TRY:-$WORKER_TRY}

W=${1:?worker name}
NAME=$JOB_PREFIX-worker-$W
MAX_VAR=WORKER_MAX_$W; MAX=${!MAX_VAR:-1}
[[ "$MAX" =~ ^[0-9]+$ ]] && [ "$MAX" -ge 1 ] || MAX=1
HAVE=$(squeue -h -u "$USER" -n "$NAME" -o %i | grep -c .)
EXTRA=""
if [ "$HAVE" -ge 1 ]; then
  if [ "$HAVE" -ge "$MAX" ] || squeue -h -u "$USER" -n "$NAME" -t PENDING -o %i | grep -q .; then
    echo "$NAME already queued/running ($HAVE of at most $MAX): $(squeue -h -u "$USER" -n "$NAME" -o '%i %P %T' | tr '\n' ';')"; exit 0
  fi
  EXTRA=1     # another copy, only if it can start now
fi

RES_VAR=WORKER_RES_$W; eval "${!RES_VAR:-cpus=4 mem=16G gpus=0}"
NODE_OPT=()
if [ "$W" = gwas ]; then
  # The GWAS worker reads genotypes and traits from the database itself, and the database
  # listens on the core node's loopback only: run it on that node, in the core's placement.
  source "$RUN/session.env" 2>/dev/null
  core_place=$(squeue -h -u "$USER" -n "$JOB_PREFIX-core" -t RUNNING -o '%P:%a' | head -1)
  [ -n "${CORE_NODE:-}" ] && [ -n "$core_place" ] || { echo "worker gwas runs beside the core: start the core first"; exit 1; }
  WORKER_TRY=$core_place
  NODE_OPT=(--nodelist="$CORE_NODE")
fi
[ "$W" = gwas ] || allowed_place "$WORKER_TRY" || { echo "placement not in launch.conf: $WORKER_TRY" >&2; exit 77; }
# A placement may carry its own GPU request (partition:account:gpu[:type]:N, as in LLM_TRY):
# `worker ml where=…:gpu:1` gives this one worker a GPU without changing WORKER_RES_ml.
place_parts() {   # entry -> part acct gres gpus (gres empty: the worker's own gpus)
  local e=$1 rest
  P_PART=${e%%:*}; rest=${e#*:}; P_ACCT=${rest%%:*}; P_GRES=""; P_GPUS=$gpus
  if [ "$rest" != "$P_ACCT" ]; then P_GRES=${rest#*:}; P_GPUS=${P_GRES##*:}; fi
  [ -z "$P_GRES" ] && [ "$gpus" -gt 0 ] && P_GRES="gpu:$gpus"
}
for entry in $WORKER_TRY; do place_parts "$entry"; check_job "$cpus" "$mem" "$P_GPUS" "$WORKER_TIME" || exit 77; done
LIMIT=$(( ${GEMI_FALLBACK_MINUTES:-10} * 60 ))
now=$(date +%s)
common=(--job-name="$NAME" --cpus-per-task="$cpus" --mem="$mem" --time="$WORKER_TIME" "${NODE_OPT[@]}"
        --output="$LOGS/worker-$W-%j.log")

chosen=""
n_try=$(wc -w <<< "$WORKER_TRY")
for entry in $WORKER_TRY; do
  place_parts "$entry"; part=$P_PART acct=$P_ACCT
  # Slurm's estimate ignores group limits: where this user's jobs already wait on one (QOSGrp*),
  # the place is full whatever it says. Skipped unless it is the only one.
  if [ "$n_try" -gt 1 ] && squeue -h -u "$USER" -p "$part" -A "$acct" -t PENDING -o %r 2>/dev/null | grep -q '^QOSGrp'; then
    echo "  $part: skipped (its account's CPU allowance is full: jobs already wait there)"
    continue
  fi
  opts=(--partition="$part" --account="$acct" --export=ALL,GEMI_HPC_ROOT="$GEMI_HPC_ROOT",GEMI_WORKER="$W",GEMI_GPUS="$P_GPUS")
  [ -n "$P_GRES" ] && opts+=(--gres="$P_GRES")
  est=$(sbatch --test-only "${opts[@]}" "${common[@]}" "$HPC/remote/worker.sbatch" 2>&1)
  start=$(echo "$est" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}' | head -1)
  if [ -z "$start" ]; then echo "  $part: not usable ($(echo "$est" | head -1 | cut -c1-90))"; continue; fi
  wait_s=$(( $(date -d "$start" +%s) - now ))
  echo "  $part: could start in ~$(( wait_s > 0 ? wait_s / 60 : 0 )) min${P_GRES:+ (with $P_GRES)}"
  chosen="$entry"
  [ "$wait_s" -le "$LIMIT" ] && { fits=1; break; }
done
[ -n "$chosen" ] || { echo "no partition accepted worker $W"; exit 1; }
if [ -n "$EXTRA" ] && [ -z "${fits:-}" ]; then
  echo "$NAME: no room to start another copy now ($HAVE running); the queued jobs wait for the running one"; exit 0
fi

place_parts "$chosen"; part=$P_PART acct=$P_ACCT
opts=(--partition="$part" --account="$acct" --export=ALL,GEMI_HPC_ROOT="$GEMI_HPC_ROOT",GEMI_WORKER="$W",GEMI_GPUS="$P_GPUS")
[ -n "$P_GRES" ] && opts+=(--gres="$P_GRES")
sbatch "${opts[@]}" "${common[@]}" "$HPC/remote/worker.sbatch" | sed "s/$/ ($NAME on $part${P_GRES:+, $P_GRES})/"
