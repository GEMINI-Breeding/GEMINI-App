import { test, expect } from "../helpers/fixtures"
import { fixturePath } from "../helpers/fixturePath"
import {
  createAerialPipeline,
  createRun,
  createWorkspace,
  findUploadByExperiment,
  readRun,
  runStepAndWait,
  skipGcp,
} from "../helpers/apiClient"
import {
  dropFiles,
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"
import {
  navigateToRun,
  startOrthomosaic,
  waitForStepTerminal,
} from "../helpers/pipelineHelpers"

/**
 * Real end-to-end orthomosaic generation.
 *
 * Drives the real UI for the things under test (upload → click "Run Step" →
 * observe SSE progress in the Run Detail page) and uses the API only for
 * prerequisite state that isn't itself under test (workspace, pipeline, run
 * linkage, GCP skip).
 *
 * Requires Docker + the `opendronemap/odm` image on the machine running the
 * tests. The first invocation on a fresh machine pulls the image (~3 GB)
 * before ODM begins — be generous with the timeout and consider running this
 * test separately from the fast suite.
 */
test.describe("Orthomosaic pipeline", () => {
  test("upload drone images, skip GCP, run ODM, observe SSE completion", async ({
    page,
    runPrefix,
  }) => {
    // ODM on 5 downscaled images typically takes 2–5 minutes; add slack for
    // Docker cold start + the cleanup teardown.
    test.setTimeout(20 * 60_000)

    const droneFiles = [
      fixturePath("images/drone/2022-06-27_100MEDIA_DJI_0876.JPG"),
      fixturePath("images/drone/2022-06-27_100MEDIA_DJI_0877.JPG"),
      fixturePath("images/drone/2022-06-27_100MEDIA_DJI_0878.JPG"),
      fixturePath("images/drone/2022-06-27_100MEDIA_DJI_0879.JPG"),
      fixturePath("images/drone/2022-06-27_100MEDIA_DJI_0880.JPG"),
    ]

    // --- 1. Upload via the real UI (same flow as data-import-manage-view) ---
    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, {
      experiment: runPrefix,
      location: "Davis",
      population: "Cowpea",
      date: "2022-06-27",
      platform: "DJI",
      sensor: "FC6310S",
    })
    await dropFiles(page, droneFiles)
    await submitUploadAndWait(page, droneFiles.length)

    // --- 2. Prereq state via API (NOT the operation under test) ---
    const upload = await findUploadByExperiment(runPrefix)
    expect(upload, "upload should exist after the UI upload").not.toBeNull()

    const workspace = await createWorkspace(runPrefix)
    const pipeline = await createAerialPipeline(workspace.id, `${runPrefix}-pipeline`)
    const run = await createRun(pipeline.id, {
      date: "2022-06-27",
      experiment: runPrefix,
      location: "Davis",
      population: "Cowpea",
      platform: "DJI",
      sensor: "FC6310S",
      fileUploadId: upload!.id,
    })

    // Run the required data_sync step (reads EXIF → msgs_synced.csv) and then
    // skip GCP. Both are prereqs, not what the test is actually asserting.
    await runStepAndWait(run.id, "data_sync", 60_000)
    await skipGcp(run.id)

    // --- 3. UI: trigger orthomosaic and observe SSE-driven state ---
    await navigateToRun(page, workspace.id, run.id)
    await startOrthomosaic(page)

    // Should transition through Running → Re-run (completed)
    const terminal = await waitForStepTerminal(page, "Orthomosaic Generation", {
      timeoutMs: 15 * 60_000,
    })
    expect(terminal).toBe("completed")

    // --- 4. Backend state confirms the run completed and produced outputs ---
    const persisted = await readRun(run.id)
    expect(persisted.steps_completed?.orthomosaic).toBe(true)
    expect(persisted.outputs).toBeTruthy()
    const outputs = persisted.outputs as Record<string, unknown>
    const orthos = outputs.orthomosaics as Array<{ rgb?: string }> | undefined
    expect(
      orthos && orthos.length > 0,
      "orthomosaics array should be non-empty after a successful run",
    ).toBeTruthy()
    expect(orthos![0].rgb).toMatch(/\.tif$/i)
  })
})
