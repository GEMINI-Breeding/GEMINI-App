import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

/** Warnings we know to be benign. Everything else fails the test. */
const KNOWN_BENIGN_PATTERNS: RegExp[] = [
  /ResizeObserver loop limit exceeded/,
  /ResizeObserver loop completed with undelivered notifications/,
]

export interface ConsoleErrorGuardHandle {
  readonly errors: string[]
  assertClean(): void
}

/**
 * Attach console.error / pageerror listeners to a Playwright page and return
 * a handle whose assertClean() fails the test if any unexpected message
 * was captured. Intended to be used via the `test.extend` fixture so every
 * spec gets it for free.
 */
export function attachConsoleErrorGuard(page: Page): ConsoleErrorGuardHandle {
  const errors: string[] = []

  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    const text = msg.text()
    if (KNOWN_BENIGN_PATTERNS.some((re) => re.test(text))) return
    errors.push(`[console.error] ${text}`)
  })

  page.on("pageerror", (err) => {
    const text = `${err.name}: ${err.message}`
    if (KNOWN_BENIGN_PATTERNS.some((re) => re.test(text))) return
    errors.push(`[pageerror] ${text}\n${err.stack ?? ""}`)
  })

  return {
    get errors() {
      return errors
    },
    assertClean() {
      expect(
        errors,
        `Unexpected console errors or uncaught exceptions during the test:\n${errors.join(
          "\n---\n",
        )}`,
      ).toEqual([])
    },
  }
}
