import shutil

from fastapi import APIRouter, Depends
from pydantic.networks import EmailStr

from app.api.deps import get_current_active_superuser
from app.models import Message
from app.utils import generate_test_email, send_email

router = APIRouter(prefix="/utils", tags=["utils"])


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


@router.get("/docker-check/")
async def docker_check() -> dict:
    """Return whether Docker is available on the host system."""
    available = shutil.which("docker") is not None
    return {"available": available}


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

    # ── Torch / CUDA ─────────────────────────────────────────────────────────
    torch_version: str | None = None
    cuda_available = False
    try:
        import torch
        torch_version = torch.__version__
        cuda_available = torch.cuda.is_available()
    except ImportError:
        pass

    import os as _os
    return {
        "agrowstitch": {"available": agrowstitch_available, "path": agrowstitch_path},
        "torch_version": torch_version,
        "cuda_available": cuda_available,
        "cpu_count": _os.cpu_count() or 1,
    }
