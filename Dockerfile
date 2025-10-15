# syntax=docker/dockerfile:1.4
FROM --platform=$BUILDPLATFORM python:3.9-slim AS base

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
# Install build deps with parallel downloads
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl build-essential gcc g++ cmake pkg-config \
    libssl-dev zlib1g-dev libffi-dev python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Install conda with parallel downloads
RUN curl -L -o ~/miniconda.sh https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh \
    && chmod +x ~/miniconda.sh \
    && ~/miniconda.sh -b -p /opt/conda \
    && rm ~/miniconda.sh \
    && /opt/conda/bin/conda config --set auto_activate_base false \
    && /opt/conda/bin/conda config --set channel_priority strict \
    && yes | /opt/conda/bin/conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main \
    && yes | /opt/conda/bin/conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r
ENV PATH=/opt/conda/bin:$PATH

WORKDIR /app
COPY GEMINI-Flask-Server/gemini-flask-server.yml ./
COPY GEMINI-Flask-Server/requirements.txt ./

# Create conda environment in expected location
RUN conda config --set solver libmamba \
    && conda env create -f gemini-flask-server.yml -p /app/GEMINI-Flask-Server/.conda \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install --upgrade pip setuptools wheel

# Parallel git clones and installs
RUN --mount=type=cache,target=/root/.cache/pip \
    git clone --depth 1 --branch v2.3.0 https://github.com/farm-ng/farm-ng-core.git & \
    git clone --depth 1 --branch opencv https://github.com/GEMINI-Breeding/AgRowStitch.git & \
    git clone --depth 1 https://github.com/cvg/LightGlue.git & \
    wait

RUN cd farm-ng-core \
    && git submodule update --init --recursive --jobs 4 \
    && sed -i 's/"-Werror",//g' setup.py \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install . \
    && cd ../AgRowStitch \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install . \
    && cd ../LightGlue \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install -e . \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install --no-build-isolation farm-ng-amiga

# Final runtime stage
FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libglu1-mesa curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g serve concurrently \
    && rm -rf /var/lib/apt/lists/* && apt-get clean

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