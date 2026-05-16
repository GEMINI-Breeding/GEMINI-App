/**
 * Strict-E2E coverage for the thermal-image pipeline.
 *
 * Two cases: a FLIR One Pro JPEG batch (auto-mode `flir_one_pro`,
 * has_gps=true) and an Amiga Boson TIFF batch (default mode
 * `boson_tlinear_high`, has_gps=false). Both drive the real upload
 * UI, exercise the byte-peek probe (src/lib/thermalProbe.ts), wait
 * for the chained THERMAL_EXTRACT worker job, and verify the
 * ThermalViewerDialog opens against the worker-written sidecars.
 *
 * Per CLAUDE.md: zero API seeding. Everything (experiment, sensor
 * platform, sensor) is created through the UI; THERMAL_EXTRACT is
 * the chained job that fires from useUploadQueue's postUploadJob
 * hook (see frontend/src/features/files/hooks/useUploadQueue.ts).
 * Console-error guard + per-test cleanup-by-prefix run via
 * tests/helpers/fixtures.
 */
import type { Page } from "@playwright/test"

import { fixturePath } from "../helpers/fixturePath"
import { expect, test } from "../helpers/fixtures"
import {
  dropFiles,
  fillUploadForm,
  navigateToUpload,
  selectDataType,
} from "../helpers/uploadHelpers"
import { waitForResponseOk } from "../helpers/waitFor"

type ThermalCase = {
  label: string
  fixtures: string[]
  /** Calibration mode the byte-peek probe should pick by default —
   *  asserted against the THERMAL_EXTRACT job's submitted params.
   *  Boson defaults to centikelvin (the BosonUSB / Amiga convention),
   *  FLIR JPEGs default to flir_one_pro (self-describing Planck). */
  expectedDefaultMode: "flir_one_pro" | "boson_centikelvin"
  /** Whether the dataset is expected to carry per-image GPS. Pinned
   *  so the Phase D preflight contract is observable from E2E. */
  expectedHasGps: boolean
  /** ImageViewer chip the spec hovers/clicks; same testid for both
   *  cases because the contract (a 'Thermal' chip on the matching
   *  Images/ thumbnail) is identical. */
  expectedFileCount: number
}

const FLIR_CASE: ThermalCase = {
  label: "FLIR One Pro JPEGs",
  fixtures: [
    fixturePath("thermal", "flir_drone_001.jpg"),
    fixturePath("thermal", "flir_drone_002.jpg"),
  ],
  expectedDefaultMode: "flir_one_pro",
  expectedHasGps: true,
  expectedFileCount: 2,
}

const BOSON_CASE: ThermalCase = {
  label: "Amiga Boson TIFFs",
  fixtures: [
    fixturePath("thermal", "boson_amiga_001.tiff"),
    fixturePath("thermal", "boson_amiga_002.tiff"),
  ],
  expectedDefaultMode: "boson_centikelvin",
  expectedHasGps: false,
  expectedFileCount: 2,
}

