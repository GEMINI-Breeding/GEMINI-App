/**
 * Phase 6 coverage for the non-bin upload path.
 *
 * Exercises the same UploadZone/UploadList/useUploadQueue chain as the
 * Amiga spec, but with two drone JPGs — no follow-up EXTRACT_BINARY job
 * fires, so the ProcessPanel title resolves to "Uploaded N file(s)"
 * and Manage Data shows the images immediately under Raw/.
 *
 * This guards the `followUpJob: { kind: "none" }` branch in
 * UploadList.tsx and the `uploadOne` → uploaded list path in
 * useUploadQueue.ts — a regression that only affected plain uploads
 * would silently break everything except the Amiga flow otherwise.
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

test.describe("Image upload (non-bin path)", () => {
  // Default 30s is too tight: the helper waits up to ~120s for "Done"
  // plus the follow-up Manage assertion.
  test.setTimeout(300_000)

  test("upload two JPGs, see them appear under Raw/ in Manage Data", async ({
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

    // Manage tab now lists experiments (DB-entity browser). Expand the
    // experiment row to see its files. Match each FileRow by its
    // `data-testid="download-<object_name>"` attribute (carrying the
    // full MinIO path scoped to our experiment slug) rather than
    // fuzzy text — guards against the filename appearing as a
    // substring elsewhere.
    await page.locator('[data-onboarding="files-tab-manage"]').click()
    await page.locator('[data-testid="manage-data-filter"]').fill(experiment)
    const expRow = page.locator(
      `[data-testid="manage-data-experiment-${experiment}"]`,
    )
    await expect(expRow).toBeVisible({ timeout: 30_000 })
    await expRow.getByRole("button", { name: "Expand" }).click()

    const list = page.locator('[data-testid="manage-data-list"]')
    await expect(
      list.locator(
        `[data-testid^="download-"][data-testid*="${experiment}"][data-testid$="/test_image_001.jpg"]`,
      ),
    ).toBeVisible({ timeout: 60_000 })
    await expect(
      list.locator(
        `[data-testid^="download-"][data-testid*="${experiment}"][data-testid$="/test_image_002.jpg"]`,
      ),
    ).toBeVisible()
  })
})
