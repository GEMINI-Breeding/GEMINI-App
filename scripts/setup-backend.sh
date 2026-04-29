#!/usr/bin/env bash
# One-time setup for the GEMINIbase backend submodule.
#
# - Initializes the backend/ submodule (GEMINIbase)
# - Seeds .env files for the pipeline stack and reference UI
# - Does NOT start Docker (run `docker compose up -d` after this completes)
#
# Safe to re-run: existing .env files are not overwritten.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"

log() { echo "[setup-backend] $*"; }

log "Initializing submodules..."
git -C "$ROOT" submodule update --init --recursive backend

PIPELINE_ENV_EXAMPLE="$BACKEND_DIR/gemini/pipeline/.env.example"
PIPELINE_ENV="$BACKEND_DIR/gemini/pipeline/.env"
if [[ ! -f "$PIPELINE_ENV" ]]; then
    log "Seeding pipeline .env from .env.example"
    cp "$PIPELINE_ENV_EXAMPLE" "$PIPELINE_ENV"
else
    log "Pipeline .env already exists, leaving as-is"
fi

# .env.example ships GEMINI_JWT_SECRET= (empty), which puts the REST API
# into "Auth disabled" mode and 503s every login. That's deliberate for
# bare-metal first-run, but unworkable in CI where the E2E suite logs in
# on every test. If the secret is empty (and only then), generate one
# so the freshly-seeded stack can authenticate without manual editing.
if grep -qE '^GEMINI_JWT_SECRET=$' "$PIPELINE_ENV"; then
    log "Generating GEMINI_JWT_SECRET (.env had it empty)"
    SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '+/=' | head -c 64)"
    # Use a different sed delimiter so / and + in the secret don't break.
    sed -i.bak "s|^GEMINI_JWT_SECRET=$|GEMINI_JWT_SECRET=${SECRET}|" "$PIPELINE_ENV"
    rm -f "${PIPELINE_ENV}.bak"
fi

UI_ENV_EXAMPLE="$BACKEND_DIR/gemini-ui/.env.example"
UI_ENV="$BACKEND_DIR/gemini-ui/.env"
if [[ -f "$UI_ENV_EXAMPLE" && ! -f "$UI_ENV" ]]; then
    log "Seeding gemini-ui .env from .env.example"
    cp "$UI_ENV_EXAMPLE" "$UI_ENV"
fi

log "Done. Next: docker compose up -d"