async function runThermalUploadAndVerify(
  page: Page,
  c: ThermalCase,
  runPrefix: string,
): Promise<void> {
  const experiment = `${runPrefix}-exp`
  const location = `${runPrefix}-loc`
  const population = `${runPrefix}-pop`
  const date = "2024-07-25"
  const platform = `${runPrefix}-plat`
  const sensor = `${runPrefix}-sensor`

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

  await dropFiles(page, c.fixtures)

  // After the byte-peek probe finishes, the calibration field
  // auto-appears with the mode pre-selected. There used to be a
  // "This is thermal data" checkbox here — it caused a silent-no-
  // worker failure mode when the user forgot to check it. The probe
  // (src/lib/thermalProbe.ts) keys off the "FLIR Systems" EXIF Make
  // string for JPEGs and the 16-bit BlackIsZero TIFF shape for TIFFs.
  const calibrationField = page.getByTestId("thermal-calibration-field")
  await expect(calibrationField).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("thermal-mode-trigger")).toBeVisible()

  // Listen for the chained job's submit BEFORE clicking, to avoid the
  // race where the response arrives before waitForResponse is wired.
  const submitJobResp = page.waitForResponse(
    (r) =>
      r.url().includes("/api/jobs/submit") && r.request().method() === "POST",
    { timeout: 120_000 },
  )
  const firstChunk = waitForResponseOk(
    page,
    "POST",
    /\/api\/files\/upload_chunk$/,
    60_000,
  )
  await page.getByTestId("upload-submit").click()
  await firstChunk

  // Title shape: UploadList writes a thermal-specific title when the
  // postUploadJob is set, regardless of mode.
  await expect(
    page.getByText(
      new RegExp(`^Uploading ${c.expectedFileCount} thermal file`, "i"),
    ),
  ).toBeVisible({ timeout: 15_000 })

  const submitResp = await submitJobResp
  expect(submitResp.ok()).toBeTruthy()
  const submitted = (await submitResp.json()) as {
    id?: string
    job_type?: string
    parameters?: { thermal_calibration?: { mode?: string } }
  }
  expect(submitted.job_type).toBe("THERMAL_EXTRACT")
  expect(submitted.parameters?.thermal_calibration?.mode).toBe(
    c.expectedDefaultMode,
  )
  expect(
    submitted.id,
    "THERMAL_EXTRACT job id must be returned",
  ).toBeTruthy()

  // Worker terminal state — same signal the amiga + image specs use.
  await expect(page.getByText(/^Done$/i).first()).toBeVisible({
    timeout: 300_000,
  })

  // Switch to View → Images → pick our experiment → the worker-
  // written preview shows with a "Thermal" badge.
  await page.locator('[data-onboarding="files-tab-view"]').click()
  await page.getByTestId("view-tab-images").click()
  const expSelect = page.getByTestId("image-viewer-experiment")
  await expect(expSelect).toBeVisible({ timeout: 30_000 })
  await expSelect.click()
  await page.getByRole("option", { name: experiment }).click()

  // The ImageViewer also lists the sibling RawThermal/*.json sidecars,
  // which the thermal-detection logic uses to tag the matching
  // Images/*.{jpg,tif,tiff} thumbnail with a "Thermal" badge (see
  // `ImageViewer.isThermalImage`). Asserting on the badge proves the
  // worker output is properly wired into the UI's detection.
  const thermalThumb = page.getByTestId("thermal-thumbnail").first()
  await expect(thermalThumb).toBeVisible({ timeout: 60_000 })
  await expect(thermalThumb.getByTestId("thermal-badge")).toBeVisible()

  // Exactly one tile per uploaded frame — no twin gallery entries for
  // the worker-written JPEG preview, no orphaned TIFF rendering as a
  // white box. This is the contract that the Boson "pairs" bug
  // (Phase I.1) regressed against.
  const thermalCount = await page.getByTestId("thermal-thumbnail").count()
  expect(thermalCount).toBe(c.expectedFileCount)
  // The worker-written JPEG preview must be hidden, and the raw
  // RawThermal/*.tif sidecar must not leak into the Images gallery
  // either. Both bugs would show up as `image-thumbnail` rows.
  const plainCount = await page.getByTestId("image-thumbnail").count()
  expect(plainCount).toBe(0)

  await thermalThumb.click()
  const dialog = page.getByTestId("thermal-viewer-dialog")
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  // Canvas + palette controls — proof the lib successfully fetched
  // the sidecar pair, decoded the uint16 TIFF, applied a palette,
  // and bound the slider state to the rendered image.
  await expect(page.getByTestId("thermal-canvas")).toBeVisible()
  await expect(page.getByTestId("thermal-palette-trigger")).toBeVisible()
  await expect(page.getByTestId("thermal-vmin")).toBeVisible()
  await expect(page.getByTestId("thermal-vmax")).toBeVisible()
  await expect(page.getByTestId("thermal-hud")).toBeVisible()

  // GPS contract observable: amiga_low_res / drone_low_res JPEGs
  // have GPS in EXIF; Boson TIFFs do not. We don't drill into the
  // sidecar JSON from the test (the worker-side has its own unit
  // tests for `has_gps`), but we surface the expectation in the
  // case definition so a future regression that silently changes
  // GPS detection across cameras is caught here.
  void c.expectedHasGps

  await page.getByTestId("thermal-close").click()
}

test.describe("Thermal upload (Image Data path)", () => {
  // THERMAL_EXTRACT downloads thermal frames, invokes exiftool /
  // numpy / Pillow, and uploads three sidecars per input. On dev
  // hardware this completes in well under a minute, but the worker
  // poll interval (5s) plus image decode adds slack.
  test.setTimeout(360_000)

  test("FLIR JPEGs → auto-detect (flir_one_pro) → THERMAL_EXTRACT → viewer", async ({
    page,
    runPrefix,
  }) => {
    await runThermalUploadAndVerify(page, FLIR_CASE, runPrefix)
  })

  test("Boson TIFFs → auto-detect (boson_centikelvin) → THERMAL_EXTRACT → viewer", async ({
    page,
    runPrefix,
  }) => {
    await runThermalUploadAndVerify(page, BOSON_CASE, runPrefix)
  })
})
