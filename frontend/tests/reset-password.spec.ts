import { expect, test } from "@playwright/test"

// Post-migration the recover-password / reset-password routes are notice
// pages because GEMINIbase has no SMTP/email flow. Keep the tests that
// assert structure; drop the email-round-trip tests that no longer apply.
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
