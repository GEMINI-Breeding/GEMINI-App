/**
 * Phase R5b: GCP picker E2E.
 *
 * Drives the redesigned picker:
 *  1. Upload drone images via the real Files UI.
 *  2. Build a workspace + aerial pipeline + run via the real Process UI.
 *  3. Walk through gcp_selection, exercising:
 *     - "Load GCPs from CSV" → CsvUploadPanel → save (textarea + file picker).
 *     - "+ Add new GCP" sentinel item in the Active-GCP dropdown opens an
 *       inline form (label + optional lat/lon/alt). Coord-bearing entries
 *       land in gcp_locations.csv; coord-less entries land in
 *       gcp_image_groups.json with an empty image list.
 *     - Per-GCP filter mode toggle (Radius / Map-picker). Map-picker mode
 *       lets the user shift-click image dots on the always-visible map to
 *       assign them as that GCP's image group.
 *     - The trash button next to the active-GCP dropdown deletes the
 *       active GCP from the catalog (CSV + groups + marks all clean up).
 *     - Image dots on the map are colored by their owning GCP — radius
 *       proximity for radius-mode, explicit group membership for map-mode.
 *  4. Read the resulting MinIO sidecars (gcp_locations.csv,
 *     gcp_list.txt, geo.txt, gcp_image_groups.json) and validate their
 *     contents — header lines, row counts, basic shape.
 *
 * A second test exercises the "skip" affordance from the empty catalog
 * card. The step row must flip to `data-status="skipped"` and no GCP
 * sidecars may land in MinIO.
 *
 * Strict-E2E (CLAUDE.md): every prerequisite is created via the UI; no
 * write-side API/SDK calls. The `request.get` calls at the end are
 * read-only verifications of the user-visible outcome (files in MinIO),
 * which the rules explicitly allow.
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

const DRONE_IMAGES = [
  "2022-06-27_100MEDIA_DJI_0876.JPG",
  "2022-06-27_100MEDIA_DJI_0877.JPG",
  "2022-06-27_100MEDIA_DJI_0878.JPG",
  "2022-06-27_100MEDIA_DJI_0879.JPG",
  "2022-06-27_100MEDIA_DJI_0880.JPG",
]

/**
 * GCPs hand-tuned against the drone fixtures' EXIF GPS (see
 * `tests/fixtures/images/drone/metadata.json`). Image cluster centre
 * ≈ 38.53364, -121.78246.
 *
 * - GCP-NEAR-A and GCP-NEAR-B sit < 20 m from the cluster, so the default
 *   50 m radius keeps every fixture image in scope.
 * - GCP-FAR-C is ~120 m east — outside 50 m so the radius-empty-state
 *   triggers; outside 200 m too so the "bump radius" assertion is
 *   unambiguous.
 */
const TEXTAREA_CSV = [
  "Label,Lat_dec,Lon_dec,Altitude",
  "stub,38.53364,-121.78246,11.0",
].join("\n")

const REPLACEMENT_CSV = [
  "Label,Lat_dec,Lon_dec,Altitude",
  "GCP-NEAR-A,38.53371,-121.78246,11.5",
  "GCP-NEAR-B,38.53357,-121.78246,11.1",
  "GCP-FAR-C,38.53364,-121.78108,11.0",
].join("\n")

const REPLACEMENT_CSV_PATH = path.join(__dirname, "_gcp_locations_e2e.csv")

/** Fetch an authed JWT for the read-only post-save MinIO checks. */
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

/**
 * Walk the upload + workspace + pipeline + run wizard, leaving the user
 * parked on RunDetail with a real run created against freshly uploaded
 * drone images. Returns the run scope so the spec can build MinIO paths.
 */
