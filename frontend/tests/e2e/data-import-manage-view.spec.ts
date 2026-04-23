import { test, expect } from "../helpers/fixtures"
import { fixturePath } from "../helpers/fixturePath"
import {
  navigateToUpload,
  selectDataType,
  fillUploadForm,
  dropFiles,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"
import {
  navigateToManage,
  findRowByPrefix,
  openImageViewer,
  assertImageRenders,
} from "../helpers/manageHelpers"

test.describe("Data import → manage → view image", () => {
  test("drone JPGs upload via UploadZone, appear in Manage, and display in viewer", async ({
    page,
    runPrefix,
  }) => {
    const droneFiles = [
      fixturePath("images/drone/2022-06-27_100MEDIA_DJI_0876.JPG"),
      fixturePath("images/drone/2022-06-27_100MEDIA_DJI_0877.JPG"),
      fixturePath("images/drone/2022-06-27_100MEDIA_DJI_0878.JPG"),
    ]

    // --- Upload ---
    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, {
      experiment: runPrefix,
      location: "e2e-loc",
      population: "e2e-pop",
      date: "2022-06-27",
      platform: "Drone",
      sensor: "RGB",
    })
    await dropFiles(page, droneFiles)
    await submitUploadAndWait(page, droneFiles.length)

    // --- Manage: row appears ---
    await navigateToManage(page)
    const row = await findRowByPrefix(page, runPrefix)
    await expect(row).toContainText(runPrefix)
    await expect(row).toContainText("3") // file_count column

    // --- View images: eye icon → dialog → first image renders ---
    const dialog = await openImageViewer(page, row)
    await assertImageRenders(dialog)
    await expect(
      dialog.getByText(/^1 \/ \d+$/),
    ).toBeVisible() // index label "1 / N"
  })
})
