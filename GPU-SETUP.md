# GPU Support for GEMINI

This guide explains how to use GPU acceleration with the GEMINI application.

## Prerequisites

To use GPU support, you must have:

1. **NVIDIA GPU** on your host machine
2. **NVIDIA drivers** installed (verify with `nvidia-smi`)
3. **NVIDIA Container Toolkit** installed

### Installing NVIDIA Container Toolkit

```bash
# Ubuntu/Debian
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
    sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
```

### Verify GPU Access

```bash
# Test that Docker can access your GPU
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi
```

If you see your GPU information, you're ready to go!

## Running GEMINI with GPU Support

### Option 1: Using Docker Compose (Recommended)

```bash
# For GPU-accelerated version
docker compose -f docker-compose-gpu.yml up

# For CPU-only version
docker compose -f docker-compose.yml up
```

### Option 2: Using Make Commands

```bash
# Build the image
make build

# Push to registry
make push

# Or build and push with custom tag
make push TAG=v1.0.0
```

## Image Details

- **Image Name**: `paibl/gemini-breeding:latest`
- **Multi-platform**: Supports `linux/amd64` and `linux/arm64`
- **GPU Ready**: The same image works for both CPU and GPU

The image automatically detects and uses GPUs when:
1. The host has NVIDIA drivers installed
2. The container is run with GPU access (via `docker-compose-gpu.yml`)
3. The NVIDIA Container Toolkit is configured

## File Overview

- `docker-compose.yml` - Standard CPU-only configuration
- `docker-compose-gpu.yml` - GPU-enabled configuration
- `Dockerfile` - Single Dockerfile for both CPU and GPU
- `docker-build-and-push.sh` - Script to build and push images
- `Makefile` - Convenient build commands

## Troubleshooting

### GPU not detected in container

```bash
# Check if NVIDIA runtime is available
docker info | grep -i runtime

# Verify GPU is visible
nvidia-smi

# Test GPU in container
docker run --rm --gpus all paibl/gemini-breeding:latest nvidia-smi
```

### Build issues

```bash
# Clean and rebuild
make clean
make build

# Or manually
docker buildx rm gemini-builder
./docker-build-and-push.sh
```

## Performance Benefits

With GPU support enabled:
- **Deep learning inference**: 10-100x faster
- **Image processing**: 5-20x faster
- **Orthomosaic generation**: Significantly faster for large datasets

GPU acceleration is automatically used by:
- PyTorch models
- TensorFlow models
- CUDA-accelerated OpenCV operations
- Any GPU-compatible libraries in the conda environment