async function createWorkspaceAndOpenRun(
  page: import("@playwright/test").Page,
  scope: { runPrefix: string; suffix: string },
): Promise<{
  experiment: string
  location: string
  population: string
  date: string
  platform: string
  sensor: string
}> {
  const experiment = `${scope.runPrefix}-${scope.suffix}-exp`
  const location = "Davis"
  const population = "Cowpea"
  const date = "2022-06-27"
  const platform = "DJI"
  const sensor = "FC6310S"
  const workspaceName = `${scope.runPrefix}-${scope.suffix}-workspace`
  const pipelineName = `${scope.runPrefix}-${scope.suffix}-pipeline`

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

  const dataSyncRow = page.getByTestId("step-row-data_sync")
  await expect(dataSyncRow).toHaveAttribute("data-status", "ready")
  await dataSyncRow.getByRole("button", { name: /run step/i }).click()
  await expect(dataSyncRow).toHaveAttribute("data-status", "completed", {
    timeout: 10_000,
  })

  return { experiment, location, population, date, platform, sensor }
}

/**
 * Helper: open the GCP step from RunDetail. Returns the step row locator
 * for status assertions.
 */
async function openGcpStep(page: import("@playwright/test").Page) {
  const gcpRow = page.getByTestId("step-row-gcp_selection")
  await expect(gcpRow).toHaveAttribute("data-status", "ready", {
    timeout: 10_000,
  })
  await gcpRow.getByRole("button", { name: /open tool/i }).click()
  await expect(
    page.getByRole("heading", { name: /^gcp selection$/i }),
  ).toBeVisible()
  return gcpRow
}

/**
 * Helper: wait for the GCP picker's image-viewer image to be ready
 * (visible + naturalWidth > 0) so position-based clicks land.
 */
async function waitForGcpImageReady(page: import("@playwright/test").Page) {
  const imgViewer = page.getByTestId("gcp-image-viewer")
  await expect(imgViewer.locator("img")).toBeVisible({ timeout: 30_000 })
  await page.waitForFunction(
    () => {
      const img = document.querySelector(
        '[data-testid="gcp-image-viewer"] img',
      ) as HTMLImageElement | null
      return Boolean(img && img.naturalWidth > 0)
    },
    undefined,
    { timeout: 30_000 },
  )
  return imgViewer
}

