.PHONY: help build push build-and-push clean

# Default target
help:
	@echo "GEMINI Docker Image Build Commands"
	@echo "==================================="
	@echo ""
	@echo "Available targets:"
	@echo "  make build              - Build image locally"
	@echo "  make push               - Build and push image to registry"
	@echo "  make build-and-push     - Alias for 'make push'"
	@echo "  make clean              - Remove buildx builder instance"
	@echo ""
	@echo "Note: The same image works for both CPU and GPU."
	@echo "      Use docker-compose.yml for CPU or docker-compose-gpu.yml for GPU."
	@echo ""
	@echo "Examples:"
	@echo "  make build TAG=v1.0.0"
	@echo "  make push TAG=v1.0.0 PLATFORM=linux/amd64"
	@echo "  make push TAG=latest REGISTRY=myregistry"

# Configuration
TAG ?= latest
PLATFORM ?= linux/amd64,linux/arm64
REGISTRY ?= paibl

# Build image locally (single platform)
build:
	@echo "Building image locally..."
	./docker-build-and-push.sh --tag $(TAG) --platform linux/amd64 --registry $(REGISTRY)

# Build and push image
push:
	@echo "Building and pushing image..."
	./docker-build-and-push.sh --tag $(TAG) --platform $(PLATFORM) --registry $(REGISTRY) --push

# Alias
build-and-push: push

# Clean up buildx builder
clean:
	@echo "Removing buildx builder instance..."
	docker buildx rm gemini-builder || true
	@echo "Done!"
