"""MCP server (stdio) exposing the same tools as the CLI.

Dependency-free: MCP's stdio transport is newline-delimited JSON-RPC 2.0,
and only initialize / tools/list / tools/call are needed. Pictures come back
as image content, so a model sees them directly.

    python -m gemi_agent mcp
"""
from __future__ import annotations

import base64
import io
import json
import sys

from .tools import TOOLS

PROTOCOL = "2024-11-05"
# Keeps a picture within what vision models take without downscaling it again.
MAX_SIDE = 2000


def _image_content(path: str) -> dict:
    from PIL import Image

    img = Image.open(path).convert("RGB")
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return {"type": "image", "data": base64.b64encode(buf.getvalue()).decode(), "mimeType": "image/jpeg"}


def _call(name: str, args: dict) -> dict:
    tool = TOOLS.get(name)
    if tool is None:
        return {"content": [{"type": "text", "text": f"unknown tool {name}"}], "isError": True}
    try:
        out = tool["fn"](args or {})
    except Exception as e:
        return {"content": [{"type": "text", "text": f"{type(e).__name__}: {e}"}], "isError": True}
    content = [{"type": "text", "text": json.dumps(out.get("result"), default=str)}]
    content += [_image_content(p) for p in out.get("images") or []]
    return {"content": content}


def serve() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        method, mid = msg.get("method"), msg.get("id")
        if mid is None:           # notification
            continue
        if method == "initialize":
            result = {"protocolVersion": msg.get("params", {}).get("protocolVersion", PROTOCOL),
                      "capabilities": {"tools": {}},
                      "serverInfo": {"name": "gemi-agent", "version": "0.1.0"}}
        elif method == "tools/list":
            result = {"tools": [{"name": n, "description": t["description"], "inputSchema": t["schema"]}
                                for n, t in TOOLS.items()]}
        elif method == "tools/call":
            p = msg.get("params", {})
            result = _call(p.get("name", ""), p.get("arguments") or {})
        elif method == "ping":
            result = {}
        else:
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid,
                                         "error": {"code": -32601, "message": f"unknown method {method}"}}) + "\n")
            sys.stdout.flush()
            continue
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "result": result}) + "\n")
        sys.stdout.flush()
