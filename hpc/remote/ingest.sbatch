#!/bin/bash -l
# Upload a folder that is already on the cluster into the session's app, as
# one batch (the same records an upload from the app makes: dataset, files,
# extraction for rover logs, the run on the Process tab). Submitted by
# `gemi-gate ingest`, which checked the folder and the settings; this job
# reads only that folder. Runs the agent's uploader with the model worker
# image's Python, against the session API over the cluster network.

source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
# Our own copy of the output: the site's end-of-job report can replace the
# head of the Slurm log. Read it with `gemi-hpc logs upload`.
exec > >(tee -a "$LOGS/upload-$SLURM_JOB_ID.log") 2>&1
load_apptainer
wait_for 600 "core session" test -s "$RUN/session.env" || exit 1
source "$RUN/session.env"
source "$RUN/secrets.env"

WTMP=/tmp/gemi-$USER-$SLURM_JOB_ID
mkdir -p "$WTMP/home"
trap 'rm -rf "$WTMP"' EXIT
ENV="$WTMP/ingest.env"
umask 077
cat > "$ENV" <<EOF
GEMI_API=http://$CORE_IP:$API_PORT
GEMI_EMAIL=$GEMINI_FIRST_SUPERUSER_EMAIL
GEMI_PASSWORD=$GEMINI_FIRST_SUPERUSER_PASSWORD
GEMI_AGENT_HOME=/agenthome
PYTHONPATH=/agentsrc
EOF
mapfile -t A < "$GEMI_INGEST_ARGS"
rm -f "$GEMI_INGEST_ARGS"
log "ingest $GEMI_INGEST_DIR -> $CORE_NODE (${A[*]})"
apptainer exec --cleanenv --no-home --env-file "$ENV" \
  -B "$GEMI_INGEST_DIR:$GEMI_INGEST_DIR:ro" -B "$HPC:/agentsrc:ro" -B "$WTMP/home:/agenthome" \
  "$IMAGES/worker-ml.sif" python -m gemi_agent ingest "$GEMI_INGEST_DIR" "${A[@]}"
