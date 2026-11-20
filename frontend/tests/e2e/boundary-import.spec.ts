/**
 * Strict-E2E for "Import boundaries from…" in the Plot Boundary tool.
 *
 * Boundary versions are stored per Processed/ directory — per flight date
 * *and* sensor — so a field drawn for one flight was invisible to the next.
 * Here a 2×3 grid is drawn for the 06-27 flight, then a run on the 06-28
 * flight imports it through the picker, saves, and the 06-28 directory ends
 * up with its own active version holding the same six plots.
 *
 * All through the UI (uploads, workspace, pipeline, runs, drawing,
 * importing, saving). The only API calls are reads that confirm what the
 * save wrote.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import type { Page } from "@playwright/test"

import { authHeader } from "../helpers/apiClient"
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

async function uploadFlight(
  page: Page,
  scope: {
    experiment: string
    season: string
    location: string
    population: string
    date: string
    platform: string
    sensor: string
  },
) {
  await navigateToUpload(page)
  await selectDataType(page, "Image Data")
  await fillUploadForm(page, scope)
  await dropFiles(
    page,
    DRONE_IMAGES.map((n) => fixturePath("images", "drone", n)),
  )
  await submitUploadAndWait(page, DRONE_IMAGES.length)
}

/** From the pipeline page: New run on the upload for `date`, open its boundary tool. */
async function openBoundaryToolForDate(
  page: Page,
  experiment: string,
  date: string,
) {
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
  await page.waitForURL(/\/process\/[^/]+\/run\/[^/?]+/)
  const runUrl = page.url()
  const runId = runUrl.split("/").pop()
  const wsId = runUrl.split("/process/")[1].split("/")[0]
  await page.goto(
    `/process/${wsId}/tool?runId=${runId}&step=plot_boundary_prep`,
  )
  await expect(
    page.getByRole("heading", { name: /plot boundary prep/i }),
  ).toBeVisible()
  return { wsId, runId }
}

test.describe("Plot boundaries — import from another flight", () => {
  test.setTimeout(6 * 60_000)

  test("grid drawn for 06-27 is imported into 06-28 and saved there", async ({
    page,
    request,
    runPrefix,
  }) => {
    const experiment = `${runPrefix}-bimp-exp`
    const season = `${runPrefix}-S`
    const location = "Davis"
    const population = "Cowpea"
    const platform = "DJI"
    const sensor = "FC6310S"
    const first = "2022-06-27"
    const second = "2022-06-28"
    const scope = { experiment, season, location, population, platform, sensor }

    // ── 1. Two flights of the same field. ───────────────────────────────
    await uploadFlight(page, { ...scope, date: first })
    await uploadFlight(page, { ...scope, date: second })

    // ── 2. Workspace + aerial pipeline. ─────────────────────────────────
    const workspaceName = `${runPrefix}-bimp-ws`
    await page.goto("/process")
    await page.locator('[data-onboarding="process-new-workspace"]').click()
    await page.getByLabel(/workspace name/i).fill(workspaceName)
    await page.getByRole("button", { name: /create workspace/i }).click()
    await page.getByText(workspaceName, { exact: true }).click()
    await page.getByRole("button", { name: /create aerial pipeline/i }).click()
    await page.getByLabel(/pipeline name/i).fill(`${runPrefix}-bimp-pipe`)
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /create pipeline/i }).click()
    await expect(
      page.getByRole("button", { name: /new run/i }).first(),
    ).toBeVisible({ timeout: 15_000 })
    const pipelineUrl = page.url()

    // ── 3. First flight: draw a 2×3 grid and save it. ───────────────────
    await openBoundaryToolForDate(page, experiment, first)
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

    // ── 4. Second flight: nothing saved here yet → import the first. ────
    await page.goto(pipelineUrl)
    await openBoundaryToolForDate(page, experiment, second)
    await expect(page.locator("text=/6 plots? across/i")).toHaveCount(0)
    await page.getByTestId("boundary-import-tab").click()
    const picker = page.getByTestId("boundary-import-picker")
    await picker.getByTestId("boundary-import-filter").fill(experiment)
    const row = picker
      .getByTestId("boundary-import-row")
      .filter({ hasText: first })
    await expect(row).toHaveCount(1, { timeout: 15_000 })
    await expect(row).toContainText("6")
    // Its own directory is never offered as an import source.
    await expect(
      picker.getByTestId("boundary-import-row").filter({ hasText: second }),
    ).toHaveCount(0)
    await row.getByRole("button", { name: "Import" }).click()
    await expect(page.locator("text=/6 plots? across 1 block/i")).toBeVisible({
      timeout: 15_000,
    })

    // ── 5. Save: the second flight now has its own copy. ────────────────
    await page.getByTestId("boundary-save-and-complete").click()
    await expect(page.getByText(/saved \+ activated/i).first()).toBeVisible({
      timeout: 30_000,
    })

    const dir = `Processed/${season}/${experiment}/${location}/${population}/${second}/${platform}/${sensor}/`
    const headers = {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    }
    const listed = await request.post("/api/plot_geometry/versions/list", {
      headers,
      data: { directory: dir },
    })
    expect(listed.ok()).toBe(true)
    const versions = (await listed.json()) as Array<{
      version: number
      is_active: boolean
    }>
    const active = versions.find((v) => v.is_active)
    expect(active, "second flight must have an active version").toBeTruthy()
    const loaded = await request.post("/api/plot_geometry/versions/load", {
      headers,
      data: { directory: dir, version: active?.version },
    })
    const snap = (await loaded.json()) as {
      state_snapshot: {
        boundaries: {
          features: Array<{ properties?: { role?: string } }>
        }
      }
    }
    const plots = snap.state_snapshot.boundaries.features.filter(
      (f) => f.properties?.role !== "outer",
    )
    expect(plots).toHaveLength(6)
  })
})
