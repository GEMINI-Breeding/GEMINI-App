/**
 * Strict-E2E for Phase 1 of the Multivariate Analyze tab.
 *
 * Imports a single CSV with TWO trait columns (height + width) via the real
 * wizard, then drives /analyze?view=multi:
 *   - picks both traits via the multi-trait MultiSelectFilter
 *   - picks Mean aggregation
 *   - clicks "Run analysis"
 *   - asserts the correlation heatmap renders with 2x2 cells
 *   - clicks an off-diagonal cell -> scatter dialog opens
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Analyze — Multivariate Phase 1", () => {
  test.setTimeout(240_000)

  test("import 2 traits → Multivariate tab → correlation heatmap + scatter drill-down", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-mv-exp`
    const traitH = `${runPrefix}-Height`
    const traitW = `${runPrefix}-Width`
    const seasonName = `${runPrefix}-Season`
    const siteName = `${runPrefix}-Site`

    // 8 plots with monotone-ish correlated height/width values so the
    // heatmap has a non-trivial correlation to render.
    const csv = [
      `plot_number,plot_row,plot_col,${traitH},${traitW}`,
      `1,1,1,1.0,0.5`,
      `2,1,2,1.5,0.8`,
      `3,1,3,2.0,1.0`,
      `4,1,4,2.5,1.3`,
      `5,2,1,3.0,1.4`,
      `6,2,2,3.5,1.7`,
      `7,2,3,4.0,2.0`,
      `8,2,4,4.5,2.2`,
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
      name: `${runPrefix}-mv.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    })

    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId("plot-number-select").click()
    await page.getByRole("option", { name: "plot_number" }).click()
    await page.getByTestId(`trait-checkbox-${traitH}`).click()
    await page.getByTestId(`trait-checkbox-${traitW}`).click()
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

    // ---- Analyze → Multivariate tab ----
    await page.goto("/analyze")
    await expect(page.getByRole("heading", { name: /^analyze$/i })).toBeVisible(
      { timeout: 15_000 },
    )

    await page.getByTestId("analyze-tab-multivariate").click()

    // URL syncs to ?view=multi
    await expect.poll(() => page.url()).toContain("view=multi")

    // Pick both traits in the multi-trait MultiSelectFilter
    await page.getByTestId("mv-trait-picker").click()
    await page.locator(`label:has-text("${traitH}")`).first().click()
    await page.locator(`label:has-text("${traitW}")`).first().click()
    // Close the dropdown — MultiSelectFilter listens to mousedown outside
    await page.getByRole("heading", { name: /^analyze$/i }).click()

    // Time-aggregation defaults to Mean — no need to open the advanced
    // panel. Run analysis directly.

    // Run analysis
    await page.getByTestId("mv-run").click()

    // Heatmap renders (2 traits → 4 cells)
    const heatmap = page.getByTestId("mv-heatmap")
    await expect(heatmap).toBeVisible({ timeout: 30_000 })

    // Cell (0,0) and (1,1) are diagonal = 1.00; (0,1) is off-diagonal
    await expect(heatmap.getByTestId("mv-cell-0-0")).toBeVisible()
    await expect(heatmap.getByTestId("mv-cell-1-1")).toBeVisible()
    await expect(heatmap.getByTestId("mv-cell-0-1")).toBeVisible()

    // Click off-diagonal → scatter dialog opens
    await page.getByTestId("mv-cell-0-1").click()
    await expect(page.getByTestId("mv-scatter-title")).toBeVisible({
      timeout: 5_000,
    })
    await expect(page.getByTestId("mv-scatter-svg")).toBeVisible()
  })
})
