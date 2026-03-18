# Building GEMI Locally

This guide covers building the GEMI desktop app on Linux, macOS, and Windows.

> **Linux compatibility note:** Build on **Ubuntu 22.04** to produce a binary that runs on
> Ubuntu 20.04+, Debian 11+, RHEL 8+, and other mainstream distros. Building on a newer
> distro (Ubuntu 24.04, Arch, etc.) will produce a binary that fails on older systems due
> to a newer glibc version being required.

---

## Prerequisites

### All platforms

| Tool | Version | Install |
|------|---------|---------|
| Git | any | system package manager |
| [uv](https://docs.astral.sh/uv/) | latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python | 3.12 | managed by uv (`uv python install 3.12`) |
| Node.js | 22 | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| Rust (stable) | ≥ 1.77 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |

### Linux (Ubuntu 22.04)

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libssl-dev \
  pkg-config
```

### macOS (Apple Silicon)

Xcode Command Line Tools are required for Rust and the farm-ng-core source build:

```bash
xcode-select --install
```

### Windows 11

- [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **C++ build tools** workload
- WebView2 runtime (pre-installed on Windows 11)
- Run all commands in **PowerShell** or **Git Bash**

---

## Clone the repo

```bash
git clone --recurse-submodules https://github.com/your-org/gemi-app.git
cd gemi-app
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive
```

---

## Build (Linux / macOS)

A `build.sh` script at the repo root handles everything:

```bash
# Full build (backend sidecar + Tauri app)
./build.sh

# Backend sidecar only (PyInstaller)
./build.sh backend

# Tauri app only (assumes backend already built)
./build.sh tauri
```

The finished installer is placed in:

```
frontend/src-tauri/target/release/bundle/
  deb/   ← Linux .deb
  dmg/   ← macOS .dmg
```

### macOS note

`build.sh` automatically detects macOS and builds `farm-ng-core` from source (no ARM64
wheels exist on PyPI). This adds ~5 minutes to the first backend build.

---

## Build (Windows)

`build.sh` does not support Windows. Run the steps manually in PowerShell:

```powershell
# 1. Install Python dependencies
cd backend
uv sync

# 2. Install vendor packages
uv pip install -e vendor/AgRowStitch --no-build-isolation
uv pip install vendor/LightGlue
uv pip install -e vendor/bin_to_images
uv pip install --no-build-isolation farm-ng-amiga  # may fail — non-fatal

# 3. Build PyInstaller backend bundle
uv run pyinstaller --clean gemi-backend.spec

# 4. Copy bundle to Tauri binaries directory
New-Item -ItemType Directory -Force -Path ..\frontend\src-tauri\binaries\gemi-backend | Out-Null
Copy-Item -Path dist\gemi-backend -Destination ..\frontend\src-tauri\binaries\gemi-backend -Recurse

# 5. Build Tauri app
cd ..\frontend
npm install
npx tauri build
```

The finished installer is at:

```
frontend\src-tauri\target\release\bundle\nsis\GEMI_1.0.0_x64-setup.exe
```

---

## Build times (approximate, warm cache)

| Platform | Backend (PyInstaller) | Tauri (Rust) | Total |
|----------|-----------------------|--------------|-------|
| Linux    | 20–40 min             | 15–30 min    | ~1 h  |
| macOS M1 | 25–45 min             | 10–20 min    | ~1 h  |
| Windows  | 25–45 min             | 20–40 min    | ~1.5 h |

First-time builds (cold Rust cache) take roughly 2× longer.

---

## Speeding up repeated builds

The backend PyInstaller bundle only needs to rebuild when Python source or dependencies
change. On subsequent builds you can skip it:

```bash
./build.sh tauri
```

To also skip `npm install` when nothing changed, `node_modules/` is preserved between
runs automatically.
