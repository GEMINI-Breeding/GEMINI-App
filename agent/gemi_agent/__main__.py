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


def _ingest(argv: list[str]) -> int:
    """`ingest <folder> key=value ...`: every file of the data type in that folder
    (and below it), uploaded to the app as one batch, in the foreground. The
    folder is the one the person named; nothing else is looked at."""
    from pathlib import Path

    from . import uploads
    from .client import Client

    if not argv:
        print("usage: ingest <folder> experiment=… site=… population=… date=YYYY-MM-DD platform=… sensor=… "
              "data_type=images|amiga_bin|orthomosaic [name_ends=_V.JPG] [run_of_day=…] [treatment=…]")
        return 2
    folder = Path(argv[0])
    opts = {k: uploads.decode_setting(v) for k, v in (a.split("=", 1) for a in argv[1:] if "=" in a)}
    kind = uploads.DATA_TYPES.get(opts.get("data_type", ""))
    if kind is None:
        raise SystemExit(f"data_type must be one of {', '.join(uploads.DATA_TYPES)}")
    ends = [e.lower() for e in (opts.get("name_ends") or "").split(",") if e]
    files = sorted(p for p in folder.rglob("*")
                   if p.is_file() and p.suffix.lower() in kind["ext"] and not p.name.startswith(".")
                   and (not ends or p.name.lower().endswith(tuple(ends))))
    print(f"{len(files)} files in {folder} ({sum(p.stat().st_size for p in files) / 1e9:.1f} GB)", flush=True)
    out = uploads.start(Client(), files, experiment=opts["experiment"], site=opts["site"],
                        population=opts["population"], date=opts["date"], platform=opts["platform"],
                        sensor=opts["sensor"], data_type=opts["data_type"], parallel=int(opts.get("parallel", 4)),
                        run_of_day=opts.get("run_of_day", ""), treatment=opts.get("treatment", ""),
                        source_folder=str(folder), foreground=True)
    print(json.dumps(out, default=str), flush=True)
    return 0 if out.get("status") in ("done", "completed") else 1


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    if argv[0] == "tools":
        for name, t in TOOLS.items():
            args = ", ".join(k for k in t["schema"]["properties"] if k != "track")
            print(f"{name}({args})\n    {t['description']}")
        return 0
    if argv[0] == "ingest":         # a cluster job: upload a folder that is on the cluster (gemi-gate ingest)
        return _ingest(argv[1:])
    if argv[0] == "_task":          # background upload batch (started by the `upload` tool)
        from . import uploads

        uploads.run(argv[1])
        return 0
    if argv[0] == "_fetch":         # a copy from online storage, then its upload (cloud.fetch, local stack)
        from . import cloud

        return cloud.run_fetch(argv[1])
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
