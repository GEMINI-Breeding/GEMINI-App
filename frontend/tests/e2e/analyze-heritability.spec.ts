/**
 * Strict-E2E for the Heritability + BLUPs chart in the single-trait
 * Analyze view.
 *
 * Imports a replicated trait CSV (3 reps × 3 accessions = 9 plots) then
 * drives /analyze → pick trait → chart-type Heritability + BLUPs.
 * Asserts the H² panel and BLUPs table render with rows for A, B, C.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Analyze — Heritability chart", () => {
  test.setTimeout(240_000)

  test("import replicated trait → Heritability chart → H² + BLUPs render", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-h2-exp`
    const traitH = `${runPrefix}-Height`
    const seasonName = `${runPrefix}-Season`
    const siteName = `${runPrefix}-Site`

    const csv = [
      `plot_number,plot_row,plot_col,accession,${traitH}`,
      `1,1,1,A,10.0`,
      `2,1,2,A,11.0`,
      `3,1,3,A,9.5`,
      `4,2,1,B,14.0`,
      `5,2,2,B,15.0`,
      `6,2,3,B,13.5`,
      `7,3,1,C,18.0`,
      `8,3,2,C,19.0`,
      `9,3,3,C,17.5`,
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
      name: `${runPrefix}-h2.csv`,
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
    await page.getByRole("option", { name: "accession" }).click()
    await page.getByTestId(`trait-checkbox-${traitH}`).click()
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

    // ---- Analyze (single-trait) → pick trait → Heritability chart ----
    await page.goto("/analyze")
    await expect(page.getByRole("heading", { name: /^analyze$/i })).toBeVisible(
      { timeout: 15_000 },
    )
    await page.getByTestId("analyze-trait-select").click()
    await page
      .getByRole("option", { name: new RegExp(traitH) })
      .first()
      .click()

    await page.getByTestId("trait-charts-chart-type").click()
    await page
      .getByRole("option", { name: "Heritability + BLUPs" })
      .click()

    const h2 = page.getByTestId("mv-heritability")
    await expect(h2).toBeVisible({ timeout: 30_000 })

    const blups = page.getByTestId("mv-blups-table")
    await expect(blups).toBeVisible()
    for (const acc of ["A", "B", "C"]) {
      await expect(blups.getByRole("cell", { name: acc })).toBeVisible()
    }
  })
})
