import { test as base } from "@playwright/test"
import {
  attachConsoleErrorGuard,
  type ConsoleErrorGuardHandle,
} from "./consoleErrorGuard"

type Fixtures = {
  consoleErrorGuard: ConsoleErrorGuardHandle
  runPrefix: string
}

/**
 * Playwright test extension. Every spec that imports `test` from this file
 * automatically gets a console-error guard that fails the test on
 * unexpected errors (per the CLAUDE.md strict-E2E rule).
 *
 * `runPrefix` is intentionally not provided here. It used to wrap two
 * pre-migration cleanup helpers (deleteWorkspacesByPrefix /
 * deleteUploadsByPrefix) that are currently throwing stubs in
 * helpers/apiClient.ts pending Phase 12. Wiring that fixture in as a
 * silent-warn no-op was a trap: the first spec to opt in would think
 * cleanup ran, when in reality nothing was deleted. We don't include the
 * fixture at all until a real implementation lands — accessing it from a
 * spec produces a clear test-time error instead of fake green.
 */
export const test = base.extend<Fixtures>({
  consoleErrorGuard: [
    async ({ page }, use) => {
      const guard = attachConsoleErrorGuard(page)
      await use(guard)
      guard.assertClean()
    },
    { auto: true },
  ],
  runPrefix: async ({}, _use) => {
    throw new Error(
      "runPrefix fixture is not implemented. The pre-migration cleanup " +
        "helpers (deleteWorkspacesByPrefix / deleteUploadsByPrefix) are " +
        "throwing stubs scheduled for replacement in Phase 12. Until then, " +
        "specs must use unique per-run identifiers and accept that test " +
        "data accumulates in MinIO/Postgres.",
    )
  },
})

export { expect } from "@playwright/test"
