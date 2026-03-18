#!/bin/bash
set -euo pipefail

echo "Building GEMI Desktop Backend..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# --- Detect Rust target triple ---
detect_target_triple() {
    if command -v rustc &>/dev/null; then
        rustc -vV | awk '/^host:/ { print $2 }'
        return
    fi

    # Fallback: construct from uname
    local arch os
    arch="$(uname -m)"
    os="$(uname -s)"

    case "$arch" in
        x86_64)  arch="x86_64" ;;
        aarch64|arm64) arch="aarch64" ;;
        *)       echo "Unsupported architecture: $arch" >&2; exit 1 ;;
    esac

    case "$os" in
        Linux)   echo "${arch}-unknown-linux-gnu" ;;
        Darwin)  echo "${arch}-apple-darwin" ;;
        MINGW*|MSYS*|CYGWIN*) echo "${arch}-pc-windows-msvc" ;;
        *)       echo "Unsupported OS: $os" >&2; exit 1 ;;
    esac
}

TARGET_TRIPLE="$(detect_target_triple)"
echo "Detected target triple: $TARGET_TRIPLE"

# --- Build with PyInstaller via uv ---
uv run pyinstaller --clean gemi-backend.spec

# --- Determine source binary name ---
if [[ "$TARGET_TRIPLE" == *windows* ]]; then
    SRC_BIN="dist/gemi-backend.exe"
    DEST_NAME="gemi-backend-${TARGET_TRIPLE}.exe"
else
    SRC_BIN="dist/gemi-backend"
    DEST_NAME="gemi-backend-${TARGET_TRIPLE}"
fi

if [[ ! -f "$SRC_BIN" ]]; then
    echo "ERROR: Build output not found at $SRC_BIN" >&2
    exit 1
fi

# --- Copy to Tauri binaries directory ---
BINARIES_DIR="$SCRIPT_DIR/../frontend/src-tauri/binaries"
mkdir -p "$BINARIES_DIR"
cp "$SRC_BIN" "$BINARIES_DIR/$DEST_NAME"

echo ""
echo "Build complete!"
echo "Binary: $BINARIES_DIR/$DEST_NAME"
