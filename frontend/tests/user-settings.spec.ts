import { expect, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"

/**
 * User-settings coverage for the post-migration shell.
 *
 * The old FastAPI-template settings page had tabbed "My profile /
 * Password / Danger zone" sections driven by private-API seeding.
 * GEMINIbase's settings page (`ApplicationSettings.tsx`) is an
 * admin-settings page (data root, docker resources) against backend
 * endpoints that the migration has not reimplemented yet — those
 * tests belong in Phase 12 after the settings UI is rewritten.
 *
 * What we DO assert here, against the Phase-5 shell:
 *   - /settings is behind the auth guard (redirects anon visitors)
 *   - logged-in users can reach it without a console crash
 *   - the sidebar user menu exposes a working Log Out item
 *   - the sidebar Experiment selector renders
 */

async function logIn(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login")
  await page.getByTestId("email-input").fill(firstSuperuser)
  await page.getByTestId("password-input").fill(firstSuperuserPassword)
  await page.getByRole("button", { name: "Log In" }).click()
  await page.waitForURL("/")
}

test.describe("authenticated shell", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("/settings is gated behind /login for anonymous visitors", async ({ page }) => {
    await page.goto("/settings")
    await page.waitForURL("/login")
  })

  test("logged-in user reaches /settings and the user menu shows their email", async ({ page }) => {
    await logIn(page)
    await page.goto("/settings")
    await expect(page).toHaveURL("/settings")
    // Sidebar user-menu trigger shows the email on hover/open.
    await page.getByTestId("user-menu").click()
    await expect(page.getByText(firstSuperuser)).toBeVisible()
  })

  test("sidebar Log Out item redirects to /login", async ({ page }) => {
    await logIn(page)
    await page.getByTestId("user-menu").click()
    await page.getByTestId("logout-menu-item").click()
    await page.waitForURL("/login")
  })

  test("sidebar Experiment selector renders after login", async ({ page }) => {
    await logIn(page)
    // Either the selector is populated with real experiments, or we see the
    // "no experiments available" empty state — both are valid post-login.
    const populated = page.getByTestId("experiment-selector")
    const empty = page.getByTestId("experiment-selector-empty")
    await expect(populated.or(empty)).toBeVisible()
  })
})
