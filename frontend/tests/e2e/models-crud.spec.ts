/**
 * Phase 8 strict-E2E: Models registry CRUD via the real /models page.
 *
 * Drives the new ModelsDashboard against the live GEMINIbase REST API:
 *   - navigate to /models, see the table render,
 *   - click Add model, fill name/Roboflow id/task, save → see the row,
 *   - click the star → "best" badge appears in the row,
 *   - edit the row, change the Roboflow id, save → see the change,
 *   - delete the row → confirm → see it vanish.
 *
 * Why not also drive InferencePage end-to-end? The LOCATE_PLANTS worker
 * needs (a) per-plot PNGs already produced by SPLIT_ORTHOMOSAIC and
 * (b) a real Roboflow API key — both are out of band for the migration
 * branch's automated suite. Coverage of those happens during Phase 15
 * hardening once the stitch+Roboflow pieces are wired.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Models registry CRUD", () => {
  test.setTimeout(60_000)

  test("add → promote-best → edit → delete a model via the real UI", async ({ page }) => {
    const stamp = Date.now()
    const initialName = `pw-model-${stamp}`
    const renamedRoboflowId = `pw/test/${stamp}`

    await page.goto("/models")
    await expect(
      page.getByRole("heading", { name: /^models$/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })

    // 1. Add
    await page.getByTestId("model-add").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByTestId("model-field-name").fill(initialName)
    await page.getByTestId("model-field-roboflow-id").fill("pw/test/initial")
    await page.getByTestId("model-field-description").fill("Phase 8 spec")
    await page.getByTestId("model-add-save").click()

    const newRow = page.locator('[data-testid="model-row"]', { hasText: initialName })
    await expect(newRow).toBeVisible({ timeout: 10_000 })

    // 2. Promote best — toggles model_info.best_model_path on the backend
    //    and re-renders with the "best" badge in the row.
    await newRow.getByTestId("model-promote").click()
    await expect(newRow.locator("text=best")).toBeVisible({ timeout: 10_000 })

    // 3. Edit — change Roboflow id, save, see the new id render.
    await newRow.getByTestId("model-edit").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    const idField = page.getByTestId("model-field-roboflow-id")
    await idField.fill(renamedRoboflowId)
    await page.getByTestId("model-edit-save").click()
    // Row updates in place; the new Roboflow id renders in the table.
    await expect(
      page.locator('[data-testid="model-row"]', { hasText: initialName })
        .locator(`text=${renamedRoboflowId}`),
    ).toBeVisible({ timeout: 10_000 })

    // 4. Delete
    const finalRow = page.locator('[data-testid="model-row"]', { hasText: initialName })
    await finalRow.getByTestId("model-delete").click()
    await page.getByTestId("model-delete-confirm").click()
    await expect(finalRow).toHaveCount(0, { timeout: 10_000 })
  })
})
