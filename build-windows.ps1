# Build GEMI for Windows.
# Requires: uv, Python 3.12, Node.js 22, Rust (MSVC), Visual Studio Build Tools 2022
#
# Usage (from repo root in PowerShell):
#   .\build-windows.ps1          # full build
#   .\build-windows.ps1 backend  # PyInstaller sidecar only
#   .\build-windows.ps1 tauri    # Tauri app only (assumes backend already built)
param(
    [ValidateSet("all", "backend", "tauri", "bin-extractor")]
    [string]$Mode = "all"
)

$ErrorActionPreference = "Stop"

$Root     = $PSScriptRoot
$Backend  = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

function Log($msg)  { Write-Host "[build] $msg" }
function Die($msg)  { Write-Error "[build] ERROR: $msg"; exit 1 }

function Build-Backend {
    Log "Building backend sidecar (PyInstaller)..."

    Set-Location $Root
    git submodule update --init --recursive

    Set-Location $Backend
    uv sync

    if (Test-Path "vendor\AgRowStitch")   { uv pip install -e vendor\AgRowStitch --no-build-isolation }
    else                                  { Log "WARNING: vendor\AgRowStitch not found" }

    if (Test-Path "vendor\LightGlue")     { uv pip install vendor\LightGlue }
    else                                  { Log "WARNING: vendor\LightGlue not found" }

    if (Test-Path "vendor\bin_to_images") { uv pip install -e vendor\bin_to_images }
    else                                  { Log "WARNING: vendor\bin_to_images not found" }

    # farm-ng-amiga: attempt source build — no Windows wheels on PyPI
    Log "Attempting farm-ng-core source build for farm-ng-amiga..."
    $FarmNgDir = Join-Path $env:TEMP "farm-ng-core"
    try {
        git clone --depth 1 --branch v2.3.0 https://github.com/farm-ng/farm-ng-core.git $FarmNgDir
        Set-Location $FarmNgDir
        git submodule update --init --recursive
        (Get-Content setup.py) -replace '"-Werror",', '' -replace '"/WX",', '' | Set-Content setup.py
        Set-Location $Backend
        uv pip install $FarmNgDir
        uv pip install --no-build-isolation farm-ng-amiga
    } catch {
        Log "WARNING: farm-ng-amiga install failed — .bin extraction unavailable"
    } finally {
        Set-Location $Backend
        if (Test-Path $FarmNgDir) { Remove-Item -Recurse -Force $FarmNgDir }
    }

    uv run pyinstaller --clean gemi-backend.spec

    $DestDir = Join-Path $Frontend "src-tauri\binaries\gemi-backend"
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
    Copy-Item -Path dist\gemi-backend -Destination $DestDir -Recurse -Force
    Log "Backend bundle → $DestDir"
}

function Build-Tauri {
    Log "Building Tauri application..."

    # Verify Inno Setup is installed
    $iscc = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
    if (-not (Test-Path $iscc)) {
        Die "Inno Setup 6 not found at '$iscc'. Download from https://jrsoftware.org/isdl.php"
    }

    Set-Location $Frontend

    if (-not (Test-Path "node_modules")) { npm install }

    $env:CARGO_INCREMENTAL = "0"
    $env:RUSTFLAGS = "-C debuginfo=0"

    # --no-bundle skips NSIS, which cannot handle CUDA DLLs (>2 GB mmap limit)
    npx tauri build --no-bundle

    Log "Creating installer with Inno Setup..."
    New-Item -ItemType Directory -Force -Path "src-tauri\target\release\bundle\inno" | Out-Null
    & $iscc "src-tauri\inno-setup.iss"
    if ($LASTEXITCODE -ne 0) { Die "Inno Setup failed (exit code $LASTEXITCODE)" }

    Log "Done. Installer: $Frontend\src-tauri\target\release\bundle\inno\"
}

function Build-BinExtractor {
    Log "Building gemi-bin-extractor Docker image..."
    Log "This image is required for .bin file extraction on Windows."

    Set-Location $Backend
    docker build -t gemi-bin-extractor -f docker/bin-extractor/Dockerfile .
    if ($LASTEXITCODE -ne 0) {
        Die "Docker build failed. Make sure Docker Desktop is running and the bin_to_images submodule is checked out."
    }
    Log "Docker image 'gemi-bin-extractor' built successfully."
}

switch ($Mode) {
    "backend"       { Build-Backend }
    "tauri"         { Build-Tauri }
    "bin-extractor" { Build-BinExtractor }
    "all"           { Build-Backend; Build-Tauri; Build-BinExtractor }
}
