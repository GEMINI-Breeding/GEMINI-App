# 🌱 GxExMINI Phenotyping App

![GEMINI Logo](assets/gemini_logo.png)

**GxExMINI** (GEMI for short) turns drone flights, rover runs and plot photos into per-plot images and trait measurements, and analyses them alongside field designs and genotype data. It is a desktop app for Windows, macOS and Linux, with an optional AI agent that can do the processing for you on request.

More about the project: [projectgemini.ucdavis.edu](https://projectgemini.ucdavis.edu/) · [Documentation and user guides](https://gemini-breeding.github.io/) · [Example data](https://ucdavis.box.com/s/ts802xlcddyufixfjmeayxwiiz2mxrb9)

---

## Install

Download the installer for your system from the [releases page](https://github.com/GEMINI-Breeding/GEMINI-App/releases) and open GEMI.

The heavy processing (orthomosaics, stitching, models) runs in a **processing stack**: a database, file storage and workers. GEMI needs one of these:

| Where the processing runs | What you need | Good for |
|---|---|---|
| **This computer** | [Docker Desktop](https://www.docker.com/products/docker-desktop/). GEMI downloads it and opens its installer for you (your system asks you to approve it), and starts it when it is installed but not running. On Linux it shows the terminal commands instead. | Small data sets, trying things out |
| **A cluster (HPC)** | A Slurm cluster with Apptainer that you can log in to with an SSH key (no password or two-factor prompt) | Whole fields and seasons |

Nothing has to be installed on the cluster beforehand: GEMI sets it up from this computer (see [Clusters](#clusters)).

### What GEMI installs for you

The two programs a new computer may be missing can be installed from inside the app, where it asks for them (the first-run walkthrough, the Docker screen, the model setup):

| Program | Needed for | What the button does |
|---|---|---|
| **Docker Desktop** | Processing on this computer | **Windows / macOS:** downloads the official installer and opens it; your system asks you to approve it (on Windows it may also ask to restart for WSL 2). **Install Docker Desktop** becomes **Start Docker** once it is installed, and GEMI carries on when Docker is up. **Linux:** Docker needs administrator rights to install, so GEMI shows the terminal commands to copy, then notices Docker by itself. |
| **Ollama** | An open language model on this computer, for the agent | Installs it completely for your user, no administrator rights: **Windows** the official installer run silently; **macOS** the app unpacked into `~/Applications`; **Linux** the official archive unpacked into `~/.local/share/gemi/ollama` (needs the `zstd` program, present on standard Ubuntu installs). Then starts it. |

Each step shows its progress and the time left. Downloads come only from docker.com and ollama.com, and installs are only started by the app on the same computer. Every screen keeps a "download it yourself" link.

If macOS says the app cannot be opened, allow it under System Settings → Privacy & Security → Open Anyway.

## First run

A short walkthrough asks three things, each changeable later in Settings:

1. **Where the processing runs**: this computer or a cluster.
2. **How you want to work**: with the agent, or by hand. By hand needs no language model; every step can be done in the app.
3. **Which model the agent uses** (only with the agent; see [Setting up the agent](#setting-up-the-agent)).

The app signs in by itself with the account of its own stack. To require a login (shared computers, several people), turn it on under Settings → Sign-in.

## Using the app

| Page | What it is for |
|---|---|
| **Home** | Two tabs. **Dashboard**: an overview built from your trait data (traits over the season, which traits move together, heritability, the latest field map, where processing stands), plus tabs of your own; pin any view to keep it. **Agent**: ask for work in plain words. Either tab can be turned off (Settings → Home). |
| **Files** | Upload rover logs (`.bin`), drone images, orthomosaics, plot photos, field designs and trait tables. Optional: a treatment, and a run number for fields covered more than once a day; when uploading many folders, say which folder is which run or treatment. |
| **Process** | Every run by experiment and date, with where it stands (running, waiting for its next step, failed, complete). Rovers and hand-held cameras go through the **ground** pipeline (plot marking, stitching, plot boundaries, plot images, inference); drones through the **aerial** pipeline (orthomosaic, plot boundaries, plot images, trait extraction, inference). Runs the agent started carry a small agent mark. |
| **Analyze** | Tables, maps and charts of traits; correlation, ANOVA, heritability, PCA, GGE biplots, field maps. |
| **Genotyping** | Marker data (HapMap, VCF, CSV) per experiment, and genome-wide association of measured traits. |
| **Settings** | Home, data and services, Compute (what runs on the cluster, start and stop), sign-in. |

Inference models can come from Roboflow, Hugging Face, or your own YOLO weights (`.pt` / `.onnx`); each pipeline keeps a list of models, and the Inference step shows the results of every model run on a run.

---

## Setting up the agent

The agent works the app through the same steps you would: upload, mark plots, stitch, run models, analyse, start and stop cluster work. It asks before anything that changes the cluster session or deletes data, and asks you for facts only you know (plots per bed, the field design, where the rover started).

It needs a **language model**. Choose one in the walkthrough, or later on the Agent tab (gear icon):

| Option | What you need | Notes |
|---|---|---|
| **A free open model on this computer** | [Ollama](https://ollama.com/download): GEMI installs it for you, no administrator rights needed. A graphics card helps a lot. | GEMI downloads and serves the model. The small Gemma 4 models (E2B, E4B) run on a laptop GPU with 6 GB; larger ones are slow there. |
| **A free open model on your cluster** | A GPU partition you can use | GEMI looks at the cluster, picks a GPU queue, installs the model server and weights (20 to 60 minutes the first time) and connects. Gemma 4 31B on a 48 GB GPU is the best tested model. |
| **A hosted model** | An API key (Anthropic Claude, OpenAI, or any OpenAI-compatible service) | Quickest to start; your requests and data go to that provider. |

Models that read images are needed for steps that look at pictures (plot photos, checking markings). If the app finds a model already running on this computer (Ollama, vLLM), it offers that one first.

How well each model does on the app's tasks, and what was changed to get small models through every step: [agent/EVALUATION.md](agent/EVALUATION.md). Full agent guide: [agent/SETUP.md](agent/SETUP.md).

### Driving GEMI from a coding agent instead

The installed app contains `gemi-agent`, one executable with every tool the in-app agent has. A coding agent (Claude Code, Codex, Gemini CLI, any MCP client) can use it with its own model, so no model has to be set up in the app.

| System | Path |
|---|---|
| macOS | `/Applications/GEMI.app/Contents/MacOS/gemi-agent` |
| Windows | `gemi-agent.exe` in the folder GEMI was installed to |
| Linux (.deb) | `/usr/bin/gemi-agent` |

Register it as an MCP server, for example in Claude Code:

```bash
claude mcp add gemi -- /Applications/GEMI.app/Contents/MacOS/gemi-agent mcp
```

Then ask in plain words: *"Use the gemi tools. Read the skill connect-hpc and set GEMI up on my cluster; my login is `ssh you@login.cluster.edu`."* The terminal and the app share their settings and state, so what one sets up appears in the other. By hand: `gemi-agent tools`, `gemi-agent status`, `gemi-agent chat "what is running?"`.

The procedures the agent follows are plain Markdown in [agent/skills/](agent/skills/), one per stage; edit them to change how it works.

---

## Clusters

With a cluster, the whole stack runs as Slurm jobs, driven from this computer over SSH. In the app, give the agent your SSH login command and it sets things up with you; each step that changes something on the cluster asks first.

- **One gate.** Every action on the cluster goes through one script there (`hpc/remote/gemi-gate`): a fixed menu confined to GEMI's own folder, with job size limits and a log of every call.
- **No idle jobs.** Workers stop themselves when no job needs them (GPU workers after 5 minutes, others after 20) and the cluster model after 30 minutes without a request; they start again when work arrives. Set per cluster in its `launch.conf`.
- **The cluster's own rules.** Where the administrators publish rules for AI agents, the agent reads them before any cluster action and follows them over its own defaults.

The same from a terminal, with the repository checked out:

```bash
# once: copy hpc/clusters/launch.conf.example to hpc/clusters/<name>/launch.conf and edit it
bash hpc/gemi-hpc sync && bash hpc/gemi-hpc pull     # code and container images
bash hpc/gemi-hpc up          # start a session (database, storage, API)
bash hpc/gemi-hpc app         # tunnels + agent + app on this computer; prints the address
bash hpc/gemi-hpc llm up      # optional: an open model on a GPU
bash hpc/gemi-hpc down        # end the session
bash hpc/gemi-hpc doctor      # check the connection, the gate and the limits
```

Details: [agent/SETUP.md](agent/SETUP.md), sections 5 and 6.

---

## Key dependencies

- **[GEMINIbase](https://github.com/GEMINI-Breeding/GEMINIbase)**: the processing stack (Litestar API, Postgres, MinIO, Redis, TiTiler and the workers), included at `backend/`.
- **[OpenDroneMap](https://opendronemap.org/)**: drone images to georeferenced orthomosaics and elevation models (aerial pipeline).
- **[AgRowStitch](https://github.com/GEMINI-Breeding/AgRowStitch)**: rover row images to plot mosaics (ground pipeline).
  Uyehara, I. K. et al. *AgRowStitch: A High-fidelity Image Stitching Pipeline for Ground-based Agricultural Images.* arXiv, 2025. [arxiv.org/pdf/2503.21990](https://arxiv.org/pdf/2503.21990)
- **[farm-ng Amiga SDK](https://github.com/farm-ng/farm-ng-amiga)**: reads Amiga rover logs (`.bin`).
- **[Tauri](https://tauri.app)** and React: the desktop app.

![Sensing Pipeline](assets/sensing_pipeline.png)

---

## Development

<details>
<summary>Running from source: backend in Docker, frontend in a browser or the desktop window</summary>

Development has two parts: the **backend** (GEMINIbase), which runs in Docker, and the **frontend**, which runs on your machine. On Windows, run the commands in **Git Bash**. More background: the [Developer Guide](https://gemini-breeding.github.io/start_guide/developer_guide/) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

**Prerequisites**

| Tool | Version | Needed for |
|---|---|---|
| Git | 2.46 or newer on Windows | Cloning the repo and the backend submodule |
| Docker Desktop (or Docker Engine with Compose v2) | Current | The backend |
| [Node.js](https://nodejs.org) | 22 or newer | The frontend |
| [Rust](https://rustup.rs) (stable) and the build tools in [docs/BUILDING.md](docs/BUILDING.md) | 1.77 or newer | The desktop window only |
| Python | 3.11 or newer | The agent from source |

**Set up and run**

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

The agent from source: `cd agent && python -m gemi_agent serve` (the app's Agent tab), or `python -m gemi_agent chat` in the terminal; see [agent/SETUP.md](agent/SETUP.md), "Quick start: a terminal".

**Day to day** (from the repo root)

| Task | Command |
|---|---|
| Start the backend | `docker compose up -d` |
| Rebuild after pulling or changing backend code | `docker compose up -d --build` |
| Live sync and rebuilds while developing the backend | `docker compose watch` |
| Stop the backend | `docker compose down` |
| A service's logs | `docker compose logs -f <service>` (e.g. `rest-api`) |

`npm run dev` warns when the worker images are older than the backend source; rebuild with `--build`.

**Ports**: frontend dev server 5173 · REST API 7777 (the dev server forwards `/api/*`) · TiTiler 8091 · NodeODM 13000 · MinIO 9000 / 9001 (console) · Postgres 5432 · Redis 6379. GEMINIbase's reference UI is off by default: `docker compose --profile geminibase-ui up -d`.

**Building installers**: [docs/BUILDING.md](docs/BUILDING.md). Pushes to `main` and `v*` tags build every platform on GitHub Actions; tags also draft a release.

**Troubleshooting**

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

</details>
