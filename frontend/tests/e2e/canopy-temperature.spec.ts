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
    await page.goto(
      `/process/${wsId}/tool?runId=${runId}&step=plot_boundary_prep`,
    )
    await expect(
      page.getByRole("heading", { name: /plot boundary prep/i }),
    ).toBeVisible()
    // The map fits to the ortho's bounds once TiTiler answers; draw inside.
    await page.waitForResponse((r) => r.url().includes("tilejson.json"), {
      timeout: 30_000,
    })
    await page.waitForTimeout(1000)
    await page.evaluate(() => {
      const w = window as unknown as {
        __leafletMap__?: {
          getBounds(): {
            getSouthWest(): { lat: number; lng: number }
            getNorthEast(): { lat: number; lng: number }
          }
          fire(name: string, payload: unknown): void
        }
        L?: {
          polygon(ring: [number, number][]): { addTo(map: unknown): unknown }
        }
      }
      const map = w.__leafletMap__
      if (!map || !w.L) throw new Error("leaflet map handle missing")
      const b = map.getBounds()
      const sw = b.getSouthWest()
      const ne = b.getNorthEast()
      const w2 = (ne.lng - sw.lng) * 0.4
      const h2 = (ne.lat - sw.lat) * 0.4
      const cx = (sw.lng + ne.lng) / 2
      const cy = (sw.lat + ne.lat) / 2
      const ring: [number, number][] = [
        [cy - h2 / 2, cx - w2 / 2],
        [cy - h2 / 2, cx + w2 / 2],
        [cy + h2 / 2, cx + w2 / 2],
        [cy + h2 / 2, cx - w2 / 2],
        [cy - h2 / 2, cx - w2 / 2],
      ]
      const layer = w.L.polygon(ring)
      layer.addTo(map)
      map.fire("pm:create", { layer, shape: "Polygon" })
    })
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
  })
})
