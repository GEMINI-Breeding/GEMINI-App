# AI Agent Instructions — GEMINI-App

This document is written for an AI coding agent starting work on this project.
Read this before reading any code.

---

## What This Project Is

GEMINI-App is a **Tauri desktop app** for agricultural phenotyping. It has:
- A **React frontend** (TanStack Router + TanStack Query + shadcn/ui + Tailwind)
- A **FastAPI backend** bundled as a PyInstaller sidecar (`gemi-backend`)
- The backend starts automatically when the Tauri app launches, runs on a random local port, and shuts down on exit

The app is **not a web app**. There is no server deployment, no Docker in production, no login screen. It runs locally on the researcher's machine.

---

## Repository

The canonical repo is `GEMINI-App`. All edits go here.

---

## No Login / No Auth UI

JWT auth has been removed. `get_current_user()` in `backend/app/api/deps.py` queries the database for the first superuser directly. There is no `/login` route, no token, no `localStorage`. Do not add or suggest login flows.

---

## Stack Quick Reference

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 18, TanStack Router (file-based), TanStack Query, shadcn/ui, Tailwind |
| Backend | FastAPI, SQLModel, SQLite |
| Python env | Python 3.12 via `uv` |
| API client | Auto-generated via `@hey-api/openapi-ts` |

---

## Key Architecture Rules

### 1. All filesystem paths go through `RunPaths`

`backend/app/core/paths.py` has a `RunPaths` class. Every path used in processing is derived from it — never call `get_setting("data_root")` directly in a route handler. Use `RunPaths.from_db(session, run_id)`.

### 2. Store output paths as relative strings

`PipelineRun.outputs` stores paths relative to `data_root`. Always use `paths.rel(absolute_path)` before storing. Never store absolute paths.

### 3. Background processing uses its own DB sessions

Processing steps run in daemon threads via `backend/app/processing/runner.py`. Background threads must open their own sessions via `runner.get_background_session()` — never pass a request-scoped `SessionDep` into a thread.

### 4. Progress is streamed via SSE

Long-running steps emit progress events via Server-Sent Events. The frontend connects to `/api/v1/pipeline-runs/{run_id}/progress`. Use the `emit()` callback pattern in processing functions.

### 5. Schema changes use `create_all` at startup

There are no migration scripts to run. `backend/app/core/db.py` calls `SQLModel.metadata.create_all()` on startup. Alembic exists only for history. When you add a model field, restart the backend — it applies automatically.

---

## After Common Changes

| Change | Required follow-up |
|--------|--------------------|
| Add or modify a backend route | `npm run generate-client` in `frontend/` |
| Add a new frontend page/route | `npx vite build --mode development` in `frontend/` to regenerate `routeTree.gen.ts` |
| Add a new Python dependency | `uv add <package>` in `backend/`, then `uv sync` |
| Add a new npm dependency | `npm install <package>` in `frontend/` |
| Add a new import in backend that PyInstaller won't auto-detect | Add to `hiddenimports` in `backend/gemi-backend.spec` |

---

## Vendor Packages — What Exists and Where

| Package | Location | How it's found |
|---------|----------|---------------|
| `AgRowStitch` | `backend/vendor/AgRowStitch/` (git submodule) | Installed via `uv pip install -e vendor/AgRowStitch`; imported directly as `import AgRowStitch` |
| `LightGlue` | `backend/vendor/LightGlue/` (git submodule) | Installed via `uv pip install vendor/LightGlue` |
| `bin_to_images` | `backend/bin_to_images/` (local, NOT a submodule) | Found automatically via `sys.path` — do NOT run `uv pip install -e vendor/bin_to_images` (that path does not exist) |
| `farm_ng_core` / `farm_ng_amiga` | PyPI (macOS: built from source) | `uv pip install farm-ng-amiga`; macOS requires source build — see `build-macos.sh` |
| `kornia`, `kornia_rs` | PyPI | `uv pip install kornia kornia_rs`; required by `bin_to_images` for Amiga `.bin` decoding |

---

## PyInstaller Bundle — Known Gotchas

These issues have been hit and fixed. Do not reintroduce them.

**`PackageNotFoundError: No package metadata was found for farm_ng_core`**
- Cause: `bin_to_images` calls `importlib.metadata` to find `farm_ng_core`, but PyInstaller doesn't bundle `.dist-info` by default.
- Fix: `copy_metadata('farm_ng_core')` and `copy_metadata('farm_ng_amiga')` in `gemi-backend.spec`.

