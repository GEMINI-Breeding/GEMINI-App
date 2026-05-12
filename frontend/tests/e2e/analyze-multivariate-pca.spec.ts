/**
 * Strict-E2E for the PCA biplot in the Multivariate Analyze tab.
 *
 * Imports a CSV with 4 traits across 12 plots (4 traits all loading on a
 * shared latent factor). Drives /analyze?view=multi → PCA sub-tab → picks
 * all 4 traits → asserts biplot SVG renders with 4 loading arrows.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Analyze — Multivariate PCA", () => {
  test.setTimeout(240_000)

  test("import 4 traits → PCA sub-tab → biplot renders", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-pca-exp`
    const traitA = `${runPrefix}-Height`
    const traitB = `${runPrefix}-Biomass`
    const traitC = `${runPrefix}-LeafArea`
    const traitD = `${runPrefix}-Yield`
    const seasonName = `${runPrefix}-Season`
    const siteName = `${runPrefix}-Site`

    // 12 plots; the 4 traits all track a shared "growth" factor with small
    // independent noise. PC1 should dominate and all 4 loading arrows
    // point roughly the same way.
    const seedRows: number[] = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]
    const rows = seedRows.map((p) => {
      const base = p
      const noise = () => (Math.sin(p * 13) * 0.3 + Math.cos(p * 7) * 0.2)
      return `${p},${1 + ((p - 1) % 3)},${1 + Math.floor((p - 1) / 3)},${base + noise()},${base * 1.2 + noise()},${base * 0.9 + noise()},${base * 1.1 + noise()}`
    })
    const csv = [
      `plot_number,plot_row,plot_col,${traitA},${traitB},${traitC},${traitD}`,
      ...rows,
    ].join("\n")

    // ---- Import via the real wizard ----
    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")

    await page.getByTestId("upload-input").setInputFiles({
      name: `${runPrefix}-pca.csv`,
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
    for (const t of [traitA, traitB, traitC, traitD]) {
      await page.getByTestId(`trait-checkbox-${t}`).click()
    }
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

    // ---- Analyze → Multivariate → PCA ----
    await page.goto("/analyze?view=multi")
    await expect(page.getByRole("heading", { name: /^analyze$/i })).toBeVisible(
      { timeout: 15_000 },
    )
    await page.getByTestId("mv-subtab-pca").click()

    // Uncheck "Average replicates by genotype" — these rows have no
    // accession_name, so the toggle is a no-op anyway, but make it explicit
    // so the test runs on per-plot rows.
    await page
      .getByTestId("mv-pca-collapse-replicates")
      .uncheck({ force: true })

    // Pick all 4 traits
    await page.getByTestId("mv-pca-trait-picker").click()
    for (const t of [traitA, traitB, traitC, traitD]) {
      await page.locator(`label:has-text("${t}")`).first().click()
    }
    await page.getByRole("heading", { name: /^analyze$/i }).click()

    // Isolate to the just-imported experiment
    await page.getByTestId("mv-experiment").click()
    await page.locator(`label:has-text("${experimentName}")`).first().click()
    await page.getByRole("heading", { name: /^analyze$/i }).click()

    await page.getByTestId("mv-pca-run").click()

    const svg = page.getByTestId("mv-pca-svg")
    await expect(svg).toBeVisible({ timeout: 30_000 })

    // All 4 loading arrows render
    for (const t of [traitA, traitB, traitC, traitD]) {
      await expect(page.getByTestId(`mv-pca-loading-${t}`)).toBeVisible()
    }

    // Scree chart renders
    await expect(page.getByTestId("mv-pca-scree")).toBeVisible()
  })
})
