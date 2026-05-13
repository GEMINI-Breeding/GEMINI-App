/**
 * Strict-E2E for the GGE biplot in the Multivariate Analyze tab.
 *
 * GGE needs the same accessions appearing across ≥3 environments. We
 * upload the same 4-accession trait CSV three times against the same
 * experiment but with three different site names — each upload creates
 * one env (experiment × season × site).
 *
 * Then drives /analyze?view=multi → GGE sub-tab → picks the trait →
 * asserts the biplot SVG renders with 3 env arrows + 4 accession points.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import type { Page } from "@playwright/test"

import { expect, test } from "../helpers/fixtures"

const ACCESSIONS = ["A", "B", "C", "D"]

interface ImportOpts {
  page: Page
  runPrefix: string
  experimentName: string
  traitName: string
  seasonName: string
  siteName: string
  rows: { accession: string; value: number }[]
  filenameSuffix: string
  isFirstImport: boolean
}

async function importTraitCsv(opts: ImportOpts) {
  const {
    page,
    runPrefix,
    experimentName,
    traitName,
    seasonName,
    siteName,
    rows,
    filenameSuffix,
    isFirstImport,
  } = opts

  const csvLines = [
    `plot_number,plot_row,plot_col,accession,${traitName}`,
    ...rows.map(
      (r, i) =>
        `${i + 1},${1 + (i % 2)},${1 + Math.floor(i / 2)},${r.accession},${r.value}`,
    ),
  ]
  const csv = csvLines.join("\n")

  await page.goto("/files")
  await page.getByTestId("files-data-type-selector").click()
  await page.getByRole("menuitem", { name: "Trait Data" }).click()
  await page.getByTestId("entity-select-experiment").click()
  if (isFirstImport) {
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
  } else {
    // Pick the existing experiment by name (created in the first import).
    await page
      .getByRole("option", { name: new RegExp(experimentName) })
      .first()
      .click()
  }
  await page.keyboard.press("Escape")

  await page.getByTestId("upload-input").setInputFiles({
    name: `${runPrefix}-gge-${filenameSuffix}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  })

  await expect(page.getByTestId("step-column-mapping")).toBeVisible({
    timeout: 30_000,
  })
  await page.getByTestId("plot-number-select").click()
  await page.getByRole("option", { name: "plot_number" }).click()
  await page.getByTestId("plot-row-select").click()
  await page.getByRole("option", { name: "plot_row" }).click()
  await page.getByTestId("plot-col-select").click()
  await page.getByRole("option", { name: "plot_col" }).click()
  await page.getByTestId("accession-name-column-select").click()
  await page.getByRole("option", { name: "accession" }).click()
  await page.getByTestId(`trait-checkbox-${traitName}`).click()
  await page.getByTestId("collection-date-fixed").fill("2026-05-01")
  await page.getByTestId("season-fixed").fill(seasonName)
  await page.getByTestId("site-fixed").fill(siteName)

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

test.describe("Analyze — GGE biplot chart", () => {
  test.setTimeout(360_000)

  test("import 3 envs → pick trait → GGE chart type → biplot renders", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-gge-exp`
    const traitH = `${runPrefix}-Height`
    const seasonName = `${runPrefix}-S`

    // 4 accessions × 3 sites with NON-collinear ranks per env so the GGE
    // biplot has scatter on both PC1 and PC2 (not collapsed to a single
    // axis). Each site has a different rank pattern, which produces a
    // genuine 2D convex hull instead of a degenerate line.
    const valuesPerSite: Record<string, Record<string, number>> = {
      X: { A: 20, B: 15, C: 10, D: 5 },
      Y: { A: 8, B: 18, C: 14, D: 11 },
      Z: { A: 5, B: 10, C: 17, D: 22 },
    }

    for (let i = 0; i < 3; i++) {
      const siteLetter = ["X", "Y", "Z"][i]
      const siteName = `${runPrefix}-Site${siteLetter}`
      await importTraitCsv({
        page,
        runPrefix,
        experimentName,
        traitName: traitH,
        seasonName,
        siteName,
        rows: ACCESSIONS.map((acc) => ({
          accession: acc,
          value: valuesPerSite[siteLetter][acc],
        })),
        filenameSuffix: siteLetter.toLowerCase(),
        isFirstImport: i === 0,
      })
    }

    // ---- Analyze (single-trait) → pick trait → GGE biplot chart ----
    await page.goto("/analyze")
    await expect(page.getByRole("heading", { name: /^analyze$/i })).toBeVisible(
      { timeout: 15_000 },
    )

    await page.getByTestId("analyze-trait-select").click()
    await page
      .getByRole("option", { name: new RegExp(traitH) })
      .first()
      .click()

    await page.getByTestId("trait-charts-chart-type").click()
    await page.getByRole("option", { name: "GGE biplot" }).click()

    const svg = page.getByTestId("mv-gge-svg")
    await expect(svg).toBeVisible({ timeout: 30_000 })

    // All 3 env arrows render (site names get the runPrefix-Site* prefix
    // and the env label joins exp · season · site).
    for (const letter of ["X", "Y", "Z"]) {
      await expect(
        page
          .locator(`[data-testid^="mv-gge-env-"][data-testid*="Site${letter}"]`)
          .first(),
      ).toBeVisible()
    }

    // All 4 accession points render
    for (const acc of ACCESSIONS) {
      await expect(page.getByTestId(`mv-gge-acc-${acc}`)).toBeVisible()
    }

    // Which-won-where polygon renders (A and D rank-cross → both vertices)
    await expect(page.getByTestId("mv-gge-polygon")).toBeVisible()
  })
})
