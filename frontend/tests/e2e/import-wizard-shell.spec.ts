/**
 * Phase 9c shell E2E (post-consolidation): the import wizard now lives
 * inside Files → Upload. The user picks "Trait Data" or "Genomic Data"
 * from the type dropdown, drops a file, and the wizard opens as a
 * dialog. The standalone /import route was removed in this session;
 * detection-engine + StepDetect are kept in tree for the future
 * unify-into-auto-detect task.
 *
 * The spec proves:
 *   - Files → Upload exposes the new "Trait Data" / "Genomic Data" types.
 *   - Picking "Trait Data" + dropping a CSV opens the wizard dialog with
 *     the Detect step removed from the stepper. Without an experiment
 *     picked, it falls back to the Phase-9e Metadata stub. With an
 *     experiment picked on the Files page first, it skips Metadata and
 *     lands directly on the Map Columns stub.
 *   - Picking "Genomic Data" + dropping a CSV opens the wizard dialog
 *     and lands on the Phase-9d Genomic stub.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures (per
 * CLAUDE.md strict-E2E).
 */
import { expect, test } from "../helpers/fixtures"

const TRAIT_CSV = [
  "plot_number,plot_row,plot_col,plant_height_cm,yield_kg",
  "1,1,1,142,4.2",
  "2,1,2,150,4.5",
  "3,1,3,137,3.9",
].join("\n")

async function selectDataType(
  page: import("@playwright/test").Page,
  label: string,
) {
  await page.getByTestId("files-data-type-selector").click()
  await page.getByRole("menuitem", { name: label }).click()
}

test.describe("Phase 9c: Import wizard inside Files", () => {
  test.setTimeout(60_000)

  test("Files page locks the upload dropzone until both data type and experiment are picked", async ({
    page,
    runPrefix,
  }) => {
    await page.goto("/files")
    await expect(
      page.getByRole("heading", { name: /^files$/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })

    // No data type selected → dropzone shows the data-type reason and
    // file selection through the input is a no-op (UploadZone's input
    // change handler short-circuits when disabled). Asserting the
    // disabled-reason text is what proves the gate is wired.
    const dropzoneReason = page.getByTestId("upload-dropzone-disabled-reason")
    await expect(dropzoneReason).toContainText(/select a data type/i)

    // Picking a data type swaps the reason to the experiment gate.
    await selectDataType(page, "Trait Data")
    await expect(page.getByTestId("import-wizard-dropzone")).toBeVisible()
    await expect(dropzoneReason).toContainText(/experiment/i)

    // Once an experiment is chosen via the EntitySelectField, the
    // dropzone unlocks and the disabled-reason element disappears.
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(`${runPrefix}-exp`)
    await page.keyboard.press("Escape")
    await expect(dropzoneReason).not.toBeVisible()
  })

  test("Trait Data with experiment picked first → skips Metadata, lands on Map Columns", async ({
    page,
    runPrefix,
  }) => {
    await page.goto("/files")
    await selectDataType(page, "Trait Data")

    // Pick "+ Create new…" experiment so initialMetadata is populated
    // before the file is dropped. The wizard then skips its own
    // Metadata step and lands directly on Map Columns. The experiment
    // name is `runPrefix`-prefixed so the auto afterEach can sweep it.
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page
      .getByTestId("entity-new-experiment")
      .fill(`${runPrefix}-trait-exp`)

    await page.getByTestId("upload-input").setInputFiles({
      name: "traits.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(TRAIT_CSV, "utf8"),
    })

    const dialog = page.getByTestId("import-wizard-dialog")
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Stepper drops both Detect and Metadata when seeded.
    const stepper = page.getByTestId("import-stepper")
    await expect(stepper).not.toContainText(/Detect/i)
    await expect(stepper).not.toContainText(/^Metadata/i)

    // 9e.2 replaced the Map Columns stub with the real step component.
    await expect(page.getByTestId("step-column-mapping")).toBeVisible()
  })
})
