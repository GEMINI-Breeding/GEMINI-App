# agent/ — AI agents for the GEMINI app

An agent that runs the app for you — uploads, pipeline steps, plot marking,
status — through the same REST API the web pages use. It works with hosted
models and with models you run yourself, from the app's home page, a
terminal, or a tool-calling client.

**Setting it up: [SETUP.md](SETUP.md).**

## What is here

| | |
|---|---|
| `skills/*/SKILL.md` | The procedures, one per stage, in plain Markdown. This is what an agent reads to know *how* to do a stage. Edit these to change behaviour. |
| `gemi_agent/tools.py`, `app_tools.py` | The tool table: one definition per tool, served to the CLI, the MCP server and the agent loop. |
| `gemi_agent/runner.py` | The agent loop for any OpenAI-compatible chat endpoint; `python -m gemi_agent chat`. |
| `gemi_agent/service.py` | HTTP service behind the app's home page; `python -m gemi_agent serve`. |
| `gemi_agent/mcp_server.py` | MCP server (stdio); `python -m gemi_agent mcp`. |
| `gemi_agent/client.py` | REST client (standard library only). |
| `gemi_agent/uploads.py` | Background, parallel, resumable uploads with a status file. |
| `gemi_agent/ground.py`, `panorama.py` | Rover track, per-pass panoramas, plot boundaries, markings, stitching. |
| `tests/` | Parser tests, a mock model + API for testing the loop and service offline, model experiments. |

Skills: `app-overview` (start here), `upload-data`, `monitor-jobs`,
`ground-pipeline`, `ground-plot-marking`, `ground-stitching`,
`aerial-pipeline`, `inference`, `reference-data`, `hpc-session`.

## How a skill is written

Skills are meant to work for small local models as well as large hosted
ones:

- front matter with `name` and a `description` that says when to use it;
- numbered steps, one action each, with a literal example call;
- tables for "if you see X, do Y";
- explicit *stop and ask* conditions and a *done when* check;
- no step depends on something not stated in the skill or returned by a tool.

## Adding a stage

1. Add tool functions to `app_tools.py` (or `tools.py` for rover-track tools)
   and register them with `_app(...)` / `_tool(...)`. Mark anything that
   deletes with `destructive=True` — runners then ask the person first.
2. Write `skills/<name>/SKILL.md`.
3. Try it: `python -m gemi_agent chat --skill <name> "…"`.

## What has been tested (a Slurm cluster, Gemma 4 31B 4-bit on vLLM, 2026-10-07)

| Task | Result |
|---|---|
| Status / monitoring questions | correct, 2 s |
| Upload one rover log, wait for extraction, report | done unaided, correct summary |
| Upload a drone flight (454 RGB images, chose `_V` files itself, noted missing GCP list) | done; a status-file bug made it report a false stall — fixed |
| Orthomosaic for that flight | agent submitted, waited and reported correctly; first run failed on a container fault (no shared memory for NodeODM), second completed in 25 min |
| Plot marking, all boundaries on one sheet | followed the steps but invented the offsets (up to 80 px off) |
| Plot marking, one boundary per picture | about 10 px median error in a direct test; inside the loop it declined most boundaries of a deeply shadowed pass as "not visible" rather than guess |

So: procedural stages work with a local model today; fine visual placement
needs either a stronger vision model or more tool support (detection first,
model verifies). Working files are in `work/` (safe to delete).

## Guardrails and guidance (2026-10-09)

Modelled on the Heliades harness, adapted to an app that runs long-lived
services on a shared cluster.

| Piece | File | What it does |
|---|---|---|
| The gate | `hpc/remote/gemi-gate` | The only thing `gemi-hpc` runs on the cluster: fixed menu, confined to the GEMI directory, job limits, call log |
| Policy | `gemi_agent/policy.py` | Pure rules: which tool calls and shell commands are free, ask first, or are denied |
| Claude Code hook | `scripts/hooks/remote_guard.py` | Applies the policy to shell and MCP calls of a Claude Code session |
| Compute | `gemi_agent/compute.py` | What runs where; start / stop with a placement; workers start for a job and stop when idle |
| Next step | `gemi_agent/guide.py` | `next_step`: the due step of a run as a filled-in tool call |
| Scoped tools | `runner.py` (`tool_scope`) | A run starts with 16 core tools; reading a skill adds the tools that skill names |
| Argument checks | `tools.check_args` | Repairs "3" for 3 and a string for a one-item list; reports made-up or missing arguments by name |

Tests (no stack needed): `PYTHONPATH=. python tests/test_policy.py`,
`tests/test_runner_tools.py`, `tests/test_parse.py`.

A tool that no skill names cannot be found by a scoped run;
`test_runner_tools.py` fails when one is added without a line in a skill.

Not carried over from Heliades, and why: its evaluator sandbox (bubblewrap /
seatbelt) confines code an agent writes, and this agent writes none; its
"nothing runs detached" rule becomes the idle stop, because workers here are
meant to outlive a single call.
