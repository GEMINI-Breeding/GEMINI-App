import { expect, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { randomEmail, randomPassword } from "./utils/random"

/**
 * Phase 5.1 admin-page coverage. Uses only the real UI — no seeding.
 * Superuser logs in, creates a user, sees it in the table, and deletes it.
 */

async function logIn(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login")
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByRole("button", { name: "Log In" }).click()
  await page.waitForURL("/")
}

test.use({ storageState: { cookies: [], origins: [] } })

test("superuser can open /admin and see the users table", async ({ page }) => {
  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")
  await expect(page).toHaveURL("/admin")
  await expect(page.getByRole("heading", { name: /users/i })).toBeVisible()
  // The seeded superuser row must be present.
  await expect(page.getByText(firstSuperuser).first()).toBeVisible()
})

test("superuser creates a new user, sees it in the table, then deletes it", async ({
  page,
}) => {
  const email = randomEmail()
  const password = randomPassword()

  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")

  await page.getByRole("button", { name: /add user/i }).click()
  await page.getByPlaceholder("Email").fill(email)
  await page.getByPlaceholder("Full name").fill("Playwright Admin Smoke")
  await page.getByPlaceholder("Password").first().fill(password)
  await page.getByPlaceholder("Password").nth(1).fill(password)
  await page.getByRole("button", { name: "Save" }).click()

  await expect(page.getByText(email).first()).toBeVisible()

  // Delete via the row action menu.
  const row = page.getByRole("row").filter({ hasText: email })
  await row.getByRole("button").click()
  await page.getByRole("menuitem", { name: /delete user/i }).click()
  await page.getByRole("button", { name: "Delete" }).click()
  await expect(page.getByText(email)).not.toBeVisible()
})
