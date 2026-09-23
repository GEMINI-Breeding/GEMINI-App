/**
 * HEAVY, local only: the ground pipeline on the full 2024-07-15 Amiga logs
 * (2 × ~1.3 GB, ExampleDatasets/Subset Amiga Data/2024-07-15/Onboard/),
 * not the 12-second fixture the CI spec uses.
 *
 *   upload both logs as one Farm-ng upload → extraction (one merged track)
 *   → ground run → Data Sync → Plot Marking: three plots sampled across the
 *   pass (~15 %, ~45 %, ~75 %), each where the rover is driving straight
 *   north or south, stitching direction from that heading → Stitching.
 *
 * Checks what the fixture can't: gigabyte uploads through the browser,
 * multi-log extraction into one track, a track of thousands of frames in
 * the marker, and stitching of both travel directions. Prints the time of
 * each stage (upload + extraction, stitching) as real-data numbers.
 *
 * Runs only with RUN_HEAVY_E2E=1 and the example data present:
 *   RUN_HEAVY_E2E=1 npm run test:e2e -- tests/e2e/ground-full-amiga-logs.heavy.spec.ts
 */
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test } from "../helpers/fixtures"
import { runDataSync } from "../helpers/processHelpers"
import {
  dropFiles,
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"

const ONBOARD = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../ExampleDatasets/Subset Amiga Data/2024-07-15/Onboard",
)
const LOGS = [
  "2024_07_15_15_49_18_998387_moats-unproved.0000.bin",
  "2024_07_15_15_52_25_212263_moats-unproved.0000.bin",
].map((n) => path.join(ONBOARD, n))
const HEAVY = process.env.RUN_HEAVY_E2E === "1"
const PLOT_FRAMES = 12
// The top camera looks down with the rover's travel across the frame:
// southbound, the scene moves left in the image and AgRowStitch stitches
// RIGHT (verified on the fixture); northbound is the mirror image.
const STITCH_FOR: Record<string, string> = { South: "Right", North: "Left" }

