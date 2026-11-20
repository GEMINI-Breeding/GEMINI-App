#!/bin/bash -l
# submit-llm.sh [model]  — submit the vLLM job to the first "partition:account:gres"
# in LLM_TRY that Slurm says could start within GEMI_FALLBACK_MINUTES (default 10),
# else to the one with the earliest estimated start.
source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
source "$HPC/clusters/current/launch.conf"
# A placement chosen for this one submit (the app's Compute panel) wins over the configured list.
LLM_TRY=${GEMI_LLM_TRY:-$LLM_TRY}

NAME=$JOB_PREFIX-llm
if squeue -h -u "$USER" -n "$NAME" -o %i | grep -q .; then
  echo "$NAME already queued/running: $(squeue -h -u "$USER" -n "$NAME" -o '%i %P %T' | tr '\n' ';')"; exit 0
fi
[ -s "$IMAGES/vllm.sif" ] || { echo "no vllm.sif yet — run: gemi-hpc llm pull"; exit 1; }
eval "$LLM_RES"
allowed_place "$LLM_TRY" || { echo "placement not in launch.conf: $LLM_TRY" >&2; exit 77; }
check_job "$cpus" "$mem" 1 "$LLM_TIME" || exit 77
LIMIT=$(( ${GEMI_FALLBACK_MINUTES:-10} * 60 )); now=$(date +%s)
common=(--job-name="$NAME" --cpus-per-task="$cpus" --mem="$mem" --time="$LLM_TIME"
        --output="$LOGS/llm-%j.log" --export=ALL,GEMI_HPC_ROOT="$GEMI_HPC_ROOT",GEMI_LLM_MODEL="${1:-}")
best="" best_wait=999999999
for entry in $LLM_TRY; do
  part=${entry%%:*}; rest=${entry#*:}; acct=${rest%%:*}; gres=${rest#*:}
  opts=(--partition="$part" --account="$acct" --gres="$gres")
  est=$(sbatch --test-only "${opts[@]}" "${common[@]}" "$HPC/remote/llm.sbatch" 2>&1)
  start=$(echo "$est" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}' | head -1)
  if [ -z "$start" ]; then echo "  $part ($gres): not usable ($(echo "$est" | head -1 | cut -c1-90))"; continue; fi
  wait_s=$(( $(date -d "$start" +%s) - now ))
  echo "  $part ($gres): could start in ~$(( wait_s > 0 ? wait_s / 60 : 0 )) min"
  if [ "$wait_s" -lt "$best_wait" ]; then best=$entry best_wait=$wait_s; fi
  [ "$wait_s" -le "$LIMIT" ] && break
done
[ -n "$best" ] || { echo "no partition accepted the LLM job"; exit 1; }
part=${best%%:*}; rest=${best#*:}; acct=${rest%%:*}; gres=${rest#*:}
sbatch --partition="$part" --account="$acct" --gres="$gres" "${common[@]}" "$HPC/remote/llm.sbatch" | sed "s/$/ ($NAME on $part)/"
