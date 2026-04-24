// Import `test` from helpers/fixtures so every case auto-attaches the
// console-error guard required by CLAUDE.md's strict-E2E rule.
import { expect, test } from "./helpers/fixtures"

/*
 * NOTE ON COVERAGE LEVEL
 * ----------------------
 * GEMINIbase has no SMTP/email flow today, so /recover-password and
 * /reset-password are placeholder notice pages. These tests assert only
 * the notice structure — they will pass forever regardless of whether a
 * real password-reset flow is ever implemented. This is a structural
 * smoke test, *not* behavioural coverage. When a real flow lands
 * upstream, **replace** these specs with a mailcatcher-driven round
 * trip (see git history for the pre-migration version).
 */
test.use({ storageState: { cookies: [], origins: [] } })

test("recover-password shows a 'not available' notice and a back link", async ({ page }) => {
  await page.goto("/recover-password")
  await expect(
    page.getByRole("heading", { name: "Password Recovery" }),
  ).toBeVisible()
  await expect(page.getByText(/not available in this deployment/i)).toBeVisible()
  await expect(page.getByRole("link", { name: /back to log in/i })).toBeVisible()
})

test("reset-password shows a 'not available' notice and a back link", async ({ page }) => {
  await page.goto("/reset-password")
  await expect(
    page.getByRole("heading", { name: "Reset Password" }),
  ).toBeVisible()
  await expect(page.getByText(/not available in this deployment/i)).toBeVisible()
  await expect(page.getByRole("link", { name: /back to log in/i })).toBeVisible()
})
