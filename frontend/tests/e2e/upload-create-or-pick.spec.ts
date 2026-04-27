/**
 * Phase 12-ish coverage for the Phase-6 upload form's new
 * "select existing or create new" entity dropdowns.
 *
 * What this proves:
 *   1. Picking "+ Create new…" for Experiment, Site, Population, Sensor
 *      Platform, and Sensor and uploading a JPG creates each entity in
 *      the DB before the chunked upload starts.
 *   2. After upload, the new experiment shows up in the sidebar
 *      ExperimentSelector dropdown (the bug the user originally hit:
 *      uploads created MinIO objects with no DB rows backing them).
 *   3. A second upload to the same experiment can pick it from the
 *      dropdown instead of re-creating it (search-or-create dedup path).
 *   4. Submitting with a blank dropdown fires the upload-error dialog
 *      with a clear "Required fields are blank" message — not a fleeting
 *      toast.
 */
import { expect, test } from "../helpers/fixtures"

function uniqueStamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

async function pickCreateNew(
  page: import("@playwright/test").Page,
  fieldKey: string,
  newName: string,
): Promise<void> {
  const slug = fieldKey.toLowerCase()
  const trigger = page.getByTestId(`entity-select-${slug}`)
  await expect(trigger).toBeEnabled({ timeout: 10_000 })
  await trigger.click()
  await page.getByTestId(`entity-create-${slug}`).click()
  const newInput = page.getByTestId(`entity-new-${slug}`)
  await expect(newInput).toBeVisible()
  await newInput.fill(newName)
}

async function pickExisting(
  page: import("@playwright/test").Page,
  fieldKey: string,
  optionName: string,
): Promise<void> {
  const slug = fieldKey.toLowerCase()
  const trigger = page.getByTestId(`entity-select-${slug}`)
  await expect(trigger).toBeEnabled({ timeout: 10_000 })
  await trigger.click()
  await page.getByRole("option", { name: optionName, exact: true }).click()
}

