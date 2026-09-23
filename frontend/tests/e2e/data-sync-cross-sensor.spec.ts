/**
 * Data Sync from another sensor, on real data from one pass (2024-07-15):
 * a phone rode the Amiga, so the phone's frames can take their positions
 * from the rover's RTK track instead of the phone's own GPS.
 *
 *   upload the Amiga log (fixture: 12 s of the pass) → extraction
 *   upload seven phone frames (fixture: six inside that window, one ~2 s
 *   before it) as Image Data, sensor "Phone"
 *   ground pipeline + run on the phone upload → Data Sync → "Sync from
 *   another sensor" → the Amiga track, out-of-range threshold 1 s
 *
 * Load-bearing checks: the summary must say 6 frames were interpolated
 * from the track and the early one kept its own GPS (so the threshold took
 * effect); the synced track the worker wrote must put the six inside the
 * rover's track (not at the phone's own fixes) and the seventh exactly at
 * its EXIF position; and Plot Marking must pick that track up for the
 * phone frames.
 *
 * Strict-E2E rules (CLAUDE.md): everything through the UI; API calls are
 * reads only.
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

const BIN = "2024_07_15_15_49_18_998387_track-fixture.0000.bin"
const PHONE = [
  "00749",
  "00754",
  "00757",
  "00760",
  "00765",
  "00770",
  "00775",
].map((n) => `240715_IMG_${n}.jpg`)
// The Amiga fixture's RTK track spans these latitudes (msgs_synced.csv).
const TRACK_LAT = [38.53654299, 38.53661835]
// 00749's own (phone) GPS fix, from its EXIF.
const EARLY_FRAME_LAT = 38.53662777777778

async function authHeaders(page: Page) {
  const auth = await page.context().storageState()
  const token =
    auth.origins
      .flatMap((o) => o.localStorage)
      .find((e) => e.name === "gemini.auth.token")?.value ?? ""
  return { Authorization: `Bearer ${token}` }
}

test.describe("Data Sync: from another sensor", () => {
  test.setTimeout(10 * 60_000)

  test("phone frames take their positions from the Amiga's RTK track", async ({
    page,
    request,
    baseURL,
    runPrefix,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const experiment = `${runPrefix}-xs-exp`
    const scopeFields = {
      experiment,
      season: "2024",
      location: "Davis",
      population: "Cowpea",
      date: "2024-07-15",
    }

    await navigateToUpload(page)
    await selectDataType(page, "Farm-ng Binary File")
    await fillUploadForm(page, scopeFields)
    await dropFiles(page, [fixturePath("binary", BIN)])
    await submitUploadAndWait(page, 1, { timeoutMs: 5 * 60_000 })

    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, {
      ...scopeFields,
      platform: "Amiga",
      sensor: "Phone",
    })
    await dropFiles(
      page,
      PHONE.map((n) => fixturePath("images", "phone", n)),
    )
    await submitUploadAndWait(page, PHONE.length)

    // Workspace → ground pipeline → a run on the phone upload.
    await page.goto("/process")
    await page.locator('[data-onboarding="process-new-workspace"]').click()
    await page.getByLabel(/workspace name/i).fill(`${runPrefix}-xs-ws`)
    await page.getByRole("button", { name: /create workspace/i }).click()
    await page.getByText(`${runPrefix}-xs-ws`, { exact: true }).click()
    await page.getByRole("button", { name: /create ground pipeline/i }).click()
    await page.getByLabel(/pipeline name/i).fill(`${runPrefix}-xs-pl`)
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /create pipeline/i }).click()
    await page
      .getByRole("button", { name: /new run/i })
      .first()
      .click()
    const phoneRow = page
      .getByTestId("upload-row")
      .filter({ hasText: experiment })
      .filter({ hasText: "Phone" })
      .first()
    await expect(phoneRow).toBeVisible({ timeout: 30_000 })
    await phoneRow.click()
    await page.getByRole("button", { name: /create run/i }).click()

    // ── Data Sync from the Amiga's track ────────────────────────────────
    const row = await runDataSync(page, {
      source: /Amiga \/ RGB/,
      maxExtrapolationSec: 1,
    })
    await expect(row.getByTestId("data-sync-summary")).toHaveText(
      "7 of 7 images have a position (synced from another sensor)",
    )
    await expect(row.getByTestId("data-sync-results")).toContainText(
      "6 interpolated from the source track, 1 own GPS (outside the track)",
    )

    // What the worker wrote beside the phone frames.
    const headers = await authHeaders(page)
    const rawScope = `Raw/2024/${experiment}/Davis/Cowpea/2024-07-15/Amiga/Phone/`
    const listing = (await (
      await request.get(
        new URL(`/api/files/list/gemini/${rawScope}`, baseURL).toString(),
        {
          headers,
        },
      )
    ).json()) as { object_name: string }[]
    const track = listing
      .map((f) => f.object_name)
      .find((n) => n.endsWith("/Metadata/msgs_synced.csv"))
    expect(track, "the synced track sits beside the phone frames").toBeTruthy()
    const csv = await (
      await request.get(
        new URL(`/api/files/download/gemini/${track}`, baseURL).toString(),
        {
          headers,
        },
      )
    ).text()
    const [head, ...lines] = csv.trim().split("\n")
    const cols = head.split(",")
    const rows = lines.map((l) =>
      Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])),
    )
    expect(rows).toHaveLength(7)
    for (const r of rows) {
      const lat = Number(r.lat)
      if (r.image === "240715_IMG_00749.jpg") {
        expect(r.gps_source).toBe("own_gps")
        expect(lat).toBeCloseTo(EARLY_FRAME_LAT, 7)
      } else {
        expect(r.gps_source).toBe("interpolated")
        expect(lat).toBeGreaterThanOrEqual(TRACK_LAT[0])
        expect(lat).toBeLessThanOrEqual(TRACK_LAT[1])
      }
    }

    // ── Plot Marking uses the synced track for the phone frames ─────────
    const markingRow = page.getByTestId("step-row-plot_marking")
    await markingRow.getByRole("button", { name: /open tool/i }).click()
    await expect(page.getByTestId("pm-frame-count")).toHaveText("/ 7", {
      timeout: 30_000,
    })
    // Frames in capture order: the early one first.
    await expect(page.getByTestId("pm-frame-name")).toHaveText(
      "240715_IMG_00749.jpg",
    )
    await page.getByTestId("pm-gps-toggle").click()
    await expect(
      page
        .getByTestId("pm-gps-map")
        .locator("path.leaflet-interactive")
        .first(),
    ).toBeAttached()
  })
})
