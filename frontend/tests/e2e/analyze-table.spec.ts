/**
 * Strict-E2E for the Analyze "Table" tab — the master table, plot query,
 * and CSV export main had and this branch lost. Until this tab existed the
 * only way to get trait values out of the app was a raw GeoJSON per
 * extraction job.
 *
 * Built entirely through the UI: a trait CSV is imported with the real
 * import wizard, then read back through Analyze → Table. The CSV download
 * is a real browser download whose contents are asserted, not just the
 * button's existence.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { readFileSync } from "node:fs"

import { expect, test } from "../helpers/fixtures"

test.describe("Analyze — Table tab", () => {
  test.setTimeout(240_000)

  test("import traits → table shows plots → filter, sort, CSV", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-table-exp`
    const height = `${runPrefix}-Height`
    const yld = `${runPrefix}-Yield`
    const seasonName = `${runPrefix}-Season`
    const siteName = `${runPrefix}-Site`

    const csv = [
      `plot_number,plot_row,plot_col,accession,${height},${yld}`,
      `1,1,1,CB27,10.5,2`,
      `2,1,2,IT93,14,5`,
      `3,1,3,CB46,9,3`,
      `10,2,1,IT93,30,1`,
    ].join("\n")

    // ── Import through the real wizard. ─────────────────────────────────
    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")
    await page.getByTestId("upload-input").setInputFiles({
      name: `${runPrefix}-table.csv`,
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
    await page.getByTestId(`trait-checkbox-${height}`).click()
    await page.getByTestId(`trait-checkbox-${yld}`).click()
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

    // ── Analyze → Table → scope. ────────────────────────────────────────
    await page.goto("/analyze")
    await page.getByTestId("analyze-tab-table").click()
    const table = page.getByTestId("analyze-table")
    await expect(table).toBeVisible()

    const expSelect = table.getByTestId("process-experiment-select")
    await expect(expSelect).toBeEnabled({ timeout: 15_000 })
    await expSelect.click()
    await page.getByRole("option", { name: experimentName }).click()
    await expect(expSelect).toContainText(experimentName)
    const seasonSelect = table.getByTestId("process-season-select")
    await expect(seasonSelect).toBeEnabled()
    await seasonSelect.click()
    await page.getByRole("option", { name: seasonName }).click()
    const siteSelect = table.getByTestId("process-site-select")
    await expect(siteSelect).toBeEnabled()
    await siteSelect.click()
    await page.getByRole("option", { name: siteName }).click()

    // Both imported traits are offered and selected by default.
    await expect(
      table.getByTestId(`analyze-table-trait-${height}`),
    ).toBeChecked()
    await expect(table.getByTestId(`analyze-table-trait-${yld}`)).toBeChecked()

    // All four plots come back from trait_records.
    const rows = table.getByTestId("analyze-table-row")
    await expect(rows).toHaveCount(4, { timeout: 30_000 })
    await expect(table.getByTestId("analyze-table-count")).toContainText(
      "4 of 4 plots",
    )

    // ── Query: accession filter, and plot:1 must NOT also match plot 10.
    await table.getByTestId("analyze-table-query").fill("acc:it93")
    await expect(rows).toHaveCount(2)
    await table.getByTestId("analyze-table-query").fill("plot:1")
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText("CB27")
    await table.getByTestId("analyze-table-query").fill("")
    await expect(rows).toHaveCount(4)

    // ── Sort by height, highest first → plot 10 (30) leads. ─────────────
    await table.getByTestId(`analyze-table-sort-trait-${height}`).click()
    await table.getByTestId(`analyze-table-sort-trait-${height}`).click()
    await expect(rows.first()).toContainText("30")
    await expect(rows.first()).toContainText("IT93")

    // ── CSV of the filtered view is a real download with real values. ───
    await table.getByTestId("analyze-table-query").fill("acc:cb")
    await expect(rows).toHaveCount(2)
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      table.getByTestId("analyze-table-csv").click(),
    ])
    const path = await download.path()
    const text = readFileSync(path, "utf8")
    const lines = text.trim().split("\n")
    expect(lines[0]).toContain(height)
    expect(lines[0]).toContain(yld)
    expect(lines).toHaveLength(3) // header + the two CB rows only
    expect(text).toContain("CB27")
    expect(text).toContain("CB46")
    expect(text).not.toContain("IT93")
    expect(text).toContain("10.5")
  })
})
