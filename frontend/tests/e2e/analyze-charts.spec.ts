/**
 * Strict-E2E for the rebuilt Analyze page.
 *
 * Imports a trait CSV via the real wizard with records spread across
 * two seasons (season-column mode) — single wizard run, but the rows
 * naturally fan out so the chart filter has something to narrow.
 *
 * Then drives /analyze and exercises:
 *   - chart-type / group-by toggle (assert SVG re-renders),
 *   - multi-select filter narrowing — open filter-season, pick one of
 *     two seasons, assert the "X of Y records" caption changes from 6/6
 *     to 3/6 (proves the in-memory filter wires into the chart data),
 *   - reset → caption returns to 6/6.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Analyze charts — driven by imported records", () => {
  test.setTimeout(240_000)

  test("import → /analyze → chart toggles + filter narrows record count", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-analyze-exp`
    const traitName = `${runPrefix}-Height`
    const seasonA = `${runPrefix}-Season-A`
    const seasonB = `${runPrefix}-Season-B`
    const siteName = `${runPrefix}-Site`

    // 6 rows split across two seasons (3 each). The `season` column gets
    // mapped via season-mode="column" so each row's record carries the
    // per-row season name — that's what the multi-select filter narrows on.
    const csv = [
      `plot_number,plot_row,plot_col,season,${traitName}`,
      `1,1,1,${seasonA},1.2`,
      `2,1,2,${seasonA},1.5`,
      `3,1,3,${seasonA},1.7`,
      `4,2,1,${seasonB},1.3`,
      `5,2,2,${seasonB},1.5`,
      `6,2,3,${seasonB},1.8`,
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
      name: `${runPrefix}-analyze.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    })

    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId("plot-number-select").click()
    await page.getByRole("option", { name: "plot_number" }).click()
    await page.getByTestId(`trait-checkbox-${traitName}`).click()
    await page.getByTestId("collection-date-fixed").fill("2026-05-01")

    // Switch season from fixed to column mode + pick the `season` column.
    await page.getByTestId("season-mode").click()
    await page.getByRole("option", { name: "From column" }).click()
    await page.getByTestId("season-column").click()
    await page.getByRole("option", { name: "season", exact: true }).click()

    // Site stays as a fixed value (only one site for this test).
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

    // ---- Analyze ----
    await page.goto("/analyze")
    await expect(page.getByRole("heading", { name: /^analyze$/i })).toBeVisible(
      { timeout: 15_000 },
    )

    await page.getByTestId("analyze-trait-select").click()
    await page
      .getByRole("option", { name: new RegExp(traitName) })
      .first()
      .click()

    // Histogram is the default chart type.
    const charts = page.getByTestId("trait-charts")
    await expect(charts).toBeVisible({ timeout: 15_000 })
    await expect(charts.locator("svg.recharts-surface").first()).toBeVisible({
      timeout: 30_000,
    })

    // The chart must contain at least one bar element — proves the data
    // arrived and recharts produced geometry, not just an empty axis frame.
    await expect
      .poll(() => charts.locator("svg.recharts-surface rect").count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0)

    // Caption shape: "6 of 6 records" — both numbers must reach ≥ 6 since
    // we just imported six rows under our runPrefix-scoped trait.
    const count = page.getByTestId("trait-charts-record-count")
    await expect(count).toContainText(/of \d+ records/i, { timeout: 10_000 })
    const initialText = (await count.textContent()) ?? ""
    const initialMatch = initialText.match(/(\d+) of (\d+) records/)
    expect(initialMatch, `caption text: ${initialText}`).toBeTruthy()
    const total = Number(initialMatch![2])
    expect(total).toBeGreaterThanOrEqual(6)
    expect(Number(initialMatch![1])).toBe(total)

    // ---- Chart-type / group-by toggle ----
    // Switch group-by from "None" to "Season". The histogram re-renders
    // with the same record count but multi-series bars.
    await page.locator("#trait-charts-group-by").click()
    await page.getByRole("option", { name: "Season" }).click()
    await expect(charts.locator("svg.recharts-surface").first()).toBeVisible({
      timeout: 10_000,
    })
    // Caption stays — group-by doesn't filter, just splits.
    await expect(count).toContainText(`${total} of ${total} records`)

    // ---- Multi-select filter narrowing ----
    // Open Season filter and pick seasonA. Empty selection = all; picking
    // a single option narrows to that one's records (3).
    await page.getByTestId("filter-season").click()
    await page.locator(`label:has-text("${seasonA}")`).first().click()
    await expect(count).toContainText(`3 of ${total} records`, {
      timeout: 10_000,
    })

    // Click "All" to clear the filter — caption returns to N/N.
    await page.locator(`label:has-text("All (")`).first().click()
    await expect(count).toContainText(`${total} of ${total} records`, {
      timeout: 10_000,
    })
  })
})
