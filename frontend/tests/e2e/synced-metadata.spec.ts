/**
 * Strict-E2E for Synced Metadata: upload your own GPS manifest, map its
 * columns, save, and look at it in the metadata viewer (main's PR #153).
 *
 * Before: Save only downloaded the remapped CSV to the user's machine (the
 * old /api/v1 route was gone), and the viewer didn't exist here. Now the
 * mapping is saved as Metadata/msgs_synced.csv beside the upload, and
 * Manage Data opens any CSV in a table / lat-lon / time-series viewer.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { expect, test } from "../helpers/fixtures"
import {
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"

test.describe("Synced metadata → metadata viewer", () => {
  test.setTimeout(180_000)

  test("upload a GPS CSV, map its columns, save, and view the track", async ({
    page,
    runPrefix,
  }) => {
    const experiment = `${runPrefix}-sync-exp`
    // The user's own column names; every one has an alias the mapper knows.
    const csv = [
      "filename,unix_time,latitude,longitude,altitude",
      "IMG_0001.jpg,1717243200.0,38.5371,-121.7552,15.2",
      "IMG_0002.jpg,1717243201.0,38.5372,-121.7551,15.3",
      "IMG_0003.jpg,1717243202.0,38.5373,-121.7550,15.1",
    ].join("\n")

    await navigateToUpload(page)
    await selectDataType(page, "Synced Metadata")
    await fillUploadForm(page, {
      experiment,
      location: "Davis",
      population: "Cowpea",
      date: "2024-06-01",
      platform: "Amiga",
      sensor: "RGB",
    })
    await page.getByTestId("upload-input").setInputFiles({
      name: "rover_gps.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    })
    await submitUploadAndWait(page, 1)

    // ── Column mapping: auto-detected, then saved to the scope. ─────────
    const mapDialog = page.getByRole("dialog")
    await expect(
      mapDialog.getByRole("heading", { name: "Map Columns" }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      mapDialog.getByTestId("msgs-synced-save-target"),
    ).toContainText("/Metadata/msgs_synced.csv")
    await mapDialog.getByRole("button", { name: "Save mapping" }).click()
    await expect(mapDialog).toBeHidden({ timeout: 30_000 })

    // ── Manage Data: the original and the saved manifest are both there;
    //    the manifest opens in the viewer with the pipeline's names. ────
    await page.locator('[data-onboarding="files-tab-manage"]').click()
    await page.getByTestId("manage-data-filter").fill(experiment)
    const expRow = page.getByTestId(`manage-data-experiment-${experiment}`)
    await expect(expRow).toBeVisible({ timeout: 30_000 })
    await expRow.getByRole("button", { name: "Expand" }).click()
    const list = page.getByTestId("manage-data-list")
    await expect(
      list.locator('[data-testid^="download-"][data-testid$="/rover_gps.csv"]'),
    ).toBeVisible({ timeout: 30_000 })
    const view = list.locator(
      '[data-testid^="view-"][data-testid$="/Metadata/msgs_synced.csv"]',
    )
    await expect(view).toBeVisible()
    await view.click()

    const viewer = page.getByTestId("metadata-viewer")
    await expect(viewer).toContainText("5 columns · 3 rows", {
      timeout: 30_000,
    })
    // Remapped to the pipeline's names. (The table hides file-path columns
    // like image_path, as main's viewer did; the 5-column count above
    // includes it.)
    const header = viewer.locator("table thead")
    for (const col of ["timestamp", "lat", "lon", "alt"]) {
      await expect(header).toContainText(col)
    }
    await expect(viewer.locator("table tbody tr")).toHaveCount(3)
    await viewer.getByTestId("metadata-tab-latlon").click()
    await expect(viewer).toContainText("3 points — X: lon, Y: lat")
  })
})
