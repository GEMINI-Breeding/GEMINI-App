"""A computer that joined a session: someone else's (a member) or its own login's (the owner)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import gemi_agent.tools  # noqa: E402,F401  (import order the service uses)
from gemi_agent import hpc_tools  # noqa: E402


def _conf(tmp_path, monkeypatch, head: str, host: str):
    (tmp_path / "farm").mkdir()
    (tmp_path / "farm" / "launch.conf").write_text(f"{head}\nHPC_HOST={host}\n")
    monkeypatch.setattr(hpc_tools, "CLUSTERS", tmp_path)


def test_joining_your_own_session_is_owning_it(tmp_path, monkeypatch):
    _conf(tmp_path, monkeypatch,
          "# Joined 2026-10-19 from the settings on llund@farm.example (gemi-hpc join); this computer's own login below.",
          "llund@farm.example")
    assert hpc_tools.joined_session("farm") is False


def test_joining_someone_elses_session_is_membership(tmp_path, monkeypatch):
    _conf(tmp_path, monkeypatch,
          "# Joined 2026-10-19 from the settings on llund@farm.example (gemi-hpc join); this computer's own login below.",
          "jmberlin@farm.example")
    assert hpc_tools.joined_session("farm") is True


def test_a_session_set_up_here_is_not_joined(tmp_path, monkeypatch):
    _conf(tmp_path, monkeypatch, "# farm", "llund@farm.example")
    assert hpc_tools.joined_session("farm") is False
