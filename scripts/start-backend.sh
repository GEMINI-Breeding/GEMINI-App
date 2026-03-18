#!/bin/bash
# Start the backend server for development
# Includes safeguard to kill existing process on port 8000

PORT=8000
BACKEND_DIR="$(dirname "$0")/../backend"

echo "Checking for existing process on port $PORT..."

# Kill any existing process on the port
if command -v fuser &> /dev/null; then
    fuser -k $PORT/tcp 2>/dev/null && echo "Killed existing process on port $PORT"
elif command -v lsof &> /dev/null; then
    PID=$(lsof -ti:$PORT)
    if [ -n "$PID" ]; then
        kill $PID 2>/dev/null && echo "Killed existing process (PID: $PID) on port $PORT"
    fi
fi

# Small delay to ensure port is released
sleep 1

echo "Starting backend server..."
cd "$BACKEND_DIR"
exec uv run uvicorn app.main:app --reload --host 127.0.0.1 --port $PORT
