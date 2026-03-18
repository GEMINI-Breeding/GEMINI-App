#!/usr/bin/env bash
# setup_submodules.sh
#
# Initialises the required git submodules for the GEMI app.
#
# Run this once after cloning the repo:
#   ./setup_submodules.sh
#
# If submodules are already present, this script is safe to re-run —
# it will skip anything that already exists.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENDOR_DIR="$ROOT/backend/vendor"

log()  { echo "[submodules] $*"; }
die()  { echo "[submodules] ERROR: $*" >&2; exit 1; }

cd "$ROOT"

# ── AgRowStitch ────────────────────────────────────────────────────────────────
# Ground-based image stitching (Amiga pipeline).
# Single-file module: backend/vendor/AgRowStitch/AgRowStitch.py
AGROWSTITCH_DIR="$VENDOR_DIR/AgRowStitch"
if [ -f "$AGROWSTITCH_DIR/AgRowStitch.py" ]; then
    log "AgRowStitch already present — skipping."
else
    log "Adding AgRowStitch submodule (opencv branch)..."
    git submodule add -b opencv \
        https://github.com/GEMINI-Breeding/AgRowStitch.git \
        backend/vendor/AgRowStitch
    log "AgRowStitch added."
fi

# ── LightGlue ─────────────────────────────────────────────────────────────────
# Feature matching library required by AgRowStitch.
LIGHTGLUE_DIR="$VENDOR_DIR/LightGlue"
if [ -d "$LIGHTGLUE_DIR" ] && [ -n "$(ls -A "$LIGHTGLUE_DIR" 2>/dev/null)" ]; then
    log "LightGlue already present — skipping."
else
    log "Adding LightGlue submodule..."
    git submodule add \
        https://github.com/cvg/LightGlue.git \
        backend/vendor/LightGlue
    log "LightGlue added."
fi

# ── Initialise / update all submodules ────────────────────────────────────────
log "Initialising and updating all submodules..."
git submodule update --init --recursive
log "All submodules up to date."

log ""
log "Done. Next steps:"
log "  Install Python dependencies into the backend venv:"
log "    cd backend"
log "    uv pip install vendor/LightGlue"
log "    uv pip install -e vendor/AgRowStitch --no-build-isolation"
log "    uv pip install farm-ng-amiga"
