/**
 * Strict-E2E: Process workspaces live on the server, not in one browser.
 *
 * They used to be kept only in localStorage — lost when site data was
 * cleared and invisible to a colleague or a second machine. A workspace
 * created here must appear in a separate browser context that has never
 * seen it (fresh storage, same login), and a delete must reach it too.
 *
 * Console-error guard auto-attached to `page` via tests/helpers/fixtures.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Process state is shared through the server", () => {
  test("a workspace made in one browser appears, and is deleted, in another", async ({
    page,
    browser,
    runPrefix,
  }) => {
    const name = `${runPrefix}-shared-ws`

    // ── 1. Create it in this browser. ───────────────────────────────────
    await page.goto("/process")
    await page.locator('[data-onboarding="process-new-workspace"]').click()
    await page.getByLabel(/workspace name/i).fill(name)
    const saved = page.waitForResponse(
      (r) =>
        r.url().includes("/api/process_state/workspace/") &&
        r.request().method() === "PUT" &&
        r.ok(),
    )
    await page.getByRole("button", { name: /create workspace/i }).click()
    await saved
    await expect(page.getByTestId(`workspace-card-${name}`)).toBeVisible()

    // ── 2. A second browser (own storage, same sign-in) sees it. ────────
    const signedIn = test.info().project.use.storageState as string
    const other = await browser.newContext({ storageState: signedIn })
    const otherPage = await other.newPage()
    try {
      await otherPage.goto("/process")
      await expect(otherPage.getByTestId(`workspace-card-${name}`)).toBeVisible(
        { timeout: 15_000 },
      )
      // Nothing about it came from local storage.
      const localCopy = await otherPage.evaluate(() =>
        localStorage.getItem("gemini.process.outbox.v1"),
      )
      expect(localCopy ?? "").not.toContain(name)

      // ── 3. Delete it here; the other browser loses it on reload. ──────
      const card = page.getByTestId(`workspace-card-${name}`)
      await card.getByRole("button", { name: "Workspace actions" }).click()
      await page.getByRole("menuitem", { name: "Delete" }).click()
      const deleted = page.waitForResponse(
        (r) =>
          r.url().includes("/api/process_state/workspace/") &&
          r.request().method() === "DELETE" &&
          r.ok(),
      )
      await page.getByRole("button", { name: "Delete", exact: true }).click()
      await deleted
      await expect(card).toBeHidden()

      const reloaded = otherPage.waitForResponse(
        (r) => r.url().endsWith("/api/process_state") && r.ok(),
      )
      await otherPage.reload()
      await reloaded
      await expect(otherPage.getByTestId(`workspace-card-${name}`)).toBeHidden()
    } finally {
      await other.close()
    }
  })
})
