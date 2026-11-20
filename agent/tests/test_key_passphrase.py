"""A key with a passphrase: found locked, unlocked into ssh-agent, then usable without prompts."""
import os
import shutil
import signal
import subprocess

import pytest

import gemi_agent.tools  # noqa: F401  (the tools module loads hpc_tools in its order)
from gemi_agent import hpc_tools as H

pytestmark = pytest.mark.skipif(not (shutil.which("ssh-keygen") and shutil.which("ssh-agent")),
                                reason="needs OpenSSH")


@pytest.fixture
def own_agent(monkeypatch):
    """A fresh ssh-agent for the test (never the person's own)."""
    monkeypatch.delenv("SSH_AUTH_SOCK", raising=False)
    monkeypatch.delenv("SSH_AGENT_PID", raising=False)
    yield
    pid = os.environ.get("SSH_AGENT_PID")
    if pid:
        os.kill(int(pid), signal.SIGTERM)


def _key(tmp_path, passphrase):
    path = tmp_path / "id_test"
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", passphrase, "-f", str(path)], check=True)
    return str(path)


def test_a_key_without_a_passphrase_is_ready(tmp_path):
    key = _key(tmp_path, "")
    assert not H.key_needs_passphrase(key)
    assert H.key_ready(key)


def test_a_locked_key_is_unlocked_with_its_passphrase(tmp_path, own_agent):
    key = _key(tmp_path, "correct horse")
    assert H.key_needs_passphrase(key)
    assert not H.key_ready(key)
    with pytest.raises(ValueError, match="did not unlock"):
        H.unlock_key(key, "wrong")
    out = H.unlock_key(key, "correct horse")
    assert out["unlocked"] and H.key_in_agent(key) and H.key_ready(key)


def test_logging_in_with_a_locked_key_asks_for_its_passphrase(tmp_path, own_agent):
    key = _key(tmp_path, "secret")
    with pytest.raises(H.KeyLocked) as e:
        H._find_key("nobody@localhost", key, None)
    assert e.value.key.endswith("id_test") and "passphrase" in str(e.value)


@pytest.mark.parametrize("bash_in", ["bin", "usr/bin"])
def test_windows_uses_git_for_windows_ssh_tools(tmp_path, monkeypatch, bash_in):
    """On Windows: Git's ssh-agent (a per-user program), not System32's (a Windows service)."""
    git = tmp_path / "Git"
    (git / bash_in).mkdir(parents=True, exist_ok=True)
    (git / "usr" / "bin").mkdir(parents=True, exist_ok=True)
    (git / bash_in / "bash.exe").write_text("")
    for tool in ("ssh", "ssh-add", "ssh-agent", "ssh-keygen"):
        (git / "usr" / "bin" / f"{tool}.exe").write_text("")
    monkeypatch.setattr(H, "_bash", lambda: str(git / bash_in / "bash.exe"))
    monkeypatch.setattr(H, "_windows", lambda: True)
    assert H._ssh_tool("ssh-agent") == str(git / "usr" / "bin" / "ssh-agent.exe")
    assert H._ssh_tool("ssh") == str(git / "usr" / "bin" / "ssh.exe")


def test_elsewhere_the_ssh_tools_on_path():
    assert H._ssh_tool("ssh-agent") == "ssh-agent"
