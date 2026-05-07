/**
 * Phase R5b smoke: GCP picker tool wires through end-to-end.
 *
 * Drives the GcpPicker MVP: upload images, create a workspace+pipeline+run,
 * pick the run scope, navigate to the gcp_selection tool, add a catalog
 * entry, click on the image to mark a pixel, save & complete the step,
 * then verify the gcp_list.txt landed in MinIO.
 *
 * Strict-E2E (CLAUDE.md): real upload, real FilesService.upload, real
 * MinIO listing assertion. No backend changes required for the upload
 * path — only the optional ODM worker integration is deferred.
 */
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

const DRONE_IMAGES = [
  "2022-06-27_100MEDIA_DJI_0876.JPG",
  "2022-06-27_100MEDIA_DJI_0877.JPG",
  "2022-06-27_100MEDIA_DJI_0878.JPG",
]

test.describe("R5b: GCP picker MVP", () => {
  test.setTimeout(5 * 60_000)

  test("upload → workspace → pipeline → run → mark GCP → gcp_list.txt in MinIO", async ({
    page,
    request,
    baseURL,
    runPrefix,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")

    // Every entity name uses `runPrefix` so the auto afterEach in
    // helpers/fixtures can sweep them via DELETE /api/e2e_cleanup. Tests
    // that roll their own `pw-${Date.now()}` names leak across runs
    // because the cleanup endpoint matches by prefix.
    const experiment = `${runPrefix}-r5b-exp`
    const location = "Davis"
    const population = "Cowpea"
    const date = "2022-06-27"
    const platform = "DJI"
    const sensor = "FC6310S"
    const workspaceName = `${runPrefix}-r5b-workspace`
    const pipelineName = `${runPrefix}-r5b-pipeline`

    // 1. Upload 3 drone images.
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

    // 2. Create workspace + pipeline + run, pick scope.
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

    // 3. Complete data_sync so gcp_selection's "ready" gate opens.
    const dataSyncRow = page.getByTestId("step-row-data_sync")
    await expect(dataSyncRow).toHaveAttribute("data-status", "ready")
    await dataSyncRow.getByRole("button", { name: /run step/i }).click()
    await expect(dataSyncRow).toHaveAttribute("data-status", "completed", {
      timeout: 5_000,
    })

    // 4. Open the gcp_selection tool.
    const gcpRow = page.getByTestId("step-row-gcp_selection")
    await expect(gcpRow).toHaveAttribute("data-status", "ready", {
      timeout: 5_000,
    })
    await gcpRow.getByRole("button", { name: /open tool/i }).click()

    // 4. Confirm the picker rendered, then add a catalog entry.
    await expect(
      page.getByRole("heading", { name: /^gcp selection$/i }),
    ).toBeVisible()
    // Card titles are <div>s not headings, so match by text instead.
    await expect(page.getByText("GCP catalog", { exact: true })).toBeVisible()
    await expect(
      page.getByText("Mark active GCP on image", { exact: false }),
    ).toBeVisible()
    await page.getByTestId("gcp-add").click()
    // The new row's lon/lat inputs are aria-labelled by the GCP label.
    await page.getByLabel(/^GCP1 lon$/i).fill("-121.7501")
    await page.getByLabel(/^GCP1 lat$/i).fill("38.5402")
    await page.getByLabel(/^GCP1 alt$/i).fill("24.5")

    // 5. Click on the image to mark a pixel coordinate.
    // Wait for the blob URL to land (img has natural dimensions then).
    const imgViewer = page.getByTestId("gcp-image-viewer")
    await expect(imgViewer.locator("img")).toBeVisible({ timeout: 30_000 })
    // Wait for naturalWidth so the click has a meaningful pixel coord.
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
    await imgViewer.locator("img").click({ position: { x: 100, y: 80 } })
    // The mark badge for GCP1 should appear below the viewer.
    await expect(page.getByText(/GCP1 \(\d+, \d+\)/)).toBeVisible()

    // 6. Save & complete step.
    await page.getByTestId("gcp-save-and-complete").click()
    // Routes back to RunDetail; gcp_selection row should be completed.
    await expect(gcpRow).toHaveAttribute("data-status", "completed", {
      timeout: 30_000,
    })

    // 7. Backend assertion: gcp_list.txt landed in the Raw/.../Images/ prefix.
    const tokenRes = await request.post(
      new URL("/api/users/login/access-token", baseURL).toString(),
      {
        data: { email: firstSuperuser, password: firstSuperuserPassword },
        headers: { "Content-Type": "application/json" },
      },
    )
    expect(tokenRes.ok()).toBe(true)
    const { access_token } = (await tokenRes.json()) as { access_token: string }
    const prefix = `Raw/2022/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/Images/`
    const listRes = await request.get(
      new URL(`/api/files/list/gemini/${prefix}`, baseURL).toString(),
      { headers: { Authorization: `Bearer ${access_token}` } },
    )
    expect(listRes.ok()).toBe(true)
    const files = (await listRes.json()) as Array<{ object_name: string }>
    const gcpFile = files.find((f) =>
      (f.object_name ?? "").endsWith("/gcp_list.txt"),
    )
    expect(
      gcpFile,
      `expected gcp_list.txt under ${prefix}, got ${JSON.stringify(
        files.map((f) => f.object_name),
      )}`,
    ).toBeDefined()
  })
})
