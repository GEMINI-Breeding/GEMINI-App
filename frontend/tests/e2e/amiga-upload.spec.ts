/**
 * Strict-E2E: an Amiga `.bin` that can't be extracted fails visibly.
 *
 * The extractor only accepts farm-ng's `YYYY_MM_DD_HH_MM_SS_<micros>_<name>`
 * log names. Uploading anything else used to end with an empty report and a
 * green "Done" — the old test fixture (`test_amiga.0000.bin`) never had a
 * single image extracted, and nothing said so. Now the EXTRACT_BINARY job
 * fails and the process panel says why.
 *
 * The happy path — a real log cut that extracts 30 GPS-tagged frames — is
 * amiga-extraction.spec.ts.
 *
 * Strict-E2E rules (CLAUDE.md): real UI only, console-error guard attached.
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

test.describe("Amiga .bin upload", () => {
  test("a .bin with an unusable log name fails and says why", async ({
    page,
    runPrefix,
  }) => {
    const experiment = `${runPrefix}-exp`
    await navigateToUpload(page)
    await selectDataType(page, "Farm-ng Binary File")
    await fillUploadForm(page, {
      experiment,
      location: `${runPrefix}-loc`,
      population: `${runPrefix}-pop`,
      date: "2026-04-24",
    })
    await dropFiles(page, [fixturePath("binary", "test_amiga.0000.bin")])
    // The upload itself succeeds; the follow-up extraction is what fails.
    await submitUploadAndWait(page, 1, { waitForDone: false })

    await expect(page.getByText("Failed", { exact: true }).first()).toBeVisible(
      { timeout: 120_000 },
    )
    await expect(
      page.getByText(/No images could be extracted/).first(),
    ).toBeAttached()
    await expect(
      page.getByText(/File name is not compatible/).first(),
    ).toBeAttached()
    await expect(page.getByText(/^Done$/)).toHaveCount(0)
  })
})
