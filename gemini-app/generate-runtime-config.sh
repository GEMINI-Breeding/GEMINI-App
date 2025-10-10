#!/bin/bash
set -e

# Default values
FLASK_PORT=${REACT_APP_FLASK_PORT:-5000}
TILE_SERVER_PORT=${REACT_APP_TILE_SERVER_PORT:-8091}
FLASK_HOST=${FLASK_HOST:-127.0.0.1}
TILE_SERVER_HOST=${TILE_SERVER_HOST:-127.0.0.1}

# Target directory
TARGET_DIR="build"

pwd
if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: $TARGET_DIR directory not found"
    exit 1
fi

echo "Generating runtime config in $TARGET_DIR/config.js"

# Generate config.js
cat > "$TARGET_DIR/config.js" << EOF
window.RUNTIME_CONFIG = {
    FLASK_PORT: '$FLASK_PORT',
    TILE_SERVER_PORT: '$TILE_SERVER_PORT',
    FLASK_HOST: '$FLASK_HOST',
    TILE_SERVER_HOST: '$TILE_SERVER_HOST'
};
EOF

echo "Runtime config generated successfully:"
cat "$TARGET_DIR/config.js"