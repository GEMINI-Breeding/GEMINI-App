import type { TestInfo } from "@playwright/test"

/**
 * Produce a collision-free identifier for a single test run. Used as the
 * experiment/run name throughout the spec so the afterEach cleanup can
 * find and delete exactly the rows this test created.
 */
export function makePrefix(info: TestInfo): string {
  const slug = info.title.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40)
  return `E2E-${slug}-${Date.now()}`
}
