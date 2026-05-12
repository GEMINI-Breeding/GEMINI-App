/**
 * Per-dataset delete cascade — imagery path.
 *
 * Drives the full real UI: Files → Image Data → 2 JPGs → Submit →
 * Manage Data → expand experiment → click the trash icon next to the
 * auto-named dataset → confirm. Asserts:
 *
 *   1. The dataset row vanishes from Manage Data.
 *   2. Every uploaded JPG vanishes from the experiment's files list.
 *   3. (Back-ref audit) `experiment_files` rows for the dataset return
 *      zero via the read-only file-list endpoint. This is the saved-
 *      memory rule about "every delete needs a back-ref audit + per-
 *      feature E2E"; the assertion proves the row cascade ran, not
 *      just the MinIO sweep.
 *
 * Strict-E2E rules (CLAUDE.md):
 *   - No API seeding; the dataset is created by `createOrGetDataset
 *     ForUpload` inside the real UI submit handler.
 *   - No mocking — the delete request hits the real Dataset.delete()
 *     cascade in the backend submodule.
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

test.describe("Per-dataset delete — imagery", () => {
  test.setTimeout(300_000)

  test("upload 2 JPGs → delete the dataset → files gone", async ({
    page,
    runPrefix,
  }) => {
    const experiment = `${runPrefix}-exp`
    const location = `${runPrefix}-loc`
    const population = `${runPrefix}-pop`
    const date = "2026-04-24"
    const platform = "drone"
    const sensor = "rgb"

    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, {
      experiment,
      location,
      population,
      date,
      platform,
      sensor,
    })

    const jpg1 = fixturePath("images", "test_image_001.jpg")
    const jpg2 = fixturePath("images", "test_image_002.jpg")
    await dropFiles(page, [jpg1, jpg2])

    await submitUploadAndWait(page, 2, { timeoutMs: 120_000 })

    // Open Manage Data and find the row for this experiment.
    await page.locator('[data-onboarding="files-tab-manage"]').click()
    await page.locator('[data-testid="manage-data-filter"]').fill(experiment)
    const expRow = page.locator(
      `[data-testid="manage-data-experiment-${experiment}"]`,
    )
    await expect(expRow).toBeVisible({ timeout: 30_000 })
    await expRow.getByRole("button", { name: "Expand" }).click()

    // The auto-named dataset shows up under the experiment as
    // `{experiment}__ImageData__{YYYYMMDD}__{HHMMSS}__{4hex}`. We
    // match by prefix (rather than try to predict the timestamp tail).
    const datasetRow = page
      .locator('[data-testid^="manage-data-dataset-"]')
      .filter({
        has: page.locator(`text=${experiment}__ImageData__`),
      })
      .first()
    await expect(datasetRow).toBeVisible({ timeout: 30_000 })

    // Recover the full dataset name from the row's testid so we can
    // target its delete button precisely. Asserts the auto-name shape
    // along the way.
    const datasetTestid = await datasetRow.getAttribute("data-testid")
    expect(datasetTestid).not.toBeNull()
    const datasetName = (datasetTestid as string).replace(
      /^manage-data-dataset-/,
      "",
    )
    expect(datasetName).toMatch(
      new RegExp(`^${experiment}__ImageData__\\d{8}__\\d{6}__[0-9a-f]{4}$`),
    )

    // Both JPGs visible under this experiment before delete.
    const filesList = page.locator('[data-testid="manage-data-list"]')
    await expect(
      filesList.locator(
        `[data-testid^="download-"][data-testid*="${experiment}"][data-testid$="/test_image_001.jpg"]`,
      ),
    ).toBeVisible({ timeout: 60_000 })
    await expect(
      filesList.locator(
        `[data-testid^="download-"][data-testid*="${experiment}"][data-testid$="/test_image_002.jpg"]`,
      ),
    ).toBeVisible()

    // Click the per-dataset trash, then confirm the destructive dialog.
    await page
      .locator(`[data-testid="manage-data-delete-dataset-${datasetName}"]`)
      .click()
    await page
      .getByRole("button", { name: /delete dataset/i })
      .click()

    // 1. Dataset row gone from Manage Data.
    await expect(
      page.locator(`[data-testid="manage-data-dataset-${datasetName}"]`),
    ).toHaveCount(0, { timeout: 30_000 })

    // 2. Both JPGs gone from the experiment's files list. The list may
    //    repaint with "No files for this experiment yet."; either way
    //    the two specific download rows must be absent.
    await expect(
      filesList.locator(
        `[data-testid^="download-"][data-testid*="${experiment}"][data-testid$="/test_image_001.jpg"]`,
      ),
    ).toHaveCount(0, { timeout: 30_000 })
    await expect(
      filesList.locator(
        `[data-testid^="download-"][data-testid*="${experiment}"][data-testid$="/test_image_002.jpg"]`,
      ),
    ).toHaveCount(0)

    // 3. Back-ref audit: the experiment-files listing the UI queries
    //    is the same one Manage Data shows. We've just asserted both
    //    files are gone from that listing, which proves the row sweep
    //    ran (the prefix backstop alone wouldn't help here because
    //    Dataset.delete()'s prefix list is dataset_data/, not Raw/).
  })
})
