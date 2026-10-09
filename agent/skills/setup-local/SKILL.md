---
name: setup-local
description: Set up and launch the GEMINI app on this computer from a fresh copy — check prerequisites, choose where the processing stack runs (this computer with Docker, or an HPC cluster), choose the agent's model, start everything and hand the person a working app. Use for "install GEMINI", "set it up", "get the app running", first run.
---

# Setting up the app on this computer

## Quick path

1. Ask where processing should run: this computer (needs Docker Desktop) or a cluster (needs an SSH login).
2. Cluster: `read_skill` `connect-hpc` and follow it.
3. This computer: check Docker is running, then start the stack as the steps below say.
4. Ask which model the agent should use and help them enter it in the settings; test it.

For an agent with a shell on the person's computer (e.g. Claude Code) and
the app's files already there (downloaded release or the repository).
Work through the sections in order; each ends with a check. Do not go on
while a check fails.

Paths below are relative to the app folder (the one containing `agent/`,
`hpc/`, `frontend/`).

## 1. What is on this computer

Run and note the answers:

```bash
python --version            # need 3.10 or newer
python -c "import PIL, numpy; print('ok')"   # if this fails: pip install pillow numpy
docker info --format '{{.ServerVersion}}'    # Docker running? (only needed for a local stack)
ssh -V                      # needed for a cluster
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader   # a local GPU? (only for a local model)
```

On Windows use Git Bash for these and for `hpc/gemi-hpc`.

## 2. Where does the processing stack run?

Ask the person if they have not said. Processing (stitching, orthomosaics,
inference) is heavy.

| Their situation | Choose |
|---|---|
| Has an HPC cluster login (Slurm) | **Cluster**: follow the `connect-hpc` skill with their SSH command, then come back to section 4 |
| Strong workstation (16+ cores, 64+ GB) with Docker | **Local**: section 3 |
| Laptop, no cluster | Local works for small data; say plainly that large runs will be slow |

## 3. Local stack (Docker)

```bash
docker compose up -d --build          # first time: several minutes
curl -s http://127.0.0.1:7777/healthz  # check: answers once the API is up
```

Sign-in is in `backend/gemini/pipeline/.env` (`GEMINI_FIRST_SUPERUSER_EMAIL`
/ `_PASSWORD`). If the stack does not come up, read
`docker compose logs --tail 50 geminibase-rest-api` and report the error.

## 4. The agent's model

The agent in the app needs a chat model. Ask which the person wants:

| Option | What to do |
|---|---|
| Hosted API (Anthropic, OpenAI, OpenRouter…) | they give an API key; write `agent/config.json`: `{"base_url": "https://api.anthropic.com/v1", "model": "<model id>", "api_key": "<key>", "tool_mode": "native"}` |
| Model on their cluster | `connect-hpc` covers it: `hpc` `pull_llm`, `llm_up`, then `connect` with `"use_cluster_model": true` writes the config |
| Model on this computer (needs a GPU with 16+ GB) | Ollama: `ollama pull <model>`; config `{"base_url": "http://localhost:11434/v1", "model": "<model>"}` |

Never print an API key back. Check:

```bash
cd agent && python -m gemi_agent chat "Reply with: ready"
```

## 5. Start the app

```bash
cd agent && python -m gemi_agent serve            # the agent service (leave running)
cd frontend && npm install && npm run dev         # the app; prints its address
```

With a cluster stack, `bash hpc/gemi-hpc app` does both and opens the
tunnels. An installed desktop build starts these itself.

Check: open the printed address; the sign-in page appears; after signing in
the home page shows the agent with its model name at the top right and
"Stack" status at the bottom left.

## 6. Hand over

Tell the person, briefly:
- the address to open and the sign-in to use;
- where the stack runs (and for a cluster: which partitions, and that
  `hpc` `down` ends the session);
- which model the agent uses;
- what to try first: "Upload …", "What is running?", or the Process tab.

## If something is missing

| Missing | Say |
|---|---|
| Python | install Python 3.10+ from python.org, then rerun |
| Docker (local stack wanted) | install Docker Desktop and start it |
| SSH key login to the cluster | `ssh-keygen`, then `ssh-copy-id user@host`; the tools cannot type passwords |
| Any model | the agent cannot run without one; the app's other pages still work |
