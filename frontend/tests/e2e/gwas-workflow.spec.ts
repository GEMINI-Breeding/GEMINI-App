/**
 * Phase 9d strict-E2E: drive the GWAS surface end-to-end through the
 * real UI against the live backend.
 *
 *   1. Import genomic data through the wizard at /files (creates 20
 *      samples × 50 variants → spawns 20 accessions under a fresh
 *      study).
 *   2. Import trait data through the wizard at /files (re-uses the
 *      same accessions by mapping Line ID → line-name-column).
 *   3. Navigate to the new study's GWAS tab.
 *   4. Submit a GWAS run; capture the job id from the redirect URL.
 *   5. Poll `GET /api/jobs/{id}` until COMPLETED, then assert:
 *        - the result blob is populated and well-typed
 *        - Manhattan + QQ images render (naturalWidth > 0)
 *        - the top-hits table has at least one row
 *
 * Per CLAUDE.md: every entity in the scenario is created through the
 * same UI a real user uses. The only API calls in this file are
 * read-only verification queries against `/api/jobs/{id}` after the
 * worker has been kicked off by the UI submit. No seeding via API.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import * as XLSX from "xlsx"

import { authHeader } from "../helpers/apiClient"
import { expect, test } from "../helpers/fixtures"

const API_URL =
  process.env.E2E_API_URL || process.env.VITE_API_URL || "http://127.0.0.1:7777"

const SAMPLE_COUNT = 20
const VARIANT_COUNT = 50
const CHROMOSOMES = 2
const SEED = 42

// Seeded PRNG so the random genotype matrix is identical across runs.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function genotypeCall(rand: () => number, ref: string, alt: string): string {
  const r = rand()
  if (r < 0.03) return "NN"
  if (r < 0.35) return `${ref}${ref}`
  if (r < 0.7) return `${ref}${alt}`
  return `${alt}${alt}`
}

interface Fixture {
  genomicBuffer: Buffer
  traitBuffer: Buffer
  sampleNames: string[]
}

function buildFixture(prefix: string): Fixture {
  const sampleNames = Array.from(
    { length: SAMPLE_COUNT },
    (_, i) => `${prefix}-M${String(i + 1).padStart(3, "0")}`,
  )

  const rand = mulberry32(SEED)

  // ── Genomic workbook ─────────────────────────────────────────────────
  // First row is a banner so detection has to skip it. Header matches
  // what the new genomic wizard's column-mapping recognises.
  const allelePool: Array<[string, string]> = [
    ["T", "C"],
    ["A", "G"],
    ["C", "T"],
    ["G", "A"],
  ]
  const titleRow = [
    "SUPPORTING DATA (synthetic e2e fixture) — polymorphic SNPs + genotypes",
  ]
  const headerRow = [
    "variant_name",
    "design_sequence",
    "alleles",
    "chromosome",
    "position",
    ...sampleNames,
  ]
  const variantRows: (string | number)[][] = []
  const perChrom = Math.ceil(VARIANT_COUNT / CHROMOSOMES)
  for (let v = 0; v < VARIANT_COUNT; v++) {
    const chrom = Math.floor(v / perChrom) + 1
    const pos = (v % perChrom) * 10_000 + 1
    const [ref, alt] = allelePool[v % allelePool.length]
    const design = `NNN[${ref}/${alt}]NNN`
    const alleles = `${ref}/${alt}`
    const row: (string | number)[] = [
      `snp_${v + 1}`,
      design,
      alleles,
      chrom,
      pos,
    ]
    for (let s = 0; s < SAMPLE_COUNT; s++) {
      row.push(genotypeCall(rand, ref, alt))
    }
    variantRows.push(row)
  }
  const genomicWb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    genomicWb,
    XLSX.utils.aoa_to_sheet([titleRow, headerRow, ...variantRows]),
    "Data",
  )
  const genomicBuffer = XLSX.write(genomicWb, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer

  // ── Trait workbook ───────────────────────────────────────────────────
  interface TraitRow {
    "Line ID": string
    Plot: number
    Stand_count: number
  }
  const traitRows: TraitRow[] = sampleNames.map((name, i) => ({
    "Line ID": name,
    Plot: i + 1,
    Stand_count: 10 + Math.floor(rand() * 41),
  }))
  const traitWb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    traitWb,
    XLSX.utils.json_to_sheet(traitRows),
    "Data",
  )
  const traitBuffer = XLSX.write(traitWb, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer

  return { genomicBuffer, traitBuffer, sampleNames }
}

test.describe("Phase 9d': GWAS end-to-end", () => {
  test.setTimeout(360_000)

  test("genomic + trait import → submit GWAS → results render", async ({
    page,
    request,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-gwas-exp`
    const studyName = `${runPrefix}-gwas-study`
    const traitName = `${runPrefix}-Stand_count`
    const seasonName = `${runPrefix}-Season`
    const siteName = `${runPrefix}-Site`
    const datasetName = `${runPrefix}-Dataset`

    const fixture = buildFixture(runPrefix)

    // ─── 1. Genomic import ────────────────────────────────────────────
    await page.goto("/files")
    await expect(
      page.getByRole("heading", { name: /^files$/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })

    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Genomic Data" }).click()

    // Create experiment via the UI.
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")

    // Drop the genomic workbook.
    await page.getByTestId("upload-input").setInputFiles({
      name: "gwas-genomic.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: fixture.genomicBuffer,
    })

    await expect(page.getByTestId("import-wizard-dialog")).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId("step-metadata-genomic")).toBeVisible({
      timeout: 30_000,
    })

    // Create a fresh study.
    await page.getByTestId("entity-select-genotyping-study").click()
    await page.getByTestId("entity-create-genotyping-study").click()
    await page.getByTestId("entity-new-genotyping-study").fill(studyName)
    await page.getByTestId("genomic-metadata-continue").click()

    await expect(page.getByTestId("step-sample-resolve")).toBeVisible()
    await expect(page.getByTestId("sample-resolve-summary")).toContainText(
      /resolved automatically/i,
      { timeout: 30_000 },
    )
    await page.getByTestId("unresolved-create-all").click()
    await page.getByTestId("sample-resolve-continue").click()

    // Ingest runs; the wizard reaches Confirm when done.
    await expect(page.getByTestId("import-step-confirm")).toBeVisible({
      timeout: 180_000,
    })
    await expect(page.getByTestId("confirm-heading")).toContainText(
      /import complete/i,
    )
    // Close the wizard dialog so the next import flow is clean.
    const closeBtn = page.getByTestId("import-finish")
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click()
    }

    // ─── 2. Trait import (line-name mapping → reuses accessions) ─────
    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()
    // Pick the existing experiment (the option is rendered now).
    await page.getByTestId("entity-select-experiment").click()
    await page
      .getByRole("option", { name: experimentName })
      .click({ timeout: 10_000 })

    await page.getByTestId("upload-input").setInputFiles({
      name: "gwas-trait.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: fixture.traitBuffer,
    })

    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId("plot-number-select").click()
    await page.getByRole("option", { name: "Plot" }).click()
    await page.getByTestId(`trait-checkbox-Stand_count`).click()
    // Override the auto-derived trait label so it carries our prefix.
    const traitLabel = page.getByTestId("trait-label-Stand_count")
    if (await traitLabel.isVisible().catch(() => false)) {
      await traitLabel.fill(traitName)
    }
    await page.getByTestId("line-name-column-select").click()
    await page.getByRole("option", { name: "Line ID" }).click()

    await page.getByTestId("collection-date-fixed").fill("2026-05-01")
    await page.getByTestId("season-fixed").fill(seasonName)
    await page.getByTestId("site-fixed").fill(siteName)
    // Some trait wizards expose a dataset-name field, others auto-derive.
    const dsField = page.getByTestId("dataset-name-0")
    if (await dsField.isVisible().catch(() => false)) {
      await dsField.fill(datasetName)
    }

    await expect(page.getByTestId("mapping-continue")).toBeEnabled({
      timeout: 15_000,
    })
    await page.getByTestId("mapping-continue").click()

    await expect(page.getByTestId("upload-continue")).toBeEnabled({
      timeout: 120_000,
    })
    await page.getByTestId("upload-continue").click()

    await expect(page.getByTestId("import-step-confirm")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId("confirm-heading")).toContainText(
      /import complete/i,
    )

    // ─── 3. Navigate to the study's GWAS tab ──────────────────────────
    await page.goto("/genotyping")
    const studyRow = page.locator("tr", { hasText: studyName })
    await expect(studyRow).toBeVisible({ timeout: 15_000 })
    await studyRow.getByTestId("genotyping-study-link").click()
    await expect(page.getByTestId("genotyping-study-title")).toContainText(
      studyName,
      { timeout: 10_000 },
    )
    // Capture the studyId from the URL once we're on the detail page.
    const studyDetailUrl = new URL(page.url())
    const studyIdMatch = studyDetailUrl.pathname.match(
      /\/genotyping\/([^/]+)$/,
    )
    expect(studyIdMatch).toBeTruthy()
    const studyId = studyIdMatch![1]

    // Switch to the GWAS tab via the URL search param.
    await page.goto(`/genotyping/${studyId}?tab=gwas`)
    await expect(page.getByTestId("genotyping-study-gwas-tab")).toBeVisible({
      timeout: 10_000,
    })

    // ─── 4. Submit a GWAS run ─────────────────────────────────────────
    // Wait until the experiment dropdown is populated, then pick our entities.
    const expSelect = page.getByTestId("gwas-experiment-select")
    await expect(expSelect.locator("option", { hasText: experimentName }))
      .toHaveCount(1, { timeout: 15_000 })
    await expSelect.selectOption({ label: experimentName })

    const datasetSelect = page.getByTestId("gwas-dataset-select")
    // Wait for the trait dataset to appear after the experiment selection.
    await expect(datasetSelect).toBeEnabled({ timeout: 15_000 })
    await expect
      .poll(
        async () => (await datasetSelect.locator("option").count()) > 1,
        { timeout: 15_000 },
      )
      .toBe(true)
    // Pick the dataset whose name carries our prefix.
    const datasetOption = datasetSelect.locator("option", {
      hasText: runPrefix,
    })
    await expect(datasetOption).toHaveCount(1, { timeout: 15_000 })
    const datasetValue = await datasetOption.getAttribute("value")
    await datasetSelect.selectOption(datasetValue!)

    // Tick the trait checkbox.
    await page.getByTestId(`gwas-trait-checkbox-${traitName}`).check()

    // Loosen QC; keep n_pcs=0 because PLINK PCA refuses with <50
    // samples and our fixture has 20. The PCA + kinship-heatmap
    // assertions below are skipped when the resulting artifact set
    // is missing those files; they're exercised end-to-end against
    // any real dataset with ≥50 samples (verified manually on the
    // 313-sample cowpea data).
    await page.getByTestId("gwas-advanced-toggle").click()
    await page.getByTestId("gwas-qc-maf").fill("0.01")
    const slider = page.getByTestId("gwas-npcs-slider")
    await slider.focus()
    await slider.fill("0")

    await page.getByTestId("gwas-submit").click()

    // Navigation to the job-detail route → captures jobId.
    await page.waitForURL(/\/genotyping\/[^/]+\/gwas\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    })
    const jobIdMatch = page.url().match(/\/gwas\/([0-9a-f-]{36})$/)
    expect(jobIdMatch).toBeTruthy()
    const jobId = jobIdMatch![1]

    // ─── 5. Poll backend until terminal; assert success ──────────────
    // Tolerate transient socket-hang-up: the REST API occasionally
    // drops a poll connection mid-GWAS (the worker holds a long
    // single-statement transaction during the kinship/IMMV refresh
    // phases). Swallow the error and let the next poll tick retry,
    // rather than failing the whole spec.
    const TERMINAL = new Set(["completed", "failed", "cancelled"])
    await expect
      .poll(
        async () => {
          try {
            const res = await request.get(`${API_URL}/api/jobs/${jobId}`, {
              headers: { Authorization: authHeader() },
            })
            if (!res.ok()) return false
            const j = await res.json()
            return TERMINAL.has(String(j.status ?? "").toLowerCase())
          } catch {
            return false
          }
        },
        {
          intervals: [2_000, 3_000, 5_000, 5_000, 5_000],
          timeout: 240_000,
          message: `GWAS job ${jobId} did not reach terminal state within 240s`,
        },
      )
      .toBe(true)

    const finalRes = await request.get(`${API_URL}/api/jobs/${jobId}`, {
      headers: { Authorization: authHeader() },
    })
    const job = await finalRes.json()
    expect(
      String(job.status).toLowerCase(),
      `job error_message: ${job.error_message}`,
    ).toBe("completed")

    const result = job.result as Record<string, unknown>
    expect(result, "job.result should be populated").toBeTruthy()
    const artifacts = result.artifacts as Record<string, string>
    expect(artifacts.manhattan).toMatch(/s3:\/\/.+\/manhattan\.png$/)
    expect(artifacts.qq).toMatch(/s3:\/\/.+\/qq\.png$/)
    expect(result.n_variants_passed_qc as number).toBeGreaterThanOrEqual(1)
    const topHits = result.top_hits as Array<{ p: number; rs: string }>
    expect(Array.isArray(topHits)).toBe(true)
    expect(topHits.length).toBeGreaterThanOrEqual(1)
    for (const hit of topHits) {
      expect(hit.p).toBeGreaterThan(0)
      expect(hit.p).toBeLessThanOrEqual(1)
    }

    // ─── 6. UI assertions on the rendered job detail page ─────────────
    await page.reload()
    await expect(page.getByTestId("gwas-status-card")).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId("gwas-result-summary")).toBeVisible({
      timeout: 30_000,
    })
    const manhattanImg = page.getByTestId("gwas-manhattan-img")
    const qqImg = page.getByTestId("gwas-qq-img")
    await expect(manhattanImg).toBeVisible()
    await expect(qqImg).toBeVisible()
    // The image is loaded via auth'd fetch + object URL; wait for the
    // blob to land and the <img> to report a non-zero natural width.
    await expect(async () => {
      const loaded = await manhattanImg.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      )
      expect(loaded).toBe(true)
    }).toPass({ timeout: 30_000 })
    await expect(async () => {
      const loaded = await qqImg.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      )
      expect(loaded).toBe(true)
    }).toPass({ timeout: 30_000 })

    const rows = page.locator(
      '[data-testid="gwas-top-hits-table"] tbody tr',
    )
    expect(await rows.count()).toBeGreaterThanOrEqual(1)

    // Polish-3 regression: the primary "Download sumstats" button is
    // rendered when status=COMPLETED and the assoc artifact exists.
    await expect(page.getByTestId("gwas-download-sumstats")).toBeVisible()

    // Polish-5b/c regression: kinship heatmap renders. (PCA section is
    // not asserted here because n_pcs=0 on this small fixture — PLINK
    // refuses PCA with <50 samples and we don't ship a 50-sample
    // fixture. Manually verified on the 313-sample cowpea data.)
    await expect(page.getByTestId("gwas-kinship-section")).toBeVisible()
    const kinshipImg = page.getByTestId("gwas-kinship-img")
    await expect(kinshipImg).toBeVisible()
    await expect(async () => {
      const loaded = await kinshipImg.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      )
      expect(loaded).toBe(true)
    }).toPass({ timeout: 30_000 })

    // Polish-2 regression: jump back to the GWAS tab and confirm the
    // Recent Runs row carries the trait name (not just the truncated
    // job id) and exposes an explicit "View" link.
    await page.goto(`/genotyping/${studyId}?tab=gwas`)
    await expect(page.getByTestId("gwas-recent-runs")).toBeVisible({
      timeout: 15_000,
    })
    const traitCell = page.locator(
      `[data-testid="gwas-recent-row-${jobId}"] td`,
      { hasText: traitName },
    )
    await expect(traitCell).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByTestId(`gwas-recent-view-${jobId}`),
    ).toBeVisible()

    // Polish-6 regression: per-row delete sweeps both the job row
    // (DB) and the MinIO artifacts under gwas/{job_id}/. We click
    // the trash icon, confirm in the dialog, and assert (a) the row
    // disappears from the Recent Runs table and (b) GET
    // /api/jobs/{jobId} returns 404. We don't poke MinIO from the
    // browser; that's covered by a manual end-to-end shell check
    // documented in the task notes.
    await page.getByTestId(`gwas-recent-delete-${jobId}`).click()
    await expect(page.getByTestId("confirm-dialog")).toBeVisible()
    await page.getByTestId("confirm-dialog-confirm").click()
    await expect(
      page.getByTestId(`gwas-recent-row-${jobId}`),
    ).toHaveCount(0, { timeout: 15_000 })

    const deletedCheck = await request.get(`${API_URL}/api/jobs/${jobId}`, {
      headers: { Authorization: authHeader() },
    })
    expect(deletedCheck.status()).toBe(404)
  })

  // Regression for the "No samples with both genotype and phenotype
  // observations" bug: before alembic 0006 the GWAS worker only saw
  // trait_records that had a non-null plot_id, because phenotype
  // extraction joined trait_records.plot_id → plot_accession_view.
  // Trait imports without a plot column (greenhouse / common garden /
  // genotype-keyed-only spreadsheets) silently produced GWAS-invisible
  // records. This spec drives the same workflow as above but skips
  // the plot-column mapping entirely; the run should still complete
  // and find phenotypes via the direct accession_id link.
  test("orphan trait records (no plot column) → GWAS still finds phenotypes", async ({
    page,
    request,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-orphan-exp`
    const studyName = `${runPrefix}-orphan-study`
    const traitName = `${runPrefix}-Stand_count`
    const seasonName = `${runPrefix}-Season`
    const siteName = `${runPrefix}-Site`

    const fixture = buildFixture(runPrefix)

    // ── Genomic import (identical to the plot-mapped spec) ─────────
    await page.goto("/files")
    await expect(
      page.getByRole("heading", { name: /^files$/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Genomic Data" }).click()
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")
    await page.getByTestId("upload-input").setInputFiles({
      name: "gwas-genomic.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: fixture.genomicBuffer,
    })
    await expect(page.getByTestId("import-wizard-dialog")).toBeVisible({
      timeout: 15_000,
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
      timeout: 180_000,
    })
    const closeBtn = page.getByTestId("import-finish")
    if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click()

    // ── Trait import — DELIBERATELY NO PLOT COLUMN MAPPED ──────────
    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()
    await page.getByTestId("entity-select-experiment").click()
    await page
      .getByRole("option", { name: experimentName })
      .click({ timeout: 10_000 })
    await page.getByTestId("upload-input").setInputFiles({
      name: "gwas-trait-orphan.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: fixture.traitBuffer,
    })
    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 30_000,
    })
    // No plot-number-select call — leave it unmapped on purpose.
    await page.getByTestId(`trait-checkbox-Stand_count`).click()
    const traitLabel = page.getByTestId("trait-label-Stand_count")
    if (await traitLabel.isVisible().catch(() => false)) {
      await traitLabel.fill(traitName)
    }
    // Line ID is the germplasm anchor — same accessions the genomic
    // import created.
    await page.getByTestId("line-name-column-select").click()
    await page.getByRole("option", { name: "Line ID" }).click()
    await page.getByTestId("collection-date-fixed").fill("2026-05-01")
    await page.getByTestId("season-fixed").fill(seasonName)
    await page.getByTestId("site-fixed").fill(siteName)
    await expect(page.getByTestId("mapping-continue")).toBeEnabled({
      timeout: 15_000,
    })
    await page.getByTestId("mapping-continue").click()
    await expect(page.getByTestId("upload-continue")).toBeEnabled({
      timeout: 120_000,
    })
    await page.getByTestId("upload-continue").click()
    await expect(page.getByTestId("import-step-confirm")).toBeVisible({
      timeout: 10_000,
    })

    // ── Navigate to study + submit GWAS ────────────────────────────
    await page.goto("/genotyping")
    const studyRow = page.locator("tr", { hasText: studyName })
    await expect(studyRow).toBeVisible({ timeout: 15_000 })
    await studyRow.getByTestId("genotyping-study-link").click()
    await expect(page.getByTestId("genotyping-study-title")).toContainText(
      studyName,
    )
    const studyId = new URL(page.url()).pathname.match(
      /\/genotyping\/([^/]+)$/,
    )![1]
    await page.goto(`/genotyping/${studyId}?tab=gwas`)

    const expSelect = page.getByTestId("gwas-experiment-select")
    await expect(expSelect.locator("option", { hasText: experimentName }))
      .toHaveCount(1, { timeout: 15_000 })
    await expSelect.selectOption({ label: experimentName })
    const datasetSelect = page.getByTestId("gwas-dataset-select")
    await expect(datasetSelect).toBeEnabled({ timeout: 15_000 })
    const datasetOption = datasetSelect.locator("option", {
      hasText: runPrefix,
    })
    await expect(datasetOption).toHaveCount(1, { timeout: 15_000 })
    await datasetSelect.selectOption(
      (await datasetOption.getAttribute("value"))!,
    )
    await page.getByTestId(`gwas-trait-checkbox-${traitName}`).check()
    await page.getByTestId("gwas-advanced-toggle").click()
    await page.getByTestId("gwas-qc-maf").fill("0.01")
    const slider = page.getByTestId("gwas-npcs-slider")
    await slider.focus()
    await slider.fill("0")
    await page.getByTestId("gwas-submit").click()

    await page.waitForURL(/\/genotyping\/[^/]+\/gwas\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    })
    const jobId = page.url().match(/\/gwas\/([0-9a-f-]{36})$/)![1]

    const TERMINAL = new Set(["completed", "failed", "cancelled"])
    await expect
      .poll(
        async () => {
          try {
            const res = await request.get(`${API_URL}/api/jobs/${jobId}`, {
              headers: { Authorization: authHeader() },
            })
            if (!res.ok()) return false
            const j = await res.json()
            return TERMINAL.has(String(j.status ?? "").toLowerCase())
          } catch {
            return false
          }
        },
        {
          intervals: [2_000, 3_000, 5_000, 5_000, 5_000],
          timeout: 240_000,
        },
      )
      .toBe(true)

    const finalRes = await request.get(`${API_URL}/api/jobs/${jobId}`, {
      headers: { Authorization: authHeader() },
    })
    const job = await finalRes.json()
    expect(
      String(job.status).toLowerCase(),
      `job error_message: ${job.error_message}`,
    ).toBe("completed")
    // The bug under regression: pre-0006 this would fail with
    // "No samples with both genotype and phenotype observations".
    // Post-0006, the worker reads accession_id directly off
    // trait_records_immv and finds every line in the fixture.
    const result = job.result as Record<string, unknown>
    expect(result.n_samples_with_phenotype as number).toBe(
      fixture.sampleNames.length,
    )
  })
})
