"""Try the configured model on a handful of everyday requests, with the short
(skill-scoped) tool list and with every tool listed, and count how cleanly it
gets there. Needs a running stack and model; it starts nothing heavy.

    PYTHONPATH=. python tests/model_trial.py [scope ...]      scope: skill | all
"""
import json
import sys
import time

from gemi_agent import runner as r

TASKS = [
    ("next", "What is the next step for the TestSite 2026-07-23 drone run? Do not run it. Tell me the exact tool call you would make.",
     lambda tools, reply: "next_step" in tools and "plot_boundaries" in reply),
    ("workers", "Which workers are running on the cluster right now, and are any jobs waiting for one?",
     lambda tools, reply: "processes" in tools or "status" in tools),
    ("failed", "List the three most recent failed jobs with their error, in one short table.",
     lambda tools, reply: "jobs" in tools),
    ("stop-idle", "Is the stitch worker running? If it is running and has nothing to do, stop it. If it is not running, just say so.",
     lambda tools, reply: "processes" in tools and "start_process" not in tools),
    ("down", "Shut the whole cluster session down now.",
     lambda tools, reply: "hpc" in tools),          # must stop at the approval, which this script declines
]


def trial(scope: str) -> list[dict]:
    rows = []
    for name, text, good in TASKS:
        cfg = {**r.load_config(), "tool_scope": scope, "max_steps": 12}
        run = r.Run(cfg, approve=lambda tool, args, reason: False)
        t = time.time()
        run.send(text)
        tools = [e["tool"] for e in run.events if e["kind"] == "tool"]
        errors = [e for e in run.events if e["kind"] == "tool" and e.get("error")]
        declined = [e["tool"] for e in run.events if e["kind"] == "approval" and not e["approved"]]
        reply = next((e["text"] for e in reversed(run.events) if e["kind"] == "assistant"), "")
        rows.append({"task": name, "ok": bool(good(tools + declined, reply)), "steps": run.steps, "tools": tools,
                     "bad_calls": len(errors), "asked_first": declined, "seconds": round(time.time() - t),
                     "status": run.status, "prompt_chars": len(run.messages[0]["content"]), "reply": reply[:300]})
        print(json.dumps(rows[-1]), flush=True)
    return rows


if __name__ == "__main__":
    out = {}
    for scope in sys.argv[1:] or ["skill", "all"]:
        print(f"== tool_scope={scope}", flush=True)
        out[scope] = trial(scope)
    for scope, rows in out.items():
        print(f"{scope}: {sum(x['ok'] for x in rows)}/{len(rows)} done right, "
              f"{sum(x['bad_calls'] for x in rows)} bad calls, {sum(x['steps'] for x in rows)} model steps, "
              f"{sum(x['seconds'] for x in rows)} s")
