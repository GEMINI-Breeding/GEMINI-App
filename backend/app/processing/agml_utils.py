"""
Wrapper around the `agml` package's public dataset catalog.

`agml.data.public_data_sources()` reads a bundled local resource shipped
inside the package — there is no network call involved in listing/filtering
datasets, only in actually downloading one (not done anywhere in this
module). The catalog is cached per-process after the first call since it's
static for the lifetime of the installed `agml` version.

`agml` itself is imported lazily inside each function, not at module import
time, so a missing/broken `agml` install degrades to a clean error the route
layer turns into a 503, rather than crashing backend startup.
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_catalog: list[Any] | None = None
_catalog_lock = threading.Lock()

_model_benchmarks: dict[str, Any] | None = None
_detector_benchmarks: dict[str, Any] | None = None
_benchmarks_lock = threading.Lock()


class AgmlUnavailableError(RuntimeError):
    """Raised when the `agml` package is missing or fails to import."""


def _get_agml():
    try:
        import agml
    except Exception as exc:
        raise AgmlUnavailableError(f"agml package unavailable: {exc}") from exc
    return agml


def _get_catalog() -> list[Any]:
    """Return the full (unfiltered) AgML public dataset catalog, cached per-process."""
    global _catalog
    if _catalog is None:
        with _catalog_lock:
            if _catalog is None:
                agml = _get_agml()
                _catalog = agml.data.public_data_sources()
                logger.info("Loaded AgML public dataset catalog (%d datasets).", len(_catalog))
    return _catalog


def _to_public_dict(meta: Any, selected_names: set[str]) -> dict:
    """Flatten a `DatasetMetadata` object into the `AgmlDatasetPublic` shape."""
    data = meta.data or {}

    n_images_raw = data.get("n_images")
    try:
        n_images = int(float(n_images_raw)) if n_images_raw not in (None, "") else None
    except (TypeError, ValueError):
        n_images = None

    sensor_modality = data.get("sensor_modality")
    if isinstance(sensor_modality, str):
        sensor_modality = sensor_modality.lower()

    return {
        "name": meta.name,
        "ml_task": data.get("ml_task"),
        "ag_task": data.get("ag_task"),
        "location": data.get("location") or None,
        "n_images": n_images,
        "sensor_modality": sensor_modality,
        "platform": data.get("platform"),
        "real_synthetic": data.get("real_synthetic"),
        "input_data_format": data.get("input_data_format"),
        "annotation_format": data.get("annotation_format"),
        "docs_url": data.get("docs_url"),
        "classes": data.get("classes") or None,
        "parent_dataset": data.get("parent_dataset") or None,
        "selected": meta.name in selected_names,
    }


def _matches_str_filter(value: Any, wanted: str) -> bool:
    return str(value or "").lower() == wanted.lower()


def list_datasets(
    *,
    ml_task: str | None = None,
    ag_task: str | None = None,
    location: str | None = None,
    sensor_modality: str | None = None,
    platform: str | None = None,
    real_synthetic: str | None = None,
    n_images_min: int | None = None,
    n_images_max: int | None = None,
    search: str | None = None,
    selected_names: set[str] | None = None,
) -> list[dict]:
    """List AgML public datasets, optionally filtered. Fully offline."""
    selected_names = selected_names or set()
    results = _get_catalog()

    if ml_task:
        results = [m for m in results if m.data.get("ml_task") == ml_task]
    if ag_task:
        results = [m for m in results if m.data.get("ag_task") == ag_task]
    if location:
        # "continent:africa" or "country:denmark"
        loc_key, _, desired = location.partition(":")
        if not desired:
            loc_key, desired = "", location
        desired = desired.strip().lower()
        results = [
            m for m in results
            if str((m.data.get("location") or {}).get(loc_key, "")).lower() == desired
        ]
    if sensor_modality:
        results = [m for m in results if _matches_str_filter(m.data.get("sensor_modality"), sensor_modality)]
    if platform:
        results = [m for m in results if _matches_str_filter(m.data.get("platform"), platform)]
    if real_synthetic:
        results = [m for m in results if _matches_str_filter(m.data.get("real_synthetic"), real_synthetic)]

    if n_images_min is not None or n_images_max is not None:
        def _n_images(m: Any) -> int:
            try:
                return int(float(m.data.get("n_images") or 0))
            except (TypeError, ValueError):
                return 0

        if n_images_min is not None:
            results = [m for m in results if _n_images(m) >= n_images_min]
        if n_images_max is not None:
            results = [m for m in results if _n_images(m) <= n_images_max]

    if search:
        needle = search.strip().lower()
        results = [m for m in results if needle in m.name.lower()]

    return [_to_public_dict(m, selected_names) for m in results]


def get_dataset(name: str, *, selected_names: set[str] | None = None) -> dict | None:
    """Return a single dataset's metadata, or None if `name` is unknown to agml."""
    agml = _get_agml()
    try:
        meta = agml.data.source(name)
    except Exception:
        return None
    return _to_public_dict(meta, selected_names or set())


