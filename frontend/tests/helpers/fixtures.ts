import { test as base, type TestInfo } from "@playwright/test"
import {
  attachConsoleErrorGuard,
  type ConsoleErrorGuardHandle,
} from "./consoleErrorGuard"
import { deleteUploadsByPrefix, deleteWorkspacesByPrefix } from "./apiClient"
import { makePrefix } from "./uniquePrefix"

type Fixtures = {
  consoleErrorGuard: ConsoleErrorGuardHandle
  runPrefix: string
}

/**
 * Playwright test extension. Every spec that imports `test` from this file
 * automatically gets a console-error guard that fails the test on
 * unexpected errors (per the CLAUDE.md strict-E2E rule).
 *
 * `runPrefix` is opt-in — specs that don't request it skip the cleanup
 * pass entirely. Relevant during the migration because the pre-migration
 * seeder cleanup helpers (deleteWorkspacesByPrefix, deleteUploadsByPrefix)
 * are currently throwing stubs; making them a non-auto fixture lets Phase
 * 5 specs use the console-error guard without tripping on the stub.
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
  runPrefix: async ({}, use, info: TestInfo) => {
    const prefix = makePrefix(info)
    try {
      await use(prefix)
    } finally {
      try {
        // Order matters: workspaces cascade-delete their pipelines/runs, and
        // uploads are independent. Delete workspaces first so their runs are
        // gone before we touch uploads.
        await deleteWorkspacesByPrefix(prefix)
        await deleteUploadsByPrefix(prefix)
      } catch (err) {
        console.warn("cleanup failed:", err)
      }
    }
  },
})

export { expect } from "@playwright/test"
