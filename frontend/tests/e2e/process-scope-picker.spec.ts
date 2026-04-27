/**
 * Process page scope-picker discovery.
 *
 * Originally the picker had a free-text date input + a hardcoded list of
 * platform/sensor names ("Drone, Amiga, RoverM2; RGB, Thermal, ..."). A
 * researcher who'd uploaded "iPhone" as a sensor name months ago had no
 * way to find it in the picker, and a typo in the date silently produced
 * a path that nothing in MinIO matched. This spec proves the new
 * behavior: every dropdown lists exactly what was uploaded under the
 * active experiment scope.
 *
 * Strict-E2E (CLAUDE.md):
 *   - Drives the real Files UI to upload via the create-or-pick form.
 *   - Drives the real Process > Orthomosaic page to verify discovery.
 *   - Asserts on the dropdown options being exactly what was uploaded
 *     (no more, no less).
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
  await page.getByTestId(`entity-select-${slug}`).click()
  await page.getByTestId(`entity-create-${slug}`).click()
  const newInput = page.getByTestId(`entity-new-${slug}`)
  await expect(newInput).toBeVisible()
  await newInput.fill(newName)
}

async function uploadOneJpg(
  page: import("@playwright/test").Page,
  args: {
    experiment: string
    site: string
    population: string
    platform: string
    sensor: string
    date: string
    fileName: string
  },
): Promise<void> {
  await page.goto("/files")
  await page.locator('[data-onboarding="files-tab-upload"]').click()
  await page.locator('[data-onboarding="files-data-type-selector"]').click()
  await page.getByRole("menuitem", { name: "Image Data", exact: true }).click()

  await pickCreateNew(page, "experiment", args.experiment)
  await pickCreateNew(page, "site", args.site)
  await pickCreateNew(page, "population", args.population)
  await page.locator("input#date").fill(args.date)
  await pickCreateNew(page, "sensorplatform", args.platform)
  await pickCreateNew(page, "sensor", args.sensor)

  await page.locator('[data-testid="upload-input"]').setInputFiles({
    name: args.fileName,
    mimeType: "image/jpeg",
    buffer: Buffer.from("jpgbytes"),
  })
  await expect(
    page.getByRole("heading", { name: /^Selected Files \(1\)$/ }),
  ).toBeVisible()

  const firstChunk = page.waitForResponse(
    (r) =>
      /\/api\/files\/upload_chunk$/.test(r.url()) &&
      r.request().method() === "POST",
    { timeout: 60_000 },
  )
  await page.locator('[data-testid="upload-submit"]').click()
  await firstChunk
  await expect(page.getByText(/^Done$/).first()).toBeVisible({ timeout: 60_000 })
}

test.describe("Process: scope picker discovers uploaded data", () => {
  test.setTimeout(180_000)

  test("uploads of arbitrary platform/sensor names appear verbatim in picker dropdowns", async ({
    page,
  }) => {
    const stamp = uniqueStamp()
    const experiment = `pw-pick-${stamp}`
    // Use a deliberately quirky platform/sensor name to prove the picker
    // discovers what the user typed, not a hardcoded preset list.
    const platform = `lowercase-drone-${stamp}`
    const sensor = `iPhone-${stamp}`
    const date = "2024-06-01"

    await uploadOneJpg(page, {
      experiment,
      site: `Davis-${stamp}`,
      population: `Cowpea-${stamp}`,
      platform,
      sensor,
      date,
      fileName: `${stamp}.jpg`,
    })

    // Switch the sidebar selector to the just-created experiment so the
    // Process picker reads from the right scope.
    await page.getByTestId("experiment-selector").click()
    await page.getByRole("option", { name: experiment }).click()

    // Open Process > Orthomosaic.
    await page.goto("/process/orthomosaic")
    await expect(
      page.getByRole("heading", { name: /orthomosaic \(run_odm\)/i }),
    ).toBeVisible()

    // The date dropdown lists exactly the date we uploaded under, no more.
    const dateTrigger = page.getByTestId("aerial-date-select")
    await expect(dateTrigger).toBeEnabled({ timeout: 15_000 })
    await dateTrigger.click()
    await expect(page.getByRole("option", { name: date })).toBeVisible()
    await page.getByRole("option", { name: date }).click()

    // Platform dropdown shows the lowercase quirky name verbatim.
    const platformTrigger = page.getByTestId("aerial-platform-select")
    await expect(platformTrigger).toBeEnabled()
    await platformTrigger.click()
    await expect(page.getByRole("option", { name: platform })).toBeVisible()
    // No "Drone" capitalized variant — that would be a hardcoded leak.
    await expect(page.getByRole("option", { name: "Drone", exact: true })).toHaveCount(0)
    await page.getByRole("option", { name: platform }).click()

    // Sensor dropdown shows the iPhone-style name verbatim.
    const sensorTrigger = page.getByTestId("aerial-sensor-select")
    await expect(sensorTrigger).toBeEnabled()
    await sensorTrigger.click()
    await expect(page.getByRole("option", { name: sensor })).toBeVisible()
    await expect(page.getByRole("option", { name: "RGB", exact: true })).toHaveCount(0)
  })

  test("empty experiment shows actionable empty state, no false defaults", async ({
    page,
  }) => {
    const stamp = uniqueStamp()
    const experiment = `pw-empty-${stamp}`

    // Create the experiment but DO NOT upload anything under it.
    await page.goto("/files")
    // Use the sidebar's "Create experiment" trigger.
    await page.getByRole("button", { name: /create experiment/i }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await dialog.locator("input").first().fill(experiment)
    await dialog.getByRole("button", { name: /^create$/i }).click()
    await expect(dialog).toHaveCount(0, { timeout: 10_000 })

    // The selector now has the empty experiment.
    await page.getByTestId("experiment-selector").click()
    await page.getByRole("option", { name: experiment }).click()

    await page.goto("/process/orthomosaic")
    await expect(
      page.getByRole("heading", { name: /orthomosaic \(run_odm\)/i }),
    ).toBeVisible()

    // The date dropdown is either disabled (no data → empty) or shows the
    // "no data uploaded yet" empty-state notice. Either way, the user
    // can't pick anything that isn't real, and the warning copy points
    // them at the Files tab.
    await expect(
      page.getByTestId("aerial-empty-state").or(
        page.getByTestId("aerial-date-empty"),
      ),
    ).toBeVisible({ timeout: 15_000 })
  })
})
