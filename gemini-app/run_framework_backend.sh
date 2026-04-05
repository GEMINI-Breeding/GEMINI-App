#!/usr/bin/env bash
#
# Start the gemini-framework Docker backend (PostgreSQL, MinIO, Redis, REST API).
# Waits for the REST API to be healthy before returning.
#
set -e

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "[framework] ERROR: Docker is not running."
    if [ "$(uname)" = "Darwin" ]; then
        echo "[framework] Please start Docker Desktop and try again."
        echo "[framework] You can open it with: open -a Docker"
    else
        echo "[framework] Please start the Docker daemon and try again."
    fi
    exit 1
fi

COMPOSE_DIR="$(cd "$(dirname "$0")/../gemini-framework/gemini/pipeline" && pwd)"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yaml"
ENV_FILE="$COMPOSE_DIR/.env"
ENV_EXAMPLE="$COMPOSE_DIR/.env.example"

# Ensure .env exists
if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$ENV_EXAMPLE" ]; then
        echo "[framework] Creating .env from .env.example..."
        cp "$ENV_EXAMPLE" "$ENV_FILE"
    else
        echo "[framework] ERROR: No .env or .env.example found in $COMPOSE_DIR"
        exit 1
    fi
fi

# Start containers (builds only if image doesn't exist or Dockerfile changed)
# Use --build flag only when explicitly requested via BUILD=1 env var
if [ "${BUILD:-0}" = "1" ]; then
    echo "[framework] Building and starting gemini-framework Docker stack..."
    docker compose -f "$COMPOSE_FILE" up -d --build 2>&1 | sed 's/^/[framework] /'
else
    echo "[framework] Starting gemini-framework Docker stack..."
    docker compose -f "$COMPOSE_FILE" up -d 2>&1 | sed 's/^/[framework] /'
fi

# Wait for REST API health
echo "[framework] Waiting for REST API to be ready..."
MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -sf http://localhost:7777/ > /dev/null 2>&1; then
        echo "[framework] REST API is ready at http://localhost:7777"
        exit 0
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $((WAITED % 10)) -eq 0 ]; then
        echo "[framework] Still waiting... (${WAITED}s)"
    fi
done

echo "[framework] ERROR: REST API did not become healthy within ${MAX_WAIT}s"
echo "[framework] Check logs: docker compose -f $COMPOSE_FILE logs rest-api"
exit 1
