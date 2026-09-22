/**
 * Strict-E2E for duplicate detection on upload (Skip / Replace / Cancel).
 *
 * Uploads write to `{scope folder}/{file name}`, so re-uploading a file
 * used to overwrite the stored copy without a word. Now the upload asks
 * first. This spec uploads one image, then that image plus a new one to
 * the same scope: the dialog must name exactly the repeat, and "Skip
 * existing" must upload only the new file. A second attempt with both
 * repeats is cancelled and must upload nothing.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
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

test.describe("Upload — duplicate detection", () => {
  test.setTimeout(240_000)

  test("re-upload asks first; Skip uploads only new files, Cancel uploads none", async ({
    page,
    runPrefix,
  }) => {
    const scope = {
      experiment: `${runPrefix}-dup-exp`,
      location: "Davis",
      population: "Cowpea",
      date: "2024-06-01",
      platform: "DJI",
      sensor: "RGB",
    }
    const jpg1 = fixturePath("images", "test_image_001.jpg")
    const jpg2 = fixturePath("images", "test_image_002.jpg")

    // ── 1. First upload: one image, no prompt. ───────────────────────────
    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, scope)
    await dropFiles(page, [jpg1])
    await submitUploadAndWait(page, 1)
    await expect(page.getByTestId("duplicate-dialog")).toBeHidden()

    // ── 2. The repeat plus a new file: the dialog names only the repeat.
    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, scope)
    await dropFiles(page, [jpg1, jpg2])
    await page.getByTestId("upload-submit").click()
    const dialog = page.getByTestId("duplicate-dialog")
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await expect(dialog).toContainText("1 of 2 files already uploaded")
    await expect(dialog.getByTestId("duplicate-names")).toHaveText(
      "test_image_001.jpg",
    )
    await dialog.getByTestId("duplicate-skip").click()
    // Only the new file goes up.
    await expect(page.getByText(/^Uploading 1 file/i).first()).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText(/^Done$/i).first()).toBeVisible({
      timeout: 120_000,
    })

    // ── 3. Both repeats → Cancel → nothing is uploaded. ──────────────────
    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, scope)
    await dropFiles(page, [jpg1, jpg2])
    const chunks: string[] = []
    page.on("request", (r) => {
      if (r.url().includes("/api/files/upload_chunk")) chunks.push(r.url())
    })
    await page.getByTestId("upload-submit").click()
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await expect(dialog).toContainText("2 of 2 files already uploaded")
    await dialog.getByTestId("duplicate-cancel").click()
    await expect(dialog).toBeHidden()
    await page.waitForTimeout(1500)
    expect(chunks, "Cancel must not upload anything").toEqual([])

    // ── 4. Manage Data shows exactly the two images. ─────────────────────
    await page.locator('[data-onboarding="files-tab-manage"]').click()
    await page.getByTestId("manage-data-filter").fill(scope.experiment)
    const expRow = page.getByTestId(
      `manage-data-experiment-${scope.experiment}`,
    )
    await expect(expRow).toBeVisible({ timeout: 30_000 })
    await expRow.getByRole("button", { name: "Expand" }).click()
    const list = page.getByTestId("manage-data-list")
    await expect(list.locator('[data-testid^="download-"]')).toHaveCount(2, {
      timeout: 30_000,
    })
  })
})
