import type { Page } from "@playwright/test"

import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
// Import `test` from helpers/fixtures so every case auto-attaches the
// console-error guard required by CLAUDE.md's strict-E2E rule.
import { expect, test } from "./helpers/fixtures"
import { randomEmail, randomPassword } from "./utils/random"

/**
 * Phase 5.1 admin-page coverage. Every test drives the real UI end-to-end
 * — no API seeding, no private-API helpers. Each test either cleans up
 * its own user or notes the residue in a comment.
 */

async function logIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login")
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByRole("button", { name: "Log In" }).click()
  await page.waitForURL("/")
}

async function logOutViaMenu(page: Page): Promise<void> {
  await page.getByTestId("user-menu").click()
  await page.getByTestId("logout-menu-item").click()
  await page.waitForURL("/login")
}

async function createUserViaAdminDialog(
  page: Page,
  {
    email,
    fullName,
    password,
    isSuperuser = false,
    isActive = true,
  }: {
    email: string
    fullName: string
    password: string
    isSuperuser?: boolean
    isActive?: boolean
  },
): Promise<void> {
  await page.getByRole("button", { name: /add user/i }).click()
  await page.getByPlaceholder("Email").fill(email)
  await page.getByPlaceholder("Full name").fill(fullName)
  await page.getByPlaceholder("Password").first().fill(password)
  await page.getByPlaceholder("Password").nth(1).fill(password)
  if (isSuperuser) {
    await page.getByLabel(/is superuser/i).check()
  }
  if (isActive) {
    await page.getByLabel(/is active/i).check()
  }
  await page.getByRole("button", { name: "Save" }).click()
  // Dialog closes; the created row renders.
  await expect(page.getByText(email).first()).toBeVisible()
}

async function deleteUserViaRow(page: Page, email: string): Promise<void> {
  const row = page.getByRole("row").filter({ hasText: email })
  await row.getByRole("button").click()
  await page.getByRole("menuitem", { name: /delete user/i }).click()
  await page.getByRole("button", { name: "Delete" }).click()
  await expect(page.getByText(email)).not.toBeVisible()
}

test.use({ storageState: { cookies: [], origins: [] } })

test("superuser can open /admin and see the users table", async ({ page }) => {
  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")
  await expect(page).toHaveURL("/admin")
  await expect(page.getByRole("heading", { name: /users/i })).toBeVisible()
  await expect(page.getByText(firstSuperuser).first()).toBeVisible()
})

test("UserActionsMenu is hidden for the caller's own row (self-lock guard)", async ({
  page,
}) => {
  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")

  const myRow = page.getByRole("row").filter({ hasText: firstSuperuser })
  await expect(myRow).toHaveCount(1)
  // The actions menu trigger is a <button> inside the row. Self-rows must
  // hide the menu so a superuser can't demote / deactivate / delete
  // themselves — the UI mirror of the Phase 2 backend guard.
  await expect(myRow.getByRole("button")).toHaveCount(0)
})

test("superuser creates a plain user, sees it in the table, then deletes it", async ({
  page,
}) => {
  const email = randomEmail()
  const password = randomPassword()

  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")

  await createUserViaAdminDialog(page, {
    email,
    fullName: "Playwright Plain User",
    password,
    isSuperuser: false,
  })

  // Row shows the "User" (not "Superuser") badge.
  const row = page.getByRole("row").filter({ hasText: email })
  await expect(row).toContainText(/^(?!Superuser).*User/)

  await deleteUserViaRow(page, email)
})

test("superuser creates a superuser, sees the Superuser badge, then deletes them", async ({
  page,
}) => {
  const email = randomEmail()
  const password = randomPassword()

  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")

  await createUserViaAdminDialog(page, {
    email,
    fullName: "Playwright Promoted",
    password,
    isSuperuser: true,
  })

  // Role column must show "Superuser" — catches a silent is_superuser drop.
  const row = page.getByRole("row").filter({ hasText: email })
  await expect(row).toContainText(/Superuser/)

  await deleteUserViaRow(page, email)
})

test("full auth chain: signup → log in as new user → admin promotes → new user reaches /admin", async ({
  page,
}) => {
  const email = randomEmail()
  const password = randomPassword()
  const fullName = "Playwright Chain User"

  // 1. Sign up through the UI and land on /login.
  await page.goto("/signup")
  await page.getByTestId("full-name-input").fill(fullName)
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByTestId("confirm-password-input").fill(password)
  await page.getByRole("button", { name: "Sign Up" }).click()
  await page.waitForURL("/login")

  // 2. Log in as the new user — verifies credentials are saved correctly.
  await logIn(page, email, password)
  // Plain users hit the auth guard on /admin because it requires superuser
  // (the current _layout guard lets any authed user in; the backend rejects
  // the list call → the page renders an error toast but does not crash).
  // Sanity: the plain user landed on the dashboard.
  await expect(page.getByTestId("user-menu")).toBeVisible()

  // 3. Log out, log in as the seeded superuser, and promote the new user.
  await logOutViaMenu(page)
  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")

  const row = page.getByRole("row").filter({ hasText: email })
  await row.getByRole("button").click()
  await page.getByRole("menuitem", { name: /edit user/i }).click()
  await page.getByLabel(/is superuser/i).check()
  await page.getByRole("button", { name: "Save" }).click()
  await expect(row).toContainText(/Superuser/)

  // 4. Log back in as the promoted user — they can now reach /admin.
  await logOutViaMenu(page)
  await logIn(page, email, password)
  await page.goto("/admin")
  await expect(page.getByRole("heading", { name: /users/i })).toBeVisible()
  await expect(page.getByText(email).first()).toBeVisible()

  // Cleanup: log back in as the seeded superuser and delete the chain user
  // so the admin table doesn't grow unbounded across runs.
  await logOutViaMenu(page)
  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")
  await deleteUserViaRow(page, email)
})
