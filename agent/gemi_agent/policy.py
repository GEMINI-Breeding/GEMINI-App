"""What an agent may do without asking, as pure functions.

One set of rules for every way an agent reaches this app: the in-app runner
(home page and `gemi_agent chat`), and Claude Code or another harness driving
the CLI, the MCP server or the shell (`scripts/hooks/remote_guard.py`). No
imports from the rest of the package, so the hook can load this file alone
and the rules can be tested without a stack.

The shape follows Heliades' guardrails for a shared cluster whose storage is
not backed up:

- The cluster is reached only through `hpc/gemi-hpc`, which runs the gate
  (`hpc/remote/gemi-gate`, a fixed menu confined to the GEMI directory). Raw
  ssh / scp / rsync from a session is refused.
- Reading is free. Routine work inside the configured envelope is free:
  submitting pipeline jobs, starting a worker on a placement the cluster's
  launch.conf names, within the gate's job limits.
- Anything that changes the envelope or the session asks the person first:
  writing the cluster configuration, copying code, installing images or
  models, starting or ending the session, starting the GPU model, stopping
  a worker that is busy.
- Deleting data always asks.
"""
from __future__ import annotations

import re
from typing import Optional

# hpc tool actions
HPC_FREE = {"status", "logs", "llm_status", "connect", "disconnect", "worker"}
HPC_ASK = {
    "sync": "copies the current code to the cluster",
    "pull": "submits a cluster job that installs the stack's container images",
    "pull_llm": "submits a cluster job that downloads a language model (tens of GB)",
    "pull_ml_deps": "submits a cluster job that installs model libraries",
    "up": "starts the session's core job on the cluster",
    "down": "ends the session: stops every worker and the core",
    "llm_up": "starts a GPU job for the agent's model",
    "llm_down": "stops the agent's model on the cluster",
}


def tool_approval(name: str, args: Optional[dict] = None) -> Optional[str]:
    """Why the person must agree before this tool call runs, or None if it may just run."""
    args = args or {}
    if name == "delete_files":
        return "deletes files from storage; this cannot be undone"
    if name == "delete_job":
        return "deletes a job record; this cannot be undone"
    if name == "hpc":
        action = str(args.get("action") or "")
        if action in HPC_FREE:
            return None
        return HPC_ASK.get(action, f"runs the cluster action {action!r}")
    if name == "cluster_folder" and args.get("upload") not in (None, False, "false", ""):
        return "submits a cluster job that uploads that folder into the session"
    if name == "online_storage" and str(args.get("action")) == "copy":
        return ("copies that folder from online storage to where the stack runs" +
                (" and uploads it into the app" if args.get("data_type") else ""))
    if name == "hpc_configure":
        return "writes the cluster's settings (where the core, workers and model run) and makes it the active cluster"
    if name == "start_process" and str(args.get("name")) == "llm":
        return HPC_ASK["llm_up"]
    if name == "stop_process":
        if str(args.get("name")) == "llm":
            return HPC_ASK["llm_down"]
        if args.get("force"):
            return "stops a worker that is in the middle of a job; the job fails and must be resubmitted"
    return None


# ── shell commands (for a harness with a shell, e.g. Claude Code) ────────────

GEMI_HPC_FREE = {"status", "ps", "logs", "doctor", "help", "site-skills", "folder-peek"}
# (join writes this computer's settings for a cluster: asks, like hpc_configure.)
GEMI_HPC_ASK = {"sync", "pull", "up", "worker", "stop", "down", "app", "tunnel", "login", "llm", "ingest", "join",
                "cloud"}
_ENV = r"(?:[A-Z_][A-Z0-9_]*=[^\s;&|<>`$()]*\s+)*"
_GEMI_HPC = re.compile(
    r"^\s*(?:cd\s+\S+\s*&&\s*)?" + _ENV + r"(?:bash\s+)?(?:\S*/)?hpc/gemi-hpc(?:\s+(?P<sub>[a-z-]+))?(?P<args>(?:\s[^;&|<>`$()]*)?)\s*$")
_CLI = re.compile(
    r"^\s*(?:cd\s+\S+\s*&&\s*)?" + _ENV + r"python[0-9.]*\s+-m\s+gemi_agent\s+(?P<tool>[a-z_]+)(?P<args>(?:\s[^;&|<>`$()]*)?)\s*$")
_REMOTE = re.compile(r"(^|[\s;&|(])(ssh|scp|sftp|rsync|sshfs)\s")
_SLURM = re.compile(r"(^|[\s;&|(])(sbatch|srun|salloc|scancel)\s")
DENY_REMOTE = ("raw remote commands are not allowed: the cluster's storage is shared and not backed up. "
               "Use hpc/gemi-hpc (status, ps, logs, doctor; sync, up, worker, stop, down, llm … ask first), "
               "which reaches the cluster only through its gate.")


def _cli_args(text: str) -> dict:
    """--key value pairs of a `python -m gemi_agent <tool>` command line."""
    words = text.split()
    out = {}
    for i, w in enumerate(words):
        if w.startswith("--") and i + 1 < len(words):
            out[w[2:]] = {"true": True, "false": False}.get(words[i + 1].lower(), words[i + 1])
    return out


def shell_decision(command: str, host: Optional[str] = None,
                   site_rules: Optional[list[str]] = None) -> Optional[tuple[str, str]]:
    """("allow" | "ask" | "deny", reason) for a shell command that touches the
    cluster; None for commands this policy has nothing to say about.

    `site_rules` names the rules the cluster's administrators publish for agents
    (skills the site publishes). When there are some, those rules govern: raw
    remote and Slurm commands ask the person instead of being denied."""
    m = _GEMI_HPC.match(command)
    if m:
        sub = m.group("sub") or "help"
        if sub == "llm":
            llm_sub = (m.group("args") or "").split()[:1]
            if llm_sub in ([], ["status"]):
                return "allow", "gemi-hpc llm status only reads"
            return "ask", f"gemi-hpc llm {llm_sub[0]} changes what runs on the cluster or prints its key"
        if sub in GEMI_HPC_FREE:
            return "allow", f"gemi-hpc {sub} only reads, through the gate"
        if sub in GEMI_HPC_ASK:
            return "ask", f"gemi-hpc {sub} writes to or submits on the cluster (or prints its login); needs your approval"
        return "deny", f"unknown gemi-hpc command {sub!r}"
    m = _CLI.match(command)
    if m:
        why = tool_approval(m.group("tool"), _cli_args(m.group("args") or ""))
        if why:
            return "ask", f"{m.group('tool')}: {why}"
        return None
    if site_rules and (_REMOTE.search(command) or (host and host in command) or _SLURM.search(command)):
        return "ask", ("raw cluster command; this cluster publishes its own rules for agents (" +
                       ", ".join(site_rules) + "), which govern it instead of the gate")
    if _REMOTE.search(command) or (host and host in command):
        return "deny", DENY_REMOTE
    # A gated command inside something longer (a pipe, a chain, a loop) cannot be
    # classified by its first word: ask, never guess.
    if "gemi-hpc" in command:
        return "ask", "a compound command that runs gemi-hpc; run it on its own line to have it classified"
    if re.search(r"-m\s+gemi_agent\s+(hpc|hpc_configure|start_process|stop_process|delete_files|delete_job)(\s|$)", command):
        return "ask", "a compound command that runs a cluster or delete tool of gemi_agent"
    if _SLURM.search(command):
        return "deny", "Slurm commands are not run from a session; jobs are submitted by the gate, within its limits."
    return None