def find_similar(
    name: str, *, limit: int = 5, selected_names: set[str] | None = None
) -> list[dict] | None:
    """
    Find datasets similar to `name` by matching ml_task + ag_task against the
    same cached catalog `list_datasets` filters. Falls back to ml_task-only
    matching if nothing shares both. Returns None if `name` itself is
    unknown to agml (caller should 404 rather than return an empty list).
    """
    agml = _get_agml()
    try:
        target = agml.data.source(name)
    except Exception:
        return None

    ml_task = target.data.get("ml_task")
    ag_task = target.data.get("ag_task")
    selected_names = selected_names or set()

    catalog = _get_catalog()
    candidates = [
        m for m in catalog
        if m.name != name and m.data.get("ml_task") == ml_task and m.data.get("ag_task") == ag_task
    ]
    if not candidates and ml_task:
        candidates = [m for m in catalog if m.name != name and m.data.get("ml_task") == ml_task]

    return [_to_public_dict(m, selected_names) for m in candidates[:limit]]


# ---------------------------------------------------------------------------
# Prior benchmark results — "foundation model results on these datasets"
#
# agml ships two small bundled JSON files with prior benchmark runs:
#   _assets/model_benchmarks.json    segmentation, keyed by dataset name
#   _assets/detector_benchmarks.json detection, keyed by "{dataset}+{model}"
# Both are local/offline, same as the main catalog — no network call.
# ---------------------------------------------------------------------------

def _load_benchmark_assets() -> tuple[dict, dict]:
    global _model_benchmarks, _detector_benchmarks
    if _model_benchmarks is None or _detector_benchmarks is None:
        with _benchmarks_lock:
            if _model_benchmarks is None or _detector_benchmarks is None:
                agml = _get_agml()
                assets_dir = Path(agml.__file__).parent / "_assets"
                try:
                    with open(assets_dir / "model_benchmarks.json") as f:
                        _model_benchmarks = json.load(f)
                except FileNotFoundError:
                    _model_benchmarks = {}
                try:
                    with open(assets_dir / "detector_benchmarks.json") as f:
                        _detector_benchmarks = json.load(f)
                except FileNotFoundError:
                    _detector_benchmarks = {}
    return _model_benchmarks, _detector_benchmarks


def _detector_metrics(entry: dict) -> dict:
    return {k: v for k, v in entry.items() if k.startswith("metrics/") or k == "fitness"}


def get_benchmarks(name: str) -> list[dict]:
    """Return known prior benchmark results for one dataset, if any."""
    model_benchmarks, detector_benchmarks = _load_benchmark_assets()
    results = []
    if name in model_benchmarks:
        entry = model_benchmarks[name]
        results.append({
            "dataset": name,
            "model": None,
            "metrics": entry.get("metric"),
            "hyperparameters": entry.get("hyperparameters"),
        })
    prefix = f"{name}+"
    for key, entry in detector_benchmarks.items():
        if key.startswith(prefix):
            results.append({
                "dataset": name,
                "model": key[len(prefix):],
                "metrics": _detector_metrics(entry),
                "hyperparameters": None,
            })
    return results


def all_benchmarks() -> list[dict]:
    """
    Return every known benchmark entry across the catalog (small — ~80 rows
    total as of agml 0.8.0). Backs the leaderboard endpoint with real data
    sourced from agml's own bundled JSON, pending AgML publishing a live
    leaderboard feed of its own.
    """
    model_benchmarks, detector_benchmarks = _load_benchmark_assets()
    results = [
        {
            "dataset": name,
            "model": None,
            "metrics": entry.get("metric"),
            "hyperparameters": entry.get("hyperparameters"),
        }
        for name, entry in model_benchmarks.items()
    ]
    for key, entry in detector_benchmarks.items():
        name, _, model_name = key.partition("+")
        results.append({
            "dataset": name,
            "model": model_name or None,
            "metrics": _detector_metrics(entry),
            "hyperparameters": None,
        })
    return results
