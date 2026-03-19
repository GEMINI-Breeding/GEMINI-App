FROM python:3.12-slim

# System libraries required by OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 \
      libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# PyTorch CPU-only (avoids the ~3 GB CUDA variant)
RUN pip install --no-cache-dir \
      torch --index-url https://download.pytorch.org/whl/cpu

# Remaining runtime dependencies
RUN pip install --no-cache-dir \
      farm-ng-amiga \
      kornia \
      kornia-rs \
      opencv-python-headless \
      tqdm \
      numpy \
      pandas \
      scipy

# Build context is a temp directory assembled at runtime with this layout:
#   bin_to_images/   ← backend/bin_to_images/ source
#   run_extraction.py
#   Dockerfile
ARG GEMI_HASH=unknown
LABEL gemi.hash=${GEMI_HASH}

COPY bin_to_images /app/bin_to_images
ENV PYTHONPATH="/app"

COPY run_extraction.py /app/run_extraction.py

ENTRYPOINT ["python", "/app/run_extraction.py"]
