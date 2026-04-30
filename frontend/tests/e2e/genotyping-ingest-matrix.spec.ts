/**
 * Phase 9b strict-E2E: Records-tab ingest-matrix flow against the live
 * GEMINIbase REST API.
 *
 * Drives the wizard end-to-end (no SDK seeding):
 *   1. Create the study (via the dashboard Add dialog) so we have a
 *      stable target for the ingest. (Bootstrap/setup; the operation
 *      under test is the matrix upload.)
 *   2. Navigate to the study's Records tab.
 *   3. Click "Upload matrix" → set the file input to a small in-memory
 *      CSV (3 variants × 3 lines).
 *   4. Assert the dialog flips to "preview" with the right counts.
 *   5. Click "Ingest" → wait for POST /ingest-matrix → assert the
 *      result panel shows variants_inserted ≥ 0 and records_inserted ≥ 0.
 *      (We can't assert exact counts because backend behaviour depends
 *      on whether the test accessions exist; both 0 and >0 are valid.)
 *   6. Close the dialog → reload the page → click Records tab again →
 *      assert the table either populates or stays empty depending on
 *      whether the test accessions resolved. Either way, no console
 *      errors.
 *
 * The accession-resolution path is interesting: the backend skips records
 * for unknown accessions and returns them as ingest warnings. The spec
 * tolerates both outcomes because seeding accessions would couple this
 * spec to Phase-11 entity tests.
 */
import { expect, test } from "../helpers/fixtures"

const MATRIX_CSV = [
  "variant_name,chromosome,position,alleles,design_sequence,LINE_A,LINE_B,LINE_C",
  "SNP_001,1,12345,A/G,ACGTACGT,A/A,A/G,G/G",
  "SNP_002,1,23456,C/T,GTGTGTGT,C/T,T/T,C/C",
  "SNP_003,2,1000,A/T,ATATATAT,A/A,T/T,A/T",
].join("\n")

test.describe("Phase 9b: Genotyping records — matrix ingest", () => {
  test.setTimeout(120_000)

  test("upload a CSV matrix → preview → ingest → result panel", async ({
    page,
  }) => {
    const stamp = Date.now()
    const studyName = `pw-ingest-${stamp}`

    // ── Setup: create a fresh study so the spec is self-contained.
    await page.goto("/genotyping")
    await page.getByTestId("genotyping-add-study").click()
    await page.locator("#entity-field-study_name").fill(studyName)
    const createReq = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/genotyping_studies") &&
        r.request().method() === "POST" &&
        r.status() < 400,
    )
    await page.getByTestId("genotyping-study-save").click()
    await createReq

    // ── Navigate into the new study's detail page.
    const studyRow = page.locator("tr", { hasText: studyName })
    await studyRow.getByTestId("genotyping-study-link").click()
    await expect(page.getByTestId("genotyping-study-title")).toContainText(
      studyName,
      { timeout: 10_000 },
    )

    // ── Records tab + upload dialog.
    await page.getByRole("tab", { name: /records/i }).click()
    await page.getByTestId("records-upload-matrix").click()
    await expect(page.getByRole("dialog")).toBeVisible()

    // setInputFiles with an in-memory buffer keeps the spec self-contained
    // (no fixture file on disk).
    await page.getByTestId("ingest-matrix-file").setInputFiles({
      name: "matrix.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(MATRIX_CSV, "utf8"),
    })

    // Preview panel renders — proves the parser ran client-side.
    const preview = page.getByTestId("ingest-matrix-preview")
    await expect(preview).toBeVisible({ timeout: 5000 })
    await expect(preview).toContainText("3 variants")
    await expect(preview).toContainText("3 samples")

    // ── Ingest.
    const ingestReq = page.waitForResponse(
      (r) =>
        /\/api\/genotyping_studies\/id\/[^/]+\/ingest-matrix$/.test(
          new URL(r.url()).pathname,
        ) &&
        r.request().method() === "POST" &&
        r.status() < 500, // 200/400 both ok — accession resolution may warn
    )
    await page.getByTestId("ingest-matrix-submit").click()
    const resp = await ingestReq
    expect(resp.status()).toBeLessThan(500)

    // Result panel renders.
    const result = page.getByTestId("ingest-matrix-result")
    await expect(result).toBeVisible({ timeout: 10_000 })
    // Both Variants inserted and Records inserted lines render even when
    // the values are 0 (e.g. accessions don't exist yet).
    await expect(result).toContainText(/Variants inserted:/i)
    await expect(result).toContainText(/Records inserted:/i)

    // ── Close dialog → reload → confirm the page still loads cleanly.
    await page.getByRole("button", { name: /close/i }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)

    await page.reload()
    await page.getByRole("tab", { name: /records/i }).click()

    // Records table is either populated or empty-state — both are valid
    // for this spec; we only need to prove no errors and the UI loads.
    const table = page.locator(
      "[data-testid='records-row'], [data-testid='records-empty']",
    )
    await expect(table.first()).toBeVisible({ timeout: 10_000 })
  })
})
