/**
 * Strict-E2E for the Files "View" tab.
 *
 * Drives the trait import wizard end-to-end (the only legitimate way to
 * land trait records in the DB per CLAUDE.md), then switches to the new
 * View tab and asserts:
 *   - the stats dashboard renders ≥2 experiments + ≥2 traits,
 *   - the trait records table shows the rows we just imported, and
 *   - filtering by experiment actually narrows the table — proven by
 *     creating two experiments with different row counts and confirming
 *     each filter selection produces the matching count.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import type { Page } from "@playwright/test"
import { expect, test } from "../helpers/fixtures"

interface TraitImportInputs {
  experimentName: string
  traitName: string
  seasonName: string
  siteName: string
  rowCount: number
  collectionDate?: string
}

async function runTraitWizard(
  page: Page,
  runPrefix: string,
  inputs: TraitImportInputs,
): Promise<void> {
  const lines = [
    `plot_number,plot_row,plot_col,${inputs.traitName}`,
    ...Array.from({ length: inputs.rowCount }, (_, i) => {
      const plot = i + 1
      const value = (1.0 + plot * 0.1).toFixed(2)
      return `${plot},1,${plot},${value}`
    }),
  ]
  const csv = lines.join("\n")

  await page.goto("/files")
  await expect(
    page.getByRole("heading", { name: /^files$/i, level: 1 }),
  ).toBeVisible({ timeout: 15_000 })

  await page.getByTestId("files-data-type-selector").click()
  await page.getByRole("menuitem", { name: "Trait Data" }).click()

  await page.getByTestId("entity-select-experiment").click()
  await page.getByTestId("entity-create-experiment").click()
  await page.getByTestId("entity-new-experiment").fill(inputs.experimentName)
  await page.keyboard.press("Escape")

  await page.getByTestId("upload-input").setInputFiles({
    name: `${runPrefix}-${inputs.experimentName}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  })

  await expect(page.getByTestId("step-column-mapping")).toBeVisible({
    timeout: 30_000,
  })
  await page.getByTestId("plot-number-select").click()
  await page.getByRole("option", { name: "plot_number" }).click()
  await page.getByTestId(`trait-checkbox-${inputs.traitName}`).click()
  await page
    .getByTestId("collection-date-fixed")
    .fill(inputs.collectionDate ?? "2026-05-01")
  await page.getByTestId("season-fixed").fill(inputs.seasonName)
  await page.getByTestId("site-fixed").fill(inputs.siteName)

  await expect(page.getByTestId("mapping-continue")).toBeEnabled({
    timeout: 10_000,
  })
  await page.getByTestId("mapping-continue").click()

  await expect(page.getByTestId("upload-continue")).toBeEnabled({
    timeout: 120_000,
  })
  await page.getByTestId("upload-continue").click()

  await expect(page.getByTestId("import-step-confirm")).toBeVisible({
    timeout: 10_000,
  })
}

test.describe("Files View tab — trait records", () => {
  // Two wizard runs back-to-back: budget ~5 min on a warm stack.
  test.setTimeout(360_000)

  test("imported records render and the experiment filter narrows them", async ({
    page,
    runPrefix,
  }) => {
    const expA = `${runPrefix}-view-exp-A`
    const expB = `${runPrefix}-view-exp-B`
    const traitA = `${runPrefix}-Yield`
    const traitB = `${runPrefix}-NDVI`
    const seasonA = `${runPrefix}-Summer-A`
    const seasonB = `${runPrefix}-Summer-B`
    const siteA = `${runPrefix}-Field-A`
    const siteB = `${runPrefix}-Field-B`

    // Wizard run 1: experiment A, trait A, 3 rows.
    await runTraitWizard(page, runPrefix, {
      experimentName: expA,
      traitName: traitA,
      seasonName: seasonA,
      siteName: siteA,
      rowCount: 3,
    })

    // Wizard run 2: experiment B, trait B, 5 rows. Distinct trait
    // names so the trait dropdown drives the per-trait read; distinct
    // experiment names so the experiment filter has something to narrow.
    await runTraitWizard(page, runPrefix, {
      experimentName: expB,
      traitName: traitB,
      seasonName: seasonB,
      siteName: siteB,
      rowCount: 5,
    })

    // ---- View tab ----
    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-view"]').first().click()
    await expect(
      page.getByRole("heading", { name: /^view data$/i }),
    ).toBeVisible({ timeout: 15_000 })

    // Stats: experiments ≥ 2, traits ≥ 2 (we just bumped both by exactly
    // those amounts under our runPrefix).
    const expValue = page.getByTestId("stat-value-experiments")
    await expect(expValue).toBeVisible({ timeout: 15_000 })
    const expCount = Number((await expValue.textContent()) ?? "0")
    expect(
      Number.isFinite(expCount) && expCount >= 2,
      `Experiments stat should be ≥ 2, got ${expCount}`,
    ).toBeTruthy()

    const traitValue = page.getByTestId("stat-value-traits")
    const traitCount = Number((await traitValue.textContent()) ?? "0")
    expect(
      Number.isFinite(traitCount) && traitCount >= 2,
      `Traits stat should be ≥ 2, got ${traitCount}`,
    ).toBeTruthy()

    // Pick traitA → 3 rows under expA.
    await page.getByTestId("trait-viewer-trait").click()
    await page
      .getByRole("option", { name: new RegExp(traitA) })
      .first()
      .click()

    const table = page.getByTestId("trait-records-table")
    await expect(table).toBeVisible({ timeout: 15_000 })
    await expect(table.locator("tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    })

    // Filter to experiment B — traitA has zero records there, so the
    // empty-state fires and the table disappears. This is the core
    // assertion that the experiment-filter actually flows into the
    // server-side `experiment_name` query param.
    await page.getByTestId("trait-viewer-experiment").click()
    await page.getByRole("option", { name: expB }).first().click()
    await expect(page.getByTestId("no-records")).toBeVisible({
      timeout: 15_000,
    })

    // Reset the filter (pick "All experiments") → 3 rows again.
    await page.getByTestId("trait-viewer-experiment").click()
    await page
      .getByRole("option", { name: /^all experiments$/i })
      .first()
      .click()
    await expect(table.locator("tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    })

    // Switch trait → traitB has 5 rows under expB.
    await page.getByTestId("trait-viewer-trait").click()
    await page
      .getByRole("option", { name: new RegExp(traitB) })
      .first()
      .click()
    await expect(table.locator("tbody tr")).toHaveCount(5, {
      timeout: 15_000,
    })
  })
})