**`AgRowStitch is not available`**
- Cause: `AgRowStitch` is a single `.py` file. The old spec collected `panorama_maker` (wrong package name — doesn't exist). PyInstaller didn't know to bundle `AgRowStitch.py`.
- Fix: `hiddenimports += ['AgRowStitch']` in spec. `_import_agrowstitch()` tries direct import first, then path-based fallback.

**`farm_ng SDK / bin_to_images is not available`**
- Cause: `kornia`/`kornia_rs` missing from the bundle, or `farm_ng_core` metadata missing.
- Fix: Both are added to `hiddenimports` and `copy_metadata` in the spec.

**General rule**: If a package is found via a path-based `sys.path.insert` trick at runtime, PyInstaller won't auto-detect it. Add it explicitly to `hiddenimports` in the spec, and restructure the import to try a direct `import` first.

---

## macOS-Specific Issues

**`farm-ng-amiga` won't install directly on Apple Silicon** — no ARM64 wheels. Must build `farm_ng_core` from source first. See `build-macos.sh` for the exact steps (clone v2.3.0, patch `-Werror`, build from source).

**`fuser` on macOS is not the Linux port-killer** — macOS ships a different `/usr/bin/fuser` (a file utility). `scripts/start-backend.sh` detects macOS via `uname` and uses `lsof` instead.

**`tauri dev` fails with `resource path 'binaries/gemi-backend' doesn't exist`** — In dev mode the backend runs separately via `start-backend.sh`, but Tauri still checks the resource path. A `placeholder.txt` is committed in `frontend/src-tauri/binaries/gemi-backend/` to satisfy this check. If it's missing, run `git pull`.

**`AgRowStitch import failed (exit -11): (no output)` in the packaged desktop app** — macOS GUI app context (Tauri/Cocoa) restricts Obj-C framework initialisation in child processes, causing cv2 and torch to SIGSEGV before producing any output. Fixed in `ground.py`:
- Pre-flight import check is skipped when `ENVIRONMENT=desktop` (set by the Tauri sidecar launcher), same as for frozen PyInstaller builds.
- `OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES` is added to the environment of all stitching subprocesses to prevent the crash when the pre-flight is not skipped or for the per-plot subprocesses.

---

## Frontend Patterns

- **File-based routing**: routes live in `frontend/src/routes/`. Adding a file creates a route automatically. Run `npx vite build --mode development` after adding routes.
- **API calls**: use the generated client from `frontend/src/client/`. Never write raw `fetch()` calls to the backend unless absolutely necessary.
- **Pipeline identity**: always use `pipeline_id` (UUID) as keys, not `pipeline_name`. Two pipelines can share a name (e.g. one ground, one aerial with the same name).
- **No `useEffect` for derived data**: compute with `useMemo`. Only use `useEffect` for side effects (DOM, subscriptions, external APIs).

---

## Processing Pipeline Overview

### Ground (Amiga robot)
1. **Bin extraction** — upload `.bin` file → extract images + GPS CSV → delete `.bin` after (success or failure)
2. **Plot marking** — user selects image ranges per plot in the UI
3. **Stitching** — AgRowStitch stitches images per plot into panoramas
4. **Georeferencing** — GPS-based georeferencing of stitched plots
5. **Inference** *(optional)* — Roboflow detection/segmentation

### Aerial (Drone)
0. **Data sync** — triggered automatically; extracts EXIF GPS from images, optionally merges with ArduPilot platform log, writes `msgs_synced.csv` and `drone_msgs.csv`
1. **GCP selection** — user marks ground control points in images
2. **Orthomosaic** — ODM generates orthomosaic + DEM
3. **Plot boundaries** — user draws polygons on the map
4. **Trait extraction** — vegetation fraction, height, temperature per plot
5. **Inference** *(optional)* — Roboflow on split plot images

---

## Build Scripts

| Script | Purpose |
|--------|---------|
| `./build-macos.sh` | Full macOS build (backend sidecar + Tauri .dmg) |
| `./build-macos.sh backend` | PyInstaller sidecar only |
| `./build-macos.sh tauri` | Tauri app only (assumes sidecar already built) |
| `./build-linux.sh` | Linux equivalent |
| `./build.sh` | Cross-platform entry point (detects OS) |

CI builds run on GitHub Actions via `.github/workflows/build.yml` — Linux (.deb), macOS (.dmg), Windows (Inno Setup .exe).

---

## What NOT to Do

- Do not add a login page or JWT auth — it has been intentionally removed
- Do not call `get_setting("data_root")` directly in route handlers — use `RunPaths.from_db()`
- Do not store absolute paths in `PipelineRun.outputs` — use `paths.rel()`
- Do not use a request-scoped DB session inside a background thread
- Do not run `uv pip install -e vendor/bin_to_images` — that path does not exist
- Do not use `pipeline_name` as a unique key anywhere — two pipelines can share a name; use `pipeline_id`
