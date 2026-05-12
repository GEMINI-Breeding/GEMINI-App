/**
 * Per-dataset delete cascade — farm-ng `.bin` extraction path.
 *
 * Hardest case: the amiga worker writes hundreds of `Processed/.../{RGB,
 * Disparity}/...` outputs and must register each as an experiment_files
 * row claiming the same dataset id that the frontend created before
 * EXTRACT_BINARY submission. The per-dataset delete must then sweep
 * every one of those rows + their MinIO objects.
 *
 * Asserts:
 *   1. The amiga worker registered its outputs (report.txt shows up in
 *      Manage Data — same as `amiga-extraction.spec.ts` already proves).
 *   2. Per-dataset trash icon visible next to the auto-named dataset.
 *   3. After confirm: dataset row gone, report.txt gone, the original
 *      `.bin`'s row is gone (the worker's cleanup step uses the new
 *      /api/files/unregister endpoint).
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

const EXTRACTION_TIMEOUT_MS = 5 * 60_000

test.describe("Per-dataset delete — amiga .bin extraction", () => {
  test.setTimeout(EXTRACTION_TIMEOUT_MS + 120_000)

  test("upload .bin → extract → delete dataset → all outputs gone", async ({
    page,
    runPrefix,
  }) => {
    const experiment = `${runPrefix}-exp`
    const location = `${runPrefix}-loc`
    const population = `${runPrefix}-pop`
    const date = "2026-04-24"
    const binName = "test_amiga.0000.bin"

    await navigateToUpload(page)
    await selectDataType(page, "Farm-ng Binary File")
    await fillUploadForm(page, { experiment, location, population, date })
    await dropFiles(page, [fixturePath("binary", binName)])
    await submitUploadAndWait(page, 1, { timeoutMs: EXTRACTION_TIMEOUT_MS })

    // Open Manage Data, find the auto-named dataset.
    await page.locator('[data-onboarding="files-tab-manage"]').click()
    await page.locator('[data-testid="manage-data-filter"]').fill(experiment)
    const expRow = page.locator(
      `[data-testid="manage-data-experiment-${experiment}"]`,
    )
    await expect(expRow).toBeVisible({ timeout: 30_000 })
    await expRow.getByRole("button", { name: "Expand" }).click()

    const datasetRow = page
      .locator('[data-testid^="manage-data-dataset-"]')
      .filter({
        has: page.locator(`text=${experiment}__FarmngBinaryFile__`),
      })
      .first()
    await expect(datasetRow).toBeVisible({ timeout: 30_000 })
    const datasetTestid = await datasetRow.getAttribute("data-testid")
    const datasetName = (datasetTestid as string).replace(
      /^manage-data-dataset-/,
      "",
    )
    expect(datasetName).toMatch(
      new RegExp(
        `^${experiment}__FarmngBinaryFile__\\d{8}__\\d{6}__[0-9a-f]{4}$`,
      ),
    )

    // Amiga worker output marker: report.txt under our experiment.
    const filesList = page.locator('[data-testid="manage-data-list"]')
    await expect(
      filesList.locator(
        `[data-testid^="download-"][data-testid*="${experiment}"][data-testid$="/report.txt"]`,
      ),
    ).toBeVisible({ timeout: 60_000 })

    // Click trash → confirm.
    await page
      .locator(`[data-testid="manage-data-delete-dataset-${datasetName}"]`)
      .click()
    await page.getByRole("button", { name: /delete dataset/i }).click()

    // Dataset row gone.
    await expect(
      page.locator(`[data-testid="manage-data-dataset-${datasetName}"]`),
    ).toHaveCount(0, { timeout: 60_000 })

    // report.txt (worker output) gone. If this fails, the worker
    // didn't register its outputs against the dataset_id and they
    // leaked.
    await expect(
      filesList.locator(
        `[data-testid^="download-"][data-testid*="${experiment}"][data-testid$="/report.txt"]`,
      ),
    ).toHaveCount(0, { timeout: 60_000 })

    // The original .bin was already removed by the worker's cleanup
    // step; with the new /api/files/unregister wiring its row is gone
    // too, so this filename should never appear under the experiment.
    await expect(
      filesList.locator(
        `[data-testid^="download-"][data-testid$="/${binName}"]`,
      ),
    ).toHaveCount(0)
  })
})
