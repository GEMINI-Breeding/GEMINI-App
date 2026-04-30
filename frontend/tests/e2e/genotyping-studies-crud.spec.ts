/**
 * Phase 9a strict-E2E: Genotyping Studies CRUD against a live GEMINIbase
 * stack.
 *
 * Drives /genotyping end-to-end (no mocking, no SDK seeding):
 *   1. Navigate to /genotyping, dashboard renders.
 *   2. Add a study via the dialog → wait for POST /api/genotyping_studies →
 *      reload → assert the row is still there (proves backend persistence,
 *      not just optimistic UI).
 *   3. Click into the row → /genotyping/$studyId loads → header shows the
 *      study name → Records / Variants / GWAS placeholders are visible
 *      (proves the route + tabs wire up).
 *   4. Navigate back, Edit the study (rename) → wait for PATCH → reload →
 *      assert the new name persists.
 *   5. Delete with cancel-then-confirm: cancel restores the row; confirm
 *      removes it; reload to prove the DELETE hit the DB.
 *
 * Per CLAUDE.md: console-error guard auto-attached via tests/helpers/fixtures;
 * every mutation is followed by a network-response wait + page reload + DOM
 * re-assert.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Phase 9a: Genotyping Studies CRUD", () => {
  test.setTimeout(120_000)

  test("add → navigate → edit → delete a study via the real UI", async ({
    page,
  }) => {
    const stamp = Date.now()
    const initialName = `pw-study-${stamp}`
    const renamedName = `pw-study-${stamp}-renamed`

    // Sidebar entry visible (not on the original main, so the regression
    // here would be that the nav config didn't pick up the new entry).
    await page.goto("/genotyping")
    await expect(
      page.getByRole("heading", { name: /genotyping studies/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })

    // ── Add ────────────────────────────────────────────────────────────
    await page.getByTestId("genotyping-add-study").click()
    await expect(page.getByRole("dialog")).toBeVisible()

    await page
      .locator("#entity-field-study_name")
      .fill(initialName)

    const createReq = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/genotyping_studies") &&
        r.request().method() === "POST" &&
        r.status() < 400,
    )
    await page.getByTestId("genotyping-study-save").click()
    await createReq

    const initialRow = page.locator("tr", { hasText: initialName })
    await expect(initialRow).toBeVisible({ timeout: 10_000 })

    // Reload — this proves the row is in the DB, not just in TanStack-Query
    // cache after a successful POST that didn't actually persist.
    await page.reload()
    await expect(page.locator("tr", { hasText: initialName })).toBeVisible({
      timeout: 10_000,
    })

    // ── Navigate to detail page ────────────────────────────────────────
    const linkRow = page.locator("tr", { hasText: initialName })
    await linkRow.getByTestId("genotyping-study-link").click()
    await expect(
      page.getByTestId("genotyping-study-title"),
    ).toContainText(initialName, { timeout: 10_000 })

    // The placeholders for Phase 9b/9c/9d aren't all rendered until the
    // user clicks the corresponding tab (Radix lazy-renders TabsContent).
    // Clicking Records / Variants / GWAS asserts each placeholder shows.
    await page.getByRole("tab", { name: /records/i }).click()
    await expect(
      page.getByTestId("genotyping-study-records-placeholder"),
    ).toBeVisible()

    await page.getByRole("tab", { name: /variants/i }).click()
    await expect(
      page.getByTestId("genotyping-study-variants-placeholder"),
    ).toBeVisible()

    await page.getByRole("tab", { name: /gwas/i }).click()
    await expect(
      page.getByTestId("genotyping-study-gwas-placeholder"),
    ).toBeVisible()

    // Back to dashboard.
    await page.goto("/genotyping")
    await expect(page.locator("tr", { hasText: initialName })).toBeVisible({
      timeout: 10_000,
    })

    // ── Edit ───────────────────────────────────────────────────────────
    const renameRow = page.locator("tr", { hasText: initialName })
    await renameRow.getByTestId("genotyping-study-edit").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    const nameInputEdit = page.locator("#entity-field-study_name")
    await nameInputEdit.fill(renamedName)

    const updateReq = page.waitForResponse(
      (r) =>
        /\/api\/genotyping_studies\/id\/[^/]+$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "PATCH" &&
        r.status() < 400,
    )
    await page.getByTestId("genotyping-study-save").click()
    await updateReq

    await expect(page.locator("tr", { hasText: renamedName })).toBeVisible({
      timeout: 10_000,
    })
    // The original-name row must be gone (optimistic UI dropping the wrong
    // row would leave it visible until a refetch — caught by reload).
    await page.reload()
    await expect(page.locator("tr", { hasText: renamedName })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator("tr", { hasText: initialName })).toHaveCount(0)

    // ── Delete (cancel first, then confirm) ────────────────────────────
    const renamedRow = page.locator("tr", { hasText: renamedName })
    await renamedRow.getByTestId("genotyping-study-delete").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: /^cancel$/i }).click()
    // Cancel must NOT delete — the row must still be there.
    await expect(page.locator("tr", { hasText: renamedName })).toBeVisible()

    // Now actually delete.
    await renamedRow.getByTestId("genotyping-study-delete").click()
    const deleteReq = page.waitForResponse(
      (r) =>
        /\/api\/genotyping_studies\/id\/[^/]+$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "DELETE" &&
        r.status() < 400,
    )
    await page.getByTestId("genotyping-study-delete-confirm").click()
    await deleteReq

    await expect(page.locator("tr", { hasText: renamedName })).toHaveCount(0, {
      timeout: 10_000,
    })

    // Reload — proves the DELETE hit the DB, not just dropped local state.
    await page.reload()
    await expect(page.locator("tr", { hasText: renamedName })).toHaveCount(0, {
      timeout: 10_000,
    })
  })
})
