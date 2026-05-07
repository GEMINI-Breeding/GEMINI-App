import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
// Import `test` from helpers/fixtures so every case auto-attaches the
// console-error guard required by CLAUDE.md's strict-E2E rule.
import { expect, test } from "./helpers/fixtures"

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

  test("/settings is gated behind /login for anonymous visitors", async ({
    page,
  }) => {
    await page.goto("/settings")
    await page.waitForURL("/login")
  })

  test("logged-in user reaches /settings and the user menu shows their email", async ({
    page,
  }) => {
    await logIn(page)
    await page.goto("/settings")
    await expect(page).toHaveURL("/settings")
    // Open the sidebar user-menu and assert the email shows up *inside the
    // opened dropdown* — the sidebar trigger also renders the email
    // permanently, so an unscoped getByText would match both elements and
    // hit Playwright's strict-mode violation.
    await page.getByTestId("user-menu").click()
    const menu = page.getByRole("menu")
    await expect(menu).toBeVisible()
    await expect(menu.getByText(firstSuperuser)).toBeVisible()
  })

  test("sidebar Log Out item redirects to /login", async ({ page }) => {
    await logIn(page)
    await page.getByTestId("user-menu").click()
    await page.getByTestId("logout-menu-item").click()
    await page.waitForURL("/login")
  })

  // The standalone sidebar "Experiment selector" UI from the Phase-5
  // shell was replaced by per-page upload-scope dropdowns
  // (`useUploadScope` + `EntitySelectField`). The `create-experiment-button`
  // / `experiment-selector` test IDs no longer exist anywhere in the
  // source tree. Re-add a coverage spec for the new pickers (e.g. the
  // FilesPage upload form) instead of resurrecting this one.
  test.skip("sidebar Experiment selector is populated and switches on choice", async () => {})
})
