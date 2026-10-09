#!/bin/bash -l
#SBATCH --job-name=gemi-pull-mldeps
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=01:00:00
# One-time: Python packages the ml worker needs for Hugging Face and
# local-weights models (torch, transformers, ultralytics, …). The published
# worker-ml image only has the Roboflow HTTP client, so these are installed
# beside it on shared storage and put on PYTHONPATH by worker.sbatch — the
# Apptainer equivalent of the extra layers in workers/ml/Dockerfile.
# Submitted by `gemi-hpc pull ml-deps`.

source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
load_apptainer

DEPS=$DATA/pydeps/ml
mkdir -p "$DEPS" "$DATA/pip-cache"
REQ=$SRC/gemini/workers/ml/requirements-models.txt
log "installing model backends into $DEPS"
apptainer exec --cleanenv --no-home --writable-tmpfs -B "$DEPS:/pydeps" -B "$DATA/pip-cache:/pipcache" \
  -B "$REQ:/requirements-models.txt:ro" --env "PIP_CACHE_DIR=/pipcache,PYTHONNOUSERSITE=1" \
  "$IMAGES/worker-ml.sif" bash -c '
    set -e
    # numpy/Pillow/opencv stay the ones in the image (the worker pins them).
    pip install --no-warn-script-location --target /pydeps --upgrade \
        --extra-index-url https://download.pytorch.org/whl/cu124 torch torchvision
    pip install --no-warn-script-location --target /pydeps --upgrade -r /requirements-models.txt
    rm -rf /pydeps/numpy /pydeps/numpy-* /pydeps/numpy.libs /pydeps/PIL /pydeps/pillow-* /pydeps/Pillow-* \
           /pydeps/cv2 /pydeps/opencv_python*
    PYTHONPATH=/pydeps python -c "import torch, transformers, ultralytics, numpy, cv2; print(\"torch\", torch.__version__, \"transformers\", transformers.__version__, \"ultralytics\", ultralytics.__version__, \"numpy\", numpy.__version__, \"cv2\", cv2.__version__)"
  ' || { log "FAILED"; exit 1; }
date -Is > "$DEPS/.installed"
log "ok ($(du -sh "$DEPS" | cut -f1))"
