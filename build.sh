#!/bin/bash
# Build the full GEMI desktop app (backend sidecar + Tauri frontend).
#
# Usage:
#   ./build.sh          # full build
#   ./build.sh backend  # backend sidecar only (PyInstaller)
#   ./build.sh tauri    # Tauri app only (assumes backend already built)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"

# ── Helpers ────────────────────────────────────────────────────────────────────

log() { echo "[build] $*"; }
die() { echo "[build] ERROR: $*" >&2; exit 1; }

# ── Prerequisites check ────────────────────────────────────────────────────────

# Vite 7 requires Node.js >= 20.19 (uses crypto.hash added in Node 21.7/22).
NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
if [[ -z "$NODE_MAJOR" ]]; then
    die "Node.js not found. Install Node.js 22: https://nodejs.org"
fi
if (( NODE_MAJOR < 22 )); then
    die "Node.js $( node --version ) is too old. Vite 7 requires Node.js >= 22. Install: nvm install 22 && nvm use 22"
fi

# ── Step 1: Build PyInstaller backend sidecar ──────────────────────────────────

build_backend() {
    log "Building backend sidecar (PyInstaller)..."

    cd "$ROOT"

    # Initialize git submodules (AgRowStitch, LightGlue)
    log "Initializing git submodules..."
    git submodule update --init --recursive

    # Apply local patches to vendored submodules that cannot be pushed upstream.
    # patches/AgRowStitch.py: fixes OpenCV 4.13 SIGSEGV (match.H = None → np.zeros).
    if [ -f "$BACKEND_DIR/patches/AgRowStitch.py" ] && [ -d "$BACKEND_DIR/vendor/AgRowStitch" ]; then
        log "Applying patch: AgRowStitch.py (OpenCV 4.13 MatchesInfo fix)"
        cp "$BACKEND_DIR/patches/AgRowStitch.py" "$BACKEND_DIR/vendor/AgRowStitch/AgRowStitch.py"
    fi

    cd "$BACKEND_DIR"

    # Install vendor packages (submodules) into venv
    if [[ -d "vendor/AgRowStitch" ]]; then
        log "Installing AgRowStitch from vendor/..."
        uv pip install -e vendor/AgRowStitch --no-build-isolation
    else
        log "WARNING: vendor/AgRowStitch not found — stitching will not be available"
    fi

    if [[ -d "vendor/LightGlue" ]]; then
        log "Installing LightGlue from vendor/..."
        uv pip install vendor/LightGlue
    else
        log "WARNING: vendor/LightGlue not found — AgRowStitch matching may fail"
    fi

    # kornia + kornia_rs: required for Amiga .bin extraction (bin_to_images lives at backend/bin_to_images/)
    uv pip install kornia kornia_rs

    # Install farm-ng-amiga (binary extraction SDK)
    OS="$(uname -s)"
    if [[ "$OS" == "Darwin" ]]; then
        log "macOS detected: building farm-ng-core from source (required for farm-ng-amiga)..."
        # Pre-install build-time dependencies so the isolated build env has them.
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
    else
        log "Installing farm-ng-amiga..."
        uv pip install farm-ng-amiga || log "WARNING: farm-ng-amiga install failed — .bin extraction unavailable"
    fi

    uv run pyinstaller --clean gemi-backend.spec

    # Detect target triple for the binary name Tauri expects
    if command -v rustc &>/dev/null; then
        TARGET_TRIPLE="$(rustc -vV | awk '/^host:/ { print $2 }')"
    else
        ARCH="$(uname -m)"
        OS="$(uname -s)"
        case "$ARCH" in
            x86_64)        ARCH="x86_64" ;;
            aarch64|arm64) ARCH="aarch64" ;;
            *) die "Unsupported arch: $ARCH" ;;
        esac
        case "$OS" in
            Linux)  TARGET_TRIPLE="${ARCH}-unknown-linux-gnu" ;;
            Darwin) TARGET_TRIPLE="${ARCH}-apple-darwin" ;;
            MINGW*|MSYS*|CYGWIN*) TARGET_TRIPLE="${ARCH}-pc-windows-msvc" ;;
            *) die "Unsupported OS: $OS" ;;
        esac
    fi

    log "Target triple: $TARGET_TRIPLE"

    SRC_DIR="dist/gemi-backend"
    [[ -d "$SRC_DIR" ]] || die "PyInstaller output directory not found at $SRC_DIR"

    DEST_DIR="$FRONTEND_DIR/src-tauri/binaries/gemi-backend"
    mkdir -p "$DEST_DIR"
    cp -r "$SRC_DIR/." "$DEST_DIR/"
    # Ensure the bundled Python interpreter is executable (Tauri can strip the bit).
    for py in "$DEST_DIR"/python3.12 "$DEST_DIR"/python3 "$DEST_DIR"/python; do
        [ -f "$py" ] && chmod +x "$py"
    done
    log "Backend bundle → $DEST_DIR"
}

# ── Step 2: Build Tauri app ────────────────────────────────────────────────────

build_tauri() {
    log "Building Tauri application..."

    cd "$FRONTEND_DIR"

    # Ensure npm dependencies are installed
    if [[ ! -d node_modules ]]; then
        log "Installing npm dependencies..."
        npm install
    fi

    npm run tauri build

    log "Tauri build complete. Installers are in: $FRONTEND_DIR/src-tauri/target/release/bundle/"
}

# ── Main ───────────────────────────────────────────────────────────────────────

MODE="${1:-all}"

case "$MODE" in
    backend) build_backend ;;
    tauri)   build_tauri ;;
    all)
        build_backend
        build_tauri
        ;;
    *) die "Unknown mode '$MODE'. Use: all | backend | tauri" ;;
esac

log "Done."