test.describe("R5b: GCP picker", () => {
  test.setTimeout(8 * 60_000)

  test.beforeAll(async () => {
    const fs = await import("node:fs/promises")
    await fs.writeFile(REPLACEMENT_CSV_PATH, REPLACEMENT_CSV, "utf-8")
  })
  test.afterAll(async () => {
    const fs = await import("node:fs/promises")
    await fs.rm(REPLACEMENT_CSV_PATH, { force: true })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Test 1 — full CSV-driven flow
  // ─────────────────────────────────────────────────────────────────────

  test("Load CSV → mark partial coverage → save: gcp_locations.csv + gcp_list.txt + geo.txt all land in MinIO", async ({
    page,
    request,
    baseURL,
    runPrefix,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const scope = await createWorkspaceAndOpenRun(page, {
      runPrefix,
      suffix: "csv",
    })
    await openGcpStep(page)

    // Empty state shows the catalog card directly. Click "Load GCPs from
    // CSV" to open CsvUploadPanel.
    await page.getByTestId("gcp-load-csv").click()
    const textarea = page.getByTestId("gcp-csv-textarea")
    await expect(textarea).toBeVisible()
    await textarea.fill(TEXTAREA_CSV)
    await page.getByTestId("gcp-csv-save").click()

    // Picker advances to main UI; the dropdown shows the stub GCP.
    const activeSelect = page.getByTestId("gcp-active-select")
    await expect(activeSelect).toBeVisible({ timeout: 15_000 })
    await expect(activeSelect).toContainText("stub")

    // Replace via file picker — exercise both CSV-entry affordances.
    await page.getByTestId("gcp-load-csv").click()
    await expect(
      page.getByText(/Replace GCP locations/i, { exact: false }),
    ).toBeVisible()
    const fileInput = page.locator('input[type="file"][accept*="csv"]')
    await fileInput.setInputFiles(REPLACEMENT_CSV_PATH)
    await expect(page.getByTestId("gcp-csv-textarea")).toHaveValue(
      /GCP-NEAR-A/,
      { timeout: 5_000 },
    )
    await page.getByTestId("gcp-csv-save").click()
    await expect(activeSelect).toBeVisible({ timeout: 15_000 })
    await expect(activeSelect).toContainText("GCP-NEAR-A")

    // Wait for EXIF GPS reads so the per-GCP radius filter is meaningful.
    await expect(
      page.getByText(/Reading EXIF GPS/i, { exact: false }),
    ).toBeHidden({ timeout: 60_000 })

    // Activate GCP-FAR-C: any reasonable default radius excludes every
    // fixture image (FAR-C is ~120 m east of the cluster). The
    // empty-state under the image viewer surfaces a "Bump radius" button
    // tied to *this* GCP's per-GCP radius.
    await activeSelect.click()
    await page.getByRole("option", { name: /GCP-FAR-C/ }).click()
    await expect(page.getByText(/No images within \d+ m of/i)).toBeVisible()
    await expect(page.getByText(/Nearest image is .* m away/)).toBeVisible()
    await page.getByTestId("gcp-radius-double").click()
    const slider = page.getByTestId("gcp-image-slider")
    await expect(slider).toBeVisible({ timeout: 5_000 })
    // Confirm the per-GCP radius input reflects the bumped value.
    const radiusInput = page.getByTestId("gcp-radius-input")
    await expect(radiusInput).toBeVisible()
    expect(Number(await radiusInput.inputValue())).toBeGreaterThan(100)

    // Switch to GCP-NEAR-A. Bump its radius wide enough (100 m) to keep
    // every fixture image in scope regardless of the runtime default,
    // so the marking flow below isn't sensitive to that constant.
    await activeSelect.click()
    await page.getByRole("option", { name: /GCP-NEAR-A/ }).click()
    await radiusInput.fill("100")
    await expect(slider).toBeVisible()
    expect(Number(await slider.getAttribute("max"))).toBeGreaterThanOrEqual(0)

    // Save must be disabled with zero marks; flips on the first mark.
    const saveBtn = page.getByTestId("gcp-save-and-complete")
    await expect(saveBtn).toBeDisabled()

    const imgViewer = await waitForGcpImageReady(page)
    await imgViewer.locator("img").click({ position: { x: 100, y: 80 } })
    await expect(page.getByText(/1 mark · 1\/3 GCPs covered/)).toBeVisible({
      timeout: 5_000,
    })
    await expect(saveBtn).toBeEnabled()

    // Right-click to remove the mark, re-add it (exercises the
    // contextmenu code path).
    await imgViewer
      .locator("img")
      .click({ button: "right", position: { x: 100, y: 80 } })
    await expect(page.getByText(/0 marks · 0\/3 GCPs covered/)).toBeVisible({
      timeout: 5_000,
    })
    await expect(saveBtn).toBeDisabled()
    await imgViewer.locator("img").click({ position: { x: 100, y: 80 } })

    // Mark GCP-NEAR-B too.
    await activeSelect.click()
    await page.getByRole("option", { name: /GCP-NEAR-B/ }).click()
    await waitForGcpImageReady(page)
    await imgViewer.locator("img").click({ position: { x: 220, y: 140 } })
    await expect(page.getByText(/2 marks · 2\/3 GCPs covered/)).toBeVisible({
      timeout: 5_000,
    })

    // Skip GCP-FAR-C deliberately. Save must stay enabled (partial-mark
    // flow); the unmarked-GCP advisory must name FAR-C.
    await expect(
      page.getByText(/1 GCP will be skipped \(no marks\): GCP-FAR-C/),
    ).toBeVisible()
    await expect(saveBtn).toBeEnabled()

    await saveBtn.click()
    const gcpRow = page.getByTestId("step-row-gcp_selection")
    await expect(gcpRow).toHaveAttribute("data-status", "completed", {
      timeout: 30_000,
    })

    // Backend verification.
    const token = await getAuthToken(request, baseURL)
    const prefix = `Raw/2022/${scope.experiment}/${scope.location}/${scope.population}/${scope.date}/${scope.platform}/${scope.sensor}/Images/`
    const listRes = await request.get(
      new URL(`/api/files/list/gemini/${prefix}`, baseURL).toString(),
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const files = (await listRes.json()) as Array<{ object_name: string }>
    const names = files.map((f) => f.object_name ?? "")
    expect(names.some((n) => n.endsWith("/gcp_locations.csv"))).toBe(true)
    expect(names.some((n) => n.endsWith("/gcp_list.txt"))).toBe(true)
    expect(names.some((n) => n.endsWith("/geo.txt"))).toBe(true)

    const csvText = await fetchMinioObjectText(
      request,
      baseURL,
      token,
      `${prefix}gcp_locations.csv`,
    )
    expect(csvText.trim()).toBe(REPLACEMENT_CSV.trim())

    const gcpListText = await fetchMinioObjectText(
      request,
      baseURL,
      token,
      `${prefix}gcp_list.txt`,
    )
    const gcpLines = gcpListText.trim().split(/\r?\n/)
    expect(gcpLines[0]).toBe("EPSG:4326")
    expect(gcpLines).toHaveLength(1 + 2) // header + 2 marks (FAR-C skipped)
    const labelsInList = gcpLines.slice(1).map((l) => l.split(/\s+/)[6])
    expect(new Set(labelsInList)).toEqual(new Set(["GCP-NEAR-A", "GCP-NEAR-B"]))
    expect(gcpListText).not.toContain("GCP-FAR-C")

    const geoText = await fetchMinioObjectText(
      request,
      baseURL,
      token,
      `${prefix}geo.txt`,
    )
    const geoLines = geoText.trim().split(/\r?\n/)
    expect(geoLines[0]).toBe("EPSG:4326")
    expect(geoLines).toHaveLength(1 + DRONE_IMAGES.length)
  })

  // ─────────────────────────────────────────────────────────────────────
  // Test 2 — skip from empty catalog
  // ─────────────────────────────────────────────────────────────────────

  test("Skip from the empty catalog: status flips to skipped, no sidecars uploaded", async ({
    page,
    request,
    baseURL,
    runPrefix,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const scope = await createWorkspaceAndOpenRun(page, {
      runPrefix,
      suffix: "skip",
    })
    const gcpRow = await openGcpStep(page)

    // Empty state shows the catalog card directly. Click the top-of-card
    // Skip button.
    await page.getByTestId("gcp-skip-top").click()
    await expect(gcpRow).toHaveAttribute("data-status", "skipped", {
      timeout: 15_000,
    })

    // No GCP sidecars must exist for this run.
    const token = await getAuthToken(request, baseURL)
    const prefix = `Raw/2022/${scope.experiment}/${scope.location}/${scope.population}/${scope.date}/${scope.platform}/${scope.sensor}/Images/`
    const listRes = await request.get(
      new URL(`/api/files/list/gemini/${prefix}`, baseURL).toString(),
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const files = (await listRes.json()) as Array<{ object_name: string }>
    const names = files.map((f) => f.object_name ?? "")
    for (const f of [
      "gcp_locations.csv",
      "gcp_list.txt",
      "geo.txt",
      "gcp_image_groups.json",
    ]) {
      expect(
        names.some((n) => n.endsWith(`/${f}`)),
        `skip path must not upload ${f}`,
      ).toBe(false)
    }
  })

  // ─────────────────────────────────────────────────────────────────────
  // Test 3 — "+ Add new GCP" inline form, with and without coords
  // ─────────────────────────────────────────────────────────────────────

  test("+ Add new GCP: type one with coords, one without; add coords later via the inline affordance", async ({
    page,
    request,
    baseURL,
    runPrefix,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const scope = await createWorkspaceAndOpenRun(page, {
      runPrefix,
      suffix: "addnew",
    })
    await openGcpStep(page)

    const activeSelect = page.getByTestId("gcp-active-select")
    await expect(activeSelect).toBeVisible({ timeout: 15_000 })

    // Open dropdown → click the "+ Add new GCP" sentinel. The inline form
    // appears below the dropdown row.
    await activeSelect.click()
    await page.getByTestId("gcp-add-new-item").click()
    const addForm = page.getByTestId("gcp-add-form")
    await expect(addForm).toBeVisible()

    // Coord-bearing entry.
    await page.getByTestId("gcp-add-label").fill("ADD-A")
    await page.getByTestId("gcp-add-lat").fill("38.53371")
    await page.getByTestId("gcp-add-lon").fill("-121.78246")
    await page.getByTestId("gcp-add-alt").fill("11.5")
    await page.getByTestId("gcp-add-submit").click()
    await expect(addForm).toBeHidden({ timeout: 10_000 })
    await expect(activeSelect).toContainText("ADD-A")

    // Coord-less entry — only a label.
    await activeSelect.click()
    await page.getByTestId("gcp-add-new-item").click()
    await expect(addForm).toBeVisible()
    await page.getByTestId("gcp-add-label").fill("ADD-B")
    await page.getByTestId("gcp-add-submit").click()
    await expect(addForm).toBeHidden({ timeout: 10_000 })

    // ADD-B is active and shows the "no coords" badge in the dropdown.
    await expect(activeSelect).toContainText("ADD-B")
    await activeSelect.click()
    const optionB = page.getByRole("option", { name: /ADD-B/ })
    await expect(optionB).toBeVisible()
    await expect(optionB).toContainText(/no coords/i)
    await optionB.click()

    // ADD-B's marking area shows the inline "Add coordinates" affordance
    // (the active GCP has no coords).
    await expect(page.getByText(/has no survey coordinates yet/i)).toBeVisible()
    await page.getByTestId("gcp-coords-add-open").click()
    await page.getByTestId("gcp-coords-add-lat").fill("38.53357")
    await page.getByTestId("gcp-coords-add-lon").fill("-121.78246")
    await page.getByTestId("gcp-coords-add-alt").fill("11.1")
    await page.getByTestId("gcp-coords-add-save").click()
    await expect(page.getByText(/has no survey coordinates yet/i)).toBeHidden({
      timeout: 15_000,
    })

    // Verify gcp_locations.csv now has both rows.
    const token = await getAuthToken(request, baseURL)
    const prefix = `Raw/2022/${scope.experiment}/${scope.location}/${scope.population}/${scope.date}/${scope.platform}/${scope.sensor}/Images/`
    const csvText = await fetchMinioObjectText(
      request,
      baseURL,
      token,
      `${prefix}gcp_locations.csv`,
    )
    const csvLines = csvText
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
    expect(csvLines[0]).toBe("Label,Lat_dec,Lon_dec,Altitude")
    expect(csvLines).toHaveLength(3) // header + ADD-A + ADD-B
    expect(
      csvLines
        .slice(1)
        .map((l) => l.split(",")[0])
        .sort(),
    ).toEqual(["ADD-A", "ADD-B"])

    // Mark each, save, verify gcp_list.txt has both labels.
    await expect(
      page.getByText(/Reading EXIF GPS/i, { exact: false }),
    ).toBeHidden({ timeout: 60_000 })
    const imgViewer = await waitForGcpImageReady(page)
    await imgViewer.locator("img").click({ position: { x: 220, y: 140 } })

    await activeSelect.click()
    await page.getByRole("option", { name: /ADD-A/ }).click()
    await waitForGcpImageReady(page)
    await imgViewer.locator("img").click({ position: { x: 100, y: 80 } })
    await expect(page.getByText(/2 marks · 2\/2 GCPs covered/)).toBeVisible({
      timeout: 5_000,
    })

    await page.getByTestId("gcp-save-and-complete").click()
    const gcpRow = page.getByTestId("step-row-gcp_selection")
    await expect(gcpRow).toHaveAttribute("data-status", "completed", {
      timeout: 30_000,
    })

    const gcpListText = await fetchMinioObjectText(
      request,
      baseURL,
      token,
      `${prefix}gcp_list.txt`,
    )
    const gcpLines = gcpListText.trim().split(/\r?\n/)
    expect(gcpLines).toHaveLength(1 + 2)
    expect(new Set(gcpLines.slice(1).map((l) => l.split(/\s+/)[6]))).toEqual(
      new Set(["ADD-A", "ADD-B"]),
    )
  })

  // ─────────────────────────────────────────────────────────────────────
  // Test 4 — per-GCP map mode: lasso 2 dots, mark one, save
  // ─────────────────────────────────────────────────────────────────────

  test("Per-GCP map mode: lasso 2 image dots on the always-visible map, mark one, save — gcp_list.txt only references lassoed images", async ({
    page,
    request,
    baseURL,
    runPrefix,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const scope = await createWorkspaceAndOpenRun(page, {
      runPrefix,
      suffix: "mapmode",
    })
    await openGcpStep(page)

    // Load CSV with one GCP via the empty-state path.
    await page.getByTestId("gcp-load-csv").click()
    await page
      .getByTestId("gcp-csv-textarea")
      .fill(
        [
          "Label,Lat_dec,Lon_dec,Altitude",
          "GCP-MAP-1,38.53364,-121.78246,11.0",
        ].join("\n"),
      )
    await page.getByTestId("gcp-csv-save").click()
    const activeSelect = page.getByTestId("gcp-active-select")
    await expect(activeSelect).toBeVisible({ timeout: 15_000 })
    await expect(activeSelect).toContainText("GCP-MAP-1")

    await expect(
      page.getByText(/Reading EXIF GPS/i, { exact: false }),
    ).toBeHidden({ timeout: 60_000 })

    // Switch the active GCP to map mode. The radius input disappears.
    await page.getByTestId("gcp-mode-map").click()
    await expect(page.getByTestId("gcp-radius-input")).toBeHidden()

    // Wait for the always-visible map's marker layer.
    const mapEl = page.getByTestId("image-dot-map")
    await expect(mapEl).toBeVisible()
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
    await page.waitForTimeout(300) // settle fitBounds

    // Shift-click 2 markers via synthetic events — same pattern as the
    // image-review spec, robust against in-flight zoom transforms.
    const TARGETS = [DRONE_IMAGES[0], DRONE_IMAGES[1]]
    for (const target of TARGETS) {
      await page.evaluate((name) => {
        const w = window as unknown as {
          __imageDotMapMarkers__?: Map<
            string,
            { _path?: SVGElement; getElement?: () => SVGElement | null }
          >
        }
        const m = w.__imageDotMapMarkers__?.get(name)
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
      await page.waitForTimeout(50)
    }

    // The slider in the marking area should now show only the 2 lassoed
    // images (the explicit group overrides any radius result).
    const slider = page.getByTestId("gcp-image-slider")
    await expect(slider).toBeVisible({ timeout: 10_000 })
    await expect(slider).toHaveAttribute("max", "1") // 0..1 → 2 images

    // Mark one, save.
    const imgViewer = await waitForGcpImageReady(page)
    await imgViewer.locator("img").click({ position: { x: 100, y: 80 } })
    await expect(page.getByText(/1 mark · 1\/1 GCPs covered/)).toBeVisible({
      timeout: 5_000,
    })

    await page.getByTestId("gcp-save-and-complete").click()
    const gcpRow = page.getByTestId("step-row-gcp_selection")
    await expect(gcpRow).toHaveAttribute("data-status", "completed", {
      timeout: 30_000,
    })

    const token = await getAuthToken(request, baseURL)
    const prefix = `Raw/2022/${scope.experiment}/${scope.location}/${scope.population}/${scope.date}/${scope.platform}/${scope.sensor}/Images/`

    // gcp_list.txt: one row referencing one of the two lassoed images.
    const gcpListText = await fetchMinioObjectText(
      request,
      baseURL,
      token,
      `${prefix}gcp_list.txt`,
    )
    const gcpLines = gcpListText.trim().split(/\r?\n/)
    expect(gcpLines).toHaveLength(2)
    const parts = gcpLines[1].split(/\s+/)
    expect(parts[6]).toBe("GCP-MAP-1")
    expect(TARGETS).toContain(parts[5])

    // gcp_image_groups.json: holds GCP-MAP-1 with both lassoed basenames.
    const groupsText = await fetchMinioObjectText(
      request,
      baseURL,
      token,
      `${prefix}gcp_image_groups.json`,
    )
    const parsed = JSON.parse(groupsText) as {
      version: number
      groups: Record<string, { images: string[] }>
    }
    expect(Object.keys(parsed.groups)).toContain("GCP-MAP-1")
    expect(new Set(parsed.groups["GCP-MAP-1"].images)).toEqual(new Set(TARGETS))
  })

  // ─────────────────────────────────────────────────────────────────────
  // Test 5 — Delete a GCP
  // ─────────────────────────────────────────────────────────────────────

  test("Delete: trash button removes the active GCP from gcp_locations.csv and the dropdown", async ({
    page,
    request,
    baseURL,
    runPrefix,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const scope = await createWorkspaceAndOpenRun(page, {
      runPrefix,
      suffix: "delete",
    })
    await openGcpStep(page)

    const activeSelect = page.getByTestId("gcp-active-select")
    await expect(activeSelect).toBeVisible({ timeout: 15_000 })

    // Add 2 GCPs via the inline form.
    for (const [label, lat, lon, alt] of [
      ["DEL-A", "38.53371", "-121.78246", "11.5"],
      ["DEL-B", "38.53357", "-121.78246", "11.1"],
    ] as const) {
      await activeSelect.click()
      await page.getByTestId("gcp-add-new-item").click()
      await page.getByTestId("gcp-add-label").fill(label)
      await page.getByTestId("gcp-add-lat").fill(lat)
      await page.getByTestId("gcp-add-lon").fill(lon)
      await page.getByTestId("gcp-add-alt").fill(alt)
      await page.getByTestId("gcp-add-submit").click()
      await expect(page.getByTestId("gcp-add-form")).toBeHidden({
        timeout: 10_000,
      })
    }

    // Verify both rows exist in MinIO before deletion.
    const token = await getAuthToken(request, baseURL)
    const prefix = `Raw/2022/${scope.experiment}/${scope.location}/${scope.population}/${scope.date}/${scope.platform}/${scope.sensor}/Images/`
    {
      const csvText = await fetchMinioObjectText(
        request,
        baseURL,
        token,
        `${prefix}gcp_locations.csv`,
      )
      const lines = csvText
        .trim()
        .split(/\r?\n/)
        .filter((l) => l.length > 0)
      expect(lines).toHaveLength(3)
      expect(
        lines
          .slice(1)
          .map((l) => l.split(",")[0])
          .sort(),
      ).toEqual(["DEL-A", "DEL-B"])
    }

    // Activate DEL-A, click trash, confirm.
    await activeSelect.click()
    await page.getByRole("option", { name: /DEL-A/ }).click()
    await page.getByTestId("gcp-delete-active").click()
    await expect(page.getByTestId("confirm-dialog")).toBeVisible()
    await expect(page.getByTestId("confirm-dialog-title")).toContainText(
      "Delete DEL-A",
    )
    await page.getByRole("button", { name: /^Delete GCP$/ }).click()

    // Catalog dropdown now shows only DEL-B.
    await expect(activeSelect).toContainText("DEL-B", { timeout: 10_000 })
    await activeSelect.click()
    await expect(page.getByRole("option", { name: /DEL-B/ })).toBeVisible()
    await expect(page.getByRole("option", { name: /DEL-A/ })).toBeHidden()
    await page.keyboard.press("Escape")

    // gcp_locations.csv has only DEL-B.
    const csvText = await fetchMinioObjectText(
      request,
      baseURL,
      token,
      `${prefix}gcp_locations.csv`,
    )
    const lines = csvText
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
    expect(lines).toHaveLength(2)
    expect(lines[1].split(",")[0]).toBe("DEL-B")
  })

  // ─────────────────────────────────────────────────────────────────────
  // Test 6 — per-GCP image-dot coloring on the always-visible map
  // ─────────────────────────────────────────────────────────────────────

  test("Per-GCP coloring: image dots are filled with the color of the GCP whose radius covers them", async ({
    page,
    baseURL,
    runPrefix,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    await createWorkspaceAndOpenRun(page, {
      runPrefix,
      suffix: "color",
    })
    await openGcpStep(page)

    // Two GCPs: one at the cluster centre (red, catalog index 0), one
    // 120 m east (blue, catalog index 1). We explicitly bump CTR's
    // radius to 100 m so every fixture image falls within its circle —
    // the test stays insensitive to the runtime DEFAULT_RADIUS_M.
    await page.getByTestId("gcp-load-csv").click()
    await page
      .getByTestId("gcp-csv-textarea")
      .fill(
        [
          "Label,Lat_dec,Lon_dec,Altitude",
          "CTR,38.53364,-121.78246,11.0",
          "EAST,38.53364,-121.78108,11.0",
        ].join("\n"),
      )
    await page.getByTestId("gcp-csv-save").click()
    const activeSelectColor = page.getByTestId("gcp-active-select")
    await expect(activeSelectColor).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByText(/Reading EXIF GPS/i, { exact: false }),
    ).toBeHidden({ timeout: 60_000 })

    // Make CTR active and widen its per-GCP radius so it claims every
    // fixture image regardless of the default-radius constant.
    await activeSelectColor.click()
    await page.getByRole("option", { name: /^CTR/ }).click()
    await page.getByTestId("gcp-radius-input").fill("100")

    await expect(page.getByTestId("image-dot-map")).toBeVisible()
    await page.waitForFunction(
      ({ targets }) => {
        const w = window as unknown as {
          __imageDotMapMarkers__?: Map<string, unknown>
        }
        const m = w.__imageDotMapMarkers__
        if (!m) return false
        return targets.every((n) => m.has(n))
      },
      { targets: DRONE_IMAGES },
      { timeout: 30_000 },
    )
    await page.waitForTimeout(300)

    // Read fillColor for every fixture marker. Catalog index 0 is red
    // (#ef4444); index 1 is blue (#3b82f6). With CTR's radius at 100 m,
    // every fixture image falls within its circle, so all dots should
    // be red. (In radius mode `selected` is empty, so the per-dot color
    // wins over any active-GCP accent.)
    const colors = await page.evaluate(() => {
      const w = window as unknown as {
        __imageDotMapMarkers__?: Map<
          string,
          { options: { fillColor?: string } }
        >
      }
      const out: Record<string, string | undefined> = {}
      for (const [name, m] of w.__imageDotMapMarkers__ ?? []) {
        out[name] = m.options.fillColor
      }
      return out
    })
    for (const name of DRONE_IMAGES) {
      expect(
        (colors[name] ?? "").toLowerCase(),
        `${name} should be red (CTR)`,
      ).toBe("#ef4444")
    }
  })
})
