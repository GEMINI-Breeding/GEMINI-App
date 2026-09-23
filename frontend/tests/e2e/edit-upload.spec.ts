/**
 * Edit an upload's metadata (main's "edit metadata"): fix a wrong date.
 *
 * The date is part of the upload's storage path, so saving moves its
 * files. Checked end to end: Manage Data lists the files under the new
 * date and none under the old, the file count is unchanged, storage holds
 * nothing at the old path, and a new run offers the upload under the new
 * date.
 *
 * Strict-E2E rules (CLAUDE.md): everything through the UI; API calls are
 * reads only.
 */
import { fixturePath } from "../helpers/fixturePath"
import { expect, test } from "../helpers/fixtures"
import {
  dropFiles,
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"

test.describe("Edit upload metadata", () => {
  test.setTimeout(300_000)

  test("change an upload's date → its files move, nothing is lost", async ({
    page,
    request,
    baseURL,
    runPrefix,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const experiment = `${runPrefix}-exp`
    const scope = {
      experiment,
      season: "2026",
      location: `${runPrefix}-loc`,
      population: `${runPrefix}-pop`,
      platform: "drone",
      sensor: "rgb",
    }
    const oldDate = "2026-04-24"
    const newDate = "2026-04-25"

    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, { ...scope, date: oldDate })
    await dropFiles(page, [
      fixturePath("images", "test_image_001.jpg"),
      fixturePath("images", "test_image_002.jpg"),
    ])
    await submitUploadAndWait(page, 2, { timeoutMs: 120_000 })

    await page.locator('[data-onboarding="files-tab-manage"]').click()
    await page.locator('[data-testid="manage-data-filter"]').fill(experiment)
    const expRow = page.locator(
      `[data-testid="manage-data-experiment-${experiment}"]`,
    )
    await expect(expRow).toBeVisible({ timeout: 30_000 })
    await expRow.getByRole("button", { name: "Expand" }).click()
    const datasetRow = page
      .locator('[data-testid^="manage-data-dataset-"]')
      .filter({ has: page.locator(`text=${experiment}__ImageData__`) })
      .first()
    await expect(datasetRow).toContainText("2 files", { timeout: 30_000 })
    const list = page.locator('[data-testid="manage-data-list"]')
    const jpgsUnder = (date: string) =>
      list.locator(
        `[data-testid^="download-"][data-testid*="/${date}/"][data-testid$=".jpg"]`,
      )
    await expect(jpgsUnder(oldDate)).toHaveCount(2)

    // ── Edit: fix the date ───────────────────────────────────────────────
    await datasetRow.getByRole("button", { name: "Edit upload" }).click()
    const dialog = page.getByTestId("edit-upload-dialog")
    await expect(dialog.getByLabel("Date")).toHaveValue(oldDate, {
      timeout: 30_000,
    })
    await expect(dialog.getByLabel("Site")).toHaveValue(scope.location)
    await expect(dialog.getByTestId("edit-upload-save")).toBeDisabled()
    await dialog.getByLabel("Date").fill(newDate)
    await dialog.getByTestId("edit-upload-save").click()
    await expect(page.getByText("Moved 2 files")).toBeVisible({
      timeout: 60_000,
    })
    await expect(dialog).toHaveCount(0)

    await expect(jpgsUnder(newDate)).toHaveCount(2, { timeout: 30_000 })
    await expect(jpgsUnder(oldDate)).toHaveCount(0)
    await expect(datasetRow).toContainText("2 files")
    await expect(datasetRow).toContainText(newDate)

    // Storage: nothing left at the old path (read-only check).
    const auth = await page.context().storageState()
    const token =
      auth.origins
        .flatMap((o) => o.localStorage)
        .find((e) => e.name === "gemini.auth.token")?.value ?? ""
    const oldPrefix = `Raw/${scope.season}/${experiment}/${scope.location}/${scope.population}/${oldDate}/`
    const res = await request.get(
      new URL(`/api/files/list/gemini/${oldPrefix}`, baseURL).toString(),
      { headers: { Authorization: `Bearer ${token}` } },
    )
    expect((await res.json()) as unknown[]).toEqual([])

    // A new run offers the upload under its new date.
    await page.goto("/process")
    await page.locator('[data-onboarding="process-new-workspace"]').click()
    await page.getByLabel(/workspace name/i).fill(`${runPrefix}-ws`)
    await page.getByRole("button", { name: /create workspace/i }).click()
    await page.getByText(`${runPrefix}-ws`, { exact: true }).click()
    await page.getByRole("button", { name: /create aerial pipeline/i }).click()
    await page.getByLabel(/pipeline name/i).fill(`${runPrefix}-pl`)
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /create pipeline/i }).click()
    await page
      .getByRole("button", { name: /new run/i })
      .first()
      .click()
    const rows = page.getByTestId("upload-row").filter({ hasText: experiment })
    await expect(rows.filter({ hasText: newDate })).toHaveCount(1, {
      timeout: 30_000,
    })
    await expect(rows.filter({ hasText: oldDate })).toHaveCount(0)
  })
})
