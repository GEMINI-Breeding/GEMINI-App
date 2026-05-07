/**
 * Phase 9d strict-E2E: drive the genomic import wizard end-to-end through
 * the real UI against the live backend.
 *
 * Two specs:
 *   1. **xlsx with banner row** — exercises the realistic path users hit:
 *      a SheetJS-built workbook whose first row is a journal-style banner
 *      so detection has to skip it before finding the header. Mirrors the
 *      tpj13827 file the user reported failing on.
 *   2. **CSV matrix** — same flow on a tiny CSV to keep the cheap path green.
 *
 * Per CLAUDE.md and the matching memory: every entity in the scenario is
 * created through the UI a real user would use — including prerequisites
 * like the experiment. There are no API seed calls in this file, on
 * purpose. The previous version of this spec POSTed the experiment via
 * the SDK before opening the wizard; that hid a real bug where a "+ Create
 * new" experiment choice on the Files page wasn't being persisted before
 * the wizard's create-study POST ran, leaving studies with no experiment
 * association in production while the test stayed green.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import * as XLSX from "xlsx"

import { authHeader } from "../helpers/apiClient"
import { expect, test } from "../helpers/fixtures"

// `frontend/.env` sets VITE_API_URL to an empty string so the dev-server
// uses a relative `/api/*` proxy. Tests need an absolute URL — fall back
// to the dev backend port. Override with E2E_API_URL if needed.
// (Used only for READ-style verification queries, never for seeding.)
const API_URL =
  process.env.E2E_API_URL || process.env.VITE_API_URL || "http://127.0.0.1:7777"

interface MatrixSpec {
  /** Sample column names (per-row this many calls). */
  samples: string[]
  /** Optional banner row content (first cell only) — when present the
   *  detection engine has to skip it to find the real header. */
  banner?: string
}

function buildMatrixRows(spec: MatrixSpec): unknown[][] {
  const header = [
    "variant_name",
    "chromosome",
    "position",
    "alleles",
    "design_sequence",
    ...spec.samples,
  ]
  // Two-letter IUPAC calls (no slash) so the detection engine's
  // `GENOTYPE_CALL_RE` recognizes the file as a genomic matrix.
  const calls = spec.samples.map(() => "AA")
  const data = [
    ["SNP_001", 1, 12345, "A/G", "ACGTACGT", ...calls],
    ["SNP_002", 1, 23456, "C/T", "GTGTGTGT", ...calls],
    ["SNP_003", 2, 34567, "G/A", "TGTGTGTG", ...calls],
  ]
  if (spec.banner) {
    return [[spec.banner], header, ...data]
  }
  return [header, ...data]
}

function buildXlsxBuffer(spec: MatrixSpec): Buffer {
  const rows = buildMatrixRows(spec)
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1")
  // SheetJS returns a Node Buffer when type:'buffer' under Node.
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  return out
}

function buildCsv(spec: MatrixSpec): string {
  const rows = buildMatrixRows(spec)
  return rows.map((r) => r.join(",")).join("\n")
}

/**
 * After the wizard's confirm screen, drive the user through the
 * studies dashboard to verify:
 *   1. The study appears on /genotyping and is clickable.
 *   2. Its detail page lists the originating experiment.
 *   3. Deleting the study via the dashboard removes it from the UI
 *      AND the backend (verified via reload + a backend GET).
 */
async function verifyStudyAndDelete(
  page: import("@playwright/test").Page,
  studyName: string,
  experimentName: string,
): Promise<void> {
  await page.goto("/genotyping")
  await expect(
    page.getByRole("heading", { name: /genotyping studies/i, level: 1 }),
  ).toBeVisible({ timeout: 15_000 })

  // The studies dashboard is a table of rows; the row matching our
  // study name has a "link" testid that navigates to the detail page.
  const studyRow = page.locator("tr", { hasText: studyName })
  await expect(studyRow).toBeVisible({ timeout: 10_000 })
  await studyRow.getByTestId("genotyping-study-link").click()
  await expect(page.getByTestId("genotyping-study-title")).toContainText(
    studyName,
    { timeout: 10_000 },
  )

  // Experiments tab is the default — assert our experiment is listed
  // AND that the empty-state hint is NOT present. The previous shape
  // of this assertion only checked for the populated list's testid;
  // because the empty-state hint had no testid, a missing-association
  // bug looked identical to a slow render and the test stayed green.
  await expect(
    page.getByTestId("genotyping-study-experiments-empty"),
  ).not.toBeVisible()
  await expect(page.getByTestId("genotyping-study-experiments")).toContainText(
    experimentName,
    { timeout: 10_000 },
  )

  // Back to the dashboard to delete via the row's delete affordance.
  await page.goto("/genotyping")
  const deleteRow = page.locator("tr", { hasText: studyName })
  await expect(deleteRow).toBeVisible({ timeout: 10_000 })
  await deleteRow.getByTestId("genotyping-study-delete").click()
  await expect(page.getByRole("dialog")).toBeVisible()

  const deleteReq = page.waitForResponse(
    (r) =>
      /\/api\/genotyping_studies\/id\/[^/]+$/.test(new URL(r.url()).pathname) &&
      r.request().method() === "DELETE" &&
      r.status() < 400,
  )
  await page.getByTestId("genotyping-study-delete-confirm").click()
  await deleteReq

  // Frontend: row gone immediately, and stays gone after a reload (so
  // we know the cache wasn't lying).
  await expect(page.locator("tr", { hasText: studyName })).toHaveCount(0, {
    timeout: 10_000,
  })
  await page.reload()
  await expect(page.locator("tr", { hasText: studyName })).toHaveCount(0, {
    timeout: 10_000,
  })

  // Backend: the search endpoint must not return the study.
  const searchRes = await fetch(
    `${API_URL}/api/genotyping_studies?study_name=${encodeURIComponent(studyName)}`,
    { headers: { Authorization: authHeader() } },
  )
  expect(searchRes.ok).toBeTruthy()
  const hits = (await searchRes.json()) as Array<{ study_name?: string }>
  expect(hits.find((s) => s.study_name === studyName)).toBeUndefined()
}

