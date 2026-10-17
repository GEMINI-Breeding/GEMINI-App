#!/bin/bash -l
#SBATCH --job-name=gemi-llm
#SBATCH --requeue
#SBATCH --signal=B:TERM@60
# A local LLM for the agent: vLLM serving one model with an OpenAI-compatible
# API on a GPU node. Submitted by submit-llm.sh. Writes run/llm.env (URL, model
# name, key) once the server answers; the agent service and `gemi-hpc llm
# tunnel` read it. Independent of the core session.

source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
source "$HPC/clusters/current/launch.conf"
load_apptainer

MODEL=${GEMI_LLM_MODEL:-$LLM_MODEL}
PORT=$(free_port)
IP=$(node_ip)
[ -s "$RUN/llm.key" ] || (umask 077; head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' > "$RUN/llm.key")
KEY=$(cat "$RUN/llm.key")
TMP=/tmp/gemi-$USER-$SLURM_JOB_ID
mkdir -p "$TMP" "$DATA/llm/hf"
rm -f "$RUN/llm.env"
cleanup() { rm -f "$RUN/llm.env"; rm -rf "$TMP"; }
trap cleanup EXIT

log "vLLM: $MODEL on $(hostname) ($(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | tr '\n' ';'))"
# HF_HUB_OFFLINE: weights were fetched by pull-llm.sbatch; never download on a GPU allocation.
# shellcheck disable=SC2086  # LLM_ARGS is a list of flags
apptainer exec --nv --no-home --writable-tmpfs $(private_ipc "$TMP/shm") \
  -B "$DATA/llm/hf:/hf" --env "HF_HOME=/hf,HF_HUB_OFFLINE=1,VLLM_NO_USAGE_STATS=1" \
  "$IMAGES/vllm.sif" \
  vllm serve "$MODEL" --host 0.0.0.0 --port "$PORT" --api-key "$KEY" \
    --served-model-name "$LLM_NAME" $LLM_ARGS &
PID=$!
trap 'log "stop signal"; kill -TERM $PID 2>/dev/null; wait $PID; cleanup; exit 0' TERM INT

t=0
until curl -sf -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; do
  kill -0 $PID 2>/dev/null || { log "vLLM exited during start-up"; exit 1; }
  sleep 5; t=$((t + 5))
  [ $t -ge 1800 ] && { log "vLLM not ready after 30 min"; kill $PID; exit 1; }
done
umask 077
{
  echo "LLM_JOB_ID=$SLURM_JOB_ID"
  echo "LLM_NODE=$(hostname)"
  echo "LLM_IP=$IP"
  echo "LLM_PORT=$PORT"
  echo "LLM_URL=http://$IP:$PORT/v1"
  echo "LLM_MODEL_NAME=$LLM_NAME"
  echo "LLM_MODEL_ID=$MODEL"
  echo "LLM_KEY=$KEY"
} > "$RUN/llm.env"
log "vLLM up after ${t}s: http://$IP:$PORT/v1 (model name: $LLM_NAME)"
# The model holds a GPU while it waits for questions. End the job after LLM_IDLE_MINUTES with no
# request served (vLLM's own counters), so an agent that has gone quiet does not keep a GPU busy.
IDLE=${LLM_IDLE_MINUTES:-30}
if [ "$IDLE" -gt 0 ]; then
  ( last="" quiet=0
    while kill -0 $PID 2>/dev/null; do
      sleep 60
      m=$(curl -sf -m 10 -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/metrics" 2>/dev/null) || continue
      done_n=$(echo "$m" | awk '/^vllm:request_success_total/ {s += $NF} END {printf "%d", s}')
      busy=$(echo "$m" | awk '/^vllm:num_requests_(running|waiting)/ {s += $NF} END {printf "%d", s}')
      if [ "$done_n" = "$last" ] && [ "${busy:-0}" -eq 0 ]; then quiet=$((quiet + 1)); else quiet=0; fi
      last=$done_n
      if [ "$quiet" -ge "$IDLE" ]; then
        log "no requests for $IDLE min: stopping the model to free the GPU (gemi-hpc llm up starts it again)"
        kill -TERM $PID 2>/dev/null
        break
      fi
    done ) &
fi
wait $PID
