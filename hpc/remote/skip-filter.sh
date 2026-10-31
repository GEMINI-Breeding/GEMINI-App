#!/bin/bash
# Rules for a copy from online storage that leave out the files the app
# already holds for the upload's date, platform and sensor, so they are not
# copied again. Run by fetch.sbatch before rclone: skip-filter.sh <out>
# <patterns> <setting=…>…  Fails (and the copy takes everything) when the
# session cannot be asked; the upload still skips what is already there.
source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
out="$1" patterns="$2"; shift 2
load_apptainer
test -s "$RUN/session.env" || { log "no session to ask what it already has"; exit 1; }
source "$RUN/session.env"
if [ -r "$RUN/secrets.env" ]; then source "$RUN/secrets.env"; else source "$RUN/stack.env"; fi
WTMP=/tmp/gemi-$USER-skip-$$
mkdir -p "$WTMP/home" "$WTMP/out"
trap 'rm -rf "$WTMP"' EXIT
umask 077
cat > "$WTMP/env" <<EOV
GEMI_API=http://$CORE_IP:$API_PORT
GEMI_EMAIL=$GEMINI_FIRST_SUPERUSER_EMAIL
GEMI_PASSWORD=$GEMINI_FIRST_SUPERUSER_PASSWORD
GEMI_AGENT_HOME=/agenthome
PYTHONPATH=/agentsrc
EOV
apptainer exec --cleanenv --no-home --env-file "$WTMP/env" \
  -B "$HPC:/agentsrc:ro" -B "$WTMP/home:/agenthome" -B "$WTMP/out:/out" \
  "$IMAGES/worker-ml.sif" python -m gemi_agent cloud_filter /out/rules "$patterns" "$@" || exit 1
cp "$WTMP/out/rules" "$out"
