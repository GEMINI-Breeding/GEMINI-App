#!/usr/bin/env python3
"""Entry point for the bundled GEMI backend server."""

import os

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
