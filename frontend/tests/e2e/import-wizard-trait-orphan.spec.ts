/**
 * Strict-E2E for the "orphan trait records" path — trait imports where
 * the user does NOT map a plot number column. The records land in the
 * backend with NULL plot_id / plot_number / plot_row_number /
 * plot_column_number and surface in the View tab's trait records table
 * with a blank Plot column.
 *
 * The flow:
 *   1. Files → Trait Data → "+ Create new" experiment.
 *   2. Drop a CSV that has trait columns but NO plot_number column.
 *   3. Map Columns step: verify the wizard does NOT block on Continue
 *      with plot fields left unmapped, and that the orphan-warning note
 *      is visible. (This is the user's only signal that they're picking
 *      the orphan path.)
 *   4. Run the upload + record ingestion to completion.
 *   5. Switch to the View tab, pick the trait, and confirm:
 *        - rows are present (records landed),
 *        - the Plot column is blank for every row.
 *
 * Per CLAUDE.md: every entity is created through the same UI a user
 * would use. No API seed writes. Read-only verification against the
 * trait list endpoint is allowed.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { authHeader } from "../helpers/apiClient"
import { expect, test } from "../helpers/fixtures"

const API_URL =
  process.env.E2E_API_URL || process.env.VITE_API_URL || "http://127.0.0.1:7777"

test.describe("Trait import wizard — orphan records (no plot column)", () => {
  test.setTimeout(180_000)

  test("CSV with no plot column → wizard completes → records show with blank Plot cell", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-orphan-exp`
    const traitName = `${runPrefix}-OrphanTrait`
    const seasonName = `${runPrefix}-Orphan-Season`
    const siteName = `${runPrefix}-Orphan-Site`
    const ROWS = 3

    // CSV: trait values only — no plot_number / plot_row / plot_col.
    const lines = [`${traitName}`]
    for (let i = 0; i < ROWS; i++) {
      lines.push((0.4 + i * 0.05).toFixed(2))
    }
    const csv = lines.join("\n")

    await page.goto("/files")
    await expect(
      page.getByRole("heading", { name: /^files$/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })

    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()

    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")

    await page.getByTestId("upload-input").setInputFiles({
      name: `${runPrefix}-orphan-traits.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    })

    const dialog = page.getByTestId("import-wizard-dialog")
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 30_000,
    })

    // Critical: leave plot fields unmapped. The orphan-path informational
    // note must be visible so the user knows what they're picking.
    await expect(page.getByTestId("plot-unmapped-warning")).toBeVisible()

    // Enable the trait column.
    await page.getByTestId(`trait-checkbox-${traitName}`).click()

    // Fill in collection date, season, site so the rest of the config is
    // valid. The orphan path only loosens the plot requirement.
    await page.getByTestId("collection-date-fixed").fill("2026-05-01")
    await page.getByTestId("season-fixed").fill(seasonName)
    await page.getByTestId("site-fixed").fill(siteName)

    // Continue must enable with no plot column mapped.
    await expect(page.getByTestId("mapping-continue")).toBeEnabled({
      timeout: 10_000,
    })
    await page.getByTestId("mapping-continue").click()

    // Upload + ingestion. There are no plot specs to bulk-create, so the
    // setup phase finishes faster than the standard trait-import spec.
    await expect(page.getByTestId("upload-continue")).toBeEnabled({
      timeout: 90_000,
    })
    await page.getByTestId("upload-continue").click()

    await expect(page.getByTestId("import-step-confirm")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId("confirm-heading")).toContainText(
      /import complete/i,
    )

    // Read-only backend verification: the trait exists under our
    // experiment. We do NOT POST anything here.
    const tRes = await fetch(
      `${API_URL}/api/traits?trait_name=${encodeURIComponent(traitName)}&experiment_name=${encodeURIComponent(experimentName)}`,
      { headers: { Authorization: authHeader() } },
    )
    expect(tRes.ok).toBeTruthy()
    const tHits = (await tRes.json()) as Array<{ trait_name?: string }>
    expect(
      tHits.find((t) => t.trait_name === traitName),
      `trait ${traitName} should exist after orphan import`,
    ).toBeDefined()

    // ---- View tab: confirm orphan records render with blank Plot ----
    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-view"]').first().click()
    await expect(
      page.getByRole("heading", { name: /^view data$/i }),
    ).toBeVisible({ timeout: 15_000 })

    // Narrow to our experiment so we don't get drowned in other test
    // runs' rows.
    await page.getByTestId("trait-viewer-experiment").click()
    await page.getByRole("option", { name: experimentName }).first().click()

    // Pick our trait.
    await page.getByTestId("trait-viewer-trait").click()
    await page
      .getByRole("option", { name: new RegExp(traitName) })
      .first()
      .click()

    const table = page.getByTestId("trait-records-table")
    await expect(table).toBeVisible({ timeout: 15_000 })
    await expect(table.locator("tbody tr")).toHaveCount(ROWS, {
      timeout: 15_000,
    })

    // The Plot column is the 5th cell in each row (Timestamp,
    // Experiment, Season, Site, Plot, Value, …). Every row's Plot cell
    // must be empty — that's the visual confirmation that the orphan
    // path landed records with NULL plot_number.
    const plotCells = table.locator("tbody tr td:nth-child(5)")
    const plotCount = await plotCells.count()
    expect(plotCount).toBe(ROWS)
    for (let i = 0; i < plotCount; i++) {
      const text = (await plotCells.nth(i).textContent())?.trim() ?? ""
      expect(
        text,
        `orphan record row ${i} should have blank Plot cell, got "${text}"`,
      ).toBe("")
    }
  })
})
