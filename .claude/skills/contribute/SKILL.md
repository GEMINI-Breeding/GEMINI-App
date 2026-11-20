---
name: contribute
description: Help develop the GEMINI app from a user's request. File a GitHub issue (bug report or feature request) on the app repository or on GEMINIbase, or open a pull request for a small, self-contained change. Use for "report this bug", "open an issue", "request a feature", "make a PR for this fix", "suggest this change to the developers".
---

# Contributing to the GEMINI app

This skill is for a coding agent (Claude Code or similar) working in a checkout of
this repository. It turns what the user ran into into an issue, or a small fix
into a pull request, so the maintainers can review it. Anything you post is
public, and maintainers read it: keep it short and specific, and free of
private details.

## 1. Which repository

| The problem or change is in… | Repository |
|---|---|
| The desktop app's screens (`frontend/`), the agent and its skills (`agent/`, `.claude/skills/`), the cluster scripts (`hpc/`), setup and docs | **GEMINI-Breeding/GEMINI-App** |
| The API, database, processing workers (ODM, stitching, ML, GWAS, geo), job types (`backend/`, a git submodule) | **GEMINI-Breeding/GEMINIbase** |

The deciding question is which code is wrong, not which screen showed the
error. A job that fails in a worker belongs to GEMINIbase, even though the
user saw it in the app. A button that sends the wrong parameters belongs to
the app. When it's unclear, file on GEMINI-App and say why you think the cause
may be in the backend.

## 2. Issue or pull request

Open a **pull request** only for a small, contained change you can test here:

- one concern (a bug fix, a wording or layout fix, a missing check, a small helper);
- about 200 changed lines or fewer, not counting tests;
- with a test where the code has tests nearby.

**File an issue instead** when the change would touch any of these:

- database schema or migrations (`backend/alembic`, `gemini/db`);
- job types, API routes or their parameters (the contract between app, workers and agent);
- authentication, user accounts or permissions;
- the cluster gate (`hpc/remote/gemi-gate`), the guard hook (`scripts/hooks`, `.claude/settings.json`);
- CI workflows (`.github/`), image builds, dependency upgrades;
- a new feature, or anything spread across many files.

The issue can describe the proposed change, or link a branch on the user's
fork. The maintainers then decide how it fits. Add-ons that leave the core
alone may later go through a plugin system. Until then, propose them as
issues.

## 3. Before posting anything

1. **Search for an existing issue or PR**: `gh issue list -R <repo> --search "<words>" --state all`
   and `gh pr list -R <repo> --search "<words>" --state all`. If there is one,
   offer to comment there instead.
2. **Strip private details.** Never include:
   - logins, emails, passwords, tokens or API keys, `.env` or `secrets` contents;
   - host names, cluster names, account or group names, Slurm job IDs, home
     or group storage paths;
   - unpublished results or field details beyond what the bug needs (site
     names, genotype lists, trait values).

   Replace them with placeholders (`<cluster>`, `/path/to/data`). Trim logs to
   the lines that show the error.
3. **Show the user the full title and body (and the diff, for a PR) and wait
   for their go-ahead.** Posting is public and can't be fully undone. Attach
   screenshots only if the user picks them; check them for names, emails and
   paths first.

## 4. Filing an issue

Collect the facts first, rather than guessing:

- app version: `git rev-parse --short HEAD` and `git -C backend rev-parse --short HEAD`;
- where the stack runs: on this computer (Docker) or on a cluster, without naming the cluster;
- the run's pipeline (aerial or ground), the step, the job type, and the job's error message.

```bash
gh issue create -R GEMINI-Breeding/GEMINI-App --title "<what is wrong, in a few words>" --body-file issue.md
```

Body (`issue.md`):

```markdown
## What happened
<one or two sentences; the error message as text>

## What I expected
<one sentence>

## Steps to reproduce
1. …

## Environment
App <hash>, backend <hash>; stack on <this computer | a cluster>; <OS>

## Notes
<trimmed log lines, what was already tried, a suspected cause with file:line if known>

_Filed with help from a coding agent._
```

For a feature request, replace the first three sections with **What I want to
do**, **Why** (the research task it serves) and **Ideas** (optional). Label it
only with labels the repository already has (`gh label list -R <repo>`).

**Without `gh`** (not installed, or not signed in): give the user a link that
opens the form filled in, with the title and body URL-encoded:
`https://github.com/<repo>/issues/new?title=…&body=…`.
Or give them the text to paste. Never ask for their GitHub token.

## 5. Opening a small pull request

1. **Base branch**: the repository's default branch, unless the maintainers name another:
   `gh repo view <repo> --json defaultBranchRef -q .defaultBranchRef.name`.
2. **Where to push**: with write access, push a new branch to the repository. Without it, fork first:
   `gh repo fork <repo> --remote --remote-name fork`.
   For a backend change, do this inside `backend/`. It is its own repository,
   so its PR goes to GEMINIbase.
3. **Branch** from the up-to-date base, named for the change (`fix/plot-marking-strip-width`).
   Leave out unrelated local edits. Stage only the files of this change, not `git add -A`.
4. **Run the checks** for what you touched, and report their results honestly:
   - frontend (from `frontend/`): `npx tsc --noEmit -p tsconfig.json`, `npx biome check <files>`,
     `npx vitest run <feature folder>`;
   - agent (from `agent/`): `python -m unittest tests.test_policy tests.test_parse tests.test_runner_tools`;
   - backend (from `backend/`, Python 3.12): `uv run --python 3.12 --with pytest pytest <test path>`.

   If a check also fails without your change, say so in the PR. Don't change
   tests or CI to make them pass.
5. **Commit** with a message that says what changed and why. **Push** and open the PR:

   ```bash
   gh pr create -R <repo> --base <default branch> --title "<what it does>" --body-file pr.md
   ```

   Body: what was wrong and what changed, how it was tested (the commands and
   their results), `Fixes #<issue>` if there is one, and a line saying a coding
   agent helped write it.
6. **A change in both repositories**: open the GEMINIbase PR first, then the
   app PR, and link each from the other. Don't move the app's `backend`
   submodule pointer until the backend PR is merged.

## Never

- Push to the default branch, force-push someone else's branch, or merge your own PR.
- Commit secrets, `.env` files, `settings.local.json`, data files, or files the user did not ask to change.
- Post on the user's behalf without showing them the text first.
- Open a PR for a change from the "file an issue instead" list. Describe it in an issue.
