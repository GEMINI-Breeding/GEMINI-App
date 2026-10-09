#!/bin/bash -l
#SBATCH --job-name=gemi-pull-llm
#SBATCH --cpus-per-task=8
#SBATCH --mem=48G
#SBATCH --time=06:00:00
# One-time setup for the local LLM: converts the vLLM image to .sif and
# downloads the model weights to group storage. Submitted by `gemi-hpc llm pull`,
# which adds --partition/--account/--output and exports GEMI_HPC_ROOT, MODELS.

source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
source "$HPC/clusters/current/launch.conf"
load_apptainer

out=$IMAGES/vllm.sif
if [ -s "$out" ]; then
  log "have vllm.sif"
else
  log "pulling vllm <- $LLM_IMAGE"
  if apptainer pull "$out.tmp" "docker://$LLM_IMAGE" >"$LOGS/pull-vllm.log" 2>&1; then
    mv "$out.tmp" "$out"; log "ok vllm ($(du -h "$out" | cut -f1))"
  else
    rm -f "$out.tmp"; log "FAILED vllm — see $LOGS/pull-vllm.log"; tail -5 "$LOGS/pull-vllm.log"; exit 1
  fi
fi

mkdir -p "$DATA/llm/hf"
failed=0
for model in ${MODELS:-$LLM_MODEL}; do
  log "downloading $model"
  mlog=$LOGS/pull-llm-$(basename "$model").log
  # HF_TOKEN (if set in the login environment) is passed through for gated models.
  if apptainer exec --no-home -B "$DATA/llm/hf:/hf" --env "HF_HOME=/hf,HF_TOKEN=${HF_TOKEN:-}" "$out" \
       python3 -c "from huggingface_hub import snapshot_download; print(snapshot_download('$model'))" \
       >"$mlog" 2>&1; then
    log "ok $model ($(du -sh "$DATA/llm/hf/hub/models--${model//\//--}" 2>/dev/null | cut -f1))"
  else
    failed=1; log "FAILED $model"; tail -5 "$mlog"
  fi
done
exit $failed
