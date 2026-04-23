import type { Locator, Page } from "@playwright/test"
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
 * (e.g. "Image Data", "Orthomosaic", "Field Design").
 */
export async function selectDataType(page: Page, label: string): Promise<void> {
  await page.locator('[data-onboarding="files-data-type-selector"]').click()
  await page.getByRole("menuitem", { name: label, exact: true }).click()
  // Once a type is selected the form appears; this anchor lets us chain fills
  // without race conditions.
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
 * equal to the field name, so getByLabel() with an exact match hits the right
 * input. Fields that don't apply to the current data type are skipped.
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
    // The cascade (experiment → location → …) means the next input only
    // enables after the previous value is committed. Wait for it briefly.
    await page.waitForTimeout(50)
  }
}

/**
 * Inject file paths via the test-mode hook in platform.ts::pickFiles and click
 * the upload zone. UploadZone calls pickFiles on click; our hook returns the
 * injected paths synchronously so onFilesAdded receives them exactly like
 * Tauri's native file dialog would.
 */
export async function dropFiles(page: Page, filePaths: string[]): Promise<void> {
  await page.evaluate((paths) => {
    ;(window as unknown as { __E2E_PICK_FILES__?: string[] }).__E2E_PICK_FILES__ =
      paths
  }, filePaths)

  const zone = page.getByRole("button", {
    name: /click to browse or drag & drop files/i,
  })
  await zone.click()

  await expect(
    page.getByRole("heading", {
      name: new RegExp(`^Selected Files \\(${filePaths.length}\\)$`, "i"),
    }),
  ).toBeVisible()
}

/**
 * Click submit and wait for the streaming upload endpoint plus the
 * ProcessPanel card that shows the final "Uploaded N file(s)" title.
 */
export async function submitUploadAndWait(
  page: Page,
  expectedFileCount: number,
): Promise<void> {
  const streamPromise = waitForResponseOk(
    page,
    "POST",
    /\/api\/v1\/files\/copy-local-stream$/,
    60_000,
  )
  await page.getByRole("button", { name: /^upload \d+ file/i }).click()
  await streamPromise
  await expect(
    page.getByText(new RegExp(`^Uploaded ${expectedFileCount} file`, "i")),
  ).toBeVisible({ timeout: 120_000 })
}
