# GEMINI-App: guide for coding agents

Read by any coding agent working in this repository (Claude Code, Codex, Cursor,
Copilot, Gemini CLI and others).

## Reporting a problem or proposing a change

When the user asks to report a bug, request a feature, "open an issue", or
"make a pull request", follow **[.claude/skills/contribute/SKILL.md](.claude/skills/contribute/SKILL.md)**.
It covers which repository to use, when a change is small enough for a pull
request (otherwise it becomes an issue), what to leave out, and how to post.
In short:

- Repository: **GEMINI-Breeding/GEMINI-App** for the app (`frontend/`), the
  agent (`agent/`), the cluster scripts (`hpc/`) and docs. Use
  **GEMINI-Breeding/GEMINIbase** for the backend (`backend/`, a submodule: the
  API, database, processing workers and job types).
- Search existing issues and pull requests first.
- Leave out logins, emails, tokens, host and cluster names, account names,
  storage paths, job IDs and unpublished data. Trim logs to the error.
- Show the user the full text (and the diff, for a pull request) and post only
  after they approve.
- Pull requests are for small, tested changes (one concern, about 200 lines).
  Changes to the schema, job types, API contracts, authentication, the cluster
  gate or guard hook, CI or dependencies go in an issue for the maintainers.
- Never push to the default branch, merge your own pull request, or change
  tests or CI to make them pass.

## Layout

| Path | What it is |
|---|---|
| `frontend/` | Desktop app (Tauri + React + TypeScript); API client generated in `src/client` |
| `backend/` | GEMINIbase submodule: REST API, Postgres, MinIO, processing workers |
| `agent/` | Python agent (`gemi_agent`) that drives the app; its skills are in `agent/skills/` |
| `.claude/skills/` | The agent skills for Claude Code, plus `contribute` for development |
| `hpc/` | Running the stack on a Slurm cluster (`gemi-hpc` client, `remote/` scripts) |
| `scripts/hooks/` | Guard hook: the cluster is reached only through `hpc/gemi-hpc` |

## Checks

- Frontend (from `frontend/`): `npx tsc --noEmit -p tsconfig.json`, `npx biome check <files>`,
  `npx vitest run <feature folder>`.
- Agent (from `agent/`): `python -m unittest tests.test_policy tests.test_parse tests.test_runner_tools tests.test_field_layout`.
  `test_runner_tools` fails if a tool is not named in any skill.
- Backend (from `backend/`, Python 3.12): `uv run --python 3.12 --with pytest pytest <test path>`.

## Conventions

- Code, comments, docs and commit messages in plain prose.
- Commit only what the change needs. Keep secrets, `.env` files, data, and
  cluster settings (`hpc/clusters/*/launch.conf`) out of commits.
- `CLAUDE.local.md`, if present, holds one developer's private notes. It is
  git-ignored: never commit it or quote it in issues.
