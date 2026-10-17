#!/bin/bash -l
#SBATCH --requeue
#SBATCH --signal=B:TERM@120
# One GEMINIbase worker (amiga | stitch | geo | ml | ...) as its own Slurm job.
# Submitted by submit-worker.sh, which sets --job-name=gemi-worker-<name>,
# partition/account/resources and exports GEMI_HPC_ROOT, GEMI_WORKER, GEMI_GPUS.
#
# The worker claims jobs from the core's REST API, so it only needs to reach
# the core node. The current source is mounted over the image's /app/gemini.

source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
load_apptainer
W=${GEMI_WORKER:?}

# The core may still be starting, or restarting after a preemption.
wait_for 900 "core session" test -s "$RUN/session.env" || exit 1
source "$RUN/session.env"

WTMP=/tmp/gemi-$USER-$SLURM_JOB_ID
trap 'rm -rf "$WTMP"' EXIT
# --pwd /app: Apptainer ignores the image's WORKDIR, and the worker is started
# as `python -m gemini.workers.<name>.worker` relative to it.
ARGS=(run --cleanenv --no-home --writable-tmpfs --pwd /app $(private_ipc "$WTMP/shm") --env-file "$RUN/stack.env"
      -B "$SRC/gemini/workers:/app/gemini/workers" -B "$SRC/gemini/__init__.py:/app/gemini/__init__.py")
if [ "$W" = ml ]; then
  mkdir -p "$DATA/models"
  ARGS+=(-B "$DATA/models:/models" --env "GEMINI_MODEL_CACHE_DIR=/models,HF_HOME=/models/huggingface")
  [ "${GEMI_GPUS:-0}" -gt 0 ] && ARGS+=(--nv)
  # Hugging Face / local-weights backends, if installed (gemi-hpc pull ml-deps).
  # Appended to sys.path, so the image's own numpy / Pillow / OpenCV still win.
  if [ -e "$DATA/pydeps/ml/.installed" ]; then
    ARGS+=(-B "$DATA/pydeps/ml:/pydeps:ro" --env "PYTHONPATH=/app:/pydeps,YOLO_AUTOINSTALL=false,YOLO_CONFIG_DIR=/models/ultralytics")
  fi
fi

if [ "$W" = odm ]; then
  # The ODM worker drives a NodeODM server; run one beside it in this job
  # (the compose stack's `geminibase-nodeodm` sidecar). Its task data goes to
  # node-local disk: large, temporary, and I/O heavy.
  ODM_PORT=$(free_port)
  mkdir -p "$WTMP/odm/data" "$WTMP/odm/tmp"
  # --ipc alone (a fresh tmpfs /dev/shm), not private_ipc: this image's glibc
  # refuses POSIX semaphores unless /dev/shm is a real tmpfs, and without
  # them OpenSfM silently runs single-process and dies an hour in with
  # queue.Full ("strange values in the reconstruction").
  apptainer exec --cleanenv --no-home --writable-tmpfs --pwd /var/www --ipc \
    -B "$WTMP/odm/data:/var/www/data" -B "$WTMP/odm/tmp:/var/www/tmp" \
    "$IMAGES/nodeodm.sif" /usr/bin/node /var/www/index.js --port "$ODM_PORT" \
    >"$LOGS/nodeodm-$SLURM_JOB_ID.log" 2>&1 &
  ODM_PID=$!
  wait_for 180 "nodeodm" curl -sf "http://127.0.0.1:$ODM_PORT/info" || { tail -20 "$LOGS/nodeodm-$SLURM_JOB_ID.log"; exit 1; }
  ARGS+=(--env "GEMINI_NODEODM_URL=http://127.0.0.1:$ODM_PORT")
  trap 'kill $ODM_PID 2>/dev/null; rm -rf "$WTMP"' EXIT
fi

log "worker $W on $(hostname) -> core $CORE_NODE (job $CORE_JOB_ID)"
apptainer "${ARGS[@]}" "$IMAGES/worker-$W.sif" &
PID=$!
# Ends this job after a quiet spell (no job of this worker's kinds waiting or running), so it does
# not hold a node, least of all a GPU, between batches of work. launch.conf sets the minutes.
source "$HPC/clusters/current/launch.conf" 2>/dev/null
if [ "${GEMI_GPUS:-0}" -gt 0 ]; then IDLE=${WORKER_IDLE_MINUTES_GPU:-5}; else IDLE=${WORKER_IDLE_MINUTES:-20}; fi
worker_idle_watch "$PID" "$IDLE" $(worker_job_types "$W")
log "worker $W stops itself after $IDLE min with no work"
# SIGTERM (preemption, scancel, time limit): the worker stops claiming and exits.
trap 'log "worker $W: stop signal"; kill -TERM $PID 2>/dev/null; wait $PID; exit 0' TERM INT
wait $PID
