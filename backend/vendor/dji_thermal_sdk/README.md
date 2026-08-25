# DJI Thermal SDK (vendored)

This folder is where the **native** DJI Thermal SDK library lives so the app
can convert DJI thermal R-JPEGs with **zero configuration** for end users —
no separate install step, no Settings path to fill in.

## Why this isn't in git

The SDK binary is DJI-licensed and not redistributable as a bare download —
DJI's EULA (https://developer.dji.com/policies/eula/) permits shipping the
SDK's **object code, in execution form only**, *as part of a compiled
Application*. `gemi-backend.spec` bundles the file(s) placed here directly
into the packaged app (`.dmg`/`.exe`/`.deb`) at build time, satisfying that
condition. Committing the raw binary into this git repo would go beyond
that — so it's gitignored here and must be placed locally before running a
packaged build.

At runtime, `backend/app/processing/thermal_utils.py` looks for the library
here first (bundled), and only falls back to the optional
Settings → Thermal → "SDK Folder Path" override if this folder is empty —
that override exists for testing a different SDK version, not as the normal
path.

## Setup (one-time, per machine building a packaged release)

1. Download the DJI Thermal SDK **v1.7+** (v1.7+ is required for Matrice 4T
   support) from
   https://www.dji.com/global/downloads/softwares/dji-thermal-sdk
2. Extract it so this folder contains:
   ```
   backend/vendor/dji_thermal_sdk/
   └── utility/
       └── bin/
           ├── linux/
           │   └── release_x64/
           │       └── libdirp.so       ← required on Linux / WSL / macOS
           └── windows/
               └── release_x64/
                   └── libdirp.dll      ← required on Windows
   ```
3. That's it — `dev mode` (`uv run` from `backend/`) and packaged builds
   (`./build-macos.sh backend` / `./build-linux.sh` / etc) both pick it up
   automatically from this exact path. No Settings configuration needed.

**macOS note:** DJI ships no native macOS build of this SDK — only Windows
and Linux. On macOS, the `linux/release_x64/libdirp.so` above is what's
needed (same file as Linux), but it's run inside a small Docker container
(`docker/dji-thermal/`) instead of loaded directly, since a Linux `.so`
can't be loaded natively via macOS's dyld. This requires Docker Desktop to
be installed and running; the container image is built automatically on
first use (one-time, ~10s — no proprietary code is baked into the image,
`libdirp.so` is bind-mounted in at run time). See
`backend/app/processing/thermal_utils.py`'s `_convert_dji_rjpeg_docker()`.

In dev mode (not yet done this setup step), thermal conversion will report
itself unavailable via `GET /utils/capabilities/` (`thermal.platforms.dji`)
rather than crash — this is the same graceful-degradation pattern used for
Docker/AgRowStitch elsewhere in this app.
