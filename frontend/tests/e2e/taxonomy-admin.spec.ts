/**
 * Phase 11 strict-E2E: taxonomy admin CRUD on a representative entity.
 *
 * Drives the real /admin/sensor-types page against the real GEMINIbase
 * REST API:
 *   - navigate, see the existing rows render,
 *   - click Add, fill the form, save → see the new row in the table,
 *   - click Edit on the new row, change the name, save → see the change,
 *   - click Delete → confirm → see the row vanish.
 *
 * Per CLAUDE.md: zero mocking, console-error guard via fixtures, asserts
 * on user-visible outcomes. We pick sensor-types because it's a flat
 * entity with the simplest schema, so the spec can run in seconds.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Taxonomy admin: sensor types CRUD", () => {
  test.setTimeout(60_000)

  test("add → edit → delete a sensor type via the real UI", async ({ page }) => {
    const stamp = Date.now()
    const initialName = `pw-st-${stamp}`
    const renamedName = `pw-st-${stamp}-renamed`

    await page.goto("/admin/sensor-types")
    await expect(
      page.getByRole("heading", { name: /sensor types/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })

    // 1. Add
    await page.getByTestId("entity-add").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    const nameField = page.locator("#entity-field-sensor_type_name")
    await nameField.fill(initialName)
    await page.getByRole("button", { name: /^save$/i }).click()

    // The Add dialog closes; the row lands in the table on refetch.
    const initialRow = page.locator("tr", { hasText: initialName })
    await expect(initialRow).toBeVisible({ timeout: 10_000 })

    // 2. Edit
    await initialRow.getByTestId("entity-edit").click()
    const editName = page.locator("#entity-field-sensor_type_name")
    await editName.fill(renamedName)
    await page.getByRole("button", { name: /save changes/i }).click()
    const renamedRow = page.locator("tr", { hasText: renamedName })
    await expect(renamedRow).toBeVisible({ timeout: 10_000 })

    // 3. Delete
    await renamedRow.getByTestId("entity-delete").click()
    await page.getByTestId("entity-delete-confirm").click()
    await expect(renamedRow).toHaveCount(0, { timeout: 10_000 })
  })
})
