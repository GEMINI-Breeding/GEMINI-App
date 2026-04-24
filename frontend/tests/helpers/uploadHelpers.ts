import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

import { waitForResponseOk } from "./waitFor"

/** Navigate to the Files dashboard. The Upload section is active by default. */
export async function navigateToUpload(page: Page): Promise<void> {
  await page.goto("/files")
  // NavSidebar has `data-onboarding="files-tab-upload"`; click it to force
  // the Upload view in case a prior test left Manage active.
  await page.locator('[data-onboarding="files-tab-upload"]').click()
  await expect(
    page.getByRole("heading", { name: /^upload$/i }),
  ).toBeVisible()
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
 * Fill the DataStructureForm. TextField renders `<label htmlFor={id}>` with id
 * equal to the field name, so `input#${field}` hits the right input.
 */
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
    const input = page.locator(`input#${field}`)
    if (!(await input.count())) continue
    await expect(input).toBeEnabled()
    await input.fill(value)
    // The cascade (experiment → location → …) enables the next input only
    // after the previous commits.
    await page.waitForTimeout(50)
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
export async function dropFiles(page: Page, filePaths: string[]): Promise<void> {
  await page.locator('[data-testid="upload-input"]').setInputFiles(filePaths)
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`^Selected Files \\(${filePaths.length}\\)$`, "i"),
    }),
  ).toBeVisible()
}

/**
 * Click the submit button and wait for every chunk upload to land. Phase 6
 * uploads chunk-by-chunk (one POST per chunk) instead of one streaming
 * call, so we wait for the final "Upload N file(s) + extracting" or
 * "Uploaded N file(s)" state in the ProcessPanel to conclude the flow.
 */
export async function submitUploadAndWait(
  page: Page,
  expectedFileCount: number,
  opts: { timeoutMs?: number } = {},
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

  // The ProcessPanel title changes to "Uploaded …" when no follow-up job
  // fires, or "Uploading … + extracting" when .bin files kick off an
  // EXTRACT_BINARY job. Either terminal string means the client side is
  // done and ProcessContext has taken over.
  await expect(
    page.getByText(
      new RegExp(
        `^(Uploaded ${expectedFileCount} file|Uploading ${expectedFileCount} \\.bin file)`,
        "i",
      ),
    ),
  ).toBeVisible({ timeout: opts.timeoutMs ?? 120_000 })
}
