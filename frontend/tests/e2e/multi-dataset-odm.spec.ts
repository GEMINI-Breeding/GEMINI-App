/**
 * Strict-E2E coverage for the Option-A multi-dataset RUN_ODM flow.
 *
 * Two RGB drone uploads at the same scope land at distinct
 * `Raw/.../{sensor}/{shortId}/Images/` prefixes. The Run wizard's
 * dataset multi-select chip-row must surface both short-ids; the user
 * deselects one; the resulting RUN_ODM submit must carry exactly the
 * remaining short-id in `parameters.dataset_short_ids`.
 *
 * Per CLAUDE.md: zero API seeding. Workspace + pipeline + run + the
 * two uploads are all created through the same UI a user would drive.
 */
import type { Page } from "@playwright/test"

import { fixturePath } from "../helpers/fixturePath"
import { expect, test } from "../helpers/fixtures"
import {
  dropFiles,
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"

const BATCH_A = [
  "2022-06-27_100MEDIA_DJI_0876.JPG",
  "2022-06-27_100MEDIA_DJI_0877.JPG",
]
const BATCH_B = [
  "2022-06-27_100MEDIA_DJI_0878.JPG",
  "2022-06-27_100MEDIA_DJI_0879.JPG",
]

interface RunScope {
  experiment: string
  location: string
  population: string
  date: string
  platform: string
  sensor: string
}

async function uploadOnce(
  page: Page,
  scope: RunScope,
  files: string[],
): Promise<void> {
  await navigateToUpload(page)
  await selectDataType(page, "Image Data")
  await fillUploadForm(page, scope)
  await dropFiles(
    page,
    files.map((n) => fixturePath("images", "drone", n)),
  )
  await submitUploadAndWait(page, files.length)
}

test.describe("Multi-dataset ODM (Option A)", () => {
  // Two uploads + workspace + pipeline + run + RUN_ODM submit. ODM
  // itself can take 10+ minutes for a real flight, but we don't wait
  // for ODM to *finish* — just that the submit lands with the right
  // parameters. 6 minutes is plenty for the click-through.
  test.setTimeout(360_000)

  test("multi-select shows both datasets, deselecting one narrows RUN_ODM", async ({
    page,
    runPrefix,
    consoleErrorGuard,
  }) => {
    // The RGB datasets have no RawThermal/thermal_dataset.json — the
    // thermal-GPS preflight will fetch and 404, which the preflight
    // tolerates but Chromium logs as a console error. Whitelist that
    // one URL pattern so the guard's strict pass still catches real
    // regressions.
    consoleErrorGuard.expectError(
      /RawThermal\/thermal_dataset\.json/,
    )
    const scope: RunScope = {
      experiment: `${runPrefix}-exp`,
      location: `${runPrefix}-loc`,
      population: `${runPrefix}-pop`,
      date: "2022-06-27",
      platform: `${runPrefix}-plat`,
      sensor: `${runPrefix}-sensor`,
    }
    const workspaceName = `${runPrefix}-workspace`
    const pipelineName = `${runPrefix}-pipeline`

    // Two back-to-back uploads at IDENTICAL scope. Pre-Option-A this
    // would commingle them on disk; post-Option-A each lands at its
    // own per-dataset Raw/.../{sensor}/{shortId}/Images/ prefix.
    await uploadOnce(page, scope, BATCH_A)
    await uploadOnce(page, scope, BATCH_B)

    // Build workspace + pipeline through the real UI.
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

    // New Run → pick the upload row by 7-tuple (NewRunDialog still
    // groups by scope + dataType; per-dataset narrowing happens in
    // RunDetail's multi-select).
    await page
      .getByRole("button", { name: /new run/i })
      .first()
      .click()
    const uploadRow = page
      .getByTestId("upload-row")
      .filter({ hasText: scope.experiment })
      .filter({ hasText: scope.date })
      .filter({ hasText: scope.platform })
      .filter({ hasText: scope.sensor })
      .first()
    await expect(uploadRow).toBeVisible({ timeout: 30_000 })
    await uploadRow.click()
    // Wait for the row to be visually selected (NewRunDialog flips
    // the `aria-selected` attribute on click). Without this the
    // following Create Run click occasionally races the row-select
    // state transition.
    await expect(uploadRow).toHaveAttribute("aria-selected", "true", {
      timeout: 5_000,
    })
    // The NewRunDialog footer can render outside the viewport on the
    // default Playwright window when the upload table is tall. JS-
    // dispatched click bypasses the viewport requirement; the button
    // is a normal <button> with an onClick handler so this is the
    // same code path a real user's mouse hits.
    const createRunBtn = page.getByRole("button", { name: /create run/i })
    await createRunBtn.evaluate((el) => (el as HTMLButtonElement).click())

    // Inputs card lists every image across both datasets (recursive
    // scope-root listing). Both batches together = 4 files.
    await expect(page.getByText(/4 images? found/)).toBeVisible({
      timeout: 30_000,
    })

    // Multi-select must surface 2 distinct dataset chips.
    const multi = page.getByTestId("dataset-multi-select")
    await expect(multi).toBeVisible({ timeout: 15_000 })
    const chips = multi.locator('[data-testid^="dataset-chip-"]')
    await expect(chips).toHaveCount(2)
    const allChipTestIds = await chips.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.testid ?? ""),
    )
    const allShortIds = allChipTestIds
      .map((t) => t.replace(/^dataset-chip-/, ""))
      .sort()
    expect(allShortIds).toHaveLength(2)
    expect(allShortIds[0]).toMatch(/^[0-9a-f]{8}$/)
    expect(allShortIds[1]).toMatch(/^[0-9a-f]{8}$/)

    // Deselect the second chip — that flips the picker out of the
    // implicit "all selected" state and into an explicit single-id
    // selection.
    const keepShortId = allShortIds[0]
    const dropShortId = allShortIds[1]
    await chips.filter({ hasText: dropShortId }).first().click()
    await expect(
      page.getByText(/1 of 2 datasets selected/i),
    ).toBeVisible({ timeout: 5_000 })

    // Data Sync gates orthomosaic — flip it to completed (no-op
    // step that just confirms images exist at the scope).
    const dataSyncRow = page.getByTestId("step-row-data_sync")
    await expect(dataSyncRow).toHaveAttribute("data-status", "ready", {
      timeout: 15_000,
    })
    await dataSyncRow.getByRole("button", { name: /run step/i }).click()
    await expect(dataSyncRow).toHaveAttribute("data-status", "completed", {
      timeout: 10_000,
    })

    // Trigger ODM. The submit fires immediately — we don't wait for
    // worker completion, just that the request body carries the
    // right `dataset_short_ids`.
    const orthoRow = page.getByTestId("step-row-orthomosaic")
    await expect(orthoRow).toBeVisible({ timeout: 15_000 })
    const submitJobResp = page.waitForResponse(
      (r) =>
        r.url().includes("/api/jobs/submit") &&
        r.request().method() === "POST",
      { timeout: 60_000 },
    )
    await orthoRow.getByRole("button", { name: /run step/i }).click()
    const submitResp = await submitJobResp
    expect(submitResp.ok()).toBeTruthy()
    const submitted = (await submitResp.json()) as {
      job_type?: string
      parameters?: { dataset_short_ids?: string[] }
    }
    expect(submitted.job_type).toBe("RUN_ODM")
    expect(submitted.parameters?.dataset_short_ids).toEqual([keepShortId])
  })
})
