#!/bin/bash -l
#SBATCH --job-name=gemi-pull
#SBATCH --cpus-per-task=8
#SBATCH --mem=16G
#SBATCH --time=02:00:00
# Converts the stack's Docker images to .sif files (skips ones already there).
# Submitted by `gemi-hpc pull`, which adds --partition/--account/--output and
# exports GEMI_HPC_ROOT, GEMI_IMAGE_REGISTRY, GEMI_IMAGE_VERSION.

source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
load_apptainer

R=$GEMI_IMAGE_REGISTRY V=$GEMI_IMAGE_VERSION
IMAGES_LIST="
db=$R/geminibase-db:$V
storage=$R/geminibase-storage:$V
storage-init=$R/geminibase-storage-init:$V
logger=$R/geminibase-logger:$V
rest-api=$R/geminibase-rest-api:$V
worker-amiga=$R/geminibase-worker-amiga:$V
worker-stitch=$R/geminibase-worker-stitch:$V
worker-geo=$R/geminibase-worker-geo:$V
worker-odm=$R/geminibase-worker-odm:$V
worker-ml=$R/geminibase-worker-ml:$V
titiler=ghcr.io/developmentseed/titiler:2.0.1
nodeodm=opendronemap/nodeodm@sha256:cb07d06e21fd6189cfad287c6fedfa0b72568100355635cd9035cb86eed42ee2
"
failed=0
for entry in $IMAGES_LIST; do
  name=${entry%%=*} ref=${entry#*=}
  [ -n "${ONLY:-}" ] && [[ " $ONLY " != *" $name "* ]] && continue
  out=$IMAGES/$name.sif
  if [ -s "$out" ]; then log "have $name"; continue; fi
  log "pulling $name <- $ref"
  if apptainer pull "$out.tmp" "docker://$ref" >"$LOGS/pull-$name.log" 2>&1; then
    mv "$out.tmp" "$out"; log "ok $name ($(du -h "$out" | cut -f1))"
  else
    rm -f "$out.tmp"; failed=1; log "FAILED $name — see $LOGS/pull-$name.log"; tail -3 "$LOGS/pull-$name.log"
  fi
done
ls -lh "$IMAGES"
exit $failed
