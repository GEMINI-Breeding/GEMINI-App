"""PreToolUse hook for Claude Code: the cluster is reached only through the gate.

Reads the hook JSON on stdin. Shell commands that reach the cluster are allowed
only through `hpc/gemi-hpc`: read-only ones pass, writing or submitting ones ask
the person, and raw ssh / scp / rsync / Slurm commands are denied, unless the
cluster's administrators publish their own rules for agents (SITE_RULES in its
launch.conf, or found by `gemi-hpc site-skills`): then those rules govern and raw
commands ask the person instead. The same rules
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


def _active() -> str:
    try:
        return (REPO / "hpc" / "clusters" / "active").read_text().strip() or "farm"
    except OSError:
        return "farm"


def _conf(key: str) -> str | None:
    """A value from the active cluster's launch.conf (kept out of source)."""
    try:
        for line in (REPO / "hpc" / "clusters" / _active() / "launch.conf").read_text().splitlines():
            if line.startswith(key + "="):
                return line.split("=", 1)[1].split("#")[0].strip().strip("'\"") or None
    except OSError:
        return None
    return None


def site_host() -> str | None:
    """The active cluster's hostname."""
    host = _conf("HPC_HOST")
    return host.split("@")[-1] if host else None


def site_rules() -> list[str]:
    """Rules the active cluster's administrators publish for agents: named in its
    launch.conf (SITE_RULES=<skill name>, comma separated), or found by
    `gemi-hpc site-skills` / the agent's cluster_rules (cached listing)."""
    names = [n.strip() for n in (_conf("SITE_RULES") or "").split(",") if n.strip()]
    try:
        names += [r["name"] for r in json.loads(
            (REPO / "agent" / "work" / "site-skills" / _active() / "index.json").read_text())]
    except (OSError, ValueError, TypeError, KeyError):
        pass
    return sorted(set(names))


def decide(data: dict) -> tuple[str, str] | None:
    policy = _policy()
    tool = str(data.get("tool_name") or "")
    args = data.get("tool_input") or {}
    if tool in ("Bash", "PowerShell"):
        return policy.shell_decision(str(args.get("command") or ""), site_host(), site_rules())
    m = re.match(r"^mcp__gemi[-_]agent__(.+)$", tool)
    if m:
        why = policy.tool_approval(m.group(1), args)
        return ("ask", f"{m.group(1)}: {why}") if why else None
    return None


def no_ask_until() -> float:
    """A person may switch the questions off for a while: `agent/work/guard-auto.json`
    holding {"until": <unix time>}. Until then, commands that would ask simply run.
    Denials (raw ssh, scp, rsync, Slurm commands) are never affected, and the gate on
    the cluster still enforces its menu and job limits. The file is local and not
    committed; delete it to be asked again."""
    try:
        return float(json.loads((REPO / "agent" / "work" / "guard-auto.json").read_text()).get("until") or 0)
    except (OSError, ValueError, TypeError, AttributeError):
        return 0.0


def main() -> None:
    import time

    verdict = decide(json.load(sys.stdin))
    if verdict is None:
        return
    decision, reason = verdict
    if decision == "ask" and time.time() < no_ask_until():
        decision, reason = "allow", reason + " (not asked: questions are switched off for this session)"
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": decision,
                                             "permissionDecisionReason": reason}}))


if __name__ == "__main__":
    main()
