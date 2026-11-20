/**
 * Regression test: importing a very wide trait CSV (many columns) must
 * not push the wizard's footer button off-screen.
 *
 * Bug: with a 95-column master CSV, the Map Columns step's data-preview
 * tables expanded the whole wizard body to ~13,800px wide (grid items
 * default to `min-width: auto` and refuse to shrink below intrinsic
 * content width). The "Continue to Upload" button rode that expansion
 * ~12,500px off-screen to the right, so it looked like the button never
 * appeared even after every required field was filled.
 *
 * Fix: `min-w-0` on the wizard root lets it shrink to the dialog's width;
 * the preview tables keep their own `overflow-x-auto` and scroll
 * internally.
 *
 * Drives the real UI end-to-end (no API seeding). Console-error guard
 * auto-attached via tests/helpers/fixtures.
 */
import { expect, test } from "../helpers/fixtures"

// Mirror the real master dataset's width (95 columns) without depending
// on a file outside the repo: a plot column + a date column + 93 trait
// columns, 4 data rows.
function wideCsv(): string {
  const traitCols = Array.from({ length: 93 }, (_, i) => `trait_${i + 1}`)
  const header = ["plot_number", "collected_on", ...traitCols].join(",")
  const rows = Array.from({ length: 4 }, (_, r) => {
    const vals = traitCols.map((_, i) => (r + i + 1).toFixed(2))
    return [String(r + 1), "2026-05-01", ...vals].join(",")
  })
  return [header, ...rows].join("\n")
}

test.describe("Trait import: very wide CSV layout", () => {
  test.setTimeout(120_000)

  test("footer button stays on-screen; preview tables scroll internally", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-wide-exp`

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
      name: `${runPrefix}-wide.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(wideCsv(), "utf8"),
    })

    await expect(page.getByTestId("import-wizard-dialog")).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 60_000,
    })

    // Fill every required field: plot column, one trait, season, site.
    // (Collection date defaults to a fixed value, which is already valid.)
    await page.getByTestId("plot-number-select").click()
    await page.getByRole("option", { name: "plot_number" }).click()
    await page.getByTestId("trait-checkbox-trait_1").click()
    await page.getByTestId("season-fixed").fill("Summer 2022")
    await page.getByTestId("site-fixed").fill("Davis")

    const continueBtn = page.getByTestId("mapping-continue")
    await expect(continueBtn).toBeEnabled({ timeout: 15_000 })

    // The wizard body must fit inside the dialog — not blow out to the
    // intrinsic width of the wide preview tables.
    const wizard = page.getByTestId("import-wizard")
    const wizardClientW = await wizard.evaluate((el) => el.clientWidth)
    expect(
      wizardClientW,
      "wizard body should fit within the 95vw dialog, not expand to the preview-table width",
    ).toBeLessThan(1280)

    // The footer button's right edge must be inside the viewport.
    const vp = page.viewportSize()
    const btnBox = await continueBtn.boundingBox()
    expect(btnBox).not.toBeNull()
    if (btnBox && vp) {
      expect(
        btnBox.x + btnBox.width,
        "Continue button must be within the viewport, not pushed off-screen",
      ).toBeLessThanOrEqual(vp.width)
    }

    // The wide preview table still scrolls horizontally inside its own box.
    const previewContainer = page
      .getByTestId("step-column-mapping")
      .locator('[data-slot="table-container"]')
      .first()
    const pScroll = await previewContainer.evaluate((el) => el.scrollWidth)
    const pClient = await previewContainer.evaluate((el) => el.clientWidth)
    expect(
      pScroll,
      "the wide data-preview table should scroll internally",
    ).toBeGreaterThan(pClient)
    expect(
      pClient,
      "the preview table must be no wider than the dialog body",
    ).toBeLessThan(1280)
  })
})
