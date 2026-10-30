"""Joining a shared session takes the SSH login as the cluster setup does: user@host or the ssh command."""
import pytest

import gemi_agent.tools  # noqa: F401  (the tools module loads hpc_tools in its order)
from gemi_agent import compute
from gemi_agent import hpc_tools as H


@pytest.fixture
def joined(monkeypatch):
    calls = []
    monkeypatch.setattr(H, "_gemi_hpc", lambda args, cluster, timeout=0: calls.append(args) or "joined: x")
    monkeypatch.setattr(H, "key_ready", lambda key: True)
    monkeypatch.setattr(compute, "reconnect", lambda: {"app_api": "ok"})
    return calls


def test_login_or_the_whole_ssh_command(joined, tmp_path):
    key = tmp_path / "id_lab"
    key.write_text("k")
    compute.join("jdoe@hive.edu", "/group/lab/gemi")
    compute.join(f"ssh -i {key} jdoe@hive.edu", "/group/lab/gemi")
    assert joined[0] == ["join", "jdoe@hive.edu", "/group/lab/gemi"]
    assert joined[1] == ["join", "-i", str(key), "jdoe@hive.edu", "/group/lab/gemi"]


def test_what_cannot_join(joined, tmp_path):
    with pytest.raises(ValueError, match="SSH login"):
        compute.join("hive.edu", "/group/lab/gemi")
    with pytest.raises(ValueError, match="port"):
        compute.join("ssh -p 2222 jdoe@hive.edu", "/group/lab/gemi")
    with pytest.raises(ValueError, match="no key file"):
        compute.join("jdoe@hive.edu", "/group/lab/gemi", str(tmp_path / "missing"))
    assert joined == []


def test_scripts_with_windows_line_ends_are_reported(tmp_path, monkeypatch):
    hpc = tmp_path / "hpc"
    (hpc / "remote").mkdir(parents=True)
    (hpc / "gemi-hpc").write_bytes(b"#!/bin/bash\r\necho hi\r\n")
    (hpc / "remote" / "lib.sh").write_bytes(b"x=1\n")
    monkeypatch.setattr(H, "HPC", hpc)
    assert H._crlf_scripts() == ["hpc/gemi-hpc"]
    with pytest.raises(RuntimeError, match="Windows line ends"):
        H._gemi_hpc(["ps"])
    (hpc / "gemi-hpc").write_bytes(b"#!/bin/bash\necho hi\n")
    assert H._crlf_scripts() == []


def test_a_joined_session_is_recognised(tmp_path, monkeypatch):
    """A member's computer does not ask the cluster for the owner's login (it is refused)."""
    monkeypatch.setattr(H, "CLUSTERS", tmp_path)
    (tmp_path / "farmish").mkdir()
    (tmp_path / "farmish" / "launch.conf").write_text("# Joined 2026-10-30 from the settings on a@b (gemi-hpc join)\nHPC_HOST=a@b\n")
    (tmp_path / "own").mkdir()
    (tmp_path / "own" / "launch.conf").write_text("# Launch settings for own\nHPC_HOST=me@b\n")
    assert H.joined_session("farmish")
    assert not H.joined_session("own")
    assert not H.joined_session("missing")
