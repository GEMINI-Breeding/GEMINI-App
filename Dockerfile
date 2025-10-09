FROM --platform=$BUILDPLATFORM python:3.9

# Add ARG for target platform
ARG TARGETPLATFORM
ARG BUILDPLATFORM

# Install system dependencies all at once
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    docker.io \
    build-essential \
    gcc \
    g++ \
    make \
    cmake \
    pkg-config \
    protobuf-compiler \
    libprotobuf-dev \
    libgrpc-dev \
    libgrpc++-dev \
    protobuf-compiler-grpc \
    libssl-dev \
    zlib1g-dev \
    libffi-dev \
    python3-dev \
    # Cross-compilation tools
    gcc-aarch64-linux-gnu \
    g++-aarch64-linux-gnu \
    # OpenCV dependencies
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libglu1-mesa-dev \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Set cross-compilation environment variables based on target platform
RUN if [ "$TARGETPLATFORM" = "linux/arm64" ]; then \
        export CC=aarch64-linux-gnu-gcc && \
        export CXX=aarch64-linux-gnu-g++ && \
        export AR=aarch64-linux-gnu-ar && \
        export STRIP=aarch64-linux-gnu-strip; \
    fi

# Install and configure conda
RUN curl -L -o ~/miniconda.sh https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh \
    && chmod +x ~/miniconda.sh \
    && ~/miniconda.sh -b -p /opt/conda \
    && rm ~/miniconda.sh \
    && /opt/conda/bin/conda config --set auto_activate_base false \
    && /opt/conda/bin/conda config --set channel_priority strict \
    && yes | /opt/conda/bin/conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main \
    && yes | /opt/conda/bin/conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r
ENV PATH=/opt/conda/bin:$PATH

# Set working directory
WORKDIR /app

# Copy conda environment file first for layer caching
COPY GEMINI-Flask-Server/gemini-flask-server.yml /app/GEMINI-Flask-Server/gemini-flask-server.yml
COPY GEMINI-Flask-Server/requirements.txt /app/GEMINI-Flask-Server/requirements.txt

# Setup Python environment early so it's cached
WORKDIR /app/GEMINI-Flask-Server
RUN conda env create -f gemini-flask-server.yml -p ./.conda \
    && conda init bash \
    && ./.conda/bin/pip install --upgrade pip setuptools wheel build pybind11 numpy grpcio-tools==1.64.1

# Install farm-ng-core and farm-ng-amiga 
WORKDIR /app
RUN git clone https://github.com/farm-ng/farm-ng-core.git \
    && cd farm-ng-core \
    && git checkout v2.3.0 \
    && git submodule update --init --recursive \
    && sed -i 's/"-Werror",//g' setup.py \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install . \
    && cd .. \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install --no-build-isolation farm-ng-amiga

# Install AgRowStitch and LightGlue
RUN git clone https://github.com/GEMINI-Breeding/AgRowStitch.git \
    && cd AgRowStitch \
    && git checkout opencv \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install . \
    && cd .. \
    && git clone https://github.com/cvg/LightGlue.git \
    && cd LightGlue \
    && /app/GEMINI-Flask-Server/.conda/bin/pip install -e .

# Copy package files first for npm layer caching
WORKDIR /app/gemini-app
COPY gemini-app/package*.json /app/gemini-app/

# Install npm dependencies (will be cached if package.json doesn't change)
RUN npm ci --legacy-peer-deps --omit=dev

# Install serve globally for production serving
RUN npm install -g serve concurrently

# Copy rest of the application code
WORKDIR /app
COPY gemini-app/ /app/gemini-app/
COPY GEMINI-Flask-Server/ /app/GEMINI-Flask-Server/
COPY assets/ /app/assets/

# Build frontend
WORKDIR /app/gemini-app
RUN npm run build

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY gemini-app/generate-runtime-config.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directory
RUN mkdir -p /root/GEMINI-App-Data

WORKDIR /app

# Set the default command to run the production build

# Set the entrypoint script to generate runtime config and start services
ENTRYPOINT ["/docker-entrypoint.sh"]