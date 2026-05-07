/**
 * P0.1b + P0.2 strict-E2E: deleting the experiment that imported trait
 * data must sweep the auto-created dataset row + the columnar
 * trait_records, so a re-import of the same data lands cleanly.
 *
 * Background. The `populate_trait_record_ids` BEFORE-INSERT trigger
 * (`6_init_functions.sql:check_trait_validity`) silently inserts a
 * `gemini.datasets` row + `experiment_datasets` + `trait_datasets` join
 * rows whenever a trait_records insert references a dataset_name that
 * doesn't exist yet. A trait-only delete leaves the experiment_datasets
 * link intact (correct), so the dataset row is NOT orphan after just a
 * trait delete — only after the experiment is also gone. The user-
 * visible bug pre-fix: deleting an experiment cleaned the experiment
 * row + its plots/traits/etc. but left
 *   (a) the auto-created `gemini.datasets` row (no orphan-dataset sweep),
 *   (b) the columnar `trait_records` rows for that experiment_name had
 *       no `delete_by_*` helper wired in (only the trait-record helper
 *       was). A re-import then resolved against leftover rows and
 *       behaved like the data was already loaded.
 *
 * This spec catches both: it asserts that after `Experiment.delete()`
 *   - the auto-dataset row no longer exists in `gemini.datasets`,
 *   - the trait_records for that experiment_name are gone (records
 *     endpoint returns empty),
 *   - a re-import with the same trait + dataset_name lands fresh.
 *
 * Mirrors the structural pattern from `import-wizard-genomic.spec.ts:323`
 * (orphan-accessions sweep regression for `GenotypingStudy.delete()`).
 *
 * Per CLAUDE.md: drive real UI; zero API seeding for prereqs; read-only
 * verification GETs are allowed. The `runPrefix` afterEach in
 * fixtures.ts cleans by name pattern but it goes through
 * `Experiment.delete()` itself — so the in-test assertions must run
 * BEFORE afterEach fires.
 */
import { authHeader } from "../helpers/apiClient"
import { expect, test } from "../helpers/fixtures"

const API_URL =
  process.env.E2E_API_URL || process.env.VITE_API_URL || "http://127.0.0.1:7777"

