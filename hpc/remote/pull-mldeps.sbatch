#!/bin/bash -l
#SBATCH --job-name=gemi-pull-mldeps
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=02:00:00
# One-time: Python packages the ml worker needs for Hugging Face and
# local-weights models (torch, transformers, ultralytics, …). The published
# worker-ml image only has the Roboflow HTTP client, so these are installed
# beside it on shared storage and put on PYTHONPATH by worker.sbatch — the
# Apptainer equivalent of the extra layers in workers/ml/Dockerfile.
# Submitted by `gemi-hpc pull ml-deps`.

source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
load_apptainer

DEPS=$DATA/pydeps/ml
# Built in a fresh folder and swapped in at the end: a running ml worker keeps
# files of the current one open (on NFS those cannot be removed), which made
# an in-place upgrade fail ("Directory not empty").
NEW=$DATA/pydeps/ml.new
rm -rf "$DATA"/pydeps/ml.old-* 2>/dev/null || true   # earlier swaps, once no worker uses them
rm -rf "$NEW"; mkdir -p "$NEW" "$DATA/pip-cache"
REQ=$SRC/gemini/workers/ml/requirements-models.txt
log "installing model backends into $NEW (then swapped in for $DEPS)"
apptainer exec --cleanenv --no-home --writable-tmpfs -B "$NEW:/pydeps" -B "$DATA/pip-cache:/pipcache" \
  -B "$REQ:/requirements-models.txt:ro" --env "PIP_CACHE_DIR=/pipcache,PYTHONNOUSERSITE=1" \
  "$IMAGES/worker-ml.sif" bash -c '
    set -e
    # numpy/Pillow/opencv stay the ones in the image (the worker pins them).
    pip install --no-warn-script-location --target /pydeps --upgrade \
        --extra-index-url https://download.pytorch.org/whl/cu124 torch torchvision
    # numpy<2 alongside: the image keeps numpy 1.x, so every package must be a
    # build for it (scipy 1.15+, for one, only imports under numpy 2).
    pip install --no-warn-script-location --target /pydeps --upgrade -r /requirements-models.txt "numpy>=1.24,<2"
    rm -rf /pydeps/numpy /pydeps/numpy-* /pydeps/numpy.libs /pydeps/PIL /pydeps/pillow-* /pydeps/Pillow-* \
           /pydeps/cv2 /pydeps/opencv_python*
    PYTHONPATH=/pydeps python -c "import torch, transformers, ultralytics, numpy, cv2, scipy.optimize; print(\"torch\", torch.__version__, \"transformers\", transformers.__version__, \"ultralytics\", ultralytics.__version__, \"numpy\", numpy.__version__, \"cv2\", cv2.__version__)"
  ' || { log "FAILED (the current packages are unchanged)"; rm -rf "$NEW" 2>/dev/null; exit 1; }
date -Is > "$NEW/.installed"
if [ -d "$DEPS" ]; then mv "$DEPS" "$DATA/pydeps/ml.old-$(date +%s)"; fi
mv "$NEW" "$DEPS"
rm -rf "$DATA"/pydeps/ml.old-* 2>/dev/null || true
log "ok ($(du -sh "$DEPS" | cut -f1))"
