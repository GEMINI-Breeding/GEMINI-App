/**
 * Strict-E2E for canopy temperature from a thermal orthomosaic (main's
 * PR #154), and the imported-ortho path it rides on.
 *
 * Built entirely through the UI:
 *   1. Upload an RGB orthomosaic (sensor RGB) and a thermal orthomosaic
 *      (sensor Thermal) for the same flight date, as Files → Orthomosaic.
 *   2. Workspace → aerial pipeline → run on the RGB upload → "Import
 *      existing" registers it (no ODM).
 *   3. Draw + save a 2×3 plot grid, run Split.
 *   4. Trait extraction with the thermal ortho picked in the dialog.
 *   5. Analyze → Table shows Temp_veg_avg_C = 27.5 °C (the thermal fixture
 *      is a constant 27.5 over the RGB fixture's footprint, so any plot with
 *      vegetation must read exactly that).
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { readFileSync } from "node:fs"

import type { Page } from "@playwright/test"
import { authHeader } from "../helpers/apiClient"
import { fixturePath } from "../helpers/fixturePath"
import { expect, test } from "../helpers/fixtures"
import {
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"
import { zipEntryNames } from "../helpers/zip"

async function uploadOrtho(
  page: Page,
  scope: Parameters<typeof fillUploadForm>[1],
  file: string,
) {
  await navigateToUpload(page)
  await selectDataType(page, "Orthomosaic")
  await fillUploadForm(page, scope)
  // Two zones on this page (RGB, then optional DEM); the ortho goes in the first.
  await page.getByTestId("upload-input").first().setInputFiles(file)
  await submitUploadAndWait(page, 1)
  // Both fixtures are UTM zone 10N GeoTIFFs; the upload page must say so.
  await expect(page.getByTestId("geotiff-check-ok")).toContainText(
    "EPSG:32610",
    { timeout: 30_000 },
  )
}

test.describe("Canopy temperature from a thermal orthomosaic", () => {
  test.setTimeout(8 * 60_000)

  test("imported RGB + thermal orthos → Temp_veg_avg_C per plot", async ({
    page,
    request,
    runPrefix,
  }) => {
    const experiment = `${runPrefix}-ctemp-exp`
    const season = `${runPrefix}-S`
    const location = "Davis"
    const population = "Cowpea"
    const date = "2024-07-10"
    const platform = "DJI"
    const base = { experiment, season, location, population, date, platform }

    // ── 1. Both orthos for the same flight. ─────────────────────────────
    await uploadOrtho(
      page,
      { ...base, sensor: "RGB" },
      fixturePath("ortho", "e2e_test_orthophoto.tif"),
    )
    await uploadOrtho(
      page,
      { ...base, sensor: "Thermal" },
      fixturePath("ortho", "e2e_test_thermal.tif"),
    )

    // ── 2. Pipeline + run on the RGB ortho; register it. ────────────────
    const workspaceName = `${runPrefix}-ctemp-ws`
    await page.goto("/process")
    await page.locator('[data-onboarding="process-new-workspace"]').click()
    await page.getByLabel(/workspace name/i).fill(workspaceName)
    await page.getByRole("button", { name: /create workspace/i }).click()
    await page.getByText(workspaceName, { exact: true }).click()
    await page.getByRole("button", { name: /create aerial pipeline/i }).click()
    await page.getByLabel(/pipeline name/i).fill(`${runPrefix}-ctemp-pipe`)
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /create pipeline/i }).click()

    await page
      .getByRole("button", { name: /new run/i })
      .first()
      .click()
    const rgbRow = page
      .getByTestId("upload-row")
      .filter({ hasText: experiment })
      .filter({ hasText: "RGB" })
      .first()
    await expect(rgbRow).toBeVisible({ timeout: 30_000 })
    await rgbRow.click()
    await page.getByRole("button", { name: /create run/i }).click()
    await page.waitForURL(/\/process\/[^/]+\/run\/[^/?]+/)
    const runUrl = page.url()
    const runId = runUrl.split("/").pop()
    const wsId = runUrl.split("/process/")[1].split("/")[0]

    await page.getByRole("button", { name: "Import existing" }).first().click()
    await page.getByTestId("import-ortho-file").click()
    await page.getByRole("option", { name: "e2e_test_orthophoto.tif" }).click()
    await page.getByRole("button", { name: "Register orthomosaic" }).click()
    await expect(page.getByTestId("step-row-orthomosaic")).toHaveAttribute(
      "data-status",
      "completed",
      { timeout: 15_000 },
    )

    // ── 3. Boundaries over the ortho, then Split. ───────────────────────
    // The map fits to the ortho's bounds once TiTiler answers; draw inside.
    // Armed before navigating, or a fast answer is missed.
    const tilejson = page.waitForResponse(
      (r) => r.url().includes("tilejson.json"),
      { timeout: 30_000 },
    )
    await page.goto(
      `/process/${wsId}/tool?runId=${runId}&step=plot_boundary_prep`,
    )
    await expect(
      page.getByRole("heading", { name: /plot boundary prep/i }),
    ).toBeVisible()
    await tilejson
    // Outer boundary straight from the ortho's extent (main's
    // auto-boundary), no hand drawing.
    await page.getByTestId("boundary-auto-from-ortho").click()
    await expect(page.locator("text=/0 plots? across 1 block/i")).toBeVisible()
    await page.getByTestId("boundary-rows").fill("2")
    await page.keyboard.press("Tab")
    await page.getByTestId("boundary-cols").fill("3")
    await page.keyboard.press("Tab")
    await page.getByRole("button", { name: /generate plot grid/i }).click()
    await expect(page.locator("text=/6 plots? across 1 block/i")).toBeVisible()
    await page.getByTestId("boundary-save-and-complete").click()
    await page.waitForURL((u) => !u.pathname.includes("/tool"), {
      timeout: 30_000,
    })

    const splitRow = page.getByTestId("step-row-split_orthomosaic")
    await expect(splitRow).toHaveAttribute("data-status", "ready", {
      timeout: 15_000,
    })
    await splitRow.getByRole("button", { name: /run step/i }).click()
    await expect(splitRow).toHaveAttribute("data-status", "completed", {
      timeout: 3 * 60_000,
    })

    // All six plot images download as one ZIP.
    const zipButton = splitRow.getByTestId("plot-images-zip")
    await expect(zipButton).toBeVisible({ timeout: 30_000 })
    const [zipDownload] = await Promise.all([
      page.waitForEvent("download"),
      zipButton.click(),
    ])
    expect(zipDownload.suggestedFilename()).toMatch(/^plot-images-.*\.zip$/)
    const entries = zipEntryNames(readFileSync(await zipDownload.path()))
    expect(entries.filter((e) => /plot_\d+.*\.png$/.test(e))).toHaveLength(6)

    // ── 4. Trait extraction with the thermal ortho. ─────────────────────
    const traitRow = page.getByTestId("step-row-trait_extraction")
    await expect(traitRow).toHaveAttribute("data-status", "ready", {
      timeout: 15_000,
    })
    await traitRow.getByRole("button", { name: /run step/i }).click()
    await page.getByTestId("trait-thermal").click()
    await page
      .getByRole("option", {
        name: `${platform}/Thermal · e2e_test_thermal.tif`,
      })
      .click()
    await expect(page.getByTestId("trait-thermal")).toContainText(
      "e2e_test_thermal.tif",
    )

    // Live threshold preview: one plot cropped from the ortho, masked in
    // the browser with the worker's rule.
    const previewVf = page.getByTestId("trait-preview-vf")
    await expect(previewVf).toHaveText(/Vegetation fraction \d\.\d{4}/, {
      timeout: 30_000,
    })
    const vfAt = async () =>
      Number(((await previewVf.textContent()) ?? "").replace(/[^\d.]/g, ""))
    const vfDefault = await vfAt()
    const previewPlot = (
      (await page.getByTestId("trait-preview-plot").textContent()) ?? ""
    ).replace(/\D/g, "")
    const slider = page.getByTestId("trait-exg-threshold")
    await slider.focus()
    await page.keyboard.press("End") // 0.50: far stricter
    await expect.poll(vfAt).toBeLessThan(vfDefault)
    await page.keyboard.press("Home")
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight")
    await expect(page.getByText("0.10", { exact: true })).toBeVisible()
    await expect.poll(vfAt).toBe(vfDefault)

    await page.getByRole("button", { name: "Run Trait Extraction" }).click()
    await expect(traitRow).toHaveAttribute("data-status", "completed", {
      timeout: 3 * 60_000,
    })

    // ── 5. Analyze → Table: canopy temperature per plot. ────────────────
    await page.goto("/analyze")
    await page.getByTestId("analyze-tab-table").click()
    const table = page.getByTestId("analyze-table")
    const expSelect = table.getByTestId("process-experiment-select")
    await expect(expSelect).toBeEnabled({ timeout: 15_000 })
    await expSelect.click()
    await page.getByRole("option", { name: experiment }).click()
    await table.getByTestId("process-season-select").click()
    await page.getByRole("option", { name: season }).click()
    await table.getByTestId("process-site-select").click()
    await page.getByRole("option", { name: location }).click()

    await expect(
      table.getByTestId("analyze-table-trait-Temp_veg_avg_C"),
    ).toBeVisible({
      timeout: 30_000,
    })
    const rows = table.getByTestId("analyze-table-row")
    await expect(rows).toHaveCount(6, { timeout: 30_000 })
    // Sort by temperature so a plot with vegetation leads.
    await table.getByTestId("analyze-table-sort-trait-Temp_veg_avg_C").click()
    await expect(rows.first()).toContainText("27.5")

    // The preview agrees with the extraction for the previewed plot (the
    // preview's crop is resampled, so allow a small difference).
    await table.getByTestId("analyze-table-query").fill(`plot:${previewPlot}`)
    await expect(rows).toHaveCount(1)
    const cells = await rows.first().locator("td").allTextContents()
    const header = await table.locator("thead th").allTextContents()
    const vfCol = header.findIndex((h) => h.includes("Vegetation_Fraction"))
    expect(vfCol).toBeGreaterThan(-1)
    expect(Math.abs(Number(cells[vfCol]) - vfDefault)).toBeLessThan(0.05)
    await table.getByTestId("analyze-table-query").fill("")

    // ── 6. Re-run replaces; deleting a run removes its values. ──────────
    // How many trait records this flight holds (read-only catalog).
    const recordCount = async () => {
      const res = await request.get("/api/multivariate_analysis/catalog", {
        headers: { Authorization: authHeader() },
      })
      const entries = (await res.json()) as Array<{
        experiment_name: string
        collection_date: string
        record_count: number
      }>
      return (
        entries.find(
          (e) => e.experiment_name === experiment && e.collection_date === date,
        )?.record_count ?? 0
      )
    }
    // One run's values: up to 6 plots × 2 traits (a plot with no
    // vegetation pixels has no canopy temperature, so no record).
    const firstCount = await recordCount()
    expect(firstCount).toBeGreaterThan(6)
    expect(firstCount).toBeLessThanOrEqual(12)

    await page.goto(`/process/${wsId}/run/${runId}`)
    const traitRow2 = page.getByTestId("step-row-trait_extraction")
    await traitRow2.getByRole("button", { name: /re-run|run step/i }).click()
    await page.getByTestId("trait-thermal").click()
    await page
      .getByRole("option", {
        name: `${platform}/Thermal · e2e_test_thermal.tif`,
      })
      .click()
    await page.getByRole("button", { name: "Run Trait Extraction" }).click()
    const panel = page.getByTestId("trait-records-panel")
    const runRows = panel.locator('[data-testid^="trait-record-row-"]')
    await expect(runRows).toHaveCount(2, { timeout: 15_000 })
    const newest = await runRows
      .first()
      .getAttribute("data-testid")
      .then((t) => (t ?? "").replace("trait-record-row-", ""))
    const older = await runRows
      .nth(1)
      .getAttribute("data-testid")
      .then((t) => (t ?? "").replace("trait-record-row-", ""))
    await expect(panel.getByTestId(`trait-record-live-${newest}`)).toHaveText(
      "Yes",
      { timeout: 3 * 60_000 },
    )
    await expect(panel.getByTestId(`trait-record-live-${older}`)).toHaveText(
      "No — replaced or deleted",
    )
    // Replaced, not appended: still one run's worth of records.
    expect(await recordCount()).toBe(firstCount)

    await panel.getByTestId(`trait-record-delete-${newest}`).click()
    await page.getByTestId("confirm-dialog-confirm").click()
    await expect(panel.getByTestId(`trait-record-live-${newest}`)).toHaveText(
      "No — replaced or deleted",
      { timeout: 15_000 },
    )
    await expect.poll(recordCount, { timeout: 15_000 }).toBe(0)
  })
})
