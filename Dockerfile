# syntax=docker/dockerfile:1.4
FROM --platform=$TARGETPLATFORM python:3.9-slim AS base

# Enable BuildKit features
ARG BUILDKIT_INLINE_CACHE=1
ARG TARGETPLATFORM
ARG BUILDPLATFORM

# Frontend builder stage
FROM --platform=$BUILDPLATFORM node:18-alpine AS frontend-builder
WORKDIR /app/gemini-app
COPY gemini-app/package*.json ./
# Use npm ci with multiple cores
RUN npm ci --legacy-peer-deps --omit=dev --prefer-offline
COPY gemini-app/ ./
# Enable parallel builds for React
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# Python dependencies builder (parallel stage)
FROM base AS python-builder
# Install build deps with parallel downloads (added GDAL dependencies for fiona)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl build-essential gcc g++ cmake pkg-config \
    libssl-dev zlib1g-dev libffi-dev python3-dev \
    libxml2-dev libxslt1-dev \
    libgdal-dev gdal-bin libgeos-dev libproj-dev \
    libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install conda and mamba
RUN set -eux; \
    echo "Building on ${BUILDPLATFORM:-unknown} for ${TARGETPLATFORM:-unknown}"; \
    case "${TARGETPLATFORM}" in \
      linux/arm64*|linux/aarch64*) \
        MINICONDA=Miniconda3-latest-Linux-aarch64.sh; \
        echo "Selected ARM64 installer: $MINICONDA"; \
        ;; \
      linux/amd64*|linux/x86_64*|*) \
        MINICONDA=Miniconda3-latest-Linux-x86_64.sh; \
        echo "Selected AMD64 installer: $MINICONDA"; \
        ;; \
    esac; \
    curl -L -o /tmp/miniconda.sh "https://repo.anaconda.com/miniconda/$MINICONDA" \
    && chmod +x /tmp/miniconda.sh \
    && /tmp/miniconda.sh -b -p /opt/conda \
    && rm /tmp/miniconda.sh \
    && /opt/conda/bin/conda config --set auto_activate_base false \
    && /opt/conda/bin/conda config --set channel_priority strict \
    && printf "yes\n" | /opt/conda/bin/conda tos accept \
    && /opt/conda/bin/conda install -n base -c conda-forge mamba -y \
    && /opt/conda/bin/conda clean -afy

ENV PATH=/opt/conda/bin:$PATH

WORKDIR /app/GEMINI-Flask-Server
COPY GEMINI-Flask-Server/gemini-flask-server.yml ./
COPY GEMINI-Flask-Server/requirements.txt ./

# Use mamba for environment creation with cache mount
RUN --mount=type=cache,target=/opt/conda/pkgs \
    \
    mamba env create -f gemini-flask-server.yml -p /app/GEMINI-Flask-Server/.conda && \
    /app/GEMINI-Flask-Server/.conda/bin/pip install --upgrade pip setuptools wheel

# Parallel git clones directly under GEMINI-Flask-Server
RUN git clone --depth 1 --branch v2.3.0 https://github.com/farm-ng/farm-ng-core.git farm-ng-core & \
    git clone --depth 1 --branch opencv https://github.com/GEMINI-Breeding/AgRowStitch.git AgRowStitch & \
    git clone --depth 1 https://github.com/cvg/LightGlue.git LightGlue & \
    wait

# Install packages with cache mount
RUN --mount=type=cache,target=/root/.cache/pip \
    cd farm-ng-core \
    && git submodule update --init --recursive --jobs 4 \
    && sed -i 's/"-Werror",//g' setup.py \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install . \
    && cd ../AgRowStitch \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install . \
    && cd ../LightGlue \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install -e . \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install --no-build-isolation farm-ng-amiga \
    && cd /app/GEMINI-Flask-Server \
    && /app/GEMINI-Flask-Server/.conda/bin/python -c "import lightglue; print('LightGlue installed successfully')"

# Final runtime stage
FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxext6 libxrender1 curl \
    libgdal* libgeos* libproj* \
    libgomp1 \
    libgl1 \
    ffmpeg libsm6 libxext6 \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g serve concurrently \
    && rm -rf /var/lib/apt/lists/* && apt-get clean

# Set OpenCV to headless mode
ENV QT_QPA_PLATFORM=offscreen
ENV OPENCV_VIDEOIO_PRIORITY_MSMF=0

# Install Docker CLI for Debian/Ubuntu
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
    apt-get update && \
    apt-get install -y docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

# Copy from parallel build stages
COPY --from=python-builder /app/GEMINI-Flask-Server/.conda /app/GEMINI-Flask-Server/.conda
COPY --from=frontend-builder /app/gemini-app/build /app/gemini-app/build
COPY --from=frontend-builder /app/gemini-app/package*.json /app/gemini-app/

ENV PATH=/app/GEMINI-Flask-Server/.conda/bin:$PATH
WORKDIR /app
COPY GEMINI-Flask-Server/ ./GEMINI-Flask-Server/
# Copy git repos from builder stage
COPY --from=python-builder /app/GEMINI-Flask-Server/AgRowStitch /app/GEMINI-Flask-Server/AgRowStitch
COPY --from=python-builder /app/GEMINI-Flask-Server/LightGlue /app/GEMINI-Flask-Server/LightGlue

COPY assets/ ./assets/
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY gemini-app/generate-runtime-config.sh /app/gemini-app/generate-runtime-config.sh
RUN chmod +x /app/gemini-app/generate-runtime-config.sh
RUN chmod +x /docker-entrypoint.sh && mkdir -p /root/GEMINI-App-Data

# Cleanup
RUN find /app/GEMINI-Flask-Server/.conda -name "*.pyc" -delete \
    && find /app/GEMINI-Flask-Server/.conda -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true \
    && rm -rf /app/GEMINI-Flask-Server/.conda/pkgs /tmp/* /var/tmp/*

WORKDIR /app
ENTRYPOINT ["/docker-entrypoint.sh"]