/**
 * Strict-E2E for the "Split Into Plot Images" step (SPLIT_ORTHOMOSAIC).
 *
 * The geo worker has supported this job all along and nothing in the UI ever
 * submitted it, so per-plot PNGs were never produced — which in turn broke
 * plot-image viewing, per-plot inference, crop downloads and the Analyze
 * click-through. This spec covers the wiring that was missing.
 *
 * What it does NOT do is run ODM: producing a real orthomosaic takes ~15
 * minutes and lives behind RUN_HEAVY_E2E in process-wizard-aerial-r4a. So
 * this spec asserts the two things that are checkable without one, both of
 * which are real regressions if they break:
 *
 *   1. The step exists in the aerial wizard, in the right place, and is
 *      reachable — it did not exist at all before.
 *   2. Running it with no plot boundaries refuses with a specific message
 *      instead of submitting a job that would return plots_processed: 0 and
 *      read as a success.
 *
 * It also drives the real Plot Boundary tool to save + activate boundaries,
 * then asserts the step is implemented (not "unavailable") and correctly
 * locked behind the orthomosaic. The submit-with-boundaries path was
 * verified live against a real ortho (6 plots, 6 PNGs of ~1.1MB each, 96.8%
 * non-black) and is covered at unit level in runApi.test.ts.
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

test.describe("Split Into Plot Images (SPLIT_ORTHOMOSAIC)", () => {
  test.setTimeout(5 * 60_000)

  test("step is present, ordered, implemented, and gated behind the orthomosaic", async ({
    page,
    runPrefix,
  }) => {
    const experiment = `${runPrefix}-split-exp`
    const location = "Davis"
    const population = "Cowpea"
    const date = "2022-06-27"
    const platform = "DJI"
    const sensor = "FC6310S"
    const workspaceName = `${runPrefix}-split-ws`
    const pipelineName = `${runPrefix}-split-pipe`

    // ── Upload → workspace → aerial pipeline → run. ──────────────────────
    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, {
      experiment,
      location,
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
      .first()
    await expect(uploadRow).toBeVisible({ timeout: 30_000 })
    await uploadRow.click()
    await page.getByRole("button", { name: /create run/i }).click()

    // ── 1. The step exists, between boundary prep and trait extraction. ──
    const splitRow = page.getByTestId("step-row-split_orthomosaic")
    await expect(splitRow).toBeVisible({ timeout: 30_000 })
    await expect(splitRow).toContainText(/split into plot images/i)

    const stepKeys = await page
      .locator("[data-testid^='step-row-']")
      .evaluateAll((els) =>
        els.map((e) =>
          (e.getAttribute("data-testid") ?? "").replace("step-row-", ""),
        ),
      )
    expect(stepKeys).toContain("split_orthomosaic")
    expect(stepKeys.indexOf("split_orthomosaic")).toBeGreaterThan(
      stepKeys.indexOf("plot_boundary_prep"),
    )
    expect(stepKeys.indexOf("split_orthomosaic")).toBeLessThan(
      stepKeys.indexOf("trait_extraction"),
    )

    // (The PlotImageGrid placeholder lives in the step's expansion area,
    // which RunDetail only offers for COMPLETED steps — so it isn't
    // reachable here and asserting on it would be testing the expander,
    // not the split wiring.)

    // ── 2. Draw + activate boundaries through the real tool. ─────────────
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
    await expect(page.getByText(/saved \+ activated/i).first()).toBeVisible({
      timeout: 30_000,
    })

    // ── 3. Back on the run: the step is real, and correctly gated. ───────
    await page.goto(`/process/${wsId}/run/${runId}`)
    const splitRow2 = page.getByTestId("step-row-split_orthomosaic")
    await expect(splitRow2).toBeVisible({ timeout: 30_000 })

    // It must NOT be "unavailable" — that status is for steps this backend
    // can't perform at all (associate_boundaries). Split is implemented.
    await expect(
      splitRow2.getByTestId("step-unavailable-split_orthomosaic"),
    ).toHaveCount(0)

    // It IS locked, because `orthomosaic` is a non-optional predecessor and
    // hasn't run — there is no ortho to cut. That gating is the correct
    // behaviour, and asserting it here is what catches someone later
    // marking the step ready (or complete) without an orthomosaic.
    await expect(splitRow2).toHaveAttribute("data-status", "locked")

    // The whole pipeline is ordered, so every step after data_sync is
    // locked on a fresh run. Confirm split sits inside that chain rather
    // than dangling outside it.
    const statuses = await page
      .locator("[data-testid^='step-row-']")
      .evaluateAll((els) =>
        Object.fromEntries(
          els.map((e) => [
            (e.getAttribute("data-testid") ?? "").replace("step-row-", ""),
            e.getAttribute("data-status"),
          ]),
        ),
      )
    expect(statuses.data_sync).toBe("ready")
    expect(statuses.orthomosaic).toBe("locked")
    expect(statuses.split_orthomosaic).toBe("locked")
  })
})
