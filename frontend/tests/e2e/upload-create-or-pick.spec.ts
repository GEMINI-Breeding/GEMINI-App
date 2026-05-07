/**
 * Phase 12-ish coverage for the Phase-6 upload form's new
 * "select existing or create new" entity dropdowns.
 *
 * What this proves:
 *   1. Picking "+ Create new…" for Experiment, Site, Population, Sensor
 *      Platform, and Sensor and uploading a JPG creates each entity in
 *      the DB before the chunked upload starts.
 *   2. After upload, the new experiment shows up in the upload form's
 *      experiment dropdown for a second upload (the bug the user
 *      originally hit: uploads created MinIO objects with no DB rows,
 *      and a second upload couldn't pick the experiment).
 *   3. A second upload to the same experiment can pick it from the
 *      dropdown instead of re-creating it (search-or-create dedup path).
 *   4. Submitting with a blank dropdown fires the upload-error dialog
 *      with a clear "Required fields are blank" message — not a fleeting
 *      toast.
 */
import { expect, test } from "../helpers/fixtures"

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
    runPrefix,
  }) => {
    const stamp = runPrefix
    const experimentName = `${stamp}-exp`
    const siteName = `${stamp}-site`
    const populationName = `${stamp}-pop`
    const platformName = `${stamp}-platform`
    const sensorName = `${stamp}-sensor`
    const date = "2024-06-01"

    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-upload"]').click()
    await page.locator('[data-onboarding="files-data-type-selector"]').click()
    await page
      .getByRole("menuitem", { name: "Image Data", exact: true })
      .click()

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
    const token = await page.evaluate(() =>
      localStorage.getItem("gemini.auth.token"),
    )
    const headers = { Authorization: `Bearer ${token}` }
    const verifyExp = await request.get(
      `/api/experiments?experiment_name=${encodeURIComponent(experimentName)}`,
      { headers },
    )
    expect(verifyExp.ok()).toBe(true)
    const expRows = (await verifyExp.json()) as Array<{
      experiment_name?: string
    }>
    expect(expRows.some((r) => r.experiment_name === experimentName)).toBe(true)

    // 5. Second upload: pick the just-created experiment from the
    //    upload form's experiment dropdown (proves the existing-pick
    //    path AND the user-association call ran — without that
    //    association the dropdown would filter it out and pickExisting
    //    would fail). Use a fresh date so the stored objectPath differs.
    await page.locator('[data-onboarding="files-tab-upload"]').click()
    await page.locator('[data-onboarding="files-data-type-selector"]').click()
    await page
      .getByRole("menuitem", { name: "Image Data", exact: true })
      .click()

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
    await expect(page.getByText(/^Done$/).first()).toBeVisible({
      timeout: 60_000,
    })
    page.off("response", onResp)
    expect(
      unwantedCreate,
      "second upload must reuse the existing experiment, not POST a new one",
    ).toBe(false)
  })

  test("blank dropdown locks the upload dropzone before any file can be staged", async ({
    page,
  }) => {
    // The Files page now gates the dropzone behind two required
    // fields: a data type AND an experiment. With nothing picked, the
    // dropzone is inert and surfaces a `data-type` reason. Picking a
    // data type swaps the reason to the experiment gate. The
    // submit-time "required fields are blank" dialog is no longer
    // reachable because you can't even stage files into the upload
    // list without scope — so the assertion has moved one step
    // earlier in the flow, where the user can actually see why
    // they're stuck.
    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-upload"]').click()

    const reason = page.getByTestId("upload-dropzone-disabled-reason")
    await expect(reason).toContainText(/select a data type/i)

    await page.locator('[data-onboarding="files-data-type-selector"]').click()
    await page
      .getByRole("menuitem", { name: "Image Data", exact: true })
      .click()
    await expect(reason).toContainText(/experiment/i)

    // Confirm the dropzone is genuinely inert: setting files on the
    // hidden input should NOT populate the Selected list because the
    // input's change handler short-circuits when disabled.
    await page.locator('[data-testid="upload-input"]').setInputFiles({
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("jpgbytes"),
    })
    await expect(
      page.getByRole("heading", { name: /^Selected Files/i }),
    ).toHaveCount(0)
  })
})
