/**
 * Strict-E2E for the Analyze → Map zero-overlap diagnostic.
 *
 * Reproduces the real failure that motivated the diagnostic: trait records
 * and plot boundaries that describe the same field with *different* plot
 * numbering, so nothing joins and the map would otherwise show a silent
 * dash on every plot. The page must instead surface an explicit
 * "records exist but none match these boundaries" banner.
 *
 * Built entirely through the UI (no API seeding):
 *   1. Import a trait CSV numbered 701.. via the real import wizard.
 *   2. Create a workspace + aerial pipeline + run for the SAME
 *      experiment/season/site, and draw a 2×3 boundary grid numbered 1..6
 *      via the Plot Boundary tool (synthetic-draw through the exposed
 *      Leaflet handle — same path BoundaryMap gives a real draw).
 *   3. Open Analyze → Map, select the scope + trait, and assert the
 *      `analyze-map-no-trait-overlap` banner appears with both plot-number
 *      ranges (records 701.., boundaries 1..6).
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { fixturePath } from "../helpers/fixturePath"
import { expect, test } from "../helpers/fixtures"
import {
  dropFiles,
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"

const DRONE_IMAGES = [
  "2022-06-27_100MEDIA_DJI_0876.JPG",
  "2022-06-27_100MEDIA_DJI_0877.JPG",
]

test.describe("Analyze Map — zero-overlap diagnostic", () => {
  test.setTimeout(5 * 60_000)

  test("records numbered 701.. vs boundaries 1.. → no-overlap banner", async ({
    page,
    runPrefix,
  }) => {
    const experiment = `${runPrefix}-ovl-exp`
    const season = `${runPrefix}-S`
    const site = "Davis"
    const population = "Cowpea"
    const date = "2022-06-27"
    const platform = "DJI"
    const sensor = "FC6310S"
    const trait = `${runPrefix}-StandCount`
    const workspaceName = `${runPrefix}-ovl-ws`
    const pipelineName = `${runPrefix}-ovl-pipe`

    // ── 1. Import a trait CSV numbered 701.. (the field's true numbering),
    //       scoped to the same experiment/season/site the boundaries will
    //       use. Done through the real import wizard. ───────────────────
    const csv = [
      `plot_number,plot_row,plot_col,${trait}`,
      `701,2,24,15`,
      `702,2,25,10`,
      `703,2,26,21`,
      `704,3,24,26`,
      `705,3,25,20`,
      `706,3,26,28`,
    ].join("\n")

    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experiment)
    await page.keyboard.press("Escape")

    await page.getByTestId("upload-input").setInputFiles({
      name: `${runPrefix}-ovl.csv`,
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
    await page.getByTestId(`trait-checkbox-${trait}`).click()
    await page.getByTestId("collection-date-fixed").fill("2026-05-01")
    await page.getByTestId("season-fixed").fill(season)
    await page.getByTestId("site-fixed").fill(site)
    // Population MUST match the boundary upload's population so the map's
    // population-scoped join compares like with like. Without this the
    // records land population-NULL while the boundaries are population
    // Cowpea, so the population-filtered query returns 0 records and the
    // diagnostic correctly stays silent (no records ≠ zero overlap).
    await page.getByTestId("population-select").click()
    await page.getByRole("option", { name: /create new/i }).click()
    await page.getByTestId("population-name").fill(population)

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

    // ── 2. Upload drone images under the SAME experiment/season/site so a
    //       boundary run can be created in that scope. ───────────────────
    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, {
      experiment,
      season,
      location: site,
      population,
      date,
      platform,
      sensor,
    })
    await dropFiles(
      page,
      DRONE_IMAGES.map((n) => fixturePath("images", "drone", n)),
    )
    await submitUploadAndWait(page, DRONE_IMAGES.length)

    // ── 3. Workspace + aerial pipeline + run. ───────────────────────────
    await page.goto("/process")
    await page.locator('[data-onboarding="process-new-workspace"]').click()
    await page.getByLabel(/workspace name/i).fill(workspaceName)
    await page.getByRole("button", { name: /create workspace/i }).click()
    await page.getByText(workspaceName, { exact: true }).click()
    await page.getByRole("button", { name: /create aerial pipeline/i }).click()
    await page.getByLabel(/pipeline name/i).fill(pipelineName)
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /create pipeline/i }).click()

    await page
      .getByRole("button", { name: /new run/i })
      .first()
      .click()
    const uploadRow = page
      .getByTestId("upload-row")
      .filter({ hasText: experiment })
      .filter({ hasText: date })
      .filter({ hasText: platform })
      .filter({ hasText: sensor })
      .first()
    await expect(uploadRow).toBeVisible({ timeout: 30_000 })
    await uploadRow.click()
    await page.getByRole("button", { name: /create run/i }).click()

    // ── 4. Draw a 2×3 boundary grid (default numbering 1..6) and save. ──
    const runUrl = page.url()
    const runId = runUrl.split("/").pop()
    const wsId = runUrl.split("/process/")[1].split("/")[0]
    await page.goto(
      `/process/${wsId}/tool?runId=${runId}&step=plot_boundary_prep`,
    )
    await expect(
      page.getByRole("heading", { name: /plot boundary prep/i }),
    ).toBeVisible()

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
      const L = w.L
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
      const layer = L.polygon(ring)
      layer.addTo(map)
      map.fire("pm:create", { layer, shape: "Polygon" })
    })

    await page.getByTestId("boundary-rows").fill("2")
    await page.keyboard.press("Tab")
    await page.getByTestId("boundary-cols").fill("3")
    await page.keyboard.press("Tab")
    await page.getByRole("button", { name: /generate plot grid/i }).click()
    await expect(page.locator("text=/6 plots? across 1 block/i")).toBeVisible()

    // Save + activate the version so the boundaries materialize into
    // `plots` (this is what /plots/geojson reads on the analyze map).
    await page.getByTestId("boundary-save-and-complete").click()
    await expect(page.getByText(/saved \+ activated/i).first()).toBeVisible({
      timeout: 30_000,
    })

    // ── 5. Analyze → Map → select scope + trait → expect overlap banner. ─
    await page.goto("/analyze")
    await expect(page.getByRole("heading", { name: /^analyze$/i })).toBeVisible(
      { timeout: 15_000 },
    )
    await page.getByTestId("analyze-tab-map").click()

    // Scope: pick experiment (auto-selected if only one visible, but set
    // it explicitly), then season + site. Each selection refetches the
    // level below it, so assert the trigger shows its chosen value before
    // moving on rather than chaining clicks through a re-rendering row.
    //
    // This spec's experiment name is long enough that it used to overflow
    // the scope picker's grid cell and push the Season trigger on top of
    // Experiment, which swallowed the click — fixed in AerialScopePicker
    // by constraining the triggers to their cells (see the comment there).
    const expSelect = page.getByTestId("process-experiment-select")
    await expect(expSelect).toBeVisible()
    await expect(expSelect).toBeEnabled()
    await expSelect.click()
    await page.getByRole("option", { name: experiment }).click()
    await expect(expSelect).toContainText(experiment)

    const seasonSelect = page.getByTestId("process-season-select")
    await expect(seasonSelect).toBeEnabled()
    await seasonSelect.click()
    await page.getByRole("option", { name: season }).click()
    await expect(seasonSelect).toContainText(season)

    const siteSelect = page.getByTestId("process-site-select")
    await expect(siteSelect).toBeEnabled()
    await siteSelect.click()
    await page.getByRole("option", { name: site }).click()
    await expect(siteSelect).toContainText(site)

    // Polygons load → pick the trait.
    await expect(page.getByTestId("analyze-map-trait")).toBeVisible()
    await page.getByTestId("analyze-map-trait").click()
    await page
      .getByRole("option", { name: new RegExp(trait) })
      .first()
      .click()

    // The banner must appear, naming the conflicting plot-number ranges.
    const banner = page.getByTestId("analyze-map-no-trait-overlap")
    await expect(banner).toBeVisible({ timeout: 30_000 })
    await expect(banner).toContainText(/701/)
    await expect(banner).toContainText(/none match/i)

    // ── Click-through: clicking a plot opens its image dialog. ──────────
    // The polygons are a deck.gl WebGL layer, so there is no DOM node per
    // plot — click the canvas where the grid is drawn. The map fits its
    // view to the polygons' bbox, so the centre is inside a plot.
    const mapBox = page.getByTestId("trait-map-container")
    await expect(mapBox).toBeVisible()
    const box = await mapBox.boundingBox()
    if (!box) throw new Error("trait map has no box")
    // Deck resolves clicks from pointer down+up at the same spot; a bare
    // mouse.click sometimes lands before the hover/pick state settles.
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.waitForTimeout(300)
    await page.mouse.down()
    await page.waitForTimeout(60)
    await page.mouse.up()
    await page.waitForTimeout(800)

    const dialog = page.getByTestId("plot-image-dialog")
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    // This run never executed SPLIT_ORTHOMOSAIC (no ODM ortho exists), so
    // the honest state is "no image yet" — NOT a broken image or a silent
    // empty dialog. That distinction is the point: the user is told what
    // to do about it.
    await expect(page.getByTestId("plot-image-missing")).toBeVisible()
    await expect(page.getByTestId("plot-image-missing")).toContainText(
      /split into plot images/i,
    )
    // Close via the dialog's own control. Escape doesn't reach it here:
    // the click left focus on the deck.gl canvas, not inside the dialog.
    await dialog.getByRole("button", { name: /close/i }).click()
    await expect(dialog).toBeHidden()
  })
})
