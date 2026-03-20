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

NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
if [[ -z "$NODE_MAJOR" ]]; then
    die "Node.js not found. Install Node.js 22: brew install node@22"
fi
if (( NODE_MAJOR < 22 )); then
    die "Node.js $(node --version) is too old. Vite 7 requires Node.js >= 22. Install: brew install node@22"
fi

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
    # kornia + kornia_rs: required for Amiga .bin extraction (bin_to_images lives at backend/bin_to_images/)
    uv pip install kornia kornia_rs

    # farm-ng-core has no ARM64 wheels on PyPI — build from source.
    # Pre-install build-time dependencies so the isolated build env has them.
    log "Building farm-ng-core from source (no ARM64 wheels on PyPI)..."
    uv pip install setuptools farm-ng-package pybind11 cmake ninja scikit-build
    FARM_NG_DIR="$(mktemp -d)"
    git clone --depth 1 --branch v2.3.0 https://github.com/farm-ng/farm-ng-core.git "$FARM_NG_DIR/farm-ng-core"
    cd "$FARM_NG_DIR/farm-ng-core"
    git submodule update --init --recursive
    sed -i '' 's/"-Werror",//g' setup.py
    cd "$BACKEND_DIR"
    uv pip install --no-build-isolation "$FARM_NG_DIR/farm-ng-core"
    uv pip install --no-build-isolation farm-ng-amiga
    rm -rf "$FARM_NG_DIR"

    uv run pyinstaller --clean gemi-backend.spec

    DEST_DIR="$FRONTEND_DIR/src-tauri/binaries/gemi-backend"
    mkdir -p "$DEST_DIR"
    cp -r dist/gemi-backend/. "$DEST_DIR/"
    # Ensure the bundled Python interpreter is executable (Tauri can strip the bit).
    for py in "$DEST_DIR"/python3.12 "$DEST_DIR"/python3 "$DEST_DIR"/python; do
        [ -f "$py" ] && chmod +x "$py"
    done
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
