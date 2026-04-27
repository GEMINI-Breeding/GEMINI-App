/**
 * Phase 7: orthomosaic end-to-end against the real ODM worker.
 *
 * Replaces the pre-migration `pipeline-orthomosaic.spec.ts` that drove a
 * workspace+pipeline+run scaffold. The new flow is direct: upload images
 * via the Files UI, submit RUN_ODM via the Phase-7 OrthomosaicTool page,
 * wait for the wsManager-backed ProcessPanel to reach "Done", then verify
 * the worker actually wrote `odm_orthophoto.tif` under MinIO `Processed/`.
 *
 * Strict-E2E (CLAUDE.md):
 *   - Drives only the real UI for the operation under test.
 *   - Hits the real GEMINIbase stack (no mocks, no API seeding for the
 *     orthomosaic submit — that's the part being tested).
 *   - Verifies user-visible outcome (ProcessPanel "Done") AND backend
 *     state (the produced .tif), so a regression that breaks either side
 *     fails this spec.
 *
 * Fixture set: 5 downscaled DJI JPGs (~200KB each) in
 *   tests/fixtures/images/drone/. Each carries embedded GPS so NodeODM
 *   doesn't need GCPs to georeference. Per the deleted-and-recovered
 *   spec, ODM on these takes 2–5 min on a warm Docker; we budget more
 *   for cold-start + any worker startup latency.
 */
import { expect, test } from "../helpers/fixtures"
import { fixturePath } from "../helpers/fixturePath"
import {
  dropFiles,
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"
import { firstSuperuser, firstSuperuserPassword } from "../config"

const ODM_TIMEOUT_MS = 15 * 60_000

const DRONE_IMAGES = [
  "2022-06-27_100MEDIA_DJI_0876.JPG",
  "2022-06-27_100MEDIA_DJI_0877.JPG",
  "2022-06-27_100MEDIA_DJI_0878.JPG",
  "2022-06-27_100MEDIA_DJI_0879.JPG",
  "2022-06-27_100MEDIA_DJI_0880.JPG",
]

test.describe("Pipeline: orthomosaic generation", () => {
  test.setTimeout(ODM_TIMEOUT_MS + 2 * 60_000)

  test("upload drone images → submit RUN_ODM → ortho written to MinIO", async ({
    page,
    request,
    baseURL,
  }) => {
    const stamp = Date.now()
    const experiment = `pw-ortho-${stamp}`
    const location = "Davis"
    const population = "Cowpea"
    const date = "2022-06-27"
    const platform = "DJI"
    const sensor = "FC6310S"

    // 1. Upload the 5 downscaled DJIs via the real Files UI.
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
    await dropFiles(page, DRONE_IMAGES.map((n) => fixturePath("images", "drone", n)))
    // Plain JPG uploads have no follow-up job — the helper's default path
    // waits for "Done" (no extraction). Image uploads on these 200KB files
    // typically land in <30s.
    await submitUploadAndWait(page, DRONE_IMAGES.length)

    // 2. Switch the sidebar Experiment selector to the just-created
    //    experiment so the AerialScopePicker can discover its uploads.
    //    (The upload form's create-or-pick flow registered every entity.)
    await page.getByTestId("experiment-selector").click()
    await page.getByRole("option", { name: experiment }).click()

    // 3. Open the Phase-7 OrthomosaicTool. Pick date / platform / sensor
    //    from the dropdowns the picker derives by listing what's actually
    //    been uploaded under this experiment.
    await page.goto("/process/orthomosaic")
    await expect(
      page.getByRole("heading", { name: /orthomosaic \(run_odm\)/i }),
    ).toBeVisible()

    await page.getByTestId("aerial-date-select").click()
    await page.getByRole("option", { name: date }).click()
    await page.getByTestId("aerial-platform-select").click()
    await page.getByRole("option", { name: platform }).click()
    await page.getByTestId("aerial-sensor-select").click()
    await page.getByRole("option", { name: sensor }).click()

    await expect(page.getByText(/5 images? found/i)).toBeVisible({
      timeout: 30_000,
    })

    const submitBtn = page.getByRole("button", { name: /run orthomosaic/i })
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // 3. Wait for the ProcessPanel entry to land, then for terminal "Done".
    await expect(
      page.locator(`text=Orthomosaic — ${date} ${platform}/${sensor}`).first(),
    ).toBeVisible({ timeout: 30_000 })

    await expect(page.locator("text=Done").first()).toBeVisible({
      timeout: ODM_TIMEOUT_MS,
    })

    // 4. Backend assertion: the worker wrote `odm_orthophoto.tif` to the
    //    expected Processed/ prefix. We use the real REST API (not a mock)
    //    via the test request fixture; the auth token comes from the same
    //    /api/users/login/access-token call e2e.setup.ts uses.
    if (!baseURL) throw new Error("baseURL not configured")
    const tokenRes = await request.post(
      new URL("/api/users/login/access-token", baseURL).toString(),
      {
        data: { email: firstSuperuser, password: firstSuperuserPassword },
        headers: { "Content-Type": "application/json" },
      },
    )
    expect(tokenRes.ok()).toBe(true)
    const { access_token } = (await tokenRes.json()) as { access_token: string }

    const processedPrefix = `Processed/2022/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/`
    const listRes = await request.get(
      new URL(`/api/files/list/gemini/${processedPrefix}`, baseURL).toString(),
      { headers: { Authorization: `Bearer ${access_token}` } },
    )
    expect(listRes.ok()).toBe(true)
    const files = (await listRes.json()) as Array<{ object_name: string }>
    const orthoNames = files
      .map((f) => f.object_name ?? "")
      .filter((n) => n.endsWith("odm_orthophoto.tif"))
    expect(
      orthoNames.length,
      `expected at least one odm_orthophoto.tif under ${processedPrefix}, got ${JSON.stringify(files.map((f) => f.object_name))}`,
    ).toBeGreaterThan(0)

    // 5. Auto-chained CREATE_COG must also have written its output. The ODM
    //    worker submits a CREATE_COG job after the ortho lands; the COG
    //    worker writes `<base>-Pyramid<ext>` to the same prefix. Wait up
    //    to 5 min for it (small ortho → quick COG, but be lenient).
    const expectedCog = `${processedPrefix}odm_orthophoto-Pyramid.tif`
    const cogDeadline = Date.now() + 5 * 60_000
    let cogFound = false
    while (Date.now() < cogDeadline) {
      const r = await request.get(
        new URL(`/api/files/list/gemini/${processedPrefix}`, baseURL).toString(),
        { headers: { Authorization: `Bearer ${access_token}` } },
      )
      if (r.ok()) {
        const ents = (await r.json()) as Array<{ object_name: string }>
        if (ents.some((e) => e.object_name === expectedCog)) {
          cogFound = true
          break
        }
      }
      await page.waitForTimeout(5_000)
    }
    expect(
      cogFound,
      `expected the auto-chained CREATE_COG worker to write ${expectedCog} within 5 min`,
    ).toBe(true)
  })
})