test.describe("P0.1b + P0.2: Experiment.delete() sweeps trait-import orphans", () => {
  test.setTimeout(180_000)

  test("trait import → delete experiment → auto-dataset + trait_records are swept", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-orphan-trait-exp`
    const traitName = `${runPrefix}-NDVI-orphan`
    const seasonName = `${runPrefix}-S`
    const siteName = `${runPrefix}-Site`
    const collectionDate = "2026-05-01"

    const csv = [
      `plot_number,plot_row,plot_col,${traitName}`,
      "1,1,1,0.42",
      "2,1,2,0.51",
      "3,1,3,0.39",
    ].join("\n")

    // ---------- 1. Import via real UI ----------
    await page.goto("/files")
    await expect(
      page.getByRole("heading", { name: /^files$/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })

    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()

    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")

    await page.getByTestId("upload-input").setInputFiles({
      name: `${runPrefix}-traits.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    })

    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId("plot-number-select").click()
    await page.getByRole("option", { name: "plot_number" }).click()
    await page.getByTestId(`trait-checkbox-${traitName}`).click()
    await page.getByTestId("collection-date-fixed").fill(collectionDate)
    await page.getByTestId("season-fixed").fill(seasonName)
    await page.getByTestId("site-fixed").fill(siteName)
    await expect(page.getByTestId("mapping-continue")).toBeEnabled({
      timeout: 10_000,
    })
    await page.getByTestId("mapping-continue").click()

    await expect(page.getByTestId("upload-continue")).toBeEnabled({
      timeout: 90_000,
    })
    await page.getByTestId("upload-continue").click()
    await expect(page.getByTestId("import-step-confirm")).toBeVisible({
      timeout: 10_000,
    })

    // ---------- 2. Capture the auto-created dataset (its id + name) ----------
    const datasetBeforeRes = await fetch(
      `${API_URL}/api/datasets?experiment_name=${encodeURIComponent(experimentName)}`,
      { headers: { Authorization: authHeader() } },
    )
    expect(datasetBeforeRes.ok).toBeTruthy()
    const datasetBefore = (await datasetBeforeRes.json()) as Array<{
      id?: string
      dataset_name?: string
    }>
    expect(
      datasetBefore.length,
      `expected ≥1 auto-dataset for ${experimentName}; got ${datasetBefore.length}`,
    ).toBeGreaterThanOrEqual(1)
    const autoDataset = datasetBefore[0]
    const autoDatasetId = autoDataset.id as string
    const autoDatasetName = autoDataset.dataset_name as string
    expect(autoDatasetId).toBeDefined()
    expect(autoDatasetName).toBeDefined()

    // ---------- 3. Delete the experiment via Manage Data ----------
    // Manage is a sidebar tab inside /files (not a separate route).
    await page.goto("/files")
    await page.getByRole("button", { name: /^manage$/i }).click()
    await expect(page.getByTestId("manage-data-experiment-list")).toBeVisible({
      timeout: 15_000,
    })

    const deleteBtn = page.getByTestId(`manage-data-delete-${experimentName}`)
    await expect(deleteBtn).toBeVisible({ timeout: 10_000 })
    await deleteBtn.click()

    // The confirm dialog requires typing the experiment name verbatim.
    const typedConfirm = page.getByTestId("confirm-dialog-typed")
    await expect(typedConfirm).toBeVisible({ timeout: 5_000 })
    await typedConfirm.fill(experimentName)

    const deleteReq = page.waitForResponse(
      (r) =>
        r.url().includes("/api/experiments/") &&
        r.request().method() === "DELETE" &&
        r.status() < 400,
      { timeout: 60_000 },
    )
    await page.getByTestId("confirm-dialog-confirm").click()
    await deleteReq

    // ---------- 4a. Auto-dataset must be swept ----------
    // Look up the dataset row by name + experiment_name. After
    // Experiment.delete(), neither should resolve to the captured row.
    const datasetAfterRes = await fetch(
      `${API_URL}/api/datasets?dataset_name=${encodeURIComponent(autoDatasetName)}&experiment_name=${encodeURIComponent(experimentName)}`,
      { headers: { Authorization: authHeader() } },
    )
    // Endpoint returns 200 with [] for missing — error code is unrelated.
    expect(datasetAfterRes.ok).toBeTruthy()
    const datasetAfter = (await datasetAfterRes.json()) as Array<{
      id?: string
      dataset_name?: string
    }>
    expect(
      datasetAfter.find((d) => d.id === autoDatasetId),
      `auto-dataset ${autoDatasetName} (id=${autoDatasetId}) must be swept by Experiment.delete() — leftover indicates the orphan-dataset sweep regressed`,
    ).toBeUndefined()

    // ---------- 4b. trait_records for this experiment must be gone ----------
    // The /traits endpoint returns the trait row itself (CASCADE on
    // experiment_traits drops the join, Experiment.delete() also drops
    // the trait via the orphan-trait sweep). Confirm via list.
    const traitsAfterRes = await fetch(
      `${API_URL}/api/traits?trait_name=${encodeURIComponent(traitName)}&experiment_name=${encodeURIComponent(experimentName)}`,
      { headers: { Authorization: authHeader() } },
    )
    expect(traitsAfterRes.ok).toBeTruthy()
    const traitsAfter = (await traitsAfterRes.json()) as Array<{
      trait_name?: string
    }>
    expect(
      traitsAfter.find((t) => t.trait_name === traitName),
      `trait ${traitName} must be swept when its only experiment is deleted`,
    ).toBeUndefined()

    // ---------- 4c. Experiment row must be gone ----------
    const expAfterRes = await fetch(
      `${API_URL}/api/experiments?experiment_name=${encodeURIComponent(experimentName)}`,
      { headers: { Authorization: authHeader() } },
    )
    expect(expAfterRes.ok).toBeTruthy()
    const expAfter = (await expAfterRes.json()) as Array<{
      experiment_name?: string
    }>
    expect(
      expAfter.find((e) => e.experiment_name === experimentName),
    ).toBeUndefined()
  })
})
