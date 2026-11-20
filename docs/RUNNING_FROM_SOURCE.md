# Running GEMI from source

[← README](../README.md)

Development has two parts: the **backend** (GEMINIbase), which runs in Docker, and the **frontend**, which runs on your machine. On Windows, run the commands in **Git Bash**. More background: the [Developer Guide](https://gemini-breeding.github.io/start_guide/developer_guide/). Coding agents: start from [AGENTS.md](../AGENTS.md).

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Git | 2.46 or newer on Windows | Cloning the repo and the backend submodule |
| Docker Desktop (or Docker Engine with Compose v2) | Current | The backend |
| [Node.js](https://nodejs.org) | 22 or newer | The frontend |
| [Rust](https://rustup.rs) (stable) and the build tools in [BUILDING.md](BUILDING.md) | 1.77 or newer | The desktop window only |
| Python | 3.11 or newer | The agent from source |

## Set up and run

```bash
git clone --recurse-submodules https://github.com/GEMINI-Breeding/GEMINI-App.git
cd GEMINI-App
./scripts/setup-backend.sh       # fetches backend/ and creates its .env files
docker compose up -d --build     # first build takes 10 minutes or more
docker compose ps                # rest-api and logger should show "healthy"

cd frontend && npm install
npm run dev                      # browser: http://localhost:5173
# or: npm run tauri:dev          # desktop window (first Rust build takes several minutes)
# or: npm run dev:full           # starts the backend containers first
```

Run only one of `npm run dev` and `npm run tauri:dev` at a time (both use port 5173). The development admin account is in `backend/gemini/pipeline/.env` (`GEMINI_FIRST_SUPERUSER_EMAIL` / `GEMINI_FIRST_SUPERUSER_PASSWORD`).

The agent from source: `cd agent && python -m gemi_agent serve` (the app's Agent tab), or `python -m gemi_agent chat` in the terminal; see [agent/SETUP.md](../agent/SETUP.md), "Quick start: a terminal".

## Day to day (from the repo root)

| Task | Command |
|---|---|
| Start the backend | `docker compose up -d` |
| Rebuild after pulling or changing backend code | `docker compose up -d --build` |
| Live sync and rebuilds while developing the backend | `docker compose watch` |
| Stop the backend | `docker compose down` |
| A service's logs | `docker compose logs -f <service>` (e.g. `rest-api`) |

`npm run dev` warns when the worker images are older than the backend source; rebuild with `--build`.

**Ports**: frontend dev server 5173 · REST API 7777 (the dev server forwards `/api/*`) · TiTiler 8091 · NodeODM 13000 · MinIO 9000 / 9001 (console) · Postgres 5432 · Redis 6379. GEMINIbase's reference UI is off by default: `docker compose --profile geminibase-ui up -d`.

**Building installers**: [BUILDING.md](BUILDING.md). Pushes to `main` and `v*` tags build every platform on GitHub Actions; tags also draft a release.

## Troubleshooting

- **`$'\r': command not found` or `Malformed input to a URL function` during `docker compose` builds.** The checkout has Windows (CRLF) line endings. Commit or stash your changes first (this discards changes to tracked files), then:
  ```bash
  git config core.autocrlf false
  git -C backend config core.autocrlf false
  for r in . backend; do git -C "$r" rm -rq --cached . && git -C "$r" reset -q --hard; done
  docker compose up -d --build
  ```
  To avoid it in future clones: `git config --global core.autocrlf input` before cloning.
- **`'..' is not recognized as an internal or external command` from `npm run dev` on Windows.** Point npm at Git Bash: `npm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"`.
- **`detected dubious ownership` during `setup-backend.sh`** (repo on an exFAT or FAT32 drive). With Git 2.46 or newer: `git config --global --add safe.directory 'G:/*'` (your drive letter), then `rm -rf backend .git/modules/backend` and run the script again.
- **The desktop app exits with `STATUS_IN_PAGE_ERROR` (0xc0000006).** The repo is on a drive that went to sleep or disconnected. Keep the Rust build output on an internal drive: `export CARGO_TARGET_DIR="$HOME/.cargo-target/gemi"`.
- **Port 5173 is already in use.** A dev server is already running; stop it first.
