#!/usr/bin/env bash
#
# Stop the gemini-framework Docker backend.
#
COMPOSE_DIR="$(cd "$(dirname "$0")/../gemini-framework/gemini/pipeline" && pwd)"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yaml"

echo "[framework] Stopping gemini-framework Docker stack..."
docker compose -f "$COMPOSE_FILE" down 2>&1 | sed 's/^/[framework] /'
echo "[framework] Stopped."
