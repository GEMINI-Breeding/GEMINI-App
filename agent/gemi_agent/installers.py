"""Install the two programs GEMI may need on this computer, from the app.

- **Ollama** (serves open language models here) installs for the current
  user on every system, without administrator rights, so it is installed
  completely: download, install, start.
    Windows  the official installer, run silently (it installs per user)
    macOS    the official app, unpacked into ~/Applications
    Linux    the official archive, unpacked into ~/.local/share/gemi/ollama
- **Docker Desktop** (runs the processing stack here) always needs an
  administrator's approval and, on Windows, often a restart. The installer is
  downloaded and opened; the system's own prompt asks the person to approve.
  Linux has no Desktop installer to open: the commands are given instead.
  A Docker that is installed but not running is started.

Each action runs in the background as a job with steps (the same shape as a
model setup, so the app shows both the same way). Downloads come only from
the projects' own addresses below.
"""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable, Optional

OLLAMA_URLS = {
    "win32": "https://ollama.com/download/OllamaSetup.exe",
    "darwin": "https://ollama.com/download/Ollama-darwin.zip",
    # Linux: .tar.zst (current builds), .tgz as a fallback (as Ollama's own install.sh does)
    "linux-x86_64": "https://ollama.com/download/ollama-linux-amd64",
    "linux-aarch64": "https://ollama.com/download/ollama-linux-arm64",
}
DOCKER_URLS = {
    "win32-AMD64": "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe",
    "win32-ARM64": "https://desktop.docker.com/win/main/arm64/Docker%20Desktop%20Installer.exe",
    "darwin-arm64": "https://desktop.docker.com/mac/main/arm64/Docker.dmg",
    "darwin-x86_64": "https://desktop.docker.com/mac/main/amd64/Docker.dmg",
}
LINUX_DOCKER_STEPS = [
    "curl -fsSL https://get.docker.com | sudo sh",
    "sudo usermod -aG docker $USER",
    "then log out and back in (or restart) so the group applies",
]
# Where Ollama is put on macOS and Linux, so it can be found again.
MAC_OLLAMA_APP = Path.home() / "Applications" / "Ollama.app"
LINUX_OLLAMA_DIR = Path.home() / ".local" / "share" / "gemi" / "ollama"

_lock = threading.Lock()
_jobs: dict[str, dict] = {}          # "ollama" | "docker" -> the latest job


def ollama_candidates() -> list[str]:
    """Places an installed Ollama is found (model_setup looks here too)."""
    return [str(MAC_OLLAMA_APP / "Contents" / "Resources" / "ollama"), str(LINUX_OLLAMA_DIR / "bin" / "ollama")]


def _platform_key(urls: dict[str, str], with_machine: bool) -> Optional[str]:
    if sys.platform == "win32":
        key = f"win32-{os.environ.get('PROCESSOR_ARCHITECTURE', 'AMD64').upper()}" if with_machine else "win32"
    elif sys.platform == "darwin":
        key = f"darwin-{platform.machine()}" if with_machine else "darwin"
    else:
        key = f"linux-{platform.machine()}"
    return urls.get(key)


def _step(name: str, estimate_s: int) -> dict:
    return {"name": name, "estimate_s": estimate_s, "status": "waiting", "detail": ""}


def _run(what: str, steps: list[dict], work: Callable[[dict], None]) -> dict:
    with _lock:
        if (_jobs.get(what) or {}).get("state") == "running":
            raise RuntimeError(f"{what} is already being installed")
        job = {"what": what, "steps": steps, "state": "running", "started": time.time(), "error": None, "note": None}
        _jobs[what] = job

    def go() -> None:
        try:
            work(job)
            job["state"] = "done"
        except Exception as e:  # noqa: BLE001  (shown to the person as is)
            job["state"] = "failed"
            job["error"] = str(e)[-600:]
            for s in job["steps"]:
                if s["status"] == "running":
                    s["status"] = "failed"
        job["ended"] = time.time()

    threading.Thread(target=go, daemon=True).start()
    return job


class _Step:
    def __init__(self, job: dict, name: str):
        self.s = next(s for s in job["steps"] if s["name"] == name)

    def __enter__(self) -> dict:
        self.s.update(status="running", started=time.time())
        return self.s

    def __exit__(self, kind, exc, tb) -> None:
        self.s["seconds"] = round(time.time() - self.s["started"])
        if kind is None and self.s["status"] == "running":
            self.s["status"] = "done"


