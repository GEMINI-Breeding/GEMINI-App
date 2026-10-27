"""The Console's lines from the agent service: cluster jobs coming and going."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gemi_agent import activity  # noqa: E402


def _row(jid, name, state, node=None, reason=None):
    return {"job_id": jid, "name": name, "slurm_state": state, "node": node, "reason": reason}


def test_queue_changes_are_noted_once(monkeypatch):
    monkeypatch.setattr(activity, "_primed", False)
    activity._seen.clear()
    activity._lines.clear()
    activity.cluster_jobs([_row("1", "gemi-core", "RUNNING", "n1")])
    assert activity.lines() == []                     # the first read only remembers
    activity.cluster_jobs([_row("1", "gemi-core", "RUNNING", "n1"), _row("2", "gemi-ingest", "PENDING", reason="Priority")])
    activity.cluster_jobs([_row("1", "gemi-core", "RUNNING", "n1"), _row("2", "gemi-ingest", "RUNNING", "n2")])
    activity.cluster_jobs([_row("1", "gemi-core", "RUNNING", "n1")], tail=lambda j: "HTTP 400 login failed")
    for _ in range(50):                                # the ended line is written from a thread
        if len(activity.lines()) == 3:
            break
        time.sleep(0.02)
    got = [(x["level"], x["message"]) for x in activity.lines()]
    assert got == [("INFO", "ingest job 2 queued (Priority)"),
                   ("INFO", "ingest job 2 running on n2"),
                   ("WARNING", "ingest job 2 ended: HTTP 400 login failed")]


def test_log_names_match_the_gate():
    assert activity.log_name("gemi-ingest", "7") == "ingest-7"
    assert activity.log_name("gemi-worker-odm", "7") == "worker-odm-7"
    assert activity.log_name("gemi-fetch", "7") == "slurm-fetch-7"


def test_track_notes_changes_only():
    activity._lines.clear()
    activity._said.clear()
    for t in ("a", "a", "b"):
        activity.track("k", t)
    assert [x["message"] for x in activity.lines()] == ["a", "b"]
