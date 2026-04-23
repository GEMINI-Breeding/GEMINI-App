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
 * automatically gets:
 *  - a console-error guard that fails the test on unexpected errors,
 *  - a unique run prefix that can be used as experiment/run names,
 *  - a guaranteed cleanup pass that deletes any uploads tagged with that
 *    prefix regardless of whether the test passed or failed.
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
