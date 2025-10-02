FROM python:3.9

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
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

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

# Set working directory and clone repo
WORKDIR /app
RUN git clone https://github.com/GEMINI-Breeding/GEMINI-App.git . \
    && git submodule update --init --recursive

# Build frontend
WORKDIR /app/gemini-app
RUN npm install --legacy-peer-deps && npm run build

# Setup Python environment and install dependencies
WORKDIR /app/GEMINI-Flask-Server
RUN conda env create -f gemini-flask-server.yml -p ./.conda \
    && conda init bash \
    && ./.conda/bin/pip install --upgrade pip setuptools wheel build pybind11 numpy grpcio-tools==1.64.1

# Install farm-ng-core and farm-ng-amiga
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

WORKDIR /app