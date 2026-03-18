"""
Background task runner and SSE progress tracking.

Design
------
Processing steps (stitching, ODM, inference, etc.) are long-running and must
run in background threads so they don't block FastAPI's event loop.

Progress is tracked in an in-memory store keyed by run_id.  The SSE endpoint
(/pipeline-runs/{id}/progress) reads from this store and streams events to
the frontend.  When a step finishes (or fails) the runner commits the final
state to the database.

Thread safety
-------------
The progress store uses a threading.Lock.  Each run gets a fresh list of
events that the SSE endpoint consumes from an increasing offset.  The
frontend reconnects with ?offset=N to resume without replaying old events.

Database access in threads
--------------------------
FastAPI's SessionDep uses request-scoped sessions that cannot be shared
across threads.  Background threads open their own sessions via
get_background_session().
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from collections.abc import Generator
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session

from app.core.db import engine

logger = logging.getLogger(__name__)

# ── In-memory progress store ──────────────────────────────────────────────────

# { run_id_str: {"events": [...], "done": bool} }
_store: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


def _init_run(run_id: str) -> None:
    with _lock:
        _store[run_id] = {"events": [], "done": False}


def emit(run_id: str, event: dict[str, Any]) -> None:
    """Append a progress event for a run.  Called from worker threads."""
    with _lock:
        if run_id not in _store:
            _store[run_id] = {"events": [], "done": False}
        _store[run_id]["events"].append(event)


def _mark_done(run_id: str) -> None:
    with _lock:
        if run_id in _store:
            _store[run_id]["done"] = True


def clear(run_id: str) -> None:
    """Remove all stored events for a run (call after SSE stream closes)."""
    with _lock:
        _store.pop(run_id, None)


def sse_stream(run_id: str, offset: int = 0) -> Generator[str, None, None]:
    """
    Generator for SSE responses.  Yields new events starting from `offset`.
    Blocks (with short sleeps) until the run is marked done.
    """
    import time

    idx = offset
    while True:
        with _lock:
            state = _store.get(run_id)

        if state is None:
            # Run not started or already cleared — yield a waiting event then exit
            yield f"data: {json.dumps({'event': 'waiting'})}\n\n"
            return

        events = state["events"]
        while idx < len(events):
            yield f"data: {json.dumps(events[idx])}\n\n"
            idx += 1

        if state["done"]:
            return

        time.sleep(0.3)


# ── Database helper for background threads ────────────────────────────────────

def get_background_session() -> Session:
    """Open a new DB session for use in a background thread."""
    return Session(engine)


# ── Active task registry (for stop support) ───────────────────────────────────

# { run_id_str: threading.Event }  — set the event to request cancellation
_stop_events: dict[str, threading.Event] = {}
_stop_lock = threading.Lock()


def register_stop_event(run_id: str) -> threading.Event:
    stop = threading.Event()
    with _stop_lock:
        _stop_events[run_id] = stop
    return stop


def request_stop(run_id: str) -> bool:
    """Signal a running step to stop.  Returns True if a task was running."""
    with _stop_lock:
        stop = _stop_events.get(run_id)
    if stop:
        stop.set()
        return True
    return False


def _deregister_stop_event(run_id: str) -> None:
    with _stop_lock:
        _stop_events.pop(run_id, None)


# ── Step runner ───────────────────────────────────────────────────────────────

def run_step_in_background(
    *,
    run_id: uuid.UUID,
    step: str,
    step_fn: Any,  # callable(session, run, stop_event) -> dict[str, str]
    step_fn_kwargs: dict[str, Any] | None = None,
) -> None:
    """
    Launch a processing step in a daemon thread.

    The step function signature must be:
        def my_step(
            session: Session,
            run_id: uuid.UUID,
            stop_event: threading.Event,
            emit: Callable[[dict], None],
            **kwargs,
        ) -> dict[str, Any]:
            ...
            return {"output_key": "relative/path"}

    On success the returned dict is merged into run.outputs and the step is
    marked complete in the DB.  On error run.status is set to "failed".
    """
    run_id_str = str(run_id)
    _init_run(run_id_str)
    stop_event = register_stop_event(run_id_str)

    def _emit(event: dict[str, Any]) -> None:
        emit(run_id_str, event)

    def worker() -> None:
        session = get_background_session()
        try:
            from app.models.pipeline import PipelineRun
            from app.crud.pipeline import update_pipeline_run
            from app.models.pipeline import PipelineRunUpdate

            run = session.get(PipelineRun, run_id)
            if not run:
                _emit({"event": "error", "message": "Run not found"})
                return

            # Mark step as running in DB
            update_pipeline_run(
                session=session,
                db_run=run,
                run_in=PipelineRunUpdate(status="running", current_step=step),
            )
            _emit({"event": "start", "step": step})

            # Execute the step function
            kwargs = step_fn_kwargs or {}
            outputs = step_fn(
                session=session,
                run_id=run_id,
                stop_event=stop_event,
                emit=_emit,
                **kwargs,
            )

            if stop_event.is_set():
                # User cancelled — revert to pending
                run = session.get(PipelineRun, run_id)
                if run:
                    update_pipeline_run(
                        session=session,
                        db_run=run,
                        run_in=PipelineRunUpdate(status="pending", current_step=None),
                    )
                _emit({"event": "cancelled", "step": step})
                return

            # Merge outputs into run record and mark step complete
            run = session.get(PipelineRun, run_id)
            if run:
                existing_outputs = dict(run.outputs or {})
                outputs = dict(outputs or {})

                # Stitching versioning: append new entry to the list
                if "_stitch_new_entry" in outputs:
                    new_entry = outputs.pop("_stitch_new_entry")
                    existing_list = list(existing_outputs.get("stitchings", []))
                    existing_list = [s for s in existing_list if s["version"] != new_entry["version"]]
                    existing_list.append(new_entry)
                    existing_outputs["stitchings"] = existing_list

                # Orthomosaic versioning: append new entry to the list instead of overwriting
                if "_ortho_new_entry" in outputs:
                    new_entry = outputs.pop("_ortho_new_entry")
                    existing_list = list(existing_outputs.get("orthomosaics", []))
                    # Backward-compat: migrate old flat "orthomosaic" key to v1 entry
                    if not existing_list and existing_outputs.get("orthomosaic"):
                        existing_list = [{
                            "version": 1,
                            "rgb": existing_outputs.pop("orthomosaic"),
                            "dem": existing_outputs.pop("dem", None),
                            "pyramid": None,
                            "created_at": None,
                        }]
                    # Remove any existing entry with same version (re-run)
                    existing_list = [o for o in existing_list if o["version"] != new_entry["version"]]
                    existing_list.append(new_entry)
                    existing_outputs["orthomosaics"] = existing_list

                # Extra steps to mark complete (e.g. georeferencing auto-completes plot_boundary_prep)
                extra_steps: list[str] = outputs.pop("_mark_steps_complete", [])

                existing_outputs.update(outputs)
                existing_steps = dict(run.steps_completed or {})
                existing_steps[step] = True
                for s in extra_steps:
                    existing_steps[s] = True
                all_steps = _all_steps_for_run(run)
                all_done = all(existing_steps.get(s, False) for s in all_steps)
                update_pipeline_run(
                    session=session,
                    db_run=run,
                    run_in=PipelineRunUpdate(
                        status="completed" if all_done else "pending",
                        current_step=None,
                        steps_completed=existing_steps,
                        outputs=existing_outputs,
                        completed_at=datetime.now(timezone.utc).isoformat() if all_done else None,
                    ),
                )
            _emit({"event": "complete", "step": step, "outputs": outputs or {}})

        except Exception as exc:
            logger.exception("Step %s failed for run %s", step, run_id_str)
            try:
                from app.models.pipeline import PipelineRun
                from app.crud.pipeline import update_pipeline_run
                from app.models.pipeline import PipelineRunUpdate

                run = session.get(PipelineRun, run_id)
                if run:
                    update_pipeline_run(
                        session=session,
                        db_run=run,
                        run_in=PipelineRunUpdate(
                            status="failed",
                            current_step=step,
                            error=str(exc)[:2000],
                        ),
                    )
            except Exception:
                pass
            _emit({"event": "error", "step": step, "message": str(exc)})
        finally:
            _mark_done(run_id_str)
            _deregister_stop_event(run_id_str)
            session.close()

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()


def _all_steps_for_run(run: Any) -> list[str]:
    """Return the canonical step list for this run's pipeline type."""
    # Import here to avoid circular imports at module load
    from app.models.pipeline import Pipeline
    from sqlmodel import Session
    session = Session(engine)
    try:
        pipeline = session.get(Pipeline, run.pipeline_id)
        if pipeline and pipeline.type == "aerial":
            return ["gcp_selection", "orthomosaic", "plot_boundaries", "trait_extraction", "inference"]
        return ["plot_marking", "stitching", "georeferencing", "inference"]
    finally:
        session.close()
