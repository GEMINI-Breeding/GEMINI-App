/**
 * Phase 6 flagship flow: upload an Amiga `.bin` file through the real UI
 * and watch it drop onto MinIO + kick off an EXTRACT_BINARY job.
 *
 * Strict-E2E rules (CLAUDE.md):
 *   - only drives the real UI (no API seeding)
 *   - listens for console errors via the fixture-attached guard
 *   - asserts user-visible outcomes: the file lands under Raw/ in Manage
 *     Data after the upload completes.
 */
import { expect, test } from "../helpers/fixtures"
import { fixturePath } from "../helpers/fixturePath"
import {
  dropFiles,
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"

test.describe("Amiga .bin upload", () => {
  test("upload a .bin, see it land under Raw/ in Manage Data", async ({
    page,
  }) => {
    const stamp = Date.now()
    const experiment = `pw-exp-${stamp}`
    const location = `loc-${stamp}`
    const population = `pop-${stamp}`
    const date = "2026-04-24"

    await navigateToUpload(page)
    await selectDataType(page, "Farm-ng Binary File")
    await fillUploadForm(page, { experiment, location, population, date })

    const binPath = fixturePath("binary", "test_amiga.0000.bin")
    await dropFiles(page, [binPath])

    // Skip the terminal "Done" wait — that covers the EXTRACT_BINARY
    // follow-up job, which is exercised separately in amiga-extraction.
    // Here we only care that the upload itself reaches MinIO.
    await submitUploadAndWait(page, 1, { waitForDone: false })

    // Manage tab should list the uploaded file under its generated Raw/ path.
    // Match by the FileRow's `data-testid="download-<object_name>"` (full
    // MinIO path scoped to our experiment slug) rather than fuzzy text.
    await page.locator('[data-onboarding="files-tab-manage"]').click()
    await page
      .locator('[data-testid="manage-data-filter"]')
      .fill(experiment)

    await expect(
      page
        .locator('[data-testid="manage-data-list"]')
        .locator(
          `[data-testid^="download-"][data-testid*="${experiment}"][data-testid$="/test_amiga.0000.bin"]`,
        ),
    ).toBeVisible({ timeout: 60_000 })
  })
})