def _download(url: str, to: Path, s: dict) -> Path:
    """Fetch `url` into `to`, reporting percent and speed on step `s`."""
    req = urllib.request.Request(url, headers={"User-Agent": "GEMI"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as r, open(to, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            rate = done / max(time.time() - t0, 0.5)
            s["detail"] = f"{done / 1e6:.0f}" + (f" of {total / 1e6:.0f}" if total else "") + f" MB, {rate / 1e6:.0f} MB/s"
            if total:
                s["percent"] = round(100 * done / total)
                s["remaining_s"] = round((total - done) / rate) if rate else None
    s.pop("remaining_s", None)
    return to


# ── Ollama ──────────────────────────────────────────────────────────────────

def install_ollama() -> dict:
    from . import model_setup

    url = _platform_key(OLLAMA_URLS, with_machine=False)
    if url is None:
        raise RuntimeError(f"no Ollama download for this system ({sys.platform} {platform.machine()}); "
                           "see https://ollama.com/download")
    if model_setup.local_status()["ollama"] == "running":
        raise RuntimeError("Ollama is already installed and running")
    steps = [_step("Download Ollama", 90), _step("Install", 60), _step("Start it", 15)]

    def work(job: dict) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="gemi-ollama-"))
        try:
            with _Step(job, "Download Ollama") as s:
                if sys.platform.startswith("linux"):
                    pkg = _download_linux_archive(url, tmp, s)
                else:
                    pkg = _download(url, tmp / url.rsplit("/", 1)[-1], s)
                s["detail"] = "downloaded"
            with _Step(job, "Install") as s:
                if model_setup._ollama_exe():
                    s["detail"] = "already installed"
                elif sys.platform == "win32":
                    # Inno Setup installer, per user (no administrator prompt).
                    subprocess.run([str(pkg), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"],
                                   check=True, timeout=900)
                elif sys.platform == "darwin":
                    MAC_OLLAMA_APP.parent.mkdir(parents=True, exist_ok=True)
                    subprocess.run(["ditto", "-x", "-k", str(pkg), str(MAC_OLLAMA_APP.parent)], check=True, timeout=600)
                else:
                    LINUX_OLLAMA_DIR.mkdir(parents=True, exist_ok=True)
                    _extract_linux_archive(pkg, LINUX_OLLAMA_DIR)
                if not model_setup._ollama_exe():
                    raise RuntimeError("the installer finished but Ollama was not found where it installs; "
                                       "install it from https://ollama.com/download instead")
                s["detail"] = model_setup._ollama_exe() or ""
            with _Step(job, "Start it") as s:
                for _ in range(10):                     # the Windows installer may start it by itself
                    if model_setup.local_status()["ollama"] == "running":
                        break
                    time.sleep(1)
                else:
                    model_setup._start_ollama()
                s["detail"] = "running"
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    return _run("ollama", steps, work)


def _exists(url: str) -> bool:
    """Whether a download is there: its headers only. (A HEAD request turns
    into a full GET after the redirect to the release file, so ask for one
    byte and close without reading.)"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GEMI", "Range": "bytes=0-0"})
        r = urllib.request.urlopen(req, timeout=30)
        try:
            return r.status in (200, 206)
        finally:
            r.close()
    except Exception:  # noqa: BLE001
        return False


def _download_linux_archive(base: str, tmp: Path, s: dict) -> Path:
    """The .tar.zst when it exists and can be unpacked here, else the .tgz."""
    can_zst = sys.version_info >= (3, 14) or bool(shutil.which("zstd") or shutil.which("unzstd"))
    if can_zst and _exists(base + ".tar.zst"):
        return _download(base + ".tar.zst", tmp / "ollama.tar.zst", s)
    if _exists(base + ".tgz"):
        return _download(base + ".tgz", tmp / "ollama.tgz", s)
    raise RuntimeError("this Ollama release needs the zstd program to unpack. Install it (Debian/Ubuntu: "
                       "sudo apt-get install zstd; Fedora: sudo dnf install zstd) and press Install again.")


def _extract_linux_archive(pkg: Path, into: Path) -> None:
    if pkg.name.endswith(".tgz"):
        with tarfile.open(pkg) as t:
            t.extractall(into, filter="data")
    elif sys.version_info >= (3, 14):
        with tarfile.open(pkg, "r:zst") as t:
            t.extractall(into, filter="data")
    else:
        subprocess.run(["tar", "--use-compress-program=" + (shutil.which("unzstd") or "zstd -d"), "-xf", str(pkg),
                        "-C", str(into)], check=True, timeout=900)


# ── Docker ──────────────────────────────────────────────────────────────────

def _docker_desktop() -> Optional[str]:
    """Docker Desktop's program, when installed."""
    if sys.platform == "win32":
        for base in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramW6432", "")):
            p = Path(base) / "Docker" / "Docker" / "Docker Desktop.exe"
            if base and p.is_file():
                return str(p)
    elif sys.platform == "darwin":
        for p in (Path("/Applications/Docker.app"), Path.home() / "Applications" / "Docker.app"):
            if p.exists():
                return str(p)
    else:
        p = Path("/opt/docker-desktop/bin/docker-desktop")
        if p.exists():
            return str(p)
    return None


def docker_state() -> str:
    """running | not_running | missing"""
    from .onboarding import _docker

    state = _docker()
    if state == "missing" and _docker_desktop():
        return "not_running"
    return state


def start_docker() -> dict:
    """Start Docker that is installed but not running."""
    app = _docker_desktop()
    steps = [_step("Start Docker", 60)]

    def work(job: dict) -> None:
        with _Step(job, "Start Docker") as s:
            if docker_state() == "running":
                s["detail"] = "already running"
                return
            if sys.platform == "win32" and app:
                subprocess.Popen([app], creationflags=0x00000008 | 0x00000200)   # detached, own group
            elif sys.platform == "darwin":
                subprocess.run(["open", "-a", "Docker"], check=True, timeout=30)
            elif app:
                subprocess.run(["systemctl", "--user", "start", "docker-desktop"], check=True, timeout=60)
            else:
                raise RuntimeError("Docker Engine is installed but not running. Start it in a terminal: "
                                   "sudo systemctl start docker")
            for i in range(180):
                if docker_state() == "running":
                    s["detail"] = "running"
                    return
                s["detail"] = f"waiting for Docker to come up ({i} s)"
                time.sleep(1)
            raise RuntimeError("Docker did not come up within 3 minutes. Open Docker Desktop and look at what it "
                               "says (a first start may ask to accept its terms or to enable WSL).")

    return _run("docker", steps, work)


def install_docker() -> dict:
    """Download Docker Desktop's installer and open it (the system asks for approval)."""
    if docker_state() != "missing":
        return start_docker()
    if sys.platform.startswith("linux"):
        raise RuntimeError("On Linux, Docker is installed from a terminal with administrator rights: "
                           + "; ".join(LINUX_DOCKER_STEPS))
    url = _platform_key(DOCKER_URLS, with_machine=True)
    if url is None:
        raise RuntimeError("no Docker Desktop download for this system; see https://docs.docker.com/get-docker/")
    steps = [_step("Download Docker Desktop", 240), _step("Open the installer", 10)]

    def work(job: dict) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="gemi-docker-"))
        with _Step(job, "Download Docker Desktop") as s:
            pkg = _download(url, tmp / urllib.request.url2pathname(url.rsplit("/", 1)[-1]).replace(" ", "-"), s)
            s["detail"] = "downloaded"
        with _Step(job, "Open the installer") as s:
            if sys.platform == "win32":
                # Asks for administrator approval (the system's prompt), then installs; WSL 2 may need a restart.
                os.startfile(str(pkg), "runas", "install --accept-license")  # type: ignore[attr-defined]
                job["note"] = ("Approve the system prompt and follow the installer. If it asks to restart, restart, "
                               "then come back here and press Start Docker.")
            else:
                subprocess.run(["open", str(pkg)], check=True, timeout=60)
                job["note"] = ("Drag Docker into Applications in the window that opened, open Docker once and accept "
                               "its terms, then come back here and press Start Docker.")
            s["detail"] = "opened"

    return _run("docker", steps, work)


def overview() -> dict[str, Any]:
    from . import model_setup

    return {"ollama": model_setup.local_status()["ollama"], "docker": docker_state(),
            "docker_linux_steps": LINUX_DOCKER_STEPS if sys.platform.startswith("linux") else None,
            "jobs": {k: v for k, v in _jobs.items()}}
