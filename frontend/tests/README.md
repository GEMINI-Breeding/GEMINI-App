# Frontend tests

Two test stacks live side-by-side in this directory:

- **Vitest** for unit tests, colocated with source (`src/**/*.test.ts`).
- **Playwright** for end-to-end tests, in this `tests/` tree.

## Running locally

```bash
# Unit tests
npm run test:unit            # one-shot
npm run test:unit:watch
npm run test:unit:ui
npm run test:unit:coverage

# E2E tests — REQUIRES a running backend on :8000
npm run test:e2e
npm run test:e2e:ui
```

### Backend prerequisites for E2E

From the repo root:

```bash
cp .env.example .env         # FIRST_SUPERUSER=admin@example.com / adminpassword
cd backend
uv sync
APP_DATA_ROOT=/tmp/gemi-test-data \
FRONTEND_HOST=http://localhost:5273 \
  uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

- **`FRONTEND_HOST=http://localhost:5273`** — the test project's dev server
  listens on **5273** (not 5173) to avoid colliding with any `npm run dev`
  you have running. The backend's CORS allowlist reads `FRONTEND_HOST`, so
  setting it here is what lets the test browser call `http://localhost:8000`
  without cross-origin errors.
- **`APP_DATA_ROOT=/tmp/gemi-test-data`** — keeps test uploads out of your
  real data directory.

### Docker + ODM

The orthomosaic E2E (`pipeline-orthomosaic.spec.ts`) shells out to
`docker run opendronemap/odm` from the backend. Prereqs on the test machine:

```bash
docker pull opendronemap/odm   # ~3 GB, one-time
```

The first invocation after a fresh pull takes 3–5 minutes on the 5 fixture
drone images; subsequent runs are slightly faster. If Docker isn't installed
or the image is missing, the spec fails fast with a clear message from the
backend's Docker-availability check.

## Test layout

```
tests/
  config.ts                      # reads root .env (FIRST_SUPERUSER, etc.)
  auth.setup.ts                  # legacy auth setup (currently unused — see below)
  login.spec.ts ...              # pre-existing specs (currently unrunnable — see below)
  helpers/
    e2e.setup.ts                 # lightweight auth bootstrap for e2e-workflows
    fixtures.ts                  # test.extend composition: consoleGuard + cleanup
    consoleErrorGuard.ts         # fails tests on unexpected console.error/pageerror
    uploadHelpers.ts             # drop files, fill form, submit, wait for completion
    manageHelpers.ts             # navigate to Manage, find row, open image viewer
    apiClient.ts                 # cleanup helpers via the generated SDK
    uniquePrefix.ts              # per-test E2E-<slug>-<timestamp> prefix
    fixturePath.ts               # absolute fixture path resolver
    waitFor.ts                   # waitForRequest / waitForResponseOk wrappers
  fixtures/
    csv/ geojson/ images/drone/ ortho/ binary/ invalid/ inference/ models/
    scripts/                     # Python fixture generators
    pipelineHelpers.ts          # step-row scoping + ortho-name dialog flow
  e2e/
    data-import-manage-view.spec.ts
    pipeline-orthomosaic.spec.ts  # real ODM run (~2 min), requires Docker
```

## Authoring new E2E specs

Always import `test` from `../helpers/fixtures`:

```ts
import { test, expect } from "../helpers/fixtures"
```

You get these fixtures for free:

- `consoleErrorGuard` — auto-attached; fails the test on any unexpected
  `console.error` or `pageerror`. Whitelist is `KNOWN_BENIGN_PATTERNS` in
  `consoleErrorGuard.ts`.
- `runPrefix` — a unique string like `E2E-drone-upload-1777000000000`. Use it
  as the `experiment` name (or similar) so the afterEach cleanup can find
  your rows.

Every spec that uses `runPrefix` automatically triggers
`deleteUploadsByPrefix(runPrefix)` on teardown, pass or fail.

## Non-goals (for now)

### Pre-existing `login.spec.ts`, `sign-up.spec.ts`, etc.
These target the old FastAPI-template auth UI. In the current app,
`isLoggedIn()` is a stub that always returns `true` and `/login` redirects
straight to `/` for any visitor, so the pre-existing specs time out waiting
for form fields that never render. They're left in place because the suite
will almost certainly be re-wired once real auth lands — which is the cue
to revisit `auth.setup.ts`. The new `e2e-workflows` project uses its own
lightweight `e2e.setup.ts` bootstrap that calls `/api/v1/login/access-token`
directly to get a bearer token.
