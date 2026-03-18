#!/bin/bash
# Build GEMI for Linux.
# Run on Ubuntu 22.04 for maximum distro compatibility (glibc 2.35).
#
# Usage:
#   ./build-linux.sh          # full build
#   ./build-linux.sh backend  # PyInstaller sidecar only
#   ./build-linux.sh tauri    # Tauri app only (assumes backend already built)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"

log() { echo "[build] $*"; }
die() { echo "[build] ERROR: $*" >&2; exit 1; }

build_backend() {
    log "Building backend sidecar (PyInstaller)..."

    cd "$ROOT"
    git submodule update --init --recursive

    cd "$BACKEND_DIR"
    uv sync

    [ -d "vendor/AgRowStitch" ]   && uv pip install -e vendor/AgRowStitch --no-build-isolation \
                                   || log "WARNING: vendor/AgRowStitch not found"
    [ -d "vendor/LightGlue" ]     && uv pip install vendor/LightGlue \
                                   || log "WARNING: vendor/LightGlue not found"
    [ -d "vendor/bin_to_images" ] && uv pip install -e vendor/bin_to_images \
                                   || log "WARNING: vendor/bin_to_images not found"

    uv pip install farm-ng-amiga || log "WARNING: farm-ng-amiga install failed"

    uv run pyinstaller --clean gemi-backend.spec

    DEST_DIR="$FRONTEND_DIR/src-tauri/binaries/gemi-backend"
    mkdir -p "$DEST_DIR"
    cp -r dist/gemi-backend/. "$DEST_DIR/"
    log "Backend bundle → $DEST_DIR"
}

build_tauri() {
    log "Building Tauri application..."

    cd "$FRONTEND_DIR"
    [ ! -d node_modules ] && npm install

    CARGO_INCREMENTAL=0 RUSTFLAGS="-C debuginfo=0" npx tauri build

    log "Done. Installer: $FRONTEND_DIR/src-tauri/target/release/bundle/deb/"
}

MODE="${1:-all}"
case "$MODE" in
    backend) build_backend ;;
    tauri)   build_tauri ;;
    all)     build_backend && build_tauri ;;
    *) die "Unknown mode '$MODE'. Use: all | backend | tauri" ;;
esac
