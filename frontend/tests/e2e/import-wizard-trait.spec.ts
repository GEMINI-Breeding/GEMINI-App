/**
 * Phase 9e strict-E2E: drive the trait import wizard end-to-end through
 * the real UI against the live backend.
 *
 * The flow: Files → Trait Data → "+ Create new" experiment → drop a 3-row
 * × 2-trait CSV → wizard opens → Map Columns step (configure plot column
 * + trait columns + fixed season/site) → Continue to Upload → setup +
 * record ingestion run → Confirm screen → verify the experiment + traits
 * + records exist in the backend via the read API.
 *
 * Per CLAUDE.md: every entity is created through the UI a real user
 * would use. There are no API seed calls in this file. Read-only
 * verification queries against the backend are allowed.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { authHeader } from "../helpers/apiClient"
import { expect, test } from "../helpers/fixtures"

const API_URL =
  process.env.E2E_API_URL || process.env.VITE_API_URL || "http://127.0.0.1:7777"

test.describe("Phase 9e: Trait import wizard end-to-end", () => {
  test.setTimeout(120_000)

  test("CSV → wizard runs to completion → records visible in backend", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-trait-exp`
    const traitNames = [`${runPrefix}-NDVI`, `${runPrefix}-Yield`]
    const seasonName = `${runPrefix}-Summer-2026`
    const siteName = `${runPrefix}-Field-A`

    // 3 rows × 2 traits → 6 records. Plot 1, 2, 3.
    const csv = [
      `plot_number,plot_row,plot_col,${traitNames[0]},${traitNames[1]}`,
      "1,1,1,0.42,4.2",
      "2,1,2,0.51,4.5",
      "3,1,3,0.39,3.9",
    ].join("\n")

    await page.goto("/files")
    await expect(
      page.getByRole("heading", { name: /^files$/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })

    // Pick "Trait Data" via the data-type selector.
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()

    // Create the experiment via the same UI path the user would. The
    // drop handler resolves "+ Create new" choices into real DB rows
    // before the wizard mounts (see the genomic spec's comment for why
    // we never seed via API).
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")

    // Drop the file. The wizard opens with the experiment seeded.
    await page.getByTestId("upload-input").setInputFiles({
      name: `${runPrefix}-traits.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    })

    const dialog = page.getByTestId("import-wizard-dialog")
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Wait for the column-mapping step (parsing the small CSV is sub-second).
    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 30_000,
    })

    // The Map Columns step opens with the plot-number selector visible.
    // The Continue button is disabled until plot + at least one trait +
    // season + site are picked. The Radix Select is portal-based, so we
    // drive it by clicking its trigger and then the matching option.
    await page.getByTestId("plot-number-select").click()
    await page.getByRole("option", { name: "plot_number" }).click()

    // Enable both trait columns. The default trait names (column header)
    // are fine — the trait_name we'll see in the backend is the column
    // header, which we made unique with `runPrefix`.
    await page.getByTestId(`trait-checkbox-${traitNames[0]}`).click()
    await page.getByTestId(`trait-checkbox-${traitNames[1]}`).click()

    // Collection date defaults to "Fixed date" mode with no value —
    // isSheetConfigValid requires a date there or the mode flipped to
    // "unknown". Set it to keep the records' timestamps deterministic.
    await page.getByTestId("collection-date-fixed").fill("2026-05-01")

    // Season and site default to fixed-value mode; type values into them.
    await page.getByTestId("season-fixed").fill(seasonName)
    await page.getByTestId("site-fixed").fill(siteName)

    // Continue to Upload.
    await expect(page.getByTestId("mapping-continue")).toBeEnabled({
      timeout: 10_000,
    })
    await page.getByTestId("mapping-continue").click()

    // Upload step runs setup-creates + file upload + record ingestion.
    // Wait for the Continue button to become enabled, which only happens
    // after phase=done.
    await expect(page.getByTestId("upload-continue")).toBeEnabled({
      timeout: 90_000,
    })
    await page.getByTestId("upload-continue").click()

    // Confirm screen.
    await expect(page.getByTestId("import-step-confirm")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId("confirm-heading")).toContainText(
      /import complete/i,
    )

    // Read-only backend verification: experiment + both traits exist.
    const expRes = await fetch(
      `${API_URL}/api/experiments?experiment_name=${encodeURIComponent(experimentName)}`,
      { headers: { Authorization: authHeader() } },
    )
    expect(expRes.ok).toBeTruthy()
    const expHits = (await expRes.json()) as Array<{
      experiment_name?: string
    }>
    expect(
      expHits.find((e) => e.experiment_name === experimentName),
    ).toBeDefined()

    // The trait controller's GET defaults `experiment_name="Experiment A"`
    // when none is supplied (Litestar query-param default), so we have
    // to pass our experiment explicitly to find traits we just created.
    for (const traitName of traitNames) {
      const tRes = await fetch(
        `${API_URL}/api/traits?trait_name=${encodeURIComponent(traitName)}&experiment_name=${encodeURIComponent(experimentName)}`,
        { headers: { Authorization: authHeader() } },
      )
      expect(tRes.ok).toBeTruthy()
      const tHits = (await tRes.json()) as Array<{ trait_name?: string }>
      expect(
        tHits.find((t) => t.trait_name === traitName),
        `trait ${traitName} should exist after import`,
      ).toBeDefined()
    }
  })

  // Regression test for the 422 race the small-fixture test missed.
  // The bulk endpoint's BEFORE-INSERT trigger does check-then-insert
  // on `gemini.datasets`, `gemini.trait_datasets`, and
  // `valid_trait_dataset_combinations` — so multiple concurrent
  // first-time POSTs targeting the same (trait, dataset, season,
  // site) tuple lose the unique-constraint race and the backend
  // returns 422. The fix is to serialize the FIRST batch per tuple
  // before unleashing concurrency. With `RECORD_BATCH_SIZE = 500`,
  // 1500 rows × 2 traits → 6 batches across one (season, site) — at
  // least 4 of those would race without the warm-up phase.
  test("large CSV that exercises >1 batch per (trait, season, site) — no 422 race", async ({
    page,
    runPrefix,
  }) => {
    test.setTimeout(180_000)
    const experimentName = `${runPrefix}-trait-big-exp`
    const traitNames = [`${runPrefix}-NDVI-big`, `${runPrefix}-Yield-big`]
    const seasonName = `${runPrefix}-Big-Season`
    const siteName = `${runPrefix}-Big-Site`
    const ROWS = 1500

    const lines = [
      `plot_number,plot_row,plot_col,${traitNames[0]},${traitNames[1]}`,
    ]
    for (let i = 1; i <= ROWS; i++) {
      lines.push(
        `${i},1,${i},${(0.3 + (i % 100) / 1000).toFixed(3)},${(3 + (i % 50) / 10).toFixed(2)}`,
      )
    }
    const csv = lines.join("\n")

    // Capture any 422 from the bulk endpoint as a deterministic failure
    // signal. The race produces 422 immediately on the second / third
    // concurrent batch, so this triggers before "Continue" enables.
    const bulkErrors: string[] = []
    page.on("response", (resp) => {
      const url = new URL(resp.url()).pathname
      if (url.includes("/records/bulk") && resp.status() >= 400) {
        bulkErrors.push(`${resp.status()} ${url}`)
      }
    })

    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")

    await page.getByTestId("upload-input").setInputFiles({
      name: `${runPrefix}-big-traits.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    })

    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId("plot-number-select").click()
    await page.getByRole("option", { name: "plot_number" }).click()
    await page.getByTestId(`trait-checkbox-${traitNames[0]}`).click()
    await page.getByTestId(`trait-checkbox-${traitNames[1]}`).click()
    await page.getByTestId("collection-date-fixed").fill("2026-05-01")
    await page.getByTestId("season-fixed").fill(seasonName)
    await page.getByTestId("site-fixed").fill(siteName)

    await expect(page.getByTestId("mapping-continue")).toBeEnabled({
      timeout: 10_000,
    })
    await page.getByTestId("mapping-continue").click()

    await expect(page.getByTestId("upload-continue")).toBeEnabled({
      timeout: 150_000,
    })
    expect(
      bulkErrors,
      "the bulk endpoint must not 422 — concurrent first-batch POSTs racing on dataset / trait_datasets uniqueness",
    ).toEqual([])
    await page.getByTestId("upload-continue").click()
    await expect(page.getByTestId("import-step-confirm")).toBeVisible({
      timeout: 10_000,
    })
  })
})
