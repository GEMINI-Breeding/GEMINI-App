#!/bin/bash
set -e

echo "Starting GEMINI Application"
echo "  React: ${REACT_APP_FRONT_PORT:-3000}"
echo "  Flask: ${REACT_APP_FLASK_PORT:-5000}"
echo "  Tile:  ${REACT_APP_TILE_SERVER_PORT:-8091}"

# Generate runtime config using the script
cd /app
bash generate-runtime-config.sh

# Start services with environment variables passed as arguments
cd /app/gemini-app
exec concurrently \
  "serve -s build -l ${REACT_APP_FRONT_PORT:-3000}" \
  "cd /app/GEMINI-Flask-Server && ./run_flask_server.sh ${REACT_APP_APP_DATA:-~/GEMINI-App-Data} ${REACT_APP_FLASK_PORT:-5000} ${REACT_APP_TILE_SERVER_PORT:-8091}"