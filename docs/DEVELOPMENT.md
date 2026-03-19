# GEMI — Developer Guide

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Setting Up the Development Environment](#setting-up-the-development-environment)
4. [Starting the App for Development](#starting-the-app-for-development)
5. [Architecture Overview](#architecture-overview)
6. [Database — Models and Migrations](#database--models-and-migrations)
7. [Adding Backend Features](#adding-backend-features)
8. [Adding Frontend Features](#adding-frontend-features)
9. [OpenAPI Client Generation](#openapi-client-generation)
10. [Background Processing and SSE](#background-processing-and-sse)
11. [Filesystem Layout (RunPaths)](#filesystem-layout-runpaths)
12. [Installing New Packages](#installing-new-packages)
13. [CI Caches](#ci-caches)
14. [Code Style and Linting](#code-style-and-linting)
15. [Building for Production](#building-for-production)
16. [Testing the Production Build Locally](#testing-the-production-build-locally)
17. [Pull Requests and Issues](#pull-requests-and-issues)
18. [Common Gotchas](#common-gotchas)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | [Tauri v2](https://tauri.app) (Rust) |
| Frontend | React 18, [TanStack Router](https://tanstack.com/router) (file-based), [TanStack Query](https://tanstack.com/query), [shadcn/ui](https://ui.shadcn.com), Tailwind CSS |
| Backend | [FastAPI](https://fastapi.tiangolo.com), [SQLModel](https://sqlmodel.tiangolo.com), SQLite |
| Python runtime | Python 3.12, managed by [uv](https://docs.astral.sh/uv/) |
| API client | Auto-generated from OpenAPI schema via [@hey-api/openapi-ts](https://heyapi.dev) |
| Linting | [Biome](https://biomejs.dev) (frontend), [Ruff](https://docs.astral.sh/ruff/) (backend) |

---

## Project Structure

```
gemi-app/
├── backend/                   # FastAPI backend
│   ├── app/
│   │   ├── api/
│   │   │   └── routes/        # One file per feature group (files, pipelines, processing, …)
│   │   ├── core/
│   │   │   ├── config.py      # Settings (reads from .env)
│   │   │   ├── db.py          # SQLite engine + session factory
│   │   │   └── paths.py       # RunPaths — all filesystem path logic lives here
│   │   ├── crud/              # Database helpers (get, create, update, delete)
│   │   ├── models/            # SQLModel table + Pydantic response models
│   │   └── processing/        # Background processing steps
│   │       ├── runner.py      # Thread launcher + SSE progress store
│   │       ├── sync.py        # Aerial: data sync step
│   │       ├── ground.py      # Ground: stitching, georeferencing
│   │       ├── aerial.py      # Aerial: ODM, trait extraction
│   │       └── inference_utils.py
│   ├── hooks/                 # PyInstaller runtime hooks
│   ├── vendor/                # Git submodules (AgRowStitch, LightGlue, bin_to_images)
│   ├── gemi-backend.spec      # PyInstaller build spec
│   └── pyproject.toml
│
├── frontend/                  # Tauri + React frontend
│   ├── src/
│   │   ├── client/            # Auto-generated API client (DO NOT EDIT MANUALLY)
│   │   ├── components/
│   │   │   └── ui/            # shadcn/ui primitives (Button, Dialog, Input, …)
│   │   ├── features/          # Feature-scoped components and pages
│   │   │   ├── analyze/       # Analyze tab (map view, table view)
│   │   │   ├── files/         # Upload Data, Manage Data
│   │   │   ├── process/       # Workspaces, pipelines, run detail
│   │   │   └── home/          # Landing / dashboard
│   │   ├── hooks/             # Shared React hooks
│   │   ├── routes/            # TanStack Router file-based routes
│   │   │   ├── __root.tsx     # Root layout (providers, auth guard)
│   │   │   ├── _layout.tsx    # Authenticated shell (sidebar + nav)
│   │   │   └── _layout/       # All authenticated pages live here
│   │   └── config/            # App-level constants
│   ├── src-tauri/             # Rust/Tauri code
│   │   ├── src/
│   │   │   ├── lib.rs         # App entry — starts backend sidecar in production
│   │   │   └── sidecar_manager.rs  # Launches gemi-backend process
│   │   ├── binaries/          # PyInstaller output copied here before Tauri build
│   │   └── tauri.conf.json
│   ├── openapi-ts.config.ts
│   └── package.json
│
├── docs/                      # Documentation
├── scripts/
│   ├── start-backend.sh       # Dev backend launcher (kills port 8000 first)
│   └── generate-client.sh     # Exports OpenAPI schema + regenerates TS client
├── build-linux.sh
├── build-macos.sh
└── build-windows.ps1
```

---

## Setting Up the Development Environment

### 1. Install prerequisites

| Tool | How |
|------|-----|
| [uv](https://docs.astral.sh/uv/) | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python 3.12 | `uv python install 3.12` |
| Node.js 22 | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| Rust (stable) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |

**Windows only** — install [Inno Setup 6](https://jrsoftware.org/isdl.php) to build the installer. The default install path (`C:\Program Files (x86)\Inno Setup 6\ISCC.exe`) is expected by `build-windows.ps1` and the CI workflow. NSIS is **not** used on Windows — see [CI Caches](#ci-caches) for why.

**Linux only** — install Tauri system dependencies:
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libssl-dev pkg-config
```

### 2. Clone with submodules

```bash
git clone --recurse-submodules https://github.com/your-org/gemi-app.git
cd gemi-app
```

If you already cloned without `--recurse-submodules`:
```bash
git submodule update --init --recursive
```

### 3. Install Python dependencies

```bash
cd backend
uv sync
```

This creates `backend/.venv` and installs everything from `pyproject.toml` / `uv.lock`.

Install vendor submodule packages (required for stitching and bin extraction):
```bash
uv pip install -e vendor/AgRowStitch --no-build-isolation
uv pip install vendor/LightGlue
uv pip install -e vendor/bin_to_images
uv pip install farm-ng-amiga   # Linux/macOS only
```

### 4. Install frontend dependencies

```bash
cd frontend
npm install
```

### 5. Environment file (optional)

The backend reads settings from a `.env` file at the **repo root**. None of these are required for local development — the defaults work out of the box:

```bash
# .env (optional)
ENVIRONMENT=local
FIRST_SUPERUSER=admin@example.com
FIRST_SUPERUSER_PASSWORD=adminpassword
APP_DATA_ROOT=/path/to/your/data   # defaults to ~/GEMI-Data
SQLITE_DB_PATH=/path/to/gemi.db    # defaults to platform app data dir
```

---

## Starting the App for Development

### Option A — Full stack in one command (recommended)

```bash
cd frontend
npm run dev:full
```

This uses `concurrently` to start the FastAPI backend (port 8000) and the Vite dev server (port 5173) simultaneously. Open `http://localhost:5173` in your browser.

### Option B — Separately (useful when only working on one layer)

```bash
# Terminal 1 — backend
cd frontend
npm run dev:backend       # or: cd backend && uv run uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev
```

### Option C — Inside the Tauri window (closest to production)

```bash
cd frontend
npm run tauri:dev         # Linux: needs GDK_BACKEND=x11 on Wayland
```

This opens a native desktop window. The backend is still started as a separate process and hot-reloads; the Tauri shell reloads when Rust code changes.

> **Vite proxy:** In dev mode, requests to `/api/*` from the browser are proxied to `http://127.0.0.1:8000` by Vite. In production (Tauri), the frontend uses `window.__GEMI_BACKEND_URL__` injected by the Rust sidecar manager.

### Default credentials

```
Email:    admin@example.com
Password: adminpassword
```

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Tauri (Rust)                                            │
│  • Spawns gemi-backend on a free port at startup         │
│  • Injects window.__GEMI_BACKEND_URL__ into the webview  │
│  • Handles native file dialogs, download_to_file IPC     │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  React (Vite)                                      │  │
│  │  • TanStack Router — file-based routing            │  │
│  │  • TanStack Query — all server state               │  │
│  │  • Auto-generated client calls FastAPI over HTTP   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  FastAPI (Python)                                  │  │
│  │  • SQLite via SQLModel                             │  │
│  │  • Long-running steps run in daemon threads        │  │
│  │  • Progress streamed to frontend via SSE           │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**Data flow for a processing step:**
1. Frontend calls `POST /api/v1/pipeline-runs/{id}/execute-step`
2. Route handler launches a daemon thread via `runner.launch()`
3. Thread emits progress events into the in-memory store
4. Frontend opens `GET /api/v1/pipeline-runs/{id}/progress` (SSE)
5. SSE endpoint streams events from the store to the browser
6. When done, thread writes outputs to `PipelineRun.outputs` in the DB

---

## Database — Models and Migrations

### Where the database lives

| Platform | Default path |
|----------|-------------|
| Linux | `~/.local/share/gemi/gemi.db` |
| macOS | `~/Library/Application Support/GEMI/gemi.db` |
| Windows | `%APPDATA%\GEMI\gemi.db` |

Override with `SQLITE_DB_PATH=/path/to/gemi.db` in `.env`.

### How the schema is managed

The app uses **`create_all` at startup** — SQLModel creates any missing tables when the backend starts. There are no migration scripts to run for development.

Alembic is present in `backend/app/alembic/` for history/auditing purposes only and is not used in the normal dev workflow.

### Adding a new database model

1. **Create the model file** in `backend/app/models/`:

```python
# backend/app/models/my_thing.py
from sqlmodel import Field, SQLModel
import uuid

class MyThing(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str
    workspace_id: uuid.UUID = Field(foreign_key="workspace.id")
```

2. **Register it** in `backend/app/models/__init__.py` so `create_all` sees it:

```python
from .my_thing import MyThing  # noqa: F401
```

3. **Add CRUD helpers** in `backend/app/crud/my_thing.py` (get, create, update, delete).

4. **Restart the backend** — the table is created automatically.

5. **Regenerate the client** after adding API routes (see [OpenAPI Client Generation](#openapi-client-generation)).

### Resetting the database

Delete the `.db` file and restart the backend. The superuser is recreated automatically from `FIRST_SUPERUSER` / `FIRST_SUPERUSER_PASSWORD` settings.

---

## Adding Backend Features

### Adding a new API route

1. Create or open a file in `backend/app/api/routes/`:

```python
# backend/app/api/routes/my_feature.py
from fastapi import APIRouter
from app.api.deps import CurrentUser, SessionDep

router = APIRouter(prefix="/my-feature", tags=["my-feature"])

@router.get("/")
def list_things(session: SessionDep, current_user: CurrentUser):
    ...
```

2. Register the router in `backend/app/api/main.py`:

```python
from app.api.routes import my_feature
api_router.include_router(my_feature.router)
```

3. Add the module to `hiddenimports` in `backend/gemi-backend.spec` so PyInstaller bundles it:

```python
'app.api.routes.my_feature',
```

4. Regenerate the TypeScript client (see below).

### Auth and session dependencies

```python
from app.api.deps import CurrentUser, SessionDep

# CurrentUser — raises 401 if not logged in, returns the User object
# SessionDep  — provides a SQLModel session, auto-committed on success
```

### Returning errors

```python
from fastapi import HTTPException
raise HTTPException(status_code=404, detail="Thing not found")
```

---

## Adding Frontend Features

### Adding a new page / route

Routes are **file-based** using TanStack Router. The filename determines the URL.

```
src/routes/_layout/my-section/
  index.tsx          → /my-section
  $itemId.tsx        → /my-section/:itemId
```

Create the file — TanStack Router auto-generates the route tree on the next `vite` run:

```tsx
// src/routes/_layout/my-section/index.tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/my-section/')({
  component: MySectionPage,
})

function MySectionPage() {
  return <div>Hello</div>
}
```

> After adding routes, run `npx vite build --mode development` once to regenerate
> `src/routeTree.gen.ts`, then `npx tsc --noEmit` to check types.

### Feature folder convention

Group related components, hooks, and pages under `src/features/<name>/`:

```
src/features/my-feature/
  components/        # UI components specific to this feature
  pages/             # Full page components (referenced by routes)
  hooks/             # Feature-scoped React Query hooks
```

### Calling the backend

Use the auto-generated client, never `fetch` directly (except for streaming endpoints):

```tsx
import { MyFeatureService } from '@/client'
import { useQuery, useMutation } from '@tanstack/react-query'

// Query
const { data } = useQuery({
  queryKey: ['my-things'],
  queryFn: () => MyFeatureService.listThings(),
})

// Mutation
const mutation = useMutation({
  mutationFn: (body) => MyFeatureService.createThing({ requestBody: body }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-things'] }),
})
```

For SSE progress streams, use `fetch` directly with `EventSource` or a custom hook — the generated client does not support streaming.

### Adding a new UI component

Use shadcn/ui for all base components (buttons, dialogs, inputs, etc.):

```bash
cd frontend
npx shadcn@latest add <component-name>
```

This copies the component source into `src/components/ui/` where you can customise it.

---

## OpenAPI Client Generation

The TypeScript client in `src/client/` is **fully auto-generated** from the backend's OpenAPI schema. Never edit files in `src/client/` manually — they will be overwritten.

**Run this every time you add, change, or remove a backend endpoint or model:**

```bash
# From repo root — exports schema from backend, regenerates client
./scripts/generate-client.sh
```

What the script does:
1. Imports `app.main` and dumps `app.openapi()` to `frontend/openapi.json`
2. Runs `npm run generate-client` (openapi-ts) to rebuild `src/client/`

The backend does **not** need to be running for this — the schema is extracted by importing the Python module directly.

---

## Background Processing and SSE

Long-running processing steps (stitching, ODM, inference) run in daemon threads so they don't block FastAPI's async event loop.

### Launching a background step

```python
from app.processing.runner import launch, get_background_session

def my_step(run_id: str, emit, **kwargs):
    # emit() sends a progress event to the SSE stream
    emit({"type": "progress", "message": "Starting...", "pct": 0})

    # Background threads MUST open their own DB session
    with get_background_session() as session:
        run = session.get(PipelineRun, run_id)
        ...

    emit({"type": "done", "message": "Complete", "pct": 100})

# In a route handler:
launch(run_id=str(run.id), target=my_step, kwargs={...})
```

### SSE progress endpoint

The frontend subscribes to `GET /api/v1/pipeline-runs/{id}/progress`. Events are stored in an in-memory dict keyed by `run_id`. The client reconnects with `?offset=N` to resume without replaying old events.

### Key rule

> **Never use the request-scoped `SessionDep` inside a background thread.**
> Always call `get_background_session()` to open a fresh session.

---

## Filesystem Layout (RunPaths)

All file paths are derived from database values — nothing is hardcoded. Use `RunPaths` for any file I/O in processing code:

```python
from app.core.paths import RunPaths

paths = RunPaths.from_db(session=session, run=run, workspace=workspace)
paths.make_dirs()

# Common paths
paths.raw                  # Raw uploaded images
paths.raw_metadata         # Platform logs, msgs_synced.csv
paths.msgs_synced          # Intermediate/workspace/.../msgs_synced.csv
paths.geo_txt              # GCP geo.txt
paths.plot_borders         # Pipeline-level, reused across runs
paths.agrowstitch_dir(n)   # Ground stitch output versioned directory
paths.ortho_dir(n)         # Aerial ortho output versioned directory

# Store relative paths in PipelineRun.outputs (relative to data_root)
run.outputs = {"stitched": paths.rel(paths.agrowstitch_dir(1))}
```

See `backend/app/core/paths.py` for the full directory layout documentation.

---

## Installing New Packages

### Python

```bash
cd backend
uv add <package>          # adds to pyproject.toml + uv.lock
uv add --dev <package>    # dev-only (tests, linting)
```

After adding a package that the PyInstaller bundle needs, add it to `hiddenimports` or the `collect_submodules` / `collect_data_files` calls in `backend/gemi-backend.spec`.

### JavaScript / TypeScript

```bash
cd frontend
npm install <package>           # runtime dependency
npm install --save-dev <package> # dev dependency
```

### After any package change

- **Python:** the `uv.lock` file is updated automatically. Commit both `pyproject.toml` and `uv.lock`.
- **JS:** `package-lock.json` is updated. Commit both `package.json` and `package-lock.json`.
- **PyInstaller cache:** the CI bundle cache is invalidated automatically when `uv.lock`, the `.spec` file, any `app/**/*.py` source, or **the workflow file itself** changes. Changing only the install *method* (e.g. adding a `--index-url`) without touching `uv.lock` is covered because the workflow file hash is included in the cache key.

---

## CI Caches

The GitHub Actions workflow maintains three caches to keep builds fast. Each is keyed so it auto-invalidates when the relevant inputs change.

| Cache | Key inputs | Typical size | Notes |
|-------|-----------|-------------|-------|
| **Python venv** (`backend/.venv`) | `pyproject.toml`, `uv.lock`, submodule hashes | 3–5 GB | Shared across jobs for the same OS |
| **PyInstaller bundle** (`binaries/gemi-backend`) | `uv.lock`, `gemi-backend.spec`, `app/**/*.py`, `hooks/**`, **`build.yml`** | 2–4 GB | Skips the 1–2 h PyInstaller step on cache hit |
| **Cargo build artifacts** | Rust source + `Cargo.lock` + `prefix-key` | 1–2 GB | Managed by `swatinem/rust-cache`; `prefix-key: "v2"` in `build.yml` |

### Windows installer: Inno Setup instead of NSIS

The Windows installer is built with **Inno Setup 6**, not NSIS. NSIS has a hard ~2 GB data-block mmap limit (`Internal compiler error #12345`) that CUDA torch DLLs alone exceed. Inno Setup has no such limit.

The CI workflow for Windows:
1. `npx tauri build --no-bundle` — compiles the Rust binary, skips NSIS
2. `ISCC.exe inno-setup.iss` — packages `GEMI.exe` + the full `gemi-backend/` sidecar (including CUDA DLLs) into a single installer

The installer script lives at `frontend/src-tauri/inno-setup.iss`. The output is `target/release/bundle/inno/GEMI_<version>_x64-setup.exe`, which matches the `artifact-glob` in `build.yml`.

Inno Setup 6 is pre-installed on GitHub Actions Windows runners. For local Windows builds, install it from [jrsoftware.org/isdl.php](https://jrsoftware.org/isdl.php) — `build-windows.ps1` expects it at the default path.

### When to manually bust a cache

- **PyInstaller bundle:** Normally auto-busts when any listed input changes, including the workflow file. If you need to force a fresh build without changing any source file (rare), bump `prefix-key` in the `swatinem/rust-cache` step or add a dummy comment to `build.yml`.
- **Cargo:** Bump `prefix-key` (currently `"v2"`) in the `swatinem/rust-cache` step to force a full Rust rebuild (e.g. after a compiler upgrade or if the cache becomes corrupt).
- **Python venv:** Change any of the key inputs, or delete the cache in the GitHub Actions UI under *Caches*.

### Common symptom: installer size doesn't grow after adding a large package

If you add or switch a large dependency (e.g. changing torch from CPU to CUDA) but the installer size stays the same, the **PyInstaller bundle cache was hit** and the old bundle was reused. Check whether any of the cache key inputs actually changed. If not, add a comment to `build.yml` to force a cache miss.

---

## Code Style and Linting

### Frontend (Biome)

```bash
cd frontend
npm run lint              # check and auto-fix
```

Biome handles formatting, import sorting, and linting in one pass. There is no Prettier or ESLint.

### Backend (Ruff)

```bash
cd backend
uv run ruff check .       # lint
uv run ruff format .      # format
```

---

## Building for Production

See [`docs/BUILDING.md`](./BUILDING.md) for full instructions per platform.

Quick reference:

```bash
# Linux (Ubuntu 22.04 recommended)
./build-linux.sh

# macOS (Apple Silicon)
./build-macos.sh

# Windows (PowerShell)
.\build-windows.ps1
```

Partial builds (skip PyInstaller if backend hasn't changed):

```bash
./build-linux.sh tauri    # Tauri only — assumes binaries/gemi-backend/ exists
./build-linux.sh backend  # PyInstaller only
```

> **Windows note:** `build-windows.ps1` uses Inno Setup 6 (not NSIS) to create the installer. Install it from [jrsoftware.org/isdl.php](https://jrsoftware.org/isdl.php) before running a full Windows build.

---

## Testing the Production Build Locally

After running a full build, the Tauri app launches the backend sidecar automatically. To verify end-to-end behaviour before distributing:

1. **Install the built package** on your machine:
   - Linux: `sudo dpkg -i frontend/src-tauri/target/release/bundle/deb/*.deb`
   - macOS: open the `.dmg` and drag to Applications
   - Windows: run the NSIS `.exe` installer

2. **Launch GEMI** from your applications menu or `gemi` on the command line.

3. The backend starts in the background on a random port. Check the terminal output (Linux/macOS) or Windows Event Viewer for `[backend]` log lines if something is wrong.

4. **Confirm the data root** is set correctly in Settings before uploading any data.

To test without installing, you can run the Tauri bundle directly:
```bash
# Linux
./frontend/src-tauri/target/release/GEMI
```

---

## Pull Requests and Issues

### Reporting a bug or requesting a feature

Open an issue at `https://github.com/your-org/gemi-app/issues` with:

- **Bug:** steps to reproduce, expected vs actual behaviour, OS and app version
- **Feature:** what problem it solves, any relevant screenshots or mockups

### Submitting a pull request

1. **Branch from `main`** with a descriptive name:
   ```bash
   git checkout -b feature/my-new-thing
   git checkout -b fix/broken-sync-step
   ```

2. **Keep commits focused.** One logical change per commit. Write commit messages in the imperative: `add aerial plot boundary export`, not `added` or `adding`.

3. **Regenerate the client** if you changed any backend routes or models:
   ```bash
   ./scripts/generate-client.sh
   ```

4. **Lint before pushing:**
   ```bash
   cd frontend && npm run lint
   cd backend && uv run ruff check .
   ```

5. **Open the PR against `main`.** Include:
   - What the change does and why
   - Screenshots for any UI changes
   - Notes on anything that needs manual testing

6. CI will run the full build on Linux, macOS, and Windows automatically.

---

## Common Gotchas

| Problem | Cause | Fix |
|---------|-------|-----|
| `MyService is not defined` or missing method in TS | Backend route added but client not regenerated | Run `./scripts/generate-client.sh` |
| Route not found / 404 after adding a page | `routeTree.gen.ts` is stale | Run `npx vite build --mode development` in `frontend/` |
| Backend 401 on every request | `access_token` not in `localStorage` | Log in at `/login` — auth token is stored there |
| `ModuleNotFoundError` in PyInstaller bundle | New import not in `hiddenimports` in `.spec` | Add module to `gemi-backend.spec` and rebuild |
| Tauri dev window blank on Wayland | `GDK_BACKEND` not set | Use `GDK_BACKEND=x11 npx tauri dev` or `npm run tauri:dev` |
| Background thread crashes silently | Used request-scoped `SessionDep` in thread | Use `get_background_session()` instead |
| Outputs missing after step completes | Path stored as absolute, not relative | Use `paths.rel(path)` before storing in `run.outputs` |
| `uv sync` succeeds but import fails | Vendor submodule not installed | Run vendor `uv pip install` steps from the setup section |
| CI bundle cache not invalidating | Changed a Python file outside `app/` | Add the path to the `hashFiles` glob in the cache step |
| Installer size unchanged after adding a large package | PyInstaller bundle cache hit — old bundle reused | Change any cache key input (e.g. add a comment to `build.yml`) to force a miss; see [CI Caches](#ci-caches) |
| Windows NSIS `error mmapping datablock #12345` | CUDA DLLs exceed NSIS's 2 GB data-block limit | Windows uses Inno Setup instead of NSIS — see [CI Caches](#ci-caches) |