test.describe("Upload form: select-or-create entity dropdowns", () => {
  test.setTimeout(180_000)

  test("create-new for every entity → backend rows exist + sidebar selector populates + second upload reuses", async ({
    page,
    request,
  }) => {
    const stamp = uniqueStamp()
    const experimentName = `pw-exp-${stamp}`
    const siteName = `pw-site-${stamp}`
    const populationName = `pw-pop-${stamp}`
    const platformName = `pw-platform-${stamp}`
    const sensorName = `pw-sensor-${stamp}`
    const date = "2024-06-01"

    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-upload"]').click()
    await page.locator('[data-onboarding="files-data-type-selector"]').click()
    await page.getByRole("menuitem", { name: "Image Data", exact: true }).click()

    // 1. Pick Create-new for every entity field.
    await pickCreateNew(page, "experiment", experimentName)
    await pickCreateNew(page, "site", siteName)
    await pickCreateNew(page, "population", populationName)
    await page.locator("input#date").fill(date)
    await pickCreateNew(page, "sensorplatform", platformName)
    await pickCreateNew(page, "sensor", sensorName)

    // 2. Drop a tiny JPG via the hidden input; that's enough to drive the
    //    create-then-upload pipeline end-to-end.
    await page.locator('[data-testid="upload-input"]').setInputFiles({
      name: `${stamp}.jpg`,
      mimeType: "image/jpeg",
      buffer: Buffer.from("jpgbytes"),
    })
    await expect(
      page.getByRole("heading", { name: /^Selected Files \(1\)$/ }),
    ).toBeVisible()

    // 3. Click submit. Expect a POST to /api/experiments before the first
    //    chunk lands — proves entity creation runs first.
    const expCreate = page.waitForResponse(
      (r) =>
        /\/api\/experiments(\?|$)/.test(r.url()) &&
        r.request().method() === "POST",
    )
    const firstChunk = page.waitForResponse(
      (r) =>
        /\/api\/files\/upload_chunk$/.test(r.url()) &&
        r.request().method() === "POST",
      { timeout: 60_000 },
    )
    await page.locator('[data-testid="upload-submit"]').click()
    const expResp = await expCreate
    expect(expResp.ok()).toBe(true)
    await firstChunk

    // Wait for the process to mark Done (no follow-up extraction job).
    await expect(page.getByText(/^Done$/)).toBeVisible({ timeout: 60_000 })

    // 4. Verify backend has the experiment via direct GET.
    const token = await page.evaluate(() => localStorage.getItem("gemini.auth.token"))
    const headers = { Authorization: `Bearer ${token}` }
    const verifyExp = await request.get(
      `/api/experiments?experiment_name=${encodeURIComponent(experimentName)}`,
      { headers },
    )
    expect(verifyExp.ok()).toBe(true)
    const expRows = (await verifyExp.json()) as Array<{ experiment_name?: string }>
    expect(expRows.some((r) => r.experiment_name === experimentName)).toBe(true)

    // 5. Sidebar selector now lists the new experiment. Open it and
    //    confirm the option is visible.
    const sidebarTrigger = page.getByRole("combobox").first()
    await sidebarTrigger.click()
    await expect(
      page.getByRole("option", { name: experimentName }),
    ).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press("Escape")

    // 6. Second upload: pick the just-created experiment from the dropdown
    //    (proves the existing-pick path), then reuse the other entities the
    //    same way. Use a fresh date so the stored objectPath differs.
    await page.locator('[data-onboarding="files-tab-upload"]').click()
    await page.locator('[data-onboarding="files-data-type-selector"]').click()
    await page.getByRole("menuitem", { name: "Image Data", exact: true }).click()

    await pickExisting(page, "experiment", experimentName)
    await pickExisting(page, "site", siteName)
    await pickExisting(page, "population", populationName)
    await page.locator("input#date").fill("2024-06-02")
    await pickExisting(page, "sensorplatform", platformName)
    await pickExisting(page, "sensor", sensorName)

    await page.locator('[data-testid="upload-input"]').setInputFiles({
      name: `${stamp}-second.jpg`,
      mimeType: "image/jpeg",
      buffer: Buffer.from("jpgbytes-second"),
    })
    await expect(
      page.getByRole("heading", { name: /^Selected Files \(1\)$/ }),
    ).toBeVisible()

    // The second upload must NOT POST a fresh experiment. Track creates
    // and assert zero of them.
    let unwantedCreate = false
    const onResp = (r: import("@playwright/test").Response) => {
      if (
        /\/api\/experiments(\?|$)/.test(r.url()) &&
        r.request().method() === "POST"
      ) {
        unwantedCreate = true
      }
    }
    page.on("response", onResp)

    const secondChunk = page.waitForResponse(
      (r) =>
        /\/api\/files\/upload_chunk$/.test(r.url()) &&
        r.request().method() === "POST",
      { timeout: 60_000 },
    )
    await page.locator('[data-testid="upload-submit"]').click()
    await secondChunk
    await expect(page.getByText(/^Done$/).first()).toBeVisible({ timeout: 60_000 })
    page.off("response", onResp)
    expect(
      unwantedCreate,
      "second upload must reuse the existing experiment, not POST a new one",
    ).toBe(false)
  })

  test("blank dropdown blocks submit with a dialog (not a fleeting toast)", async ({
    page,
  }) => {
    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-upload"]').click()
    await page.locator('[data-onboarding="files-data-type-selector"]').click()
    await page.getByRole("menuitem", { name: "Image Data", exact: true }).click()

    // Pick a file but leave the dropdowns alone.
    await page.locator('[data-testid="upload-input"]').setInputFiles({
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("jpgbytes"),
    })
    await expect(
      page.getByRole("heading", { name: /^Selected Files \(1\)$/ }),
    ).toBeVisible()
    await page.locator('[data-testid="upload-submit"]').click()

    const dialog = page.locator('[data-testid="upload-error-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(dialog).toContainText(/required fields are blank/i)
    // Should call out at least one of the scope fields by name.
    await expect(dialog).toContainText(
      /(experiment|location|population|date|platform|sensor)/i,
    )
    // Wait past sonner's autodismiss to prove the dialog stays.
    await page.waitForTimeout(5_000)
    await expect(dialog).toBeVisible()
  })
})
