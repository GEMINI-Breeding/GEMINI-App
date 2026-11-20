"""Entry point of the packaged agent (`gemi-agent`), the one executable the
desktop app ships and starts. Same sub-commands as `python -m gemi_agent`:
`gemi-agent serve`, `gemi-agent chat`, `gemi-agent mcp`, `gemi-agent <tool> …`.
Built by build_desktop.py.
"""
import sys

from gemi_agent.__main__ import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
