/**
 * Ground (Amiga) pipeline, end to end through the UI:
 *
 *   upload an Amiga .bin (a 30-frame cut of a real pass; see
 *   fixtures/scripts/generate-amiga-track-fixture.py) → extraction →
 *   workspace + ground pipeline (Amiga preset) + run → Data Sync →
 *   Plot Marking: step through the frames, mark two plots, set their
 *   stitching direction, save → pipeline settings: set crop rules (drag in
 *   the visual crop tool; a south-heading rule) → Stitching: RUN_STITCH runs AgRowStitch per
 *   plot and georeferences each → the stitched plot mosaics show on the
 *   run page → Plot Boundary Prep draws over the combined ground mosaic;
 *   outline it and grid it into two plots → Associate Boundaries matches
 *   each stitched plot to a polygon and writes PlotImages/ →
 *   reopening Plot Marking shows the saved markings.
 *
 * Load-bearing checks: the marker must actually show the extracted frames
 * (a broken track lookup shows "No extracted rover frames"); the stitch
 * must produce an image per marked plot that the browser can decode; and
 * the backend must hold a georeferenced combined mosaic whose footprints
 * sit on the fixture's GPS track (Davis, 38.5366 N) — a stitch that ignored
 * the markings or skipped georeferencing fails here.
 *
 * Strict-E2E rules (CLAUDE.md): everything is created through the UI; the
 * only API calls are reads that confirm what the UI did.
 */
import type { Page } from "@playwright/test"

