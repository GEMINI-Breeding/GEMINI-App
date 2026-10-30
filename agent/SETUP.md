# Agent setup

How to get an AI agent running the GEMINI app for you: from a terminal, from
the app's home page, or from a tool-calling client such as Claude Code.

Three things have to be chosen:

1. **Where the app's stack runs** — this computer (Docker), or a cluster (Slurm).
2. **Which model drives the agent** — hosted through an API, or one you run.
3. **How you talk to it** — home page, terminal chat, or your own agent client.

Any combination works; the pieces only need to reach each other over HTTP.

```
 you ── home page ─┐
 you ── terminal ──┼─ agent loop ── tools ── GEMINI REST API ── workers
 Claude Code / MCP ┘       │
                           └── model endpoint (OpenAI-compatible)
```

## Quick start: the desktop app with a cluster

1. Open GEMI. On the first screen choose **Set up on a cluster** (no Docker
   needed), or let it start its own services on this computer.
2. Give the agent a model, one of:
   - **Set up a free open model** on the setup page: pick one (Gemma 4 31B is
     the tested one) and where it runs. *This computer* downloads it with
     [Ollama](https://ollama.com) (install Ollama first). *A cluster* takes
     your SSH command, looks at the cluster, and installs and starts the
     model on a GPU. Each step shows its expected time; a first install on a
     cluster is the long one (the model server and the weights, 20 to 60
     minutes).
   - **Use a hosted one**: provider "Claude (Anthropic)" or "OpenAI", paste
     an API key, **Save and test**. 
   - No model in the app at all: drive GEMI from a coding agent's terminal
     (README, "Install the app, then drive it from a coding agent's terminal").
3. Type the SSH command you log in to the cluster with, e.g.
   `ssh you@login.cluster.edu`. Key-based login must already work: the app
   cannot answer a password or two-factor prompt.
4. The agent surveys the cluster and proposes where each part runs. Each step
   that changes something on the cluster (writing settings, copying code,
   installing images, starting the session) shows an **Allow / Decline**
   prompt with what it does.
5. When the stack is up the page offers **Sign in**; it signs you in by
   itself. From then on the app opens straight to the home page.

The first installation on a cluster downloads the container images
(about 20 minutes) before the session can start.

## Quick start: a terminal

```bash
git clone --recurse-submodules <this repository> && cd GEMINI-App
python3 -m pip install -r agent/requirements.txt
cd agent
export GEMI_LLM_URL=https://api.anthropic.com/v1 GEMI_LLM_MODEL=claude-sonnet-5-5 GEMI_LLM_KEY=<your API key>
python3 -m gemi_agent chat --skill connect-hpc "My cluster login is: ssh you@login.cluster.edu"
```

It asks before each step that changes the cluster. Afterwards
`python3 -m gemi_agent chat` takes any request ("what is running", "upload the
photos in ~/flights/0821 …"), and `bash hpc/gemi-hpc app` opens the app in a
browser against the cluster.

With **Claude Code**, open the repository folder: the skills (`.claude/skills`),
the tools (`.mcp.json`, an MCP server) and the cluster guard
(`.claude/settings.json`) come with the checkout. Say "connect GEMINI to my
cluster, my login is ssh you@login.cluster.edu". If your system has `python3`
but no `python`, change the command in `.mcp.json`.

## 1. Install (once)

Python 3.10+ on the computer where the agent runs:

```bash
pip install -r agent/requirements.txt     # numpy, pillow, openpyxl
```

Nothing else: the client, the loop, the service and the MCP server use only
the standard library.

## 2. Point it at the app

Create `agent/.env` (git-ignored):

```
GEMI_API=http://127.0.0.1:7777
GEMI_EMAIL=you@example.com
GEMI_PASSWORD=your-app-password
```

`GEMI_API` is the REST API: `http://127.0.0.1:7777` for the local Docker
stack; for a cluster session, the port printed by `gemi-hpc tunnel` (the desktop
app's own tunnel uses 7877, so the two never share a port). Without `GEMI_API`,
the agent service follows the place the desktop app works on.
The home page does not use this login — it acts as whoever is signed in.

Check: `cd agent && python -m gemi_agent status`

## 3. Choose a model

The agent needs an **OpenAI-compatible chat endpoint**. Plot marking also
needs a model that accepts **images**. Settings live in `agent/config.json`
(or the home page's settings dialog, or environment variables):

```json
{ "base_url": "http://localhost:8000/v1", "model": "gemma4", "api_key": "", "tool_mode": "text", "vision": true }
```

| Option | `base_url` | `model` | Notes |
|---|---|---|---|
| Local, on your cluster (vLLM) | from `gemi-hpc llm tunnel` | `gemma4` | section 5; no data leaves your institution |
| Local, on this computer (Ollama) | `http://localhost:11434/v1` | e.g. `gemma4:12b` | `ollama pull <model>`; needs a GPU with enough memory |
| Local (LM Studio, llama.cpp server, vLLM) | their `/v1` address | as served | any OpenAI-compatible server |
| Hosted: Anthropic | `https://api.anthropic.com/v1` | e.g. `claude-sonnet-5-5` | API key in `api_key`; uses Anthropic's OpenAI-compatible endpoint |
| Hosted: OpenAI or compatible (OpenRouter, Together, …) | provider's `/v1` | provider's model id | API key in `api_key` |

`tool_mode`:
- `text` (default) — the model asks for a tool by replying with a small JSON
  object. Works with every model and server; use it for local models.
- `native` — the endpoint's own function calling. Use with hosted models, or
  local servers started with tool-call support.

Environment variables override the file: `GEMI_LLM_URL`, `GEMI_LLM_MODEL`,
`GEMI_LLM_KEY`, `GEMI_LLM_TOOL_MODE`.

Check: `python -m gemi_agent chat "Say which skills you have."`

Picking a model: larger models follow multi-step procedures more reliably.
For marking plots from pictures, use the largest vision model you can run;
for uploads, status and job handling, small models do fine.

## 4. Use it

**Home page.** Start the service next to the app:

```bash
cd agent && python -m gemi_agent serve        # port 7790; the dev server proxies /agent to it
```

Open the app: the home page is the agent. Pick a skill (or none), type what
you want, watch each step, approve or decline anything that deletes data.
The gear icon holds the model settings (administrators only).

**Terminal.**

```bash
cd agent
python -m gemi_agent chat                                   # interactive
python -m gemi_agent chat --skill upload-data "Upload D:/field-data/rover for Coachella / Lima, 2026-09-17, 4 files at a time"
python -m gemi_agent chat --skill ground-plot-marking --track Raw/2026/EXP/SITE/POP/2026-09-17/Amiga/RGB/c0fca235/ "Mark passes 60 to 70"
```

Without an agent, the same tools are plain commands — useful in scripts and
for checking what an agent did:

```bash
python -m gemi_agent tools
python -m gemi_agent upload --paths '["D:/field-data/rover"]' --experiment GEMINI --site Coachella \
       --population Lima --date 2026-09-17 --data_type amiga_bin --parallel 4
python -m gemi_agent tasks                 # upload progress
python -m gemi_agent jobs --status RUNNING
```

**Your own agent (Claude Code, other MCP clients).** The repository's
`.mcp.json` registers the tools as an MCP server; skills are in
`agent/skills/` (copy them to `.claude/skills/` for Claude Code). Any other
model: give it `agent/skills/app-overview/SKILL.md` as instructions and let
it run `python -m gemi_agent <tool>` commands.

## 5. Running on your HPC cluster

For clusters with **Slurm and Apptainer** (no Docker needed). One-time:

1. Copy `hpc/clusters/launch.conf.example` to `hpc/clusters/<yours>/launch.conf` and edit
   `launch.conf`: login host and SSH key, a directory on shared storage with
   plenty of space (`GEMI_HPC_ROOT`), and your partitions and accounts
   (`sinfo` and `sacctmgr show assoc user=$USER` list them). Run
   `bash hpc/tools/cluster-info.sh` on the cluster to collect the facts.
2. `export GEMI_CLUSTER=<yours>` (or write `<yours>` into `hpc/clusters/active`).
3. `bash hpc/gemi-hpc sync && bash hpc/gemi-hpc pull` — code and container
   images (a Slurm job; about 20 minutes).
4. Optional local model: `bash hpc/gemi-hpc llm pull` (image + weights;
   up to an hour).

Each working session:

```bash
bash hpc/gemi-hpc up                 # database, storage, API
bash hpc/gemi-hpc worker amiga stitch   # the workers the work needs
bash hpc/gemi-hpc llm up             # optional: the local model on a GPU
bash hpc/gemi-hpc app                # opens tunnels, starts the agent service and the app; prints URL + login
…
bash hpc/gemi-hpc down && bash hpc/gemi-hpc llm down
```

`gemi-hpc app` wires everything: the agent service runs on your computer (so
it can upload your local files), reaches the cluster's API through an SSH
tunnel, and uses the cluster's model if `llm up` is running — otherwise the
model from `agent/config.json`.

What to set for the model in `launch.conf`:

| Setting | Meaning |
|---|---|
| `LLM_MODEL` | Hugging Face id. Default: 4-bit Gemma 4 31B (vision, ~20 GB of GPU memory) |
| `LLM_TRY` | `partition:account:gres` list, tried in order; first that can start soon wins |
| `LLM_ARGS` | extra `vllm serve` flags (context length, memory fraction) |
| `LLM_TIME` | wall time of the model job |

Smaller GPU (16–24 GB): `LLM_MODEL=google/gemma-4-E4B-it-qat-w4a16-ct`.
Gated models need `HF_TOKEN` in your login environment on the cluster.

Details and troubleshooting: skill `hpc-session`.

## 6. What the agent may do

One policy (`gemi_agent/policy.py`) for every way an agent reaches the app:
the home page, `gemi_agent chat`, and Claude Code or another harness using
the CLI, the MCP server or the shell.

| | Examples | |
|---|---|---|
| Reading | status, listings, logs, the cluster survey | free |
| Routine work inside the configured setup | uploads, pipeline jobs, starting a worker on a configured partition | free |
| Changing the cluster session or its setup | `hpc` sync / pull / up / down, `hpc_configure`, starting or stopping the model, stopping a busy worker | asks first |
| Deleting | `delete_files`, `delete_job` | asks first |

On the home page an "asks first" call waits for Allow / Decline and shows
the reason. In the terminal it prompts (`--yes` answers yes).

**The cluster is reached only through the gate.** `hpc/gemi-hpc` runs
`hpc/remote/gemi-gate` on the cluster for every action: a fixed menu,
confined to the GEMI directory, with job limits (32 CPUs, 128 GB, 1 GPU,
2 days, 10 jobs unless the cluster's `launch.conf` says otherwise) and a log
of every call. `bash hpc/gemi-hpc doctor` proves the gate refuses what is
not on its menu.

**Claude Code.** `.claude/settings.json` runs `scripts/hooks/remote_guard.py`
before every shell and agent-tool call: raw `ssh` / `scp` / `rsync` /
`sbatch` are denied, read-only `gemi-hpc` commands pass, and the writing or
submitting ones ask you. `.claude/` is not committed, so copy that file to a
new checkout. The hook matches words, so a command that only *mentions* ssh
(text in a heredoc, say) is denied too; put such text in a file instead.

**Workers.** A job the agent submits starts the worker it needs; a worker
with no jobs for 60 minutes is stopped by the agent service. Both are
switches at the bottom of the home page's Compute panel.

## Roadmap

- **First-run setup in the app.** On first launch, the home page walks the
  user through connecting compute — a cluster (collecting the `launch.conf`
  facts over SSH, as `hpc/tools/cluster-info.sh` does), a cloud GPU, or this
  computer — and choosing a model, with the agent doing the checks. Today
  these are the manual steps in sections 3 and 5.
- Agent service running inside the cluster session (for data that is
  already on the cluster), next to the on-your-computer mode used now.
- Field design file as input to plot marking (plots per bed, borders).
- Aerial steps that are interactive today (ground control points, plot
  boundaries) as agent tools.
