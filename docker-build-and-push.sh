#!/bin/bash

# Script to build and push GEMINI Docker images
# Usage: ./build-and-push.sh [OPTIONS]
# Options:
#   --platform PLATFORM    Specify platform (default: linux/amd64,linux/arm64)
#   --tag TAG             Specify tag (default: latest)
#   --registry REGISTRY   Specify registry (default: paibl)
#   --push                Push images after building
#   --help                Show this help message
#
# Note: The same image works for both CPU and GPU.
#       GPU support is enabled at runtime via docker-compose-gpu.yml

set -e

# Default values
PLATFORM="linux/amd64,linux/arm64"
TAG="latest"
REGISTRY="paibl"
PUSH_IMAGES=false
IMAGE_NAME="gemini-breeding"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --platform)
      PLATFORM="$2"
      shift 2
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    --registry)
      REGISTRY="$2"
      shift 2
      ;;
    --push)
      PUSH_IMAGES=true
      shift
      ;;
    --help)
      echo "Usage: ./docker-build-and-push.sh [OPTIONS]"
      echo "Options:"
      echo "  --platform PLATFORM    Specify platform (default: linux/amd64,linux/arm64)"
      echo "  --tag TAG             Specify tag (default: latest)"
      echo "  --registry REGISTRY   Specify registry (default: paibl)"
      echo "  --push                Push images after building"
      echo "  --help                Show this help message"
      echo ""
      echo "Note: The same image works for both CPU and GPU."
      echo "      Use docker-compose.yml for CPU or docker-compose-gpu.yml for GPU."
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

FULL_IMAGE_NAME="${REGISTRY}/${IMAGE_NAME}"

echo "========================================="
echo "GEMINI Docker Image Build & Push"
echo "========================================="
echo "Image: ${FULL_IMAGE_NAME}"
echo "Tag: ${TAG}"
echo "Platform: ${PLATFORM}"
echo "Push images: ${PUSH_IMAGES}"
echo ""
echo "This image works for both CPU and GPU"
echo "========================================="

# Check if buildx is available
if ! docker buildx version &> /dev/null; then
    echo "Error: docker buildx is not available"
    echo "Please install Docker Buildx or use a newer version of Docker"
    exit 1
fi

# Create builder instance if it doesn't exist
if ! docker buildx ls | grep -q "gemini-builder"; then
    echo "Creating buildx builder instance..."
    docker buildx create --name gemini-builder --use
else
    echo "Using existing buildx builder instance..."
    docker buildx use gemini-builder
fi

# Bootstrap the builder
docker buildx inspect --bootstrap

# Build the base image
echo ""
echo "Building base image: ${FULL_IMAGE_NAME}:${TAG}"
echo "========================================="

if [ "$PUSH_IMAGES" = true ]; then
    docker buildx build \
        --platform "${PLATFORM}" \
        --tag "${FULL_IMAGE_NAME}:${TAG}" \
        --push \
        -f Dockerfile \
        .
else
    # For local builds without push, only build for current platform
    LOCAL_PLATFORM=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
    echo "Note: Building for local platform only (${LOCAL_PLATFORM})"
    echo "Multi-platform builds require --push flag"
    docker buildx build \
        --platform "${LOCAL_PLATFORM}" \
        --tag "${FULL_IMAGE_NAME}:${TAG}" \
        --load \
        -f Dockerfile \
        .
fi

echo "✓ Base image built successfully"

echo ""
echo "========================================="
echo "Build completed successfully!"
echo "========================================="

if [ "$PUSH_IMAGES" = true ]; then
    echo "Image pushed to registry:"
    echo "  - ${FULL_IMAGE_NAME}:${TAG}"
else
    echo "Image built locally (not pushed):"
    echo "  - ${FULL_IMAGE_NAME}:${TAG}"
    echo ""
    echo "To push image, run with --push flag"
fi

echo ""
echo "Usage:"
echo "  CPU:  docker compose -f docker-compose.yml up"
echo "  GPU:  docker compose -f docker-compose-gpu.yml up"
