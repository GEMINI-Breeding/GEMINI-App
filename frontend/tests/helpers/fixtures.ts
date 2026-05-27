import { test as base } from "@playwright/test"
import { authHeader } from "./apiClient"
import {
  attachConsoleErrorGuard,
  type ConsoleErrorGuardHandle,
} from "./consoleErrorGuard"
import { makePrefix } from "./uniquePrefix"

type Fixtures = {
  consoleErrorGuard: ConsoleErrorGuardHandle
  runPrefix: string
}

// `??` would treat VITE_API_URL="" as "set", so fall through with `||`
// to the dev fallback. Frontend `.env` deliberately blanks VITE_API_URL
// so the dev server uses a relative `/api/*` proxy in the browser.
const API_URL =
  process.env.E2E_API_URL || process.env.VITE_API_URL || "http://127.0.0.1:7777"

/**
 * After each test, sweep entities the test created. Specs name their
 * top-level entities with this prefix (`E2E-<slug>-<timestamp>`); the
 * backend endpoint cascades a delete across experiments, genotyping
 * studies, accessions, and lines whose names start with that string.
 *
 * The endpoint is gated behind GEMINI_E2E_CLEANUP_ENABLED on the
 * backend; in CI/dev the docker-compose .env sets it to 1. In prod
 * the env var is unset and the endpoint returns 404.
 */
async function cleanupByPrefix(prefix: string): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/e2e_cleanup?prefix=${encodeURIComponent(prefix)}`,
    { method: "DELETE", headers: { Authorization: authHeader() } },
  )
  if (res.status === 404) {
    // The endpoint exists in the controller registry but is gated
    // behind `GEMINI_E2E_CLEANUP_ENABLED=1`. In prod the env var is
    // unset and the 404 is expected. On a dev box that gate being
    // off is a bug — every spec leaks E2E-prefixed rows. Warn loudly
    // so the developer hits this once and fixes the .env, instead of
    // silently accumulating garbage.
    console.warn(
      `[fixtures] cleanup for ${prefix} → 404. ` +
        `Set GEMINI_E2E_CLEANUP_ENABLED=1 in backend/gemini/pipeline/.env ` +
        `and recreate the rest-api container.`,
    )
    return
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `e2e_cleanup(${prefix}) → ${res.status} ${res.statusText}: ${body}`,
    )
  }
}

/**
 * Playwright test extension. Every spec that imports `test` from this file
 * automatically gets:
 *   - a console-error guard that fails the test on unexpected errors
 *     (per CLAUDE.md's strict-E2E rule);
 *   - a per-test `runPrefix` (the same shape `makePrefix` produces), and
 *     an automatic afterEach that DELETEs entities under that prefix so
 *     the dev DB doesn't accumulate test data across runs.
 *
 * Specs that already build their own prefix via `makePrefix(info)`
 * should pass that exact string into the entity names they create —
 * the auto-fixture will sweep using the same string.
 */
// Declaration order matters: Playwright tears fixtures down in reverse,
// so the LAST fixture declared here runs its cleanup FIRST. We want
// runPrefix's cleanupByPrefix (which DELETEs entities) to run AFTER
// consoleErrorGuard.assertClean — otherwise a still-mounted page can
// fire a poll against an already-deleted entity, log a 404 to console,
// and trip the guard during teardown. Declare runPrefix FIRST so its
// teardown is LAST.
export const test = base.extend<Fixtures>({
  runPrefix: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API requires an object destructure even when no fixtures are injected
    async ({}, use, info) => {
      const prefix = makePrefix(info)
      await use(prefix)
      // afterEach: best-effort sweep. Logged but not failed-on if the
      // endpoint is misconfigured — the test outcome already passed/
      // failed by this point.
      // Local debugging escape hatch: set KEEP_E2E_DATA=1 to keep the
      // test's MinIO + DB entities around so the produced artifacts can
      // be inspected.
      if (process.env.KEEP_E2E_DATA === "1") {
        console.warn(
          `[fixtures] KEEP_E2E_DATA=1 — skipping cleanup for ${prefix}`,
        )
        return
      }
      try {
        await cleanupByPrefix(prefix)
      } catch (err) {
        console.warn(`[fixtures] cleanup failed for ${prefix}:`, err)
      }
    },
    { auto: true },
  ],
  consoleErrorGuard: [
    async ({ page }, use) => {
      const guard = attachConsoleErrorGuard(page)
      await use(guard)
      guard.assertClean()
    },
    { auto: true },
  ],
})

export { expect } from "@playwright/test"
