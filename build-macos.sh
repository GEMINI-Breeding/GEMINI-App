#!/bin/bash
# Build GEMI for macOS (Apple Silicon).
# Requires Xcode Command Line Tools: xcode-select --install
#
# Usage:
#   ./build-macos.sh          # full build
#   ./build-macos.sh backend  # PyInstaller sidecar only
#   ./build-macos.sh tauri    # Tauri app only (assumes backend already built)
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

    # farm-ng-core has no ARM64 wheels on PyPI — build from source
    log "Building farm-ng-core from source (no ARM64 wheels on PyPI)..."
    FARM_NG_DIR="$(mktemp -d)"
    git clone --depth 1 --branch v2.3.0 https://github.com/farm-ng/farm-ng-core.git "$FARM_NG_DIR/farm-ng-core"
    cd "$FARM_NG_DIR/farm-ng-core"
    git submodule update --init --recursive
    sed -i '' 's/"-Werror",//g' setup.py
    cd "$BACKEND_DIR"
    uv pip install "$FARM_NG_DIR/farm-ng-core"
    uv pip install --no-build-isolation farm-ng-amiga
    rm -rf "$FARM_NG_DIR"

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

    log "Done. Installer: $FRONTEND_DIR/src-tauri/target/release/bundle/dmg/"
}

MODE="${1:-all}"
case "$MODE" in
    backend) build_backend ;;
    tauri)   build_tauri ;;
    all)     build_backend && build_tauri ;;
    *) die "Unknown mode '$MODE'. Use: all | backend | tauri" ;;
esac
