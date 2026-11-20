# The agent

[← README](../README.md)

The agent works the app through the same steps you would: upload, mark plots, stitch, run models, analyse, start and stop cluster work. It asks before anything that changes the cluster session or deletes data, and asks you for facts only you know (plots per bed, the field design, where the rover started).

## Choosing a language model

Choose one in the first-run walkthrough, or later on the Agent tab (gear icon):

| Option | What you need | Notes |
|---|---|---|
| **A free open model on this computer** | [Ollama](https://ollama.com/download): GEMI installs it for you, no administrator rights needed. A graphics card helps a lot. | GEMI downloads and serves the model. The small Gemma 4 models (E2B, E4B) run on a laptop GPU with 6 GB; larger ones are slow there. |
| **A free open model on your cluster** | A GPU partition you can use | GEMI looks at the cluster, picks a GPU queue, installs the model server and weights (20 to 60 minutes the first time) and connects. Gemma 4 31B on a 48 GB GPU is the best tested model. |
| **A hosted model** | An API key (Anthropic Claude, OpenAI, or any OpenAI-compatible service) | Quickest to start; your requests and data go to that provider. |

Models that read images are needed for steps that look at pictures (plot photos, checking markings). If the app finds a model already running on this computer (Ollama, vLLM), it offers that one first.

How well each model does on the app's tasks, and what was changed to get small models through every step: [agent/EVALUATION.md](../agent/EVALUATION.md). Full agent guide: [agent/SETUP.md](../agent/SETUP.md).

## Driving GEMI from a coding agent instead

The installed app contains `gemi-agent`, one executable with every tool the in-app agent has. A coding agent (Claude Code, Codex, Gemini CLI, any MCP client) can use it with its own model, so no model has to be set up in the app.

| System | Path |
|---|---|
| macOS | `/Applications/GEMI.app/Contents/MacOS/gemi-agent` |
| Windows | `gemi-agent.exe` in the folder GEMI was installed to |
| Linux (.deb) | `/usr/bin/gemi-agent` |

Register it as an MCP server, for example in Claude Code:

```bash
claude mcp add gemi -- /Applications/GEMI.app/Contents/MacOS/gemi-agent mcp
```

Then ask in plain words: *"Use the gemi tools. Read the skill connect-hpc and set GEMI up on my cluster; my login is `ssh you@login.cluster.edu`."* The terminal and the app share their settings and state, so what one sets up appears in the other. By hand: `gemi-agent tools`, `gemi-agent status`, `gemi-agent chat "what is running?"`.

The procedures the agent follows are plain Markdown in [agent/skills/](../agent/skills/), one per stage; edit them to change how it works.

## Reporting problems and suggesting changes

In a checkout of this repository, ask your coding agent to "report this as an issue" or "open a pull request for this fix". It follows [AGENTS.md](../AGENTS.md) and the `contribute` skill: the right repository (the app, or GEMINIbase for the backend), no private details, and the text shown to you before anything is posted.
