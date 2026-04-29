import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

/** Warnings we know to be benign. Everything else fails the test. */
const KNOWN_BENIGN_PATTERNS: RegExp[] = [
  /ResizeObserver loop limit exceeded/,
  /ResizeObserver loop completed with undelivered notifications/,
  // The post-login update-check hits api.github.com/repos/.../releases/latest
  // which rate-limits unauthenticated requests at 60/hr/IP. The app handles
  // a non-2xx as `{status: "error"}` (no UI surfaces an error), but Chrome
  // still logs the response status. The check is a once-per-day fire-and-
  // forget; it's not a code-level failure.
  /api\.github\.com\/repos\/[^)\s]*\/releases\/latest/,
  // TiTiler returns 404 for COG tile coordinates that fall inside the
  // overall bounding-box rectangle but outside the ortho's actual data
  // footprint (drone orthomosaics are non-rectangular — the corners of
  // the bbox are nodata). Leaflet's `bounds` option only clips at the
  // bbox level, so edge tiles still get requested. The tile layer
  // already swallows these via `tileerror`; Chromium still logs the
  // network 404. This is cosmetic, not a real failure.
  /\/titiler\/cog\/tiles\/[^)\s]*\)/,
]

export interface ConsoleErrorGuardHandle {
  readonly errors: string[]
  /**
   * Tell the guard that a specific console.error is *expected* during this
   * test — typically because the test deliberately exercises a 4xx code
   * path (e.g. "log in with the wrong password" expects a 400). The
   * pattern matches the full error string the guard records, including
   * the URL when present.
   *
   * This is per-test only. The default is still strict; nothing global is
   * loosened. Use sparingly and only for paths the test is the *subject*
   * of, not for noise to be hidden.
   */
  expectError(pattern: RegExp): void
  assertClean(): void
}

/**
 * Attach console.error / pageerror / unhandledrejection listeners to a
 * Playwright page and return a handle whose assertClean() fails the test
 * if any unexpected message was captured.
 *
 * The unhandledrejection bridge matters: components that catch rejections
 * "gracefully" (toast + return) leave Chrome silent on `pageerror`, but a
 * dropped backend call that the UI handles by hiding the error is exactly
 * the regression we want this guard to catch. We forward those events to
 * the console as errors so the same `console` listener picks them up.
 */
export function attachConsoleErrorGuard(page: Page): ConsoleErrorGuardHandle {
  const errors: string[] = []
  const expectedPatterns: RegExp[] = []

  // Bridge unhandledrejection → console.error so the listener below sees
  // it. addInitScript runs before any page script on every navigation.
  void page.addInitScript(() => {
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason
      const text =
        reason instanceof Error
          ? `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`
          : `unhandled rejection: ${
              typeof reason === "string" ? reason : JSON.stringify(reason)
            }`
      // eslint-disable-next-line no-console
      console.error(`[unhandledrejection] ${text}`)
    })
  })

  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    const text = msg.text()
    // Chrome's "Failed to load resource" messages don't include the URL in
    // text() — grab it from location() so the test failure message is
    // diagnosable rather than a wall of identical 404s.
    const loc = msg.location()
    const where = loc?.url ? ` (${loc.url})` : ""
    const fullText = `${text}${where}`
    if (KNOWN_BENIGN_PATTERNS.some((re) => re.test(fullText))) return
    errors.push(`[console.error] ${fullText}`)
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
    expectError(pattern: RegExp) {
      expectedPatterns.push(pattern)
    },
    assertClean() {
      const unexpected = errors.filter(
        (e) => !expectedPatterns.some((re) => re.test(e)),
      )
      expect(
        unexpected,
        `Unexpected console errors or uncaught exceptions during the test:\n${unexpected.join(
          "\n---\n",
        )}`,
      ).toEqual([])
      // Counter-assertion: every pattern the test declared must actually
      // have matched at least one captured error. Catches stale patterns
      // when the underlying error message changes — without this, a test
      // that declares "expect 400 from /login" would silently pass even
      // if the 400 stops firing.
      for (const re of expectedPatterns) {
        expect(
          errors.some((e) => re.test(e)),
          `Expected console error matching ${re} but none was observed.`,
        ).toBe(true)
      }
    },
  }
}
