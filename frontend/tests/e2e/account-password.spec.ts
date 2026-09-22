/**
 * Strict-E2E: a user can change their own password.
 *
 * The profile and change-password forms existed but were mounted nowhere,
 * so no one could change their password in the app. They now live under
 * Settings → Account. (For an admin locked out with no email server there
 * is also `python -m gemini.rest_api.reset_password`, shown on the "Forgot
 * password" page; that one runs on the host, so it isn't driven here.)
 *
 * Signs up a throwaway user through the UI, changes its password, proves
 * the old one no longer works and the new one does, then deletes the user
 * from the Admin page as the seeded superuser.
 */
import type { Page } from "@playwright/test"

import { firstSuperuser, firstSuperuserPassword } from "../config"
import { expect, test } from "../helpers/fixtures"

test.use({ storageState: { cookies: [], origins: [] } })

async function logIn(page: Page, email: string, password: string) {
  await page.goto("/login")
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByRole("button", { name: "Log In" }).click()
}

async function logOut(page: Page) {
  await page.waitForLoadState("networkidle")
  // Radix menu: open on pointerdown, fire the item via click (see admin.spec).
  await page
    .getByTestId("user-menu")
    .dispatchEvent("pointerdown", { button: 0 })
  await page.getByTestId("logout-menu-item").dispatchEvent("click")
  await page.waitForURL("/login")
}

test.describe("Account — change password", () => {
  test.setTimeout(120_000)

  test("change your own password in Settings; the old one stops working", async ({
    page,
    runPrefix,
    consoleErrorGuard,
  }) => {
    const email = `${runPrefix
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)}@example.com`
    const oldPassword = "first-password-123"
    const newPassword = "second-password-456"

    // The deliberate wrong-password login below answers 400.
    consoleErrorGuard.expectError(/Failed to load resource.*400/)

    // ── 0. "Forgot password" explains the no-email ways back in. ────────
    await page.goto("/recover-password")
    await expect(page.getByTestId("password-reset-command")).toContainText(
      "python -m gemini.rest_api.reset_password",
    )

    // ── 1. Sign up and sign in as a fresh user. ─────────────────────────
    await page.goto("/signup")
    await page.getByTestId("full-name-input").fill("Password Changer")
    await page.getByTestId("email-input").fill(email)
    await page.getByTestId("password-input").fill(oldPassword)
    await page.getByTestId("confirm-password-input").fill(oldPassword)
    await page.getByRole("button", { name: "Sign Up" }).click()
    await page.waitForURL("/login")
    await logIn(page, email, oldPassword)
    await page.waitForURL("/")

    // ── 2. Settings → Account → change it. ──────────────────────────────
    await page.goto("/settings")
    await page.getByTestId("settings-tab-account").click()
    await page.getByTestId("current-password-input").fill(oldPassword)
    await page.getByTestId("new-password-input").fill(newPassword)
    await page.getByTestId("confirm-password-input").fill(newPassword)
    await page.getByRole("button", { name: "Update Password" }).click()
    await expect(page.getByText("Password updated successfully")).toBeVisible({
      timeout: 15_000,
    })

    // ── 3. Old password refused, new one accepted. ──────────────────────
    await logOut(page)
    const refused = page.waitForResponse(
      (r) => r.url().includes("/login/access-token") && r.status() === 400,
    )
    await logIn(page, email, oldPassword)
    await refused
    await expect(page).toHaveURL(/\/login/)
    await logIn(page, email, newPassword)
    await page.waitForURL("/")
    await expect(page.getByTestId("user-menu")).toBeVisible()

    // ── 4. Cleanup through the Admin page as the seeded superuser. ─────
    await logOut(page)
    await logIn(page, firstSuperuser, firstSuperuserPassword)
    await page.waitForURL("/")
    await page.goto("/admin")
    await page.waitForLoadState("networkidle")
    const row = page.getByRole("row").filter({ hasText: email })
    await row.getByRole("button").dispatchEvent("pointerdown", { button: 0 })
    await page
      .getByRole("menuitem", { name: /delete user/i })
      .dispatchEvent("click")
    await page.getByRole("button", { name: "Delete" }).dispatchEvent("click")
    await expect(page.getByText(email)).not.toBeVisible({ timeout: 15_000 })
  })
})