import { fixturePath } from "../helpers/fixturePath"
import { expect, test } from "../helpers/fixtures"
import { runDataSync } from "../helpers/processHelpers"
import {
  dropFiles,
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"

async function authHeadersFor(page: Page) {
  const auth = await page.context().storageState()
  const token =
    auth.origins
      .flatMap((o) => o.localStorage)
      .find((e) => e.name === "gemini.auth.token")?.value ?? ""
  return { Authorization: `Bearer ${token}` }
}

const BIN = "2024_07_15_15_49_18_998387_track-fixture.0000.bin"
const EXTRACTION_TIMEOUT_MS = 5 * 60_000
// Two plots of 5 frames each: ~30–90 s of CPU stitching per plot.
const STITCH_TIMEOUT_MS = 10 * 60_000

test.describe("R6: ground pipeline — plot marking → stitching", () => {
  test.setTimeout(EXTRACTION_TIMEOUT_MS + STITCH_TIMEOUT_MS + 3 * 60_000)

  test("mark two plots on a real Amiga track and stitch them", async ({
    page,
    request,
    baseURL,
    runPrefix,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const experiment = `${runPrefix}-r6-exp`
    const location = "Davis"
    const population = "Cowpea"
    const date = "2024-07-15"
    const season = "2024"
    const workspaceName = `${runPrefix}-r6-workspace`
    const pipelineName = `${runPrefix}-r6-pipeline`

    // ── Upload the rover log and let it extract ──────────────────────────
    await navigateToUpload(page)
    await selectDataType(page, "Farm-ng Binary File")
    await fillUploadForm(page, {
      experiment,
      season,
      location,
      population,
      date,
    })
    await dropFiles(page, [fixturePath("binary", BIN)])
    await submitUploadAndWait(page, 1, { timeoutMs: EXTRACTION_TIMEOUT_MS })

    // ── Workspace → ground pipeline (Amiga preset) → run ─────────────────
    await page.goto("/process")
    await page.locator('[data-onboarding="process-new-workspace"]').click()
    await page.getByLabel(/workspace name/i).fill(workspaceName)
    await page.getByRole("button", { name: /create workspace/i }).click()
    await page.getByText(workspaceName, { exact: true }).click()

    await page.getByRole("button", { name: /create ground pipeline/i }).click()
    await page.getByLabel(/pipeline name/i).fill(pipelineName)
    await page.getByRole("button", { name: /^next$/i }).click()
    await page
      .getByRole("button", { name: /Amiga.*Farm-ng ground robot/ })
      .click()
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
      .filter({ hasText: "Amiga" })
      .first()
    await expect(uploadRow).toBeVisible({ timeout: 30_000 })
    await uploadRow.click()
    await page.getByRole("button", { name: /create run/i }).click()
    const runUrl = page.url()

    // The rover log carries its own track: Data Sync keeps it.
    const dataSyncRow = await runDataSync(page)
    await expect(dataSyncRow.getByTestId("data-sync-summary")).toHaveText(
      "30 of 30 images have a position",
    )

    // ── Plot Marking ─────────────────────────────────────────────────────
    const markingRow = page.getByTestId("step-row-plot_marking")
    await expect(markingRow).toHaveAttribute("data-status", "ready")
    await markingRow.getByRole("button", { name: /open tool/i }).click()

    const marker = page.getByTestId("plot-marker")
    await expect(marker).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("pm-frame-count")).toHaveText("/ 30")
    // The frame itself decodes (not a broken image or a spinner).
    const frameImg = page.getByTestId("pm-frame")
    await expect(frameImg).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(() =>
        frameImg.evaluate((el) => (el as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0)
    // The rover heads south on this pass (msgs_synced direction column).
    await expect(marker).toContainText("Heading South")

    const frameName = page.getByTestId("pm-frame-name")
    const frameIndex = page.getByTestId("pm-frame-index")
    const goTo = async (n: number) => {
      await frameIndex.fill(String(n))
      await expect(frameIndex).toHaveValue(String(n))
    }
    const setDirection = async (label: string) => {
      await page.getByTestId("pm-direction").click()
      await page.getByRole("option", { name: label, exact: true }).click()
      await expect(page.getByTestId("pm-direction")).toContainText(label)
    }

    // Plot 1: frames 1–5 (buttons), stitched left-to-right on this camera.
    await goTo(1)
    const plot1Start = (await frameName.textContent()) ?? ""
    await page.getByTestId("pm-mark-start").click()
    await goTo(5)
    const plot1End = (await frameName.textContent()) ?? ""
    await page.getByTestId("pm-mark-end").click()
    await setDirection("Right")
    await expect(page.getByTestId("pm-start")).toHaveText(plot1Start)
    await expect(page.getByTestId("pm-end")).toHaveText(plot1End)
    await expect(page.getByTestId("pm-done-count")).toHaveText("1/1 done")

    // Plot 2: frames 6–10 with the keyboard (N, →, S, E), inheriting
    // plot 1's direction.
    await page.getByTestId("pm-plot-label").click() // move focus off the input
    await page.keyboard.press("n")
    await expect(page.getByTestId("pm-plot-label")).toHaveText("Plot 2")
    await goTo(5)
    await page.getByTestId("pm-plot-label").click()
    await page.keyboard.press("ArrowRight")
    await expect(frameIndex).toHaveValue("6")
    const plot2Start = (await frameName.textContent()) ?? ""
    await page.keyboard.press("s")
    await goTo(10)
    const plot2End = (await frameName.textContent()) ?? ""
    await page.getByTestId("pm-plot-label").click()
    await page.keyboard.press("e")
    await expect(page.getByTestId("pm-direction")).toContainText("Right")
    await expect(page.getByTestId("pm-done-count")).toHaveText("2/2 done")
    expect(new Set([plot1Start, plot1End, plot2Start, plot2End]).size).toBe(4)

    // The GPS map draws the track.
    await page.getByTestId("pm-gps-toggle").click()
    await expect(page.getByTestId("pm-gps-map")).toBeVisible()
    await expect(
      page
        .getByTestId("pm-gps-map")
        .locator("path.leaflet-interactive")
        .first(),
    ).toBeAttached()

    await page.getByTestId("pm-save").click()
    await expect(page.getByText("Saved 2 plot markings")).toBeVisible()
    await page.getByRole("button", { name: /^back$/i }).click()
    await expect(page).toHaveURL(runUrl)
    await expect(markingRow).toHaveAttribute("data-status", "completed")

    // ── Crop rules in the pipeline settings ──────────────────────────────
    // The catch-all rule's left crop is set by dragging in the visual tool;
    // a second rule for southbound travel crops the top. The rover heads
    // south, so both plots must be stitched with the south rule.
    await page.getByRole("link", { name: "Process" }).click()
    await page.getByText(workspaceName, { exact: true }).click()
    await page.getByRole("button", { name: /^settings$/i }).click()
    await page.getByRole("button", { name: /^next$/i }).click()
    const rules = page.getByTestId("crop-rules")
    await expect(rules.getByTestId("crop-rule-0")).toBeVisible()

    await rules
      .getByTestId("crop-rule-0")
      .getByRole("button", { name: "Open visual crop tool" })
      .click()
    const cropTool = page.getByTestId("edge-crop-tool")
    const cropFrame = cropTool.getByTestId("edge-crop-frame")
    await expect(cropFrame).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(() =>
        cropFrame.evaluate((el) => (el as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0)
    await expect(cropTool.getByTestId("edge-crop-count")).toHaveText("1 / 30")
    const handle = cropTool.getByTestId("edge-crop-handle-left")
    const box = await handle.boundingBox()
    if (!box) throw new Error("no crop handle")
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 6 })
    await page.mouse.up()
    const leftText =
      (await cropTool.getByTestId("edge-crop-left").textContent()) ?? ""
    const leftPx = Number.parseInt(leftText, 10)
    expect(leftPx).toBeGreaterThan(50)
    await cropTool.getByTestId("edge-crop-apply").click()
    await expect(cropTool).toHaveCount(0)
    await expect(
      rules.getByTestId("crop-rule-0").getByLabel("left crop (px)"),
    ).toHaveValue(String(leftPx))

    await rules.getByRole("button", { name: "Add rule" }).click()
    const southRule = rules.getByTestId("crop-rule-1")
    await southRule.getByTitle("Add S").click()
    await expect(southRule.getByTitle("S — click to remove")).toBeVisible()
    await southRule.getByLabel("top crop (px)").fill("40")
    // The tool shows only frames taken heading south, with its badge.
    await southRule
      .getByRole("button", { name: "Open visual crop tool" })
      .click()
    await expect(cropTool).toContainText("S only")
    await expect(cropTool.getByTestId("edge-crop-frame")).toBeVisible({
      timeout: 30_000,
    })
    await cropTool.getByRole("button", { name: /cancel/i }).click()

    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /save changes/i }).click()
    await page.goto(runUrl)

    // ── Stitching ────────────────────────────────────────────────────────
    const stitchRow = page.getByTestId("step-row-stitching")
    await expect(stitchRow).toHaveAttribute("data-status", "ready")
    await stitchRow.getByRole("button", { name: /run step/i }).click()
    await expect(stitchRow).toHaveAttribute("data-status", "completed", {
      timeout: STITCH_TIMEOUT_MS,
    })

    const results = stitchRow.getByTestId("stitch-results")
    await expect(results).toBeVisible({ timeout: 30_000 })
    await expect(results.getByTestId("stitch-summary")).toHaveText(
      "2 plot mosaics of 2 marked · georeferenced",
    )
    await expect(results.getByTestId("stitch-failed")).toHaveCount(0)
    const mosaics = results.getByTestId("stitch-plot")
    await expect(mosaics).toHaveCount(2)
    for (const i of [0, 1]) {
      const img = mosaics.nth(i).locator("img")
      await expect(img).toBeVisible({ timeout: 30_000 })
      // A stitched strip is wider than one frame is tall — a real mosaic.
      const [w, h] = await img.evaluate((el) => [
        (el as HTMLImageElement).naturalWidth,
        (el as HTMLImageElement).naturalHeight,
      ])
      expect(w).toBeGreaterThan(h)
      await expect(mosaics.nth(i)).toContainText(`Plot ${i + 1}`)
    }

    // Read-only check of what the worker stored.
    const headers = await authHeadersFor(page)
    const prefix = `Processed/${season}/${experiment}/${location}/${population}/${date}/Amiga/RGB/AgRowStitch_v1/`
    const listed = await request.get(
      new URL(`/api/files/list/gemini/${prefix}`, baseURL).toString(),
      { headers },
    )
    expect(listed.ok()).toBe(true)
    const names = ((await listed.json()) as { object_name: string }[]).map(
      (f) => f.object_name.slice(prefix.length),
    )
    expect(names).toEqual(
      expect.arrayContaining([
        "full_res_mosaic_temp_plot_1.png",
        "full_res_mosaic_temp_plot_2.png",
        "georeferenced_plot_1_utm.tif",
        "georeferenced_plot_2_utm.tif",
        "combined_mosaic.tif",
        "plot_borders.csv",
        "stitch_manifest.json",
      ]),
    )
    const manifestRes = await request.get(
      new URL(
        `/api/files/download/gemini/${prefix}stitch_manifest.json`,
        baseURL,
      ).toString(),
      { headers },
    )
    const manifest = (await manifestRes.json()) as {
      succeeded_plots: string[]
      plots: Record<
        string,
        { frames: number; mask: number[]; footprint: [number, number][] }
      >
      config: { mask: number[] }
    }
    expect(manifest.succeeded_plots).toEqual(["1", "2"])
    // The catch-all rule is the pipeline-wide default…
    expect(manifest.config.mask).toEqual([leftPx, 0, 0, 0])
    for (const id of ["1", "2"]) {
      expect(manifest.plots[id].frames).toBe(5)
      // …but the south rule names these southbound plots, so it wins.
      expect(manifest.plots[id].mask).toEqual([0, 0, 40, 0])
      for (const [lon, lat] of manifest.plots[id].footprint) {
        expect(lat).toBeCloseTo(38.5366, 3)
        expect(lon).toBeCloseTo(-121.7765, 3)
      }
    }
    // Plot 2 was marked further along the southbound pass: it lies south.
    const meanLat = (id: string) => {
      const ring = manifest.plots[id].footprint
      return ring.reduce((s, [, lat]) => s + lat, 0) / ring.length
    }
    expect(meanLat("2")).toBeLessThan(meanLat("1"))

    // ── Plot Boundary Prep draws over the ground mosaic ─────────────────
    // Ground runs have no ortho; the georeferenced combined mosaic is the
    // underlay. At least one of its TiTiler tiles must actually decode.
    const boundaryRow = page.getByTestId("step-row-plot_boundary_prep")
    await expect(boundaryRow).toHaveAttribute("data-status", "ready")
    await boundaryRow.getByRole("button", { name: /open tool/i }).click()
    const mosaicTiles = page.locator(
      'img.leaflet-tile[src*="/titiler/cog/tiles/"][src*="combined_mosaic.tif"]',
    )
    await expect(mosaicTiles.first()).toBeAttached({ timeout: 60_000 })
    await expect
      .poll(
        () =>
          mosaicTiles.evaluateAll((imgs) =>
            imgs.some((el) => (el as HTMLImageElement).naturalWidth > 0),
          ),
        { timeout: 30_000 },
      )
      .toBe(true)

    // Outline the mosaic and split it into two plots, north and south.
    await page.getByTestId("boundary-auto-from-ortho").click()
    await page.getByTestId("boundary-rows").fill("2")
    await page.keyboard.press("Tab")
    await page.getByTestId("boundary-cols").fill("1")
    await page.keyboard.press("Tab")
    await page.getByRole("button", { name: /generate plot grid/i }).click()
    await expect(page.locator("text=/2 plots? across 1 block/i")).toBeVisible()
    await page.getByTestId("boundary-save-and-complete").click()
    await expect(page.getByText(/saved \+ activated/i).first()).toBeVisible({
      timeout: 30_000,
    })
    await page.goto(runUrl)

    // ── Associate Boundaries ─────────────────────────────────────────────
    // Each stitched plot's centre falls in one of the two polygons: plot 1
    // (marked first on the southbound pass) in the north one.
    const assocRow = page.getByTestId("step-row-associate_boundaries")
    await expect(assocRow).toHaveAttribute("data-status", "ready", {
      timeout: 30_000,
    })
    await assocRow.getByRole("button", { name: /run step/i }).click()
    await expect(assocRow).toHaveAttribute("data-status", "completed", {
      timeout: 5 * 60_000,
    })
    const assoc = assocRow.getByTestId("association-results")
    await expect(assoc.getByTestId("association-summary")).toHaveText(
      "2 of 2 stitched plots matched a boundary (stitch v1)",
      { timeout: 30_000 },
    )
    const cells = await assoc
      .getByTestId("association-table")
      .locator("tbody tr")
      .evaluateAll((trs) =>
        trs.map((tr) =>
          Array.from(tr.querySelectorAll("td")).map((td) => td.textContent),
        ),
      )
    expect(cells.map((c) => c[0])).toEqual(["1", "2"])
    const boundaryPlots = cells.map((c) => c[1])
    expect(new Set(boundaryPlots).size).toBe(2)
    expect(boundaryPlots.every((p) => p === "1" || p === "2")).toBe(true)
    // The matched plots' images are where Analyze and inference look.
    const plotImagesPrefix = `Processed/${season}/${experiment}/${location}/${population}/${date}/Amiga/RGB/PlotImages/`
    const plotImages = await request.get(
      new URL(`/api/files/list/gemini/${plotImagesPrefix}`, baseURL).toString(),
      { headers: await authHeadersFor(page) },
    )
    expect(
      ((await plotImages.json()) as { object_name: string }[])
        .map((f) => f.object_name.slice(plotImagesPrefix.length))
        .sort(),
    ).toEqual(["plot_1_accession_unknown.png", "plot_2_accession_unknown.png"])

    // ── The markings persisted ───────────────────────────────────────────
    await markingRow.getByRole("button", { name: /re-open tool/i }).click()
    await expect(page.getByTestId("pm-done-count")).toHaveText("2/2 done", {
      timeout: 30_000,
    })
    await expect(page.getByTestId("pm-plot-label")).toHaveText("Plot 1")
    await expect(page.getByTestId("pm-start")).toHaveText(plot1Start)
    await expect(page.getByTestId("pm-end")).toHaveText(plot1End)
    await expect(page.getByTestId("pm-version-select")).toHaveValue("1")
  })
})
