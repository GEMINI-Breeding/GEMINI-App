import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

import { waitForResponseOk } from "./waitFor"

/** Navigate to the Files dashboard. The Upload section is active by default. */
export async function navigateToUpload(page: Page): Promise<void> {
  await page.goto("/files")
  // NavSidebar has `data-onboarding="files-tab-upload"`; click it to force
  // the Upload view in case a prior test left Manage active.
  await page.locator('[data-onboarding="files-tab-upload"]').click()
  await expect(page.getByRole("heading", { name: /^upload$/i })).toBeVisible()
}

/**
 * Open the DataTypes dropdown and pick an entry by its visible label
 * (e.g. "Image Data", "Orthomosaic", "Farm-ng Binary File").
 */
export async function selectDataType(page: Page, label: string): Promise<void> {
  await page.locator('[data-onboarding="files-data-type-selector"]').click()
  await page.getByRole("menuitem", { name: label, exact: true }).click()
  await expect(
    page.locator('[data-onboarding="files-data-structure-form"]'),
  ).toBeVisible()
}

export interface UploadFormValues {
  experiment?: string
  location?: string
  population?: string
  date?: string
  platform?: string
  sensor?: string
}

/**
 * Fill the DataStructureForm. The form is now a stack of entity dropdowns
 * (Experiment / Site / Population / Sensor platform / Sensor) where each
 * field can either pick an existing row or "+ Create new…" with a typed
 * name. Date stays a free-text date input.
 *
 * Helper behavior: every value passed in is treated as a *new entity name*
 * — that's what the existing test suite needs, since each spec generates
 * unique-stamped names and expects them to be created on the fly. The
 * first time the spec runs, the create-new path executes; on re-runs, the
 * resolveScope hook's search-by-name dedupes them.
 */
const FORM_FIELD_TO_SELECT_TESTID: Record<string, string> = {
  experiment: "entity-select-experiment",
  location: "entity-select-site",
  population: "entity-select-population",
  platform: "entity-select-sensorplatform",
  sensor: "entity-select-sensor",
}
const FORM_FIELD_TO_NEW_INPUT_TESTID: Record<string, string> = {
  experiment: "entity-new-experiment",
  location: "entity-new-site",
  population: "entity-new-population",
  platform: "entity-new-sensorplatform",
  sensor: "entity-new-sensor",
}

export async function fillUploadForm(
  page: Page,
  values: UploadFormValues,
): Promise<void> {
  const fieldOrder: (keyof UploadFormValues)[] = [
    "experiment",
    "location",
    "population",
    "date",
    "platform",
    "sensor",
  ]
  for (const field of fieldOrder) {
    const value = values[field]
    if (!value) continue

    if (field === "date") {
      const input = page.locator("input#date")
      if (!(await input.count())) continue
      await expect(input).toBeEnabled()
      await input.fill(value)
      continue
    }

    const selectTestId = FORM_FIELD_TO_SELECT_TESTID[field]
    const newInputTestId = FORM_FIELD_TO_NEW_INPUT_TESTID[field]
    if (!selectTestId || !newInputTestId) continue

    const trigger = page.getByTestId(selectTestId)
    if (!(await trigger.count())) continue
    await expect(trigger).toBeEnabled()
    await trigger.click()
    // Pick the "+ Create new…" sentinel and then fill the new-name input.
    await page
      .getByTestId(
        `entity-create-${selectTestId.replace("entity-select-", "")}`,
      )
      .click()
    const newInput = page.getByTestId(newInputTestId)
    await expect(newInput).toBeVisible()
    await newInput.fill(value)
  }
}

/**
 * Select files via the hidden <input type="file"> inside UploadZone.
 *
 * The Phase-6 dropzone is browser-native: clicking it opens a file picker.
 * Playwright can't drive that picker, so we `setInputFiles` on the input
 * directly — which fires the same change event the picker would. Files
 * are passed as absolute host paths (e.g. fixtures) because Playwright's
 * setInputFiles reads them from disk.
 */
export async function dropFiles(
  page: Page,
  filePaths: string[],
): Promise<void> {
  await page.locator('[data-testid="upload-input"]').setInputFiles(filePaths)
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`^Selected Files \\(${filePaths.length}\\)$`, "i"),
    }),
  ).toBeVisible()
}

/**
 * Click submit and wait for the upload to leave the client side.
 *
 * Always asserts:
 *   1. /api/files/upload_chunk fires (upload reached the API).
 *   2. ProcessPanel shows the expected "Uploading …" title.
 *
 * If `waitForDone !== false` (default), the helper also waits for the
 * process to reach a terminal state. That state depends on whether a
 * follow-up extraction job was kicked off:
 *   - Plain (non-bin) uploads have no follow-up — `useUploadQueue` flips
 *     the process to `status: "completed"` the moment every chunk lands,
 *     and ProcessPanel renders "Done". This covers per-item completion
 *     transitively: "Done" is unreachable unless every item.status went
 *     to "completed".
 *   - .bin uploads chain an EXTRACT_BINARY job; "Done" only appears once
 *     wsManager streams a terminal status from the worker.
 *
 * If `waitForDone === false`, the helper instead asserts the per-upload
 * completion signal — the ProcessPanel message flips from "Uploading N
 * .bin file(s) + extracting" to "Extracting N file(s)" exactly when the
 * client side finished every chunk *and* `JobsService.submitJob` returned
 * a real job id. A regression that dropped the final completion call (or
 * lost the follow-up job submission) would not produce that text. This
 * is the assertion that protects callers who skip the worker wait.
 */
export async function submitUploadAndWait(
  page: Page,
  expectedFileCount: number,
  opts: { timeoutMs?: number; waitForDone?: boolean } = {},
): Promise<void> {
  // Wait for at least one /upload_chunk response to confirm the upload
  // actually started; individual chunks happen in a loop afterwards.
  const firstChunk = waitForResponseOk(
    page,
    "POST",
    /\/api\/files\/upload_chunk$/,
    60_000,
  )
  await page.locator('[data-testid="upload-submit"]').click()
  await firstChunk

  // Confirm the expected ProcessPanel title.
  await expect(
    page.getByText(
      new RegExp(
        `^(Uploading ${expectedFileCount} \\.bin file|Uploading ${expectedFileCount} file)`,
        "i",
      ),
    ),
  ).toBeVisible({ timeout: 15_000 })

  if (opts.waitForDone === false) {
    // The "Extracting N file(s)" message is set by useUploadQueue right
    // after every chunk lands and the EXTRACT_BINARY job submission
    // returns a non-empty job id. Asserting on it confirms the upload
    // really finished client-side, not just that some chunks reached
    // MinIO.
    await expect(
      page.getByText(new RegExp(`^Extracting ${expectedFileCount} file`, "i")),
    ).toBeVisible({ timeout: opts.timeoutMs ?? 60_000 })
    return
  }

  // Terminal "Done" — set when the process status flips to "completed".
  // For plain uploads this happens the moment chunks land; for extraction
  // it happens when the worker reports COMPLETED via wsManager.
  await expect(page.getByText(/^Done$/i).first()).toBeVisible({
    timeout: opts.timeoutMs ?? 120_000,
  })
}
