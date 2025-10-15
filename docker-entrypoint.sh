#!/bin/bash
set -e

echo "Starting GEMINI Application"
echo "  React: ${REACT_APP_FRONT_PORT:-3000}"
echo "  Flask: ${REACT_APP_FLASK_PORT:-5000}"
echo "  Tile:  ${REACT_APP_TILE_SERVER_PORT:-8091}"

cd /app/gemini-app
# Generate runtime config using the script
bash generate-runtime-config.sh

# Start Flask server and frontend concurrently
cd /app
concurrently \
    "serve -s /app/gemini-app/build -l ${REACT_APP_FRONT_PORT:-3000}" \
    "cd /app/GEMINI-Flask-Server && python src/app_flask_backend.py --data_root_dir /root/GEMINI-App-Data --flask_port ${REACT_APP_FLASK_PORT:-5000} --titiler_port ${REACT_APP_TILE_SERVER_PORT:-8091}"