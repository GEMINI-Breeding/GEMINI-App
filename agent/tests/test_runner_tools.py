"""Tool scoping, argument checks and approvals in the agent loop, with a scripted model (no endpoint, no stack)."""
import gemi_agent.runner as r
from gemi_agent.tools import TOOLS, check_args

SKILLS = [s["name"] for s in TOOLS["skills"]["fn"]({})["result"]]

# Every tool is reachable: in the core list, or named by at least one skill.
reach = set(r.CORE_TOOLS) | {t for s in SKILLS for t in r.skill_tools(s)}
missing = [n for n in TOOLS if n not in reach and n != "skills"]
assert not missing, f"tools no skill mentions (a scoped run cannot find them): {missing}"
assert all(n in TOOLS for n in r.CORE_TOOLS)
print("every tool reachable:", len(TOOLS), "tools,", len(r.CORE_TOOLS), "core")

# ── argument checks ──────────────────────────────────────────────────────────
ok = lambda n, a: check_args(n, a)   # noqa: E731
assert ok("jobs", {"limit": "5", "status": "FAILED"}) == ({"limit": 5, "status": "FAILED"}, None)      # "5" -> 5
assert ok("wait_jobs", {"job_ids": "abc"})[0] == {"job_ids": ["abc"]}                                   # one item -> list
assert ok("wait_jobs", {"job_ids": "a, b"})[0] == {"job_ids": ["a", "b"]}
assert ok("upload", {"paths": ["x"], "dry_run": "true"})[1].startswith("upload needs experiment")      # missing required
assert "has no argument 'pass_number'" in ok("panorama", {"track": "Raw/x/", "pass_number": 3})[1]     # made-up name
assert "Its arguments are:" in ok("status", {"verbose": True})[1]
assert ok("jobs", {"limit": "many"})[1] == "jobs: argument 'limit' must be integer, got 'many'."
assert "still a placeholder" in ok("plot_boundaries", {"orthomosaic_path": "P/x.tif", "design_path": "<field design file>"})[1]
assert "still a placeholder" in ok("upload", {"paths": ["<folder with the drone photos>"], "experiment": "E", "site": "S",
                                              "population": "P", "date": "2026-01-01", "data_type": "images"})[1]
assert ok("browse", {"prefix": "Raw/<odd but real>/x"})[1] is None      # only a whole-value placeholder counts
print("argument checks ok")

# ── a scripted model ─────────────────────────────────────────────────────────
script: list[str] = []
seen: list[list[dict]] = []


def fake_chat(cfg, messages, tools=None):
    seen.append(messages)
    return {"content": script.pop(0)}


r.chat = fake_chat
calls: list[tuple[str, dict]] = []
for name in ("status", "hpc", "delete_job", "read_skill", "run_orthomosaic", "jobs"):
    real = TOOLS[name]["fn"]

    def stub(args, name=name, real=real):
        calls.append((name, args))
        return real(args) if name == "read_skill" else {"result": {"ok": name}}

    TOOLS[name]["fn"] = stub

cfg = {**r.DEFAULTS, "tool_scope": "skill"}
run = r.Run(cfg)
assert set(run.names) == set(r.CORE_TOOLS) and "run_orthomosaic" not in run.names
core_prompt = len(run.messages[0]["content"])
full_prompt = len(r.Run({**cfg, "tool_scope": "all"}).messages[0]["content"])
assert core_prompt < full_prompt * 0.6, (core_prompt, full_prompt)
print(f"system prompt: {core_prompt} chars scoped vs {full_prompt} with every tool")

# Reading a skill adds its tools; a bad argument is reported, not run; then the corrected call runs.
script += ['{"tool": "read_skill", "args": {"name": "aerial-pipeline"}}',
           '{"tool": "jobs", "args": {"limit": "3", "state": "FAILED"}}',
           '{"tool": "jobs", "args": {"limit": "3", "status": "FAILED"}}',
           "Done."]
run.send("build the orthomosaic")
assert "run_orthomosaic" in run.names and "plot_boundaries" in run.names
assert "run_orthomosaic(" in run.messages[0]["content"]                       # the prompt lists it now
assert "Tools added to your list" in run.messages[3]["content"]
assert [c for c in calls if c[0] == "jobs"] == [("jobs", {"limit": 3, "status": "FAILED"})]   # only the valid call ran
assert any("NOT RUN" in m["content"] and "state" in m["content"] for m in run.messages if isinstance(m["content"], str))
assert run.status == "waiting"
print("skill unlock and argument repair ok")

# A cluster action stops for approval with its reason; declining tells the model.
run = r.Run(cfg)
script += ['{"tool": "hpc", "args": {"action": "down"}}', "I did not stop it."]
run.send("shut it down")
assert run.status == "awaiting_approval" and "ends the session" in run.pending["reason"]
assert not [c for c in calls if c[0] == "hpc"]
run.resolve(False)
assert run.status == "waiting" and not [c for c in calls if c[0] == "hpc"]
# Approved: it runs.
run = r.Run(cfg)
script += ['{"tool": "hpc", "args": {"action": "down"}}', "Stopped."]
run.send("shut it down")
run.resolve(True)
assert [c for c in calls if c[0] == "hpc"] == [("hpc", {"action": "down"})]
# Reading the cluster is free.
run = r.Run(cfg)
script += ['{"tool": "hpc", "args": {"action": "status"}}', "It is up."]
run.send("is it up")
assert run.status == "waiting" and calls[-1] == ("hpc", {"action": "status"})
print("approvals ok")

# First-run setup: only the cluster tools, and nothing else unlocks.
run = r.Run(cfg, groups=["hpc"])
assert "upload" not in run.names and "hpc_probe" in run.names
script += ['{"tool": "delete_job", "args": {"job_id": "1"}}', "ok"]
run.send("x")
assert not [c for c in calls if c[0] == "delete_job"]
# An unknown name gets a suggestion.
run = r.Run(cfg)
script += ['{"tool": "orthomosaic", "args": {}}', "ok"]
run.send("x")
assert any("Did you mean: run_orthomosaic" in str(m["content"]) for m in run.messages)
print("restricted run and unknown tool ok")
