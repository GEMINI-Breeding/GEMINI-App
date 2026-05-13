/**
 * Strict-E2E for MANOVA in the Multivariate Analyze tab.
 *
 * Imports a CSV with 2 traits × 3 accessions × 4 replicates (12 plots),
 * accession means well-separated on both traits + small noise. Drives
 * /analyze?view=multi → MANOVA sub-tab → picks both traits → asserts the
 * one-way panel renders with the four standard test-statistic rows.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Analyze — Multivariate MANOVA", () => {
  test.setTimeout(240_000)

  test("import 2 traits × replicated accessions → MANOVA → one-way panel renders", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-manova-exp`
    const traitH = `${runPrefix}-Height`
    const traitW = `${runPrefix}-Width`
    const seasonName = `${runPrefix}-Season`
    const siteName = `${runPrefix}-Site`

    // 12 plots: 3 accessions × 4 reps, both traits clearly separated by
    // accession with small reproducible "noise" derived from plot index.
    const accBases: Record<string, { h: number; w: number }> = {
      A: { h: 10, w: 5 },
      B: { h: 14, w: 7 },
      C: { h: 18, w: 9 },
    }
    const accessions = ["A", "B", "B", "C", "A", "C", "B", "A", "C", "A", "B", "C"]
    const csvRows = accessions.map((acc, i) => {
      const plot = i + 1
      const jitter = ((plot * 37) % 10) / 50 // small deterministic noise
      const { h, w } = accBases[acc]
      return `${plot},${1 + (i % 3)},${1 + Math.floor(i / 3)},${acc},${(h + jitter).toFixed(3)},${(w + jitter).toFixed(3)}`
    })
    const csv = [
      `plot_number,plot_row,plot_col,accession,${traitH},${traitW}`,
      ...csvRows,
    ].join("\n")

    // ---- Import via the real wizard ----
    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")

    await page.getByTestId("upload-input").setInputFiles({
      name: `${runPrefix}-manova.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    })

    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId("plot-number-select").click()
    await page.getByRole("option", { name: "plot_number" }).click()
    await page.getByTestId("plot-row-select").click()
    await page.getByRole("option", { name: "plot_row" }).click()
    await page.getByTestId("plot-col-select").click()
    await page.getByRole("option", { name: "plot_col" }).click()
    await page.getByTestId("accession-name-column-select").click()
    await page.getByRole("option", { name: "accession", exact: true }).click()
    for (const t of [traitH, traitW]) {
      await page.getByTestId(`trait-checkbox-${t}`).click()
    }
    await page.getByTestId("collection-date-fixed").fill("2026-05-01")
    await page.getByTestId("season-fixed").fill(seasonName)
    await page.getByTestId("site-fixed").fill(siteName)

    await expect(page.getByTestId("mapping-continue")).toBeEnabled({
      timeout: 10_000,
    })
    await page.getByTestId("mapping-continue").click()
    await expect(page.getByTestId("upload-continue")).toBeEnabled({
      timeout: 120_000,
    })
    await page.getByTestId("upload-continue").click()
    await expect(page.getByTestId("import-step-confirm")).toBeVisible({
      timeout: 10_000,
    })

    // ---- Analyze → Multivariate → MANOVA ----
    await page.goto("/analyze?view=multi")
    await expect(page.getByRole("heading", { name: /^analyze$/i })).toBeVisible(
      { timeout: 15_000 },
    )
    await page.getByTestId("mv-subtab-manova").click()

    // Pick both traits
    await page.getByTestId("mv-manova-trait-picker").click()
    for (const t of [traitH, traitW]) {
      await page.locator(`label:has-text("${t}")`).first().click()
    }
    await page.getByRole("heading", { name: /^analyze$/i }).click()

    // Isolate to the imported experiment so we MANOVA only its records
    await page.getByTestId("mv-experiment").click()
    await page.locator(`label:has-text("${experimentName}")`).first().click()
    await page.getByRole("heading", { name: /^analyze$/i }).click()

    await page.getByTestId("mv-manova-run").click()

    // One-way panel renders
    const panel = page.getByTestId("mv-manova-panel-one_way").first()
    await expect(panel).toBeVisible({ timeout: 30_000 })

    // All four standard test statistics show up
    for (const stat of [
      "Wilks' lambda",
      "Pillai's trace",
      "Hotelling-Lawley trace",
      "Roy's greatest root",
    ]) {
      await expect(panel.getByTestId(`mv-manova-row-${stat}`)).toBeVisible()
    }

    // No replication warning — we have 4 reps per accession
    await expect(panel.getByTestId("mv-manova-warning")).toHaveCount(0)
  })
})