test.describe("HEAVY: full Amiga logs through the ground pipeline", () => {
  test.skip(!HEAVY, "Set RUN_HEAVY_E2E=1 to run the full-log spec")
  test.skip(
    !LOGS.every((f) => existsSync(f)),
    "Needs ExampleDatasets/Subset Amiga Data/2024-07-15/Onboard",
  )
  test.setTimeout(3 * 60 * 60_000)

  test("two 1.3 GB logs → one track → three plots stitched", async ({
    page,
    runPrefix,
  }) => {
    const timings: Record<string, string> = {}
    const clock = () => {
      const t0 = Date.now()
      return () => `${((Date.now() - t0) / 60_000).toFixed(1)} min`
    }
    const experiment = `${runPrefix}-full-exp`

    let lap = clock()
    await navigateToUpload(page)
    await selectDataType(page, "Farm-ng Binary File")
    await fillUploadForm(page, {
      experiment,
      season: "2024",
      location: "Davis",
      population: "Cowpea",
      date: "2024-07-15",
    })
    await dropFiles(page, LOGS)
    await submitUploadAndWait(page, 2, { timeoutMs: 2 * 60 * 60_000 })
    timings["upload + extraction (2.6 GB)"] = lap()

    await page.goto("/process")
    await page.locator('[data-onboarding="process-new-workspace"]').click()
    await page.getByLabel(/workspace name/i).fill(`${runPrefix}-full-ws`)
    await page.getByRole("button", { name: /create workspace/i }).click()
    await page.getByText(`${runPrefix}-full-ws`, { exact: true }).click()
    await page.getByRole("button", { name: /create ground pipeline/i }).click()
    await page.getByLabel(/pipeline name/i).fill(`${runPrefix}-full-pl`)
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
    const row = page
      .getByTestId("upload-row")
      .filter({ hasText: experiment })
      .filter({ hasText: "Amiga" })
      .first()
    await expect(row).toBeVisible({ timeout: 60_000 })
    await row.click()
    await page.getByRole("button", { name: /create run/i }).click()
    const runUrl = page.url()

    const synced = await runDataSync(page)
    const summary =
      (await synced.getByTestId("data-sync-summary").textContent()) ?? ""
    const frames = Number(/of (\d+) images/.exec(summary)?.[1] ?? 0)
    // Both logs, merged into one track (1204 + 1206 top-camera frames).
    // Half of that means the upload reported done before the second
    // extraction finished, or the second replaced the first.
    expect(frames, summary).toBe(2410)
    timings.frames = String(frames)

    // ── Plot Marking: three plots across the pass ───────────────────────
    await page
      .getByTestId("step-row-plot_marking")
      .getByRole("button", { name: /open tool/i })
      .click()
    await expect(page.getByTestId("pm-frame-count")).toHaveText(`/ ${frames}`, {
      timeout: 120_000,
    })
    const marker = page.getByTestId("plot-marker")
    const index = page.getByTestId("pm-frame-index")
    const goTo = async (n: number) => {
      await index.fill(String(n))
      await expect(index).toHaveValue(String(n))
      await expect(page.getByTestId("pm-frame")).toBeVisible({
        timeout: 60_000,
      })
    }
    const headingAt = async (n: number) => {
      await goTo(n)
      const text = (await marker.textContent()) ?? ""
      return /Heading (North|South|East|West)/.exec(text)?.[1] ?? ""
    }
    const plots: { start: number; heading: string }[] = []
    for (const fraction of [0.15, 0.45, 0.75]) {
      let start = Math.round(frames * fraction)
      // Straight along a row: the same N/S heading at both ends of the plot.
      for (let tries = 0; tries < 40; tries++, start += 25) {
        const a = await headingAt(start)
        const b = await headingAt(start + PLOT_FRAMES - 1)
        if (a === b && STITCH_FOR[a]) break
      }
      const heading = await headingAt(start)
      expect(
        STITCH_FOR[heading],
        `no straight run near ${fraction}`,
      ).toBeTruthy()
      plots.push({ start, heading })
    }
    timings.plots = plots.map((p) => `${p.start}(${p.heading})`).join(", ")

    for (const [i, p] of plots.entries()) {
      if (i > 0) {
        await page.getByTestId("pm-plot-label").click()
        await page.keyboard.press("n")
        await expect(page.getByTestId("pm-plot-label")).toHaveText(
          `Plot ${i + 1}`,
        )
      }
      await goTo(p.start)
      await page.getByTestId("pm-mark-start").click()
      await goTo(p.start + PLOT_FRAMES - 1)
      await page.getByTestId("pm-mark-end").click()
      await page.getByTestId("pm-direction").click()
      await page
        .getByRole("option", { name: STITCH_FOR[p.heading], exact: true })
        .click()
    }
    await expect(page.getByTestId("pm-done-count")).toHaveText("3/3 done")
    await page.getByTestId("pm-save").click()
    await expect(page.getByText("Saved 3 plot markings")).toBeVisible()
    await page.goto(runUrl)

    // ── Stitching ────────────────────────────────────────────────────────
    lap = clock()
    const stitchRow = page.getByTestId("step-row-stitching")
    await stitchRow.getByRole("button", { name: /run step/i }).click()
    await expect(stitchRow).toHaveAttribute("data-status", "completed", {
      timeout: 60 * 60_000,
    })
    timings["stitching (3 plots)"] = lap()
    const results = stitchRow.getByTestId("stitch-results")
    await expect(results.getByTestId("stitch-summary")).toHaveText(
      "3 plot mosaics of 3 marked · georeferenced",
      { timeout: 60_000 },
    )
    await expect(results.getByTestId("stitch-failed")).toHaveCount(0)
    for (const img of await results
      .getByTestId("stitch-plot")
      .locator("img")
      .all()) {
      await expect(img).toBeVisible({ timeout: 60_000 })
      const [w, h] = await img.evaluate((el) => [
        (el as HTMLImageElement).naturalWidth,
        (el as HTMLImageElement).naturalHeight,
      ])
      expect(w).toBeGreaterThan(h)
    }

    console.log(`\n[full-amiga-logs] ${JSON.stringify(timings, null, 2)}\n`)
    test.info().annotations.push({
      type: "timings",
      description: JSON.stringify(timings),
    })
  })
})
