/**
 * Phase 6 exit-criterion verification: upload an Amiga `.bin`, wait for
 * the EXTRACT_BINARY job to reach terminal state, and confirm the FLIR
 * worker actually decoded the file.
 *
 * This is the "extraction side" of the flow that amiga-upload.spec.ts
 * deliberately skips. It's slow (the amiga worker has to decode the
 * fixture end-to-end), so the timeouts are intentionally generous.
 *
 * Strict-E2E rules (CLAUDE.md):
 *   - Drives only the real UI — no API seeding.
 *   - Console-error guard attached via the fixture.
 *   - Verifies user-visible outcomes: ProcessPanel "Done", files in
 *     Manage, AND report.txt content proves the per-file decode loop
 *     was actually entered (not just the up-front skeleton).
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

// The amiga worker is torch/kornia heavy — the first run inside a cold
// container can take a minute or two on the test fixture. Budget for it.
const EXTRACTION_TIMEOUT_MS = 5 * 60_000

test.describe("Amiga .bin full extraction", () => {
  test.setTimeout(EXTRACTION_TIMEOUT_MS + 60_000)

  test("upload .bin → EXTRACT_BINARY reaches Done → extracted files appear", async ({
    page,
    request,
    baseURL,
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

    // submitUploadAndWait both confirms the "Processing 1 .bin file"
    // title (unified single-bar UX, Phase 9k) and then waits for the
    // terminal "Done" message that ProcessContext writes when the
    // EXTRACT_BINARY job reaches COMPLETED via wsManager.
    await submitUploadAndWait(page, 1, { timeoutMs: EXTRACTION_TIMEOUT_MS })

    // The amiga worker writes its outputs back under Raw/ (sibling to the
    // Amiga/ input directory) and deletes the original .bin. Manage Data
    // already opens on Raw/, so we just filter to the new experiment slug
    // and assert three things:
    //   1. report.txt — exists in the listing.
    //   2. report.txt CONTENT — contains the per-file `--- File: <name>
    //      ---` marker that bin_to_images.py only writes inside the decode
    //      loop. report.txt's skeleton is written before decoding, so
    //      asserting only its presence would not distinguish "extraction
    //      ran end-to-end" from "extraction crashed before any files were
    //      processed."
    //   3. The original .bin is GONE — confirms the worker's MinIO cleanup
    //      step ran (worker removes processed inputs to avoid re-extraction).
    await page.locator('[data-onboarding="files-tab-manage"]').click()
    await page.locator('[data-testid="manage-data-filter"]').fill(experiment)
    // Manage tab now lists experiments; expand the row to see its files.
    const expRow = page.locator(
      `[data-testid="manage-data-experiment-${experiment}"]`,
    )
    await expect(expRow).toBeVisible({ timeout: 30_000 })
    await expRow.getByRole("button", { name: "Expand" }).click()

    // FileRow encodes the full object_name in `data-testid="download-<obj>"`,
    // so the button matching `…/report.txt` for our experiment slug uniquely
    // identifies the row. Wait for it to appear, then recover the path.
    const downloadBtn = page
      .locator('[data-testid="manage-data-list"]')
      .locator(
        `[data-testid^="download-"][data-testid*="${experiment}"][data-testid$="/report.txt"]`,
      )
    await expect(downloadBtn).toBeVisible({ timeout: 60_000 })
    const objectName = await downloadBtn.evaluate((el) =>
      (el.getAttribute("data-testid") ?? "").replace(/^download-/, ""),
    )
    expect(objectName).toMatch(new RegExp(`${experiment}.*report\\.txt$`))

    // Fetch the file through the same authenticated download endpoint the
    // UI uses (path is `<bucket>/<object_name>`). Read storageState to
    // get the bearer token the e2e-setup project seeded.
    const auth = await page.context().storageState()
    const token =
      auth.origins
        .flatMap((o) => o.localStorage)
        .find((e) => e.name === "gemini.auth.token")?.value ?? ""
    expect(token, "Bearer token must be in storage state").not.toBe("")

    if (!baseURL) throw new Error("baseURL is not configured")
    const reportResp = await request.get(
      new URL(`/api/files/download/gemini/${objectName}`, baseURL).toString(),
      { headers: { Authorization: `Bearer ${token}` } },
    )
    expect(reportResp.status()).toBe(200)
    const reportBody = await reportResp.text()

    // Skeleton lines (always present, even if decoding never started).
    expect(reportBody).toMatch(/Number of files:\s*1/)
    // Per-file marker — only written inside the decode loop. This is the
    // line that distinguishes "ran end-to-end" from "set up and crashed."
    expect(reportBody).toContain(`--- File: `)
    expect(reportBody).toContain(binName)

    await expect(
      page.locator('[data-testid="manage-data-list"]').getByText(binName),
    ).toHaveCount(0)
  })
})
