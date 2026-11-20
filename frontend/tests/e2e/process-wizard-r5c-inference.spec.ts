/**
 * Phase R5c smoke: InferenceTool route + UI scaffolding renders.
 *
 * Drives only as far as the form: pipeline-saved Roboflow model appears
 * in the model picker, image source picker shows the right options, and
 * the submit button is gated on having a real image. We don't actually
 * submit a LOCATE_PLANTS job because real submission requires a working
 * Roboflow API key; the e2e environment doesn't carry one.
 */

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
]

test.describe("R5c: InferenceTool MVP", () => {
  test.setTimeout(5 * 60_000)

  test("upload → workspace → pipeline (with model) → run → inference tool dispatches", async ({
    page,
    runPrefix,
  }) => {
    const experiment = `${runPrefix}-r5c-exp`
    const location = "Davis"
    const population = "Cowpea"
    const date = "2022-06-27"
    const platform = "DJI"
    const sensor = "FC6310S"
    const workspaceName = `${runPrefix}-r5c-workspace`
    const pipelineName = `${runPrefix}-r5c-pipeline`

    // 1. Upload images so the run-scope picker has something to find.
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

    // 2. Workspace.
    await page.goto("/process")
    await page.locator('[data-onboarding="process-new-workspace"]').click()
    await page.getByLabel(/workspace name/i).fill(workspaceName)
    await page.getByRole("button", { name: /create workspace/i }).click()
    await page.getByText(workspaceName, { exact: true }).click()

    // 3. Pipeline wizard — fill a Roboflow model in step 3 so InferenceTool
    //    has something in its model picker.
    await page.getByRole("button", { name: /create aerial pipeline/i }).click()
    await page.getByLabel(/pipeline name/i).fill(pipelineName)
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /^next$/i }).click()
    // Step 3: Roboflow models. The first row's inputs are unlabeled
    // headers — find them by their placeholders.
    await page.getByPlaceholder(/wheat detection/i).fill("Smoke detector")
    await page.getByPlaceholder(/rf_xxx/i).fill("rf_TEST_NO_REAL_CALL")
    await page.getByPlaceholder(/my-project\/3/i).fill("smoke/model/1")
    // Choose a self-hosted inference server. The form collected this for
    // the whole migration while nothing read it, so "local" silently still
    // meant Roboflow cloud. The tool must now report the choice.
    await page.getByRole("radio", { name: /local server/i }).check()
    await page
      .getByTestId("pipeline-local-server-url")
      .fill("http://localhost:9002")
    await page.getByRole("button", { name: /create pipeline/i }).click()

    // 4. Run from upload-driven NewRunDialog.
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

    // 5. inference is locked behind earlier non-optional steps; that's
    //    fine — drive directly to the tool route to verify dispatch.
    //    URL form: /process/{wsId}/tool?runId=...&step=inference.
    const wsCardLink = page.url() // currently the run page
    const runId = wsCardLink.split("/").pop()
    expect(runId).toBeTruthy()
    // Replace "/run/{runId}" with "/tool?runId={runId}&step=inference".
    const wsId = wsCardLink.split("/process/")[1].split("/")[0]
    await page.goto(`/process/${wsId}/tool?runId=${runId}&step=inference`)

    await expect(
      page.getByRole("heading", { name: /^inference$/i }),
    ).toBeVisible()

    // The model picker shows the saved Roboflow entry. SelectTrigger
    // surfaces the active value.
    await expect(page.getByTestId("inference-model")).toContainText(
      "Smoke detector",
    )
    // The pipeline's local-server choice reaches the tool.
    await expect(page.getByTestId("inference-endpoint")).toContainText(
      "local inference server at http://localhost:9002",
    )
    // Image source picker defaults to "Plot images (split or associated)".
    await expect(page.getByTestId("inference-source")).toContainText(
      /Plot images/i,
    )
    // Switch to raw images so the picker has files.
    await page.getByTestId("inference-source").click()
    await page.getByRole("option", { name: /raw drone images/i }).click()

    // The image viewer should appear with at least one navigation control.
    await expect(page.getByTestId("inference-image-viewer")).toBeVisible({
      timeout: 30_000,
    })
    // Submit button is enabled once an image loads. Don't click — we'd
    // submit a real Roboflow API call with a fake key.
    await expect(page.getByTestId("inference-submit")).toBeEnabled({
      timeout: 30_000,
    })

    // ── Per-plot fan-out mode. ──────────────────────────────────────────
    // Before this existed the tool could only ever infer ONE image, so a
    // user with 200 plots had no way to run the model over their field.
    const modeSelect = page.getByTestId("inference-mode")
    await expect(modeSelect).toBeVisible()
    // Defaults to single-image, so the existing behaviour is unchanged.
    await expect(modeSelect).toContainText(/previewed image/i)

    await modeSelect.click()
    await page
      .getByRole("option", { name: /every image at this source/i })
      .click()
    await expect(modeSelect).toContainText(/every image/i)

    // The note states how many images the one job will cover — the point
    // of the mode is that it's one job, not one per plot.
    const note = page.getByTestId("inference-mode-all-note")
    await expect(note).toBeVisible()
    await expect(note).toContainText(/will be inferred in a single job/i)
    await expect(note).toContainText(/per plot/i)

    // Still submittable in this mode (not clicked — fake API key).
    await expect(page.getByTestId("inference-submit")).toBeEnabled()
  })
})
