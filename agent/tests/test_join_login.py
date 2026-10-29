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
