/**
 * Strict-E2E for reference data (hand measurements): upload → manage →
 * download the original → see it beside extracted traits in Analyze →
 * delete.
 *
 * Before this, reference data could be uploaded and was used nowhere.
 * Built entirely through the UI: the trait records come from the real
 * import wizard, the reference file from the real Files → Upload flow and
 * its column-mapping dialog. The only API calls are reads that confirm the
 * delete actually reached the database.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { readFileSync } from "node:fs"

import { authHeader } from "../helpers/apiClient"
import { expect, test } from "../helpers/fixtures"
import {
  fillUploadForm,
  navigateToUpload,
  selectDataType,
} from "../helpers/uploadHelpers"

test.describe("Reference data", () => {
  test.setTimeout(300_000)

  test("upload → manage + download original → Analyze table columns → delete", async ({
    page,
    request,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-ref-exp`
    const height = `${runPrefix}-Height`
    const seasonName = `${runPrefix}-Season`
    const siteName = `${runPrefix}-Site`
    const refName = `${runPrefix}-HandLAI`
    const refColumn = `LAI_hand (ref: ${refName})`

    // ── 1. Extracted-trait side: import 3 plots through the wizard. ─────
    const traitCsv = [
      `plot_number,plot_row,plot_col,accession,${height}`,
      `1,1,1,CB27,10`,
      `2,1,2,IT93,20`,
      `3,1,3,CB46,30`,
    ].join("\n")
    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")
    await page.getByTestId("upload-input").setInputFiles({
      name: `${runPrefix}-ref-traits.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(traitCsv, "utf8"),
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
    // Same population the reference upload names, as a real field would.
    await page.getByTestId("population-select").click()
    await page.getByRole("option", { name: "+ Create new…" }).click()
    await page.getByTestId("population-name").fill("Cowpea")
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

    // ── 2. Reference side: plot 2 by plot_id, plot 3 by row/col only,
    //       plot 99 matches nothing. ─────────────────────────────────────
    const refCsv = [
      "plot_id,row,col,LAI",
      "2,,,4.5",
      ",1,3,6.25",
      "99,,,1",
    ].join("\n")
    await navigateToUpload(page)
    await selectDataType(page, "Reference Data")
    await page.locator("input#name").fill(refName)
    await fillUploadForm(page, {
      experiment: experimentName,
      season: seasonName,
      location: siteName,
      population: "Cowpea",
      date: "2026-05-02",
    })
    await page.getByTestId("upload-input").setInputFiles({
      name: `${runPrefix}-lai.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(refCsv, "utf8"),
    })
    await page.getByTestId("upload-submit").click()
    const refDialog = page.getByRole("dialog")
    const uploadRef = refDialog.getByRole("button", {
      name: "Upload Reference Data",
    })
    await expect(uploadRef).toBeEnabled({ timeout: 60_000 })
    // Rename the trait in the mapping. Catches the dialog re-parsing the
    // file on every render, which silently reset the mapping to "LAI".
    const traitName = refDialog.getByPlaceholder("trait name")
    await expect(traitName).toHaveCount(1)
    await traitName.fill("LAI_hand")
    await page.waitForTimeout(500)
    await expect(traitName).toHaveValue("LAI_hand")
    await uploadRef.click()
    await expect(refDialog).toBeHidden({ timeout: 30_000 })

    // ── 3. Manage: listed with its plot count; the original downloads
    //       byte-for-byte. ──────────────────────────────────────────────
    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-manage"]').click()
    const section = page.getByTestId("reference-data-section")
    await expect(
      section.getByTestId(`reference-data-row-${refName}`),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      section.getByTestId(`reference-data-plots-${refName}`),
    ).toHaveText("3")
    const downloadBtn = section.getByTestId(
      `reference-data-download-${refName}`,
    )
    await expect(downloadBtn).toBeEnabled()
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      downloadBtn.click(),
    ])
    expect(readFileSync(await download.path(), "utf8")).toBe(refCsv)

    // ── 4. Analyze → Table: the reference column sits beside the trait,
    //       joined by plot_id and by row/col. ─────────────────────────────
    await page.goto("/analyze")
    await page.getByTestId("analyze-tab-table").click()
    const table = page.getByTestId("analyze-table")
    const expSelect = table.getByTestId("process-experiment-select")
    await expect(expSelect).toBeEnabled({ timeout: 15_000 })
    await expSelect.click()
    await page.getByRole("option", { name: experimentName }).click()
    await table.getByTestId("process-season-select").click()
    await page.getByRole("option", { name: seasonName }).click()
    await table.getByTestId("process-site-select").click()
    await page.getByRole("option", { name: siteName }).click()

    const rows = table.getByTestId("analyze-table-row")
    await expect(rows).toHaveCount(3, { timeout: 30_000 })
    const refHeader = table.getByTestId(`analyze-table-sort-trait-${refColumn}`)
    await expect(refHeader).toBeVisible({ timeout: 15_000 })
    // Highest reference value first: plot 3 (6.25, matched by row/col),
    // then plot 2 (4.5, by plot_id); plot 1 has none and sorts last.
    await refHeader.click()
    await refHeader.click()
    await expect(rows.nth(0)).toContainText("CB46")
    await expect(rows.nth(0)).toContainText("6.25")
    await expect(rows.nth(1)).toContainText("IT93")
    await expect(rows.nth(1)).toContainText("4.5")
    await expect(rows.nth(2)).toContainText("CB27")

    // Toggling reference data off removes the column.
    await table.getByTestId("analyze-table-show-ref").click()
    await expect(refHeader).toBeHidden()
    await table.getByTestId("analyze-table-show-ref").click()
    await expect(refHeader).toBeVisible()

    // ── 5. Delete from Manage; gone from the list, the table and the DB. ─
    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-manage"]').click()
    await section.getByTestId(`reference-data-delete-${refName}`).click()
    await page.getByTestId("confirm-dialog-confirm").click()
    await expect(
      section.getByTestId(`reference-data-row-${refName}`),
    ).toBeHidden({ timeout: 15_000 })

    const listRes = await request.get("/api/reference_data/", {
      params: { name: refName },
      headers: { Authorization: authHeader() },
    })
    expect(listRes.ok()).toBe(true)
    expect(((await listRes.json()) as unknown[]) ?? []).toHaveLength(0)

    await page.goto("/analyze")
    await page.getByTestId("analyze-tab-table").click()
    await expect(rows).toHaveCount(3, { timeout: 30_000 })
    await expect(refHeader).toBeHidden()
  })
})
