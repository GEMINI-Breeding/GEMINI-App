"""PreToolUse hook for Claude Code: the cluster is reached only through the gate.

Reads the hook JSON on stdin. Shell commands that reach the cluster are allowed
only through `hpc/gemi-hpc`: read-only ones pass, writing or submitting ones ask
the person, and raw ssh / scp / rsync / Slurm commands are denied. The same rules
ask before the agent tools (CLI or MCP) that change the cluster session or delete
data. Everything else is left alone.

The rules themselves live in agent/gemi_agent/policy.py, shared with the in-app
agent, so a Claude Code session and the app's own agent ask for the same things.
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def _policy():
    spec = importlib.util.spec_from_file_location("gemi_policy", REPO / "agent" / "gemi_agent" / "policy.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["gemi_policy"] = module
    spec.loader.exec_module(module)
    return module


def site_host() -> str | None:
    """The active cluster's hostname from its launch.conf (kept out of source)."""
    try:
        name = (REPO / "hpc" / "clusters" / "active").read_text().strip() or "farm"
        for line in (REPO / "hpc" / "clusters" / name / "launch.conf").read_text().splitlines():
            if line.startswith("HPC_HOST="):
                return line.split("=", 1)[1].split("#")[0].strip().strip("'\"").split("@")[-1] or None
    except OSError:
        return None
    return None


def decide(data: dict) -> tuple[str, str] | None:
    policy = _policy()
    tool = str(data.get("tool_name") or "")
    args = data.get("tool_input") or {}
    if tool in ("Bash", "PowerShell"):
        return policy.shell_decision(str(args.get("command") or ""), site_host())
    m = re.match(r"^mcp__gemi[-_]agent__(.+)$", tool)
    if m:
        why = policy.tool_approval(m.group(1), args)
        return ("ask", f"{m.group(1)}: {why}") if why else None
    return None


def main() -> None:
    verdict = decide(json.load(sys.stdin))
    if verdict is None:
        return
    decision, reason = verdict
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": decision,
                                             "permissionDecisionReason": reason}}))


if __name__ == "__main__":
    main()
