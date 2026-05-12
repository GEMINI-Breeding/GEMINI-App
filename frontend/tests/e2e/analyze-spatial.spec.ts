/**
 * Strict-E2E for the Spatial chart in the single-trait Analyze view.
 *
 * Imports a 2×4 trait grid (single trait, plots laid out across rows/cols),
 * then drives /analyze → pick trait → chart-type Spatial:
 *   - asserts the SVG grid renders with the expected 8 cells (2 rows × 4 cols).
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Analyze — Spatial (field layout) chart", () => {
  test.setTimeout(240_000)

  test("import gridded trait → Spatial chart type → field map renders", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-spatial-exp`
    const traitH = `${runPrefix}-Height`
    const seasonName = `${runPrefix}-Season`
    const siteName = `${runPrefix}-Site`

    // 8 plots laid out as 2 rows × 4 columns.
    const csv = [
      `plot_number,plot_row,plot_col,${traitH}`,
      `1,1,1,1.0`,
      `2,1,2,1.2`,
      `3,1,3,1.4`,
      `4,1,4,1.6`,
      `5,2,1,2.0`,
      `6,2,2,2.2`,
      `7,2,3,2.4`,
      `8,2,4,2.6`,
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
      name: `${runPrefix}-spatial.csv`,
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

    // ---- Analyze (single-trait) → pick trait → Spatial chart ----
    await page.goto("/analyze")
    await expect(page.getByRole("heading", { name: /^analyze$/i })).toBeVisible(
      { timeout: 15_000 },
    )

    await page.getByTestId("analyze-trait-select").click()
    await page
      .getByRole("option", { name: new RegExp(traitH) })
      .first()
      .click()

    // Switch chart type to "Field layout" (the Spatial chart).
    await page.getByTestId("trait-charts-chart-type").click()
    await page.getByRole("option", { name: "Field layout" }).click()

    const spatial = page.getByTestId("mv-spatial")
    await expect(spatial).toBeVisible({ timeout: 30_000 })

    // All 8 cells should render with their row/col coordinates as testids
    for (let r = 1; r <= 2; r++) {
      for (let c = 1; c <= 4; c++) {
        await expect(
          spatial.getByTestId(`mv-spatial-cell-${r}-${c}`),
        ).toBeVisible()
      }
    }
  })
})
