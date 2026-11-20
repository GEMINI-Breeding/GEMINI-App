#!/usr/bin/env bash
# dev-remote.sh — open the app (development build) on this computer against a
# GEMI stack running on another computer, through SSH. Nothing of the stack
# runs here: no Docker, no images. The other computer keeps its ports on
# 127.0.0.1; this script forwards them over SSH.
#
#   scripts/dev-remote.sh user@host [api_port] [tiles_port]
#
# api_port / tiles_port: the other computer's REST API and TiTiler ports
# (the Docker stack's defaults are 7777 and 8091; the desktop app shows its
# own under Settings). The other computer needs an SSH server: built into
# macOS and Linux (Remote Login / sshd), "OpenSSH Server" on Windows.
#
# For a cluster set up from another computer, use `hpc/gemi-hpc join`, then
# `hpc/gemi-hpc app` instead.
set -euo pipefail
login=${1:?usage: scripts/dev-remote.sh user@host [api_port] [tiles_port]}
api=${2:-7777} tiles=${3:-8091}
[[ "$login" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$ ]] || { echo "user@host, please" >&2; exit 2; }
REPO=$(cd "$(dirname "$0")/.." && pwd)
free_port() { node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
l_api=$(free_port); l_tiles=$(free_port); l_agent=$(free_port); web=$(free_port)

# The tunnel is reopened if it drops (sleep, Wi-Fi), like gemi-hpc app does.
keep=$(mktemp)
( while [ -e "$keep" ]; do
    ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
      -L "127.0.0.1:$l_api:127.0.0.1:$api" -L "127.0.0.1:$l_tiles:127.0.0.1:$tiles" "$login" &
    echo $! > "$keep.pid"; wait $! || true
    [ -e "$keep" ] && { echo "  tunnel dropped; reconnecting..." >&2; sleep 3; }
  done ) &
trap 'rm -f "$keep"; kill "$(cat "$keep.pid" 2>/dev/null)" ${agent_pid:-} 2>/dev/null; rm -f "$keep.pid"' EXIT
for _ in $(seq 1 30); do curl -s -m 3 -o /dev/null "http://127.0.0.1:$l_api/healthz" && break; sleep 1; done
curl -s -m 5 -o /dev/null "http://127.0.0.1:$l_api/healthz" \
  || { echo "no GEMI API at $login:127.0.0.1:$api (is the stack running there, and the port right?)"; exit 1; }

echo
echo "  GEMI on $login:  http://localhost:$web   (sign in with an account of that stack)"
echo "  (Ctrl-C closes the app and the tunnel here; the stack on $login keeps running)"
# The agent service runs here, so the agent can upload files from this computer.
( cd "$REPO/agent" && GEMI_API="http://127.0.0.1:$l_api" GEMI_EMAIL= GEMI_PASSWORD= \
    python3 -m gemi_agent serve --port "$l_agent" ) &
agent_pid=$!
cd "$REPO/frontend"
GEMI_API_TARGET="http://127.0.0.1:$l_api" GEMI_TITILER_TARGET="http://127.0.0.1:$l_tiles" \
  GEMI_AGENT_TARGET="http://127.0.0.1:$l_agent" VITE_DISABLE_UPDATE_CHECK=1 npx vite --port "$web" --strictPort