test.describe("Phase 9d: Genomic import wizard end-to-end", () => {
  test.setTimeout(120_000)

  test("xlsx with banner row → detection skips banner, ingests through to confirm", async ({
    page,
    runPrefix,
  }) => {
    const prefix = runPrefix
    const experimentName = `${prefix}-exp`
    const studyName = `${prefix}-xlsx-study`
    const samples = [`${prefix}-S_A`, `${prefix}-S_B`, `${prefix}-S_C`]

    await page.goto("/files")
    await expect(
      page.getByRole("heading", { name: /^files$/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })

    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Genomic Data" }).click()

    // Create the experiment via the same UI a real user would use:
    // open the experiment dropdown, click "+ Create new", type the
    // name. The drop handler on the wizard dropzone is responsible
    // for materialising this choice into a real DB row before the
    // wizard mounts; if that path regresses, the create-study POST
    // will fail (or silently leave the study unassociated) and the
    // detail-page assertion below will catch it.
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    // Click outside the popover to commit the new entry as the choice.
    await page.keyboard.press("Escape")

    const xlsxBuf = buildXlsxBuffer({
      samples,
      banner: "Supplementary Data S1 — generated for E2E run",
    })
    await page.getByTestId("upload-input").setInputFiles({
      name: "tiny-matrix.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsxBuf,
    })

    // Detection runs, then the wizard reaches the study picker.
    await expect(page.getByTestId("import-wizard-dialog")).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId("step-metadata-genomic")).toBeVisible({
      timeout: 30_000,
    })
    // The file summary should report 3 sample columns (banner-row skipped).
    await expect(page.getByTestId("genomic-file-summary")).toContainText(
      /3 samples? detected/i,
    )

    // Create a new study (suggested name pre-fills from the file basename).
    await page.getByTestId("entity-select-genotyping-study").click()
    await page.getByTestId("entity-create-genotyping-study").click()
    // Override the suggestion with a unique name so the test is repeatable.
    await page.getByTestId("entity-new-genotyping-study").fill(studyName)

    // Pick a Population — exercises the Phase-9e' addition that links
    // every wizard-created accession to a Population row in the
    // experiment, mirroring what the trait wizard does.
    const populationName = `${prefix}-cowpea-magic`
    await page.getByTestId("entity-select-genotyping-population").click()
    await page.getByTestId("entity-create-genotyping-population").click()
    await page
      .getByTestId("entity-new-genotyping-population")
      .fill(populationName)

    await page.getByTestId("genomic-metadata-continue").click()

    await expect(page.getByTestId("step-sample-resolve")).toBeVisible()
    await expect(page.getByTestId("sample-resolve-summary")).toContainText(
      /resolved automatically/i,
      { timeout: 30_000 },
    )
    await page.getByTestId("unresolved-create-all").click()
    await page.getByTestId("sample-resolve-continue").click()

    await expect(page.getByTestId("step-ingest-genomic")).toBeVisible()
    await expect(page.getByTestId("import-step-confirm")).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByTestId("confirm-heading")).toContainText(
      /import complete/i,
    )
    await expect(page.getByText(studyName)).toBeVisible()

    // Verify the Population row was created and linked to the
    // experiment. We pass `experiment_name` because the controller's
    // search endpoint scopes by experiment.
    const popRes = await fetch(
      `${API_URL}/api/populations?population_name=${encodeURIComponent(populationName)}&experiment_name=${encodeURIComponent(experimentName)}`,
      { headers: { Authorization: authHeader() } },
    )
    expect(popRes.ok).toBeTruthy()
    const popHits = (await popRes.json()) as Array<{
      population_name?: string
    }>
    expect(
      popHits.find((p) => p.population_name === populationName),
      `population ${populationName} should exist after genomic import`,
    ).toBeDefined()

    await verifyStudyAndDelete(page, studyName, experimentName)
  })

  test("csv matrix → cheap path still works", async ({ page, runPrefix }) => {
    const prefix = runPrefix
    const experimentName = `${prefix}-exp`
    const studyName = `${prefix}-csv-study`
    const samples = [`${prefix}-LINE_A`, `${prefix}-LINE_B`, `${prefix}-LINE_C`]

    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Genomic Data" }).click()

    // Create the experiment via the UI (see comment on the xlsx test
    // for why we never seed via API).
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")

    const csv = buildCsv({ samples })
    await page.getByTestId("upload-input").setInputFiles({
      name: "tiny-matrix.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    })

    await expect(page.getByTestId("step-metadata-genomic")).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId("entity-select-genotyping-study").click()
    await page.getByTestId("entity-create-genotyping-study").click()
    await page.getByTestId("entity-new-genotyping-study").fill(studyName)
    await page.getByTestId("genomic-metadata-continue").click()

    await expect(page.getByTestId("sample-resolve-summary")).toContainText(
      /resolved automatically/i,
      { timeout: 30_000 },
    )
    await page.getByTestId("unresolved-create-all").click()
    await page.getByTestId("sample-resolve-continue").click()

    await expect(page.getByTestId("import-step-confirm")).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByText(studyName)).toBeVisible()

    await verifyStudyAndDelete(page, studyName, experimentName)
  })

  // Regression: deleting a genotyping study used to leave its
  // wizard-created accession rows in `gemini.accessions`. Re-importing
  // the same data the next time would auto-resolve every sample
  // header against those leftover rows, hiding the user's
  // "is anything actually being imported?" check. The fix is in
  // `GenotypingStudy.delete()` — it now sweeps any accession whose
  // only refs were via this study (no `plots` row, no other
  // `genotyping_study_samples` row).
  test("delete + re-import — orphan accessions are swept, sample-resolve starts unresolved", async ({
    page,
    runPrefix,
  }) => {
    test.setTimeout(180_000)
    const prefix = runPrefix
    const experimentName = `${prefix}-redo-exp`
    const studyName1 = `${prefix}-redo-study-1`
    const studyName2 = `${prefix}-redo-study-2`
    const samples = [`${prefix}-A`, `${prefix}-B`, `${prefix}-C`]

    const csv = buildCsv({ samples })

    // -------- First import --------
    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Genomic Data" }).click()
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")

    await page.getByTestId("upload-input").setInputFiles({
      name: "tiny-matrix.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    })

    await expect(page.getByTestId("step-metadata-genomic")).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId("entity-select-genotyping-study").click()
    await page.getByTestId("entity-create-genotyping-study").click()
    await page.getByTestId("entity-new-genotyping-study").fill(studyName1)
    await page.getByTestId("genomic-metadata-continue").click()

    // Fresh DB → all samples unresolved on the first import.
    await expect(page.getByTestId("sample-resolve-summary")).toContainText(
      `0 of ${samples.length} resolved automatically`,
      { timeout: 30_000 },
    )
    await page.getByTestId("unresolved-create-all").click()
    await page.getByTestId("sample-resolve-continue").click()

    await expect(page.getByTestId("import-step-confirm")).toBeVisible({
      timeout: 60_000,
    })
    await page.getByTestId("import-finish").click()

    // -------- Delete the study via the studies dashboard --------
    await page.goto("/genotyping")
    const studyRow = page.locator("tr", { hasText: studyName1 })
    await expect(studyRow).toBeVisible({ timeout: 15_000 })
    await studyRow.getByTestId("genotyping-study-delete").click()
    const deleteReq = page.waitForResponse(
      (r) =>
        /\/api\/genotyping_studies\/id\/[^/]+$/.test(
          new URL(r.url()).pathname,
        ) &&
        r.request().method() === "DELETE" &&
        r.status() < 400,
    )
    await page.getByTestId("genotyping-study-delete-confirm").click()
    await deleteReq
    await expect(page.locator("tr", { hasText: studyName1 })).toHaveCount(0, {
      timeout: 10_000,
    })

    // -------- Second import — same samples, same experiment --------
    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Genomic Data" }).click()
    // Re-use the same experiment by typing its name and accepting the
    // existing-row match.
    await page.getByTestId("entity-select-experiment").click()
    await page
      .getByRole("option", { name: experimentName })
      .click({ timeout: 10_000 })

    await page.getByTestId("upload-input").setInputFiles({
      name: "tiny-matrix-redo.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    })

    await expect(page.getByTestId("step-metadata-genomic")).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId("entity-select-genotyping-study").click()
    await page.getByTestId("entity-create-genotyping-study").click()
    await page.getByTestId("entity-new-genotyping-study").fill(studyName2)
    await page.getByTestId("genomic-metadata-continue").click()

    // The bug: without the orphan-accession sweep, the resolver finds
    // the previous-study accessions and shows "3 of 3 resolved
    // automatically". Assert "0 of 3" instead — i.e., a fresh import
    // looks identical to the first one.
    await expect(page.getByTestId("sample-resolve-summary")).toContainText(
      `0 of ${samples.length} resolved automatically`,
      { timeout: 30_000 },
    )
  })
})
