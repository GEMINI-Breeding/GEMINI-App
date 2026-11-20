"""Field facts and field design files, shared by everyone who uses the same stack.

The agent keeps both on the person's own computer (work/run_facts.json and
work/field_layouts/), so a colleague who joined the same session saw none of
them. They now also live in the stack's storage, beside the data:

    Shared/GEMI/run_facts/<run id>.json     the facts of a run (its public ones)
    Shared/GEMI/field_designs/<file name>   the field design files they name

A fact names its design by file name (a path is only true on one computer);
each computer keeps a copy of the file in its own field_layouts folder,
fetched when first needed. Everything here is best effort: without the stack
(not connected, signed out) the computer's own copies are used as before.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

SHARED = "Shared/GEMI"
FACTS = f"{SHARED}/run_facts/"
DESIGNS = f"{SHARED}/field_designs/"
_TTL = 15.0
_cache: dict[str, tuple[float, dict]] = {}


def _client():
    from .tools import client

    return client()


def _upload(object_name: str, blob: bytes) -> None:
    _client().upload_chunk(blob, 0, 1, f"agent:{object_name}:{len(blob)}:{time.time():.0f}", object_name)


def read_facts(run_id: str) -> Optional[dict]:
    """The run's shared facts; {} when none were shared, None when the stack cannot be asked."""
    if not run_id:
        return {}
    hit = _cache.get(run_id)
    if hit and time.time() - hit[0] < _TTL:
        return dict(hit[1])
    from .client import ApiError

    try:
        facts = json.loads(_client().download(f"{FACTS}{run_id}.json") or b"{}")
    except ApiError as e:
        if e.status != 404:
            return None
        facts = {}
    except Exception:
        return None
    facts = facts if isinstance(facts, dict) else {}
    _cache[run_id] = (time.time(), facts)
    return dict(facts)


def write_facts(run_id: str, facts: dict) -> bool:
    try:
        _upload(f"{FACTS}{run_id}.json", json.dumps(facts, indent=1).encode())
    except Exception:
        return False
    _cache[run_id] = (time.time(), dict(facts))
    return True


def put_design(path: Path) -> Optional[str]:
    """Share a field design file (by its name); the name, or None when it could not be."""
    try:
        _upload(DESIGNS + path.name, path.read_bytes())
    except Exception:
        return None
    return path.name


def list_designs() -> list[str]:
    try:
        rows = _client().list_dir(DESIGNS)
    except Exception:
        return []
    names = []
    for r in rows:
        name = str(r.get("object_name") or "")[len(DESIGNS):]
        if name and "/" not in name:
            names.append(name)
    return names


def fetch_design(name: str, folder: Path) -> Optional[Path]:
    """This computer's copy of a shared design file, fetched when it has none."""
    name = Path(name).name
    if not name:
        return None
    local = folder / name
    if local.is_file():
        return local
    try:
        blob = _client().download(DESIGNS + name)
    except Exception:
        return None
    folder.mkdir(parents=True, exist_ok=True)
    local.write_bytes(blob)
    return local
