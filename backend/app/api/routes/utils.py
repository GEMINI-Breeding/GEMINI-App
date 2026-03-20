import collections
import logging
import shutil

from fastapi import APIRouter, Depends
from pydantic.networks import EmailStr

from app.api.deps import CurrentUser, get_current_active_superuser
from app.models import Message
from app.utils import generate_test_email, send_email

router = APIRouter(prefix="/utils", tags=["utils"])

# ── In-memory log ring buffer ─────────────────────────────────────────────────
# Captures the last 500 log lines from all loggers; served to the frontend
# Console tab so developers can see backend output without a terminal.

_log_buffer: collections.deque = collections.deque(maxlen=500)


class _RingBufferHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            _log_buffer.append({
                "level": record.levelname,
                "message": self.format(record),
                "ts": record.created,
            })
        except Exception:
            self.handleError(record)


_ring_handler = _RingBufferHandler()
_ring_handler.setFormatter(
    logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
)
logging.getLogger().addHandler(_ring_handler)


@router.post(
    "/test-email/",
    dependencies=[Depends(get_current_active_superuser)],
    status_code=201,
)
def test_email(email_to: EmailStr) -> Message:
    """
    Test emails.
    """
    email_data = generate_test_email(email_to=email_to)
    send_email(
        email_to=email_to,
        subject=email_data.subject,
        html_content=email_data.html_content,
    )
    return Message(message="Test email sent")


@router.get("/health-check/")
async def health_check() -> bool:
    return True


@router.get("/logs")
def get_logs(current_user: CurrentUser) -> list[dict]:
    """Return the last 500 backend log lines for the frontend Console tab."""
    return list(_log_buffer)


@router.get("/docker-check/")
async def docker_check() -> dict:
    """Return whether Docker is installed and the daemon is running."""
    import os
    import subprocess

    # Common locations where Docker CLI lives on Mac (Docker Desktop) and Linux
    extra_paths = [
        "/usr/local/bin/docker",
        "/opt/homebrew/bin/docker",
        "/usr/bin/docker",
        os.path.expanduser("~/.docker/bin/docker"),
    ]

    docker_bin = shutil.which("docker")
    if docker_bin is None:
        for p in extra_paths:
            if os.path.isfile(p) and os.access(p, os.X_OK):
                docker_bin = p
                break

    if docker_bin is None:
        return {"available": False, "reason": "not_installed"}

    # Docker Desktop on Mac may use a user-scoped socket
    env = os.environ.copy()
    user_socket = os.path.expanduser("~/.docker/run/docker.sock")
    if os.path.exists(user_socket) and "DOCKER_HOST" not in env:
        env["DOCKER_HOST"] = f"unix://{user_socket}"

    try:
        result = subprocess.run(
            [docker_bin, "info"],
            capture_output=True,
            timeout=10,
            env=env,
        )
        if result.returncode == 0:
            return {"available": True}
        stderr = (result.stderr or b"").decode(errors="replace")
        if "permission denied" in stderr.lower():
            return {"available": False, "reason": "permission_denied"}
        return {"available": False, "reason": stderr[:200]}
    except Exception as e:
        return {"available": False, "reason": str(e)}


@router.get("/capabilities/")
async def capabilities() -> dict:
    """
    Report availability of optional heavy dependencies used by processing steps.
    Called by the frontend to show warnings before running steps that require them.
    """
    import importlib.util
    import sys
    from pathlib import Path

    # ── AgRowStitch ───────────────────────────────────────────────────────────
    agrowstitch_available = False
    agrowstitch_path: str | None = None

    candidates = [
        Path(__file__).parents[3] / "vendor" / "AgRowStitch" / "AgRowStitch.py",
    ]
    env_path = __import__("os").environ.get("AGROWSTITCH_PATH")
    if env_path:
        candidates.insert(0, Path(env_path))
    # Sibling repo fallback
    candidates.append(Path(__file__).parents[5] / "AgRowStitch" / "AgRowStitch.py")

    for candidate in candidates:
        if candidate.exists():
            try:
                spec = importlib.util.spec_from_file_location("_AgRowStitch_check", candidate)
                mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
                spec.loader.exec_module(mod)  # type: ignore[union-attr]
                if hasattr(mod, "run"):
                    agrowstitch_available = True
                    agrowstitch_path = str(candidate)
                    break
            except Exception:
                pass

    # ── Torch / CUDA / MPS ───────────────────────────────────────────────────
    torch_version: str | None = None
    cuda_available = False
    mps_available = False
    try:
        import torch
        torch_version = torch.__version__
        cuda_available = torch.cuda.is_available()
        mps_available = torch.backends.mps.is_available()
    except ImportError:
        pass

    import os as _os
    return {
        "agrowstitch": {"available": agrowstitch_available, "path": agrowstitch_path},
        "torch_version": torch_version,
        "cuda_available": cuda_available,
        "mps_available": mps_available,
        "cpu_count": _os.cpu_count() or 1,
    }
