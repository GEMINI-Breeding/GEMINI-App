"""The approval and shell rules (agent/gemi_agent/policy.py) and the Claude Code hook that applies them."""
import importlib.util
from pathlib import Path

from gemi_agent.policy import shell_decision as sh
from gemi_agent.policy import tool_approval as ask

# ── tools ────────────────────────────────────────────────────────────────────
assert ask("status") is None
assert ask("run_orthomosaic", {"experiment": "X"}) is None            # routine work is free
assert ask("start_process", {"name": "odm"}) is None                  # a worker, inside the envelope
assert ask("hpc", {"action": "status"}) is None
assert ask("hpc", {"action": "worker", "workers": ["odm"]}) is None
for action in ("sync", "pull", "pull_llm", "up", "down", "llm_up", "llm_down"):
    assert ask("hpc", {"action": action}), action                      # session-level: ask
assert ask("hpc", {"action": "something_new"})                         # unknown action: ask, never free
assert ask("hpc_configure", {"name": "x"})
assert ask("start_process", {"name": "llm"})                           # a GPU job
assert ask("stop_process", {"name": "odm"}) is None
assert ask("stop_process", {"name": "odm", "force": True})             # interrupts work
assert ask("delete_files", {"object_names": ["a"]}) and ask("delete_job", {"job_id": "1"})
print("tool approvals ok")

# ── shell ────────────────────────────────────────────────────────────────────
HOST = "login.cluster.example"
allow = lambda c: sh(c, HOST) and sh(c, HOST)[0] == "allow"   # noqa: E731
asks = lambda c: sh(c, HOST) and sh(c, HOST)[0] == "ask"      # noqa: E731
deny = lambda c: sh(c, HOST) and sh(c, HOST)[0] == "deny"     # noqa: E731

for c in ("bash hpc/gemi-hpc status", "hpc/gemi-hpc ps", "bash hpc/gemi-hpc logs worker-odm",
          "LINES_N=80 bash hpc/gemi-hpc logs gate", "bash hpc/gemi-hpc doctor", "bash hpc/gemi-hpc llm status",
          "bash hpc/gemi-hpc"):
    assert allow(c), c
for c in ("bash hpc/gemi-hpc sync", "bash hpc/gemi-hpc up", "bash hpc/gemi-hpc worker odm geo",
          "GEMI_WORKER_TRY=low:publicgrp bash hpc/gemi-hpc worker odm", "bash hpc/gemi-hpc stop odm",
          "bash hpc/gemi-hpc down", "bash hpc/gemi-hpc llm up", "bash hpc/gemi-hpc llm env", "bash hpc/gemi-hpc login",
          "python -m gemi_agent hpc --action down", "cd agent && python -m gemi_agent hpc --action llm_up",
          "python -m gemi_agent hpc_configure --name x --ssh user@h", "python -m gemi_agent stop_process --name odm --force true",
          "python -m gemi_agent delete_job --job_id 12"):
    assert asks(c), c
for c in ("ssh user@" + HOST + " rm -rf ~", "ssh -i key someone@elsewhere ls", "scp a b:c", "rsync -a x y:z",
          "echo hi; ssh x@y ls", "curl http://" + HOST + "/", "sbatch job.sh", "cd x && scancel 123",
          "bash hpc/gemi-hpc frobnicate"):
    assert deny(c), c
# A gated command with anything chained onto it is not "the gated command": it falls through to the raw rules.
assert deny("bash hpc/gemi-hpc status; ssh a@b ls")
assert asks("bash hpc/gemi-hpc status && rm -rf agent/work")                  # compound: ask, never guess
assert asks("cd /repo && bash hpc/gemi-hpc down") and allow("cd /repo && bash hpc/gemi-hpc ps")
assert asks("for w in odm geo; do python -m gemi_agent stop_process --name $w; done")
for c in ("git status", "python -m gemi_agent status", "python -m gemi_agent hpc --action status",
          "python -m gemi_agent run_orthomosaic --experiment X", "ssh-keygen -t ed25519", "ls hpc/"):
    assert sh(c, HOST) is None, c
print("shell rules ok")

# ── the hook ─────────────────────────────────────────────────────────────────
path = Path(__file__).resolve().parents[2] / "scripts" / "hooks" / "remote_guard.py"
spec = importlib.util.spec_from_file_location("remote_guard", path)
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)
hook.site_rules = lambda: []                       # a cluster without published agent rules: the gate only
assert hook.decide({"tool_name": "Bash", "tool_input": {"command": "ssh a@b ls"}})[0] == "deny"
hook.site_rules = lambda: ["site-rules"]              # one that publishes them its rules govern, so ask
assert hook.decide({"tool_name": "Bash", "tool_input": {"command": "ssh a@b ls"}})[0] == "ask"
assert hook.decide({"tool_name": "Bash", "tool_input": {"command": "sbatch x.sh"}})[0] == "ask"
assert hook.decide({"tool_name": "Bash", "tool_input": {"command": "bash hpc/gemi-hpc site-skills"}})[0] == "allow"
hook.site_rules = lambda: []
assert hook.decide({"tool_name": "Bash", "tool_input": {"command": "bash hpc/gemi-hpc ps"}})[0] == "allow"
assert hook.decide({"tool_name": "mcp__gemi-agent__hpc", "tool_input": {"action": "down"}})[0] == "ask"
assert hook.decide({"tool_name": "mcp__gemi-agent__status", "tool_input": {}}) is None
assert hook.decide({"tool_name": "Read", "tool_input": {"file_path": "x"}}) is None
print("hook ok")
