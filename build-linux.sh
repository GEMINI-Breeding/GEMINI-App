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

NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
if [[ -z "$NODE_MAJOR" ]]; then
    die "Node.js not found. Install Node.js 22: https://nodejs.org"
fi
if (( NODE_MAJOR < 22 )); then
    die "Node.js $(node --version) is too old. Vite 7 requires Node.js >= 22. Install: nvm install 22 && nvm use 22"
fi

build_backend() {
    log "Building backend sidecar (PyInstaller)..."

    cd "$ROOT"
    git submodule update --init --recursive

    # Apply local patches to vendored submodules that cannot be pushed upstream.
    # patches/AgRowStitch.py: fixes OpenCV 4.13 SIGSEGV (match.H = None → np.zeros).
    if [ -f "$BACKEND_DIR/patches/AgRowStitch.py" ] && [ -d "$BACKEND_DIR/vendor/AgRowStitch" ]; then
        log "Applying patch: AgRowStitch.py (OpenCV 4.13 MatchesInfo fix)"
        cp "$BACKEND_DIR/patches/AgRowStitch.py" "$BACKEND_DIR/vendor/AgRowStitch/AgRowStitch.py"
    fi

    cd "$BACKEND_DIR"
    uv sync

    [ -d "vendor/AgRowStitch" ]   && uv pip install -e vendor/AgRowStitch --no-build-isolation \
                                   || log "WARNING: vendor/AgRowStitch not found"
    [ -d "vendor/LightGlue" ]     && uv pip install vendor/LightGlue \
                                   || log "WARNING: vendor/LightGlue not found"
    # kornia + kornia_rs: required for Amiga .bin extraction (bin_to_images lives at backend/bin_to_images/)
    uv pip install kornia kornia_rs

    uv pip install farm-ng-amiga || log "WARNING: farm-ng-amiga install failed"

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

    log "Done. Installer: $FRONTEND_DIR/src-tauri/target/release/bundle/deb/"
}

MODE="${1:-all}"
case "$MODE" in
    backend) build_backend ;;
    tauri)   build_tauri ;;
    all)     build_backend && build_tauri ;;
    *) die "Unknown mode '$MODE'. Use: all | backend | tauri" ;;
esac
