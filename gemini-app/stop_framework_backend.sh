#!/usr/bin/env bash
#
# Stop the gemini-framework Docker backend.
#
# Uses "docker compose stop" (not "down") to preserve containers.
# This makes the next startup much faster since containers don't need
# to be recreated. Use "npm run server:framework:down" to fully remove
# containers and free disk space.
#
COMPOSE_DIR="$(cd "$(dirname "$0")/../gemini-framework/gemini/pipeline" && pwd)"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yaml"

if [ "$1" = "--down" ]; then
    echo "[framework] Removing gemini-framework Docker stack..."
    docker compose -f "$COMPOSE_FILE" down 2>&1 | sed 's/^/[framework] /'
    echo "[framework] Containers removed. Data volumes preserved."
    echo "[framework] To also remove data: docker compose -f $COMPOSE_FILE down -v"
else
    echo "[framework] Stopping gemini-framework Docker stack..."
    docker compose -f "$COMPOSE_FILE" stop 2>&1 | sed 's/^/[framework] /'
    echo "[framework] Stopped. Containers preserved for fast restart."
fi
