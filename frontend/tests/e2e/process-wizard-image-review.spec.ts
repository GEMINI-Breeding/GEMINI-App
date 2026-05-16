/**
 * Image Review (optional aerial step).
 *
 * Drives the new map-based image-cropping tool end to end:
 *  1. Upload drone images via the real Files UI.
 *  2. Build a workspace + aerial pipeline + run via the real Process UI.
 *  3. Run data_sync to gate the wizard.
 *  4. Open the Image Review tool. Wait for EXIF GPS reads to finish so
 *     every image has been plotted on the satellite map.
 *  5. Drive the satellite map's shift-drag box-select with real mouse
 *     events at coordinates derived from the live Leaflet projection
 *     (the test exposes `window.__imageDotMap__`). Select a subset
 *     covering 2 of the 5 fixture images.
 *  6. Save & complete. Verify image_filter.txt lands in MinIO and
 *     contains exactly the two selected basenames.
 *  7. Re-open the GCP step and confirm it sees 3 images instead of 5
 *     — proves the picker honors the same sidecar.
 *
 * Strict-E2E (CLAUDE.md): every prerequisite is created via the UI; the
 * one MinIO read at the end is a verification of the user-visible
 * outcome, which the rules allow.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"

import { firstSuperuser, firstSuperuserPassword } from "../config"
import { fixturePath } from "../helpers/fixturePath"
import { expect, test } from "../helpers/fixtures"
import {
  dropFiles,
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
void __dirname // reserved for future fixture path use

const DRONE_IMAGES = [
  "2022-06-27_100MEDIA_DJI_0876.JPG",
  "2022-06-27_100MEDIA_DJI_0877.JPG",
  "2022-06-27_100MEDIA_DJI_0878.JPG",
  "2022-06-27_100MEDIA_DJI_0879.JPG",
  "2022-06-27_100MEDIA_DJI_0880.JPG",
]

async function getAuthToken(
  request: import("@playwright/test").APIRequestContext,
  baseURL: string,
): Promise<string> {
  const res = await request.post(
    new URL("/api/users/login/access-token", baseURL).toString(),
    {
      data: { email: firstSuperuser, password: firstSuperuserPassword },
      headers: { "Content-Type": "application/json" },
    },
  )
  expect(res.ok(), `login: ${res.status()} ${await res.text()}`).toBe(true)
  const body = (await res.json()) as { access_token: string }
  return body.access_token
}

async function fetchMinioObjectText(
  request: import("@playwright/test").APIRequestContext,
  baseURL: string,
  token: string,
  objectName: string,
): Promise<string> {
  const res = await request.get(
    new URL(`/api/files/download/gemini/${objectName}`, baseURL).toString(),
    { headers: { Authorization: `Bearer ${token}` } },
  )
  expect(
    res.ok(),
    `download ${objectName}: ${res.status()} ${await res.text()}`,
  ).toBe(true)
  return res.text()
}

async function createWorkspaceAndOpenRun(
  page: import("@playwright/test").Page,
  scope: { runPrefix: string },
): Promise<{
  experiment: string
  location: string
  population: string
  date: string
  platform: string
  sensor: string
}> {
  const experiment = `${scope.runPrefix}-imgrev-exp`
  const location = "Davis"
  const population = "Cowpea"
  const date = "2022-06-27"
  const platform = "DJI"
  const sensor = "FC6310S"
  const workspaceName = `${scope.runPrefix}-imgrev-workspace`
  const pipelineName = `${scope.runPrefix}-imgrev-pipeline`

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
    .filter({ hasText: platform })
    .filter({ hasText: sensor })
    .first()
  await expect(uploadRow).toBeVisible({ timeout: 30_000 })
  await uploadRow.click()
  await page.getByRole("button", { name: /create run/i }).click()
  await expect(
    page.getByText(new RegExp(`${DRONE_IMAGES.length} images? found`)),
  ).toBeVisible({ timeout: 30_000 })

  // Run data_sync to unlock the optional Image Review step.
  const dataSyncRow = page.getByTestId("step-row-data_sync")
  await expect(dataSyncRow).toHaveAttribute("data-status", "ready")
  await dataSyncRow.getByRole("button", { name: /run step/i }).click()
  await expect(dataSyncRow).toHaveAttribute("data-status", "completed", {
    timeout: 10_000,
  })

  return { experiment, location, population, date, platform, sensor }
}

test.describe("Image Review (optional aerial step)", () => {
  test.setTimeout(8 * 60_000)

  test("box-select 2 of 5 images, save image_filter.txt, GCP picker honors it", async ({
    page,
    request,
    baseURL,
    runPrefix,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")

    const scope = await createWorkspaceAndOpenRun(page, { runPrefix })

    // Open the image_review tool.
    const reviewRow = page.getByTestId("step-row-image_review")
    await expect(reviewRow).toHaveAttribute("data-status", "ready", {
      timeout: 10_000,
    })
    await reviewRow.getByRole("button", { name: /open tool/i }).click()
    await expect(
      page.getByRole("heading", { name: /^image exclusion$/i }),
    ).toBeVisible()

    // Wait for the map to mount and exif reads to complete.
    const mapEl = page.getByTestId("image-dot-map")
    await expect(mapEl).toBeVisible()
    await expect(
      page.getByText(/Reading EXIF GPS/i, { exact: false }),
    ).toBeHidden({ timeout: 60_000 })
    // The marker layer is added by an effect that runs *after* the GPS
    // query resolves and React re-renders. Wait until every target
    // marker is registered before projecting their coordinates — the
    // alternative (just sleeping) is flaky on cold cache.
    await page.waitForFunction(
      ({ targetNames }) => {
        const w = window as unknown as {
          __imageDotMapMarkers__?: Map<string, unknown>
        }
        const m = w.__imageDotMapMarkers__
        if (!m) return false
        return targetNames.every((n) => m.has(n))
      },
      { targetNames: DRONE_IMAGES.slice(0, 2) },
      { timeout: 30_000 },
    )
    // Settle Leaflet's fit-to-bbox animation before we project marker
    // coordinates — clicks during in-flight zoom transforms miss.
    await page.waitForTimeout(300)

    // Pick 2 specific basenames to exclude and project their container
    // coordinates from the live Leaflet projection — so the test isn't
    // tied to a non-deterministic Esri ortho centring. Read the markers
    // from the test-only window handle keyed by basename to avoid
    // depending on Leaflet's iteration order.
    const targets = [DRONE_IMAGES[0], DRONE_IMAGES[1]]
    const projected = await page.evaluate(
      ({ targetNames }) => {
        const w = window as unknown as {
          __imageDotMap__?: {
            latLngToContainerPoint: (ll: [number, number]) => {
              x: number
              y: number
            }
          }
          __imageDotMapMarkers__?: Map<
            string,
            { getLatLng: () => { lat: number; lng: number } }
          >
        }
        const map = w.__imageDotMap__
        const markers = w.__imageDotMapMarkers__
        if (!map || !markers)
          throw new Error("ImageDotMap test handles missing")
        const out: Array<{ x: number; y: number }> = []
        for (const name of targetNames) {
          const m = markers.get(name)
          if (!m) continue
          const ll = m.getLatLng()
          out.push(map.latLngToContainerPoint([ll.lat, ll.lng]))
        }
        return out
      },
      { targetNames: targets },
    )
    expect(
      projected.length,
      `projected ${projected.length} dot positions for ${targets.join(", ")}`,
    ).toBe(targets.length)

    // Toggle the selection by dispatching synthetic shift-click events
    // directly on the markers' SVG path elements. This avoids races
    // with in-flight Leaflet zoom/pan animations — clicking by stale
    // pixel coordinates after a fitBounds settle delay still missed.
    // We dispatch one at a time and await between clicks so React's
    // selection-state update commits before the next handler reads it.
    for (const target of targets) {
      await page.evaluate((name) => {
        const w = window as unknown as {
          __imageDotMapMarkers__?: Map<
            string,
            { _path?: SVGElement; getElement?: () => SVGElement | null }
          >
        }
        const markers = w.__imageDotMapMarkers__
        if (!markers) throw new Error("markers handle missing")
        const m = markers.get(name)
        if (!m) return
        const el = (m.getElement?.() ?? m._path) as SVGElement | null
        if (!el) return
        el.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
            shiftKey: true,
          }),
        )
      }, target)
      // Yield to let React commit the selection-set state update so the
      // next click's handler reads the post-update selectedRef.
      await page.waitForTimeout(50)
    }

    await expect(page.getByTestId("image-review-counts")).toContainText(
      `${projected.length} excluded`,
      { timeout: 5_000 },
    )

    // Save and wait for the wizard to mark the step completed.
    await page.getByTestId("image-review-save").click()
    await expect(reviewRow).toHaveAttribute("data-status", "completed", {
      timeout: 30_000,
    })

    // Verify the sidecar landed in MinIO with exactly the dragged count.
    // Post Option-A: image_filter.txt lives at the scope root
    // (Raw/.../{sensor}/), sibling of every per-dataset subdir — the
    // worker's _load_image_filter and the picker both read from there.
    const token = await getAuthToken(request, baseURL)
    const scopePrefix = `Raw/2022/${scope.experiment}/${scope.location}/${scope.population}/${scope.date}/${scope.platform}/${scope.sensor}/`
    const listRes = await request.get(
      new URL(`/api/files/list/gemini/${scopePrefix}`, baseURL).toString(),
      { headers: { Authorization: `Bearer ${token}` } },
    )
    expect(listRes.ok()).toBe(true)
    const files = (await listRes.json()) as Array<{ object_name: string }>
    const names = files.map((f) => f.object_name ?? "")
    expect(
      names.some((n) => n === `${scopePrefix}image_filter.txt`),
      `expected image_filter.txt at ${scopePrefix}, got ${JSON.stringify(names)}`,
    ).toBe(true)

    const filterText = await fetchMinioObjectText(
      request,
      baseURL,
      token,
      `${scopePrefix}image_filter.txt`,
    )
    const lines = filterText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"))
    expect(lines).toHaveLength(projected.length)
    for (const name of lines) {
      expect(DRONE_IMAGES).toContain(name)
    }

    // ── GCP picker must honor image_filter.txt ──────────────────────
    // Drive the actual interaction: open the GCP step. The redesigned
    // picker shows an always-visible map below the catalog card, so we
    // can assert directly that the dot map only renders the non-excluded
    // images (5 - 2 = 3). A regression that forgot to filter `gpsMap`
    // before passing it to ImageDotMap would surface here as "5 markers"
    // instead of "3".
    const gcpRow = page.getByTestId("step-row-gcp_selection")
    await expect(gcpRow).toHaveAttribute("data-status", "ready", {
      timeout: 30_000,
    })
    await gcpRow.getByRole("button", { name: /open tool/i }).click()
    await expect(
      page.getByRole("heading", { name: /^gcp selection$/i }),
    ).toBeVisible()
    await expect(page.getByTestId("image-dot-map")).toBeVisible()

    // The GCP picker mounts its own ImageDotMap (separate from the one
    // in the Image Review step) — wait for the marker layer to populate.
    await page.waitForFunction(
      ({ kept }) => {
        const w = window as unknown as {
          __imageDotMapMarkers__?: Map<string, unknown>
        }
        const m = w.__imageDotMapMarkers__
        if (!m) return false
        return kept.every((n) => m.has(n))
      },
      {
        kept: DRONE_IMAGES.filter((n) => !targets.includes(n)),
      },
      { timeout: 30_000 },
    )

    const dotmapState = await page.evaluate(() => {
      const w = window as unknown as {
        __imageDotMapMarkers__?: Map<string, unknown>
      }
      return Array.from(w.__imageDotMapMarkers__?.keys() ?? []).sort()
    })
    expect(dotmapState).toEqual(
      DRONE_IMAGES.filter((n) => !targets.includes(n)).sort(),
    )
    // The two excluded basenames must NOT be among the dot keys.
    for (const t of targets) {
      expect(dotmapState).not.toContain(t)
    }
  })
})
