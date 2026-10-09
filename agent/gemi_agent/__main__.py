"""Command line: python -m gemi_agent <tool> [--arg value ...]

    python -m gemi_agent tools                       list the tools
    python -m gemi_agent chat [--skill NAME] [TEXT]  talk to the configured model; it uses the tools
    python -m gemi_agent serve [--port 7790]         the agent service the app's home page talks to
    python -m gemi_agent mcp                         MCP server (stdio) for tool-calling clients
    python -m gemi_agent passes --track Raw/…/c0fca235/
    python -m gemi_agent panorama --pass 3
    python -m gemi_agent set_boundaries --pass 3 --move '{"4": 2876}'

`--track` falls back to GEMI_TRACK. Values are parsed as JSON where they can
be (numbers, lists, objects, true/false), otherwise taken as text. Results
print as JSON; pictures are listed under "images" as file paths to open.
"""
from __future__ import annotations

import json
import os
import sys

from .tools import TOOLS


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    if argv[0] == "tools":
        for name, t in TOOLS.items():
            args = ", ".join(k for k in t["schema"]["properties"] if k != "track")
            print(f"{name}({args})\n    {t['description']}")
        return 0
    if argv[0] == "_task":          # background upload batch (started by the `upload` tool)
        from . import uploads

        uploads.run(argv[1])
        return 0
    if argv[0] in ("chat", "run"):
        from .runner import main_cli

        return main_cli(argv[1:])
    if argv[0] == "serve":
        from .service import serve as serve_http

        serve_http(argv[1:])
        return 0
    if argv[0] == "mcp":
        from .mcp_server import serve

        serve()
        return 0
    tool = TOOLS.get(argv[0])
    if tool is None:
        print(f"unknown tool {argv[0]!r}; try: python -m gemi_agent tools", file=sys.stderr)
        return 2
    args: dict = {}
    rest = argv[1:]
    i = 0
    while i < len(rest):
        key = rest[i].lstrip("-").replace("-", "_")
        # The next word is this option's value unless it is itself an option
        # name (a value may start with "--" when it has spaces: quoted flags).
        if i + 1 < len(rest) and (not rest[i + 1].startswith("--") or " " in rest[i + 1]):
            raw = rest[i + 1]
            try:
                args[key] = json.loads(raw)
            except json.JSONDecodeError:
                args[key] = raw
            i += 2
        else:
            args[key] = True
            i += 1
    try:
        out = tool["fn"](args)
    except Exception as e:  # one line for the agent, not a traceback
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}))
        return 1
    print(json.dumps(out, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
