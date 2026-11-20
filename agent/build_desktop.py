"""Build what the desktop app needs to run the agent without a Python install
or a source checkout. Run on the machine (or CI runner) of the target system,
before `tauri build`:

    python agent/build_desktop.py

Produces, under frontend/src-tauri/ (both are generated, not committed):

    binaries/gemi-agent-<target triple>[.exe]   the agent as one executable (PyInstaller),
                                                with the skills inside it
    agent-resources/                            read-only files it uses at run time:
        hpc/gemi-hpc, hpc/remote/, hpc/tools/probe.sh, hpc/clusters/launch.conf.example
        backend.tgz + backend/REVISION          the backend source `gemi-hpc sync` sends to a cluster
        stack-version                           which published images match this build

The app starts the executable with GEMI_AGENT_HOME (the person's settings and
state, in the app's data folder) and GEMI_AGENT_RESOURCES (agent-resources).
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

AGENT = Path(__file__).resolve().parent
REPO = AGENT.parent
TAURI = REPO / "frontend" / "src-tauri"
OUT_BIN = TAURI / "binaries"
OUT_RES = TAURI / "agent-resources"


def triple() -> str:
    out = subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=True).stdout
    return next(line.split(":", 1)[1].strip() for line in out.splitlines() if line.startswith("host:"))


def lf(src: Path, dst: Path) -> None:
    """Copy a script with Unix line ends and its executable bit: these run under bash here and on the cluster."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(src.read_bytes().replace(b"\r\n", b"\n"))
    os.chmod(dst, 0o755)


def resources() -> None:
    shutil.rmtree(OUT_RES, ignore_errors=True)
    hpc = OUT_RES / "hpc"
    lf(REPO / "hpc" / "gemi-hpc", hpc / "gemi-hpc")
    for f in sorted((REPO / "hpc" / "remote").iterdir()):
        if f.is_file():
            lf(f, hpc / "remote" / f.name)
    lf(REPO / "hpc" / "tools" / "probe.sh", hpc / "tools" / "probe.sh")
    lf(REPO / "hpc" / "clusters" / "launch.conf.example", hpc / "clusters" / "launch.conf.example")
    shutil.copy(TAURI / "stack-version", OUT_RES / "stack-version")

    backend = REPO / "backend"
    keep = ["gemini", "alembic", "alembic.ini", "pyproject.toml"]

    def skip(info: tarfile.TarInfo):
        name = info.name.replace("\\", "/")
        if "__pycache__" in name or name.endswith((".pyc", ".DS_Store")):
            return None
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        return info

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name in keep:
            tar.add(backend / name, arcname=name, filter=skip)
    (OUT_RES / "backend.tgz").write_bytes(buf.getvalue())
    rev = subprocess.run(["git", "-C", str(backend), "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
    dirty = subprocess.run(["git", "-C", str(backend), "diff", "--quiet"]).returncode != 0
    (OUT_RES / "backend").mkdir(exist_ok=True)
    (OUT_RES / "backend" / "REVISION").write_text((rev.stdout.strip() or "unknown") + ("+uncommitted" if dirty else "") + "\n")
    size = sum(f.stat().st_size for f in OUT_RES.rglob("*") if f.is_file())
    print(f"agent-resources: {sum(1 for f in OUT_RES.rglob('*') if f.is_file())} files, {size / 1e6:.1f} MB")


def binary() -> None:
    name = f"gemi-agent-{triple()}"
    work = AGENT / "work" / "pyinstaller"
    sep = ";" if os.name == "nt" else ":"
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--name", name,
           "--distpath", str(OUT_BIN), "--workpath", str(work / "build"), "--specpath", str(work),
           "--paths", str(AGENT), "--add-data", f"{AGENT / 'skills'}{sep}skills",
           "--collect-submodules", "gemi_agent", "--hidden-import", "openpyxl", "--hidden-import", "PIL.ImageDraw", "--hidden-import", "PIL.ImageFont",
           # Not needed by the agent; keeps the executable small and its start quick.
           "--exclude-module", "tkinter", "--exclude-module", "matplotlib", "--exclude-module", "scipy",
           "--exclude-module", "pandas", "--exclude-module", "torch", "--exclude-module", "cv2",
           str(AGENT / "gemi_agent_app.py")]
    subprocess.run(cmd, check=True)
    exe = OUT_BIN / (name + (".exe" if os.name == "nt" else ""))
    print(f"{exe.name}: {exe.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    resources()
    if "--resources-only" not in sys.argv:
        binary()
