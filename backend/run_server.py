#!/usr/bin/env python3
"""Entry point for the bundled GEMI backend server."""

import os

# ── AgRowStitch subprocess mode ───────────────────────────────────────────────
# When the frozen bundle is spawned with GEMI_AGROWSTITCH_CONFIG set, act as a
# plain Python interpreter running AgRowStitch instead of starting the server.
# This is the standard pattern for PyInstaller apps that need to spawn Python
# subprocesses (there is no standalone `python` executable in the bundle).
_agrowstitch_config = os.environ.get("GEMI_AGROWSTITCH_CONFIG")
if _agrowstitch_config:
    import sys

    # sys._MEIPASS is the bundle root — AgRowStitch.py is collected there.
    _meipass = getattr(sys, "_MEIPASS", None)
    if _meipass and _meipass not in sys.path:
        sys.path.insert(0, _meipass)

    _agrowstitch_dir = os.environ.get("GEMI_AGROWSTITCH_DIR", "")
    if _agrowstitch_dir and _agrowstitch_dir not in sys.path:
        sys.path.insert(0, _agrowstitch_dir)

    if _agrowstitch_config == "__probe__":
        # Import-only pre-flight check: verify AgRowStitch can be imported.
        from AgRowStitch import run  # type: ignore  # noqa: F401
        print("AgRowStitch import OK")
        sys.exit(0)

    _cpu_count = int(os.environ.get("GEMI_AGROWSTITCH_CPU_COUNT", "1"))

    from AgRowStitch import run  # type: ignore

    try:
        r = run(_agrowstitch_config, _cpu_count)
        if hasattr(r, "__iter__") and not isinstance(r, (str, bytes)):
            for _ in r:
                pass
    except Exception as _exc:
        # Print to stderr so the parent process captures it via the PIPE,
        # then exit with a non-zero code so ground.py knows it failed.
        # Do NOT re-raise — a bare raise causes PyInstaller's windowed-mode
        # "Unhandled exception in script" popup on Windows.
        import traceback as _tb
        print("AgRowStitch error:", _exc, file=sys.stderr)
        _tb.print_exc(file=sys.stderr)
        sys.exit(1)
    sys.exit(0)
# ─────────────────────────────────────────────────────────────────────────────

# Set desktop environment BEFORE importing the app so config.py picks it up
os.environ["ENVIRONMENT"] = "desktop"

import uvicorn

# Import app directly so PyInstaller can bundle it
from app.main import app


def main():
    port = int(os.environ.get("GEMI_BACKEND_PORT", "8000"))
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
