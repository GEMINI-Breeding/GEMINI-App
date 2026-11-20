/**
 * Regression test: when a multi-site / multi-year file is imported with a
 * single fixed Site and a germplasm column mapped, plot numbers that
 * repeat across fields collapse onto one plot whose germplasm disagrees
 * row-to-row. The backend trigger raises an "Accession mismatch" error.
 *
 * The wizard must surface that as an ACTIONABLE hint (what went wrong +
 * what to change), not the raw trigger message with internal UUIDs.
 *
 * Drives the real UI end-to-end (no API seeding). The console-error guard
 * is intentionally relaxed for the expected backend 422 on this spec.
 */
import { expect, test } from "../helpers/fixtures"

// Two "fields" (rows 1..2 vs 3..4) that reuse the same plot numbers (1, 2)
// with DIFFERENT germplasm. Site is mapped as a single fixed value below,
// so plot 1 gets germplasm "A" from field-1 and "B" from field-2 → the
// trigger rejects the second.
function collidingCsv(): string {
  return [
    "plot_number,germplasm,yield",
    "1,A,10",
    "2,B,11",
    "1,C,12", // same plot_number 1, different germplasm → mismatch
    "2,D,13",
  ].join("\n")
}

test.describe("Trait import: accession-mismatch hint", () => {
  test.setTimeout(120_000)

  test("collapsing multi-field plots shows an actionable error, not raw SQL", async ({
    page,
    runPrefix,
    consoleErrorGuard,
  }) => {
    const experimentName = `${runPrefix}-mismatch-exp`

    // This test deliberately triggers the backend's accession-mismatch
    // 422 on the bulk records endpoint — the console logs that response
    // status. Declare it expected so the strict guard doesn't fail us
    // for the very error we're asserting the UI handles gracefully.
    consoleErrorGuard.expectError(/records\/bulk/)
    consoleErrorGuard.expectError(/Failed to load resource/)

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
      name: `${runPrefix}-mismatch.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(collidingCsv(), "utf8"),
    })

    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 60_000,
    })

    // Map plot number, the germplasm column (as Line name), one trait,
    // and a FIXED site — the misconfiguration that causes the collision.
    await page.getByTestId("plot-number-select").click()
    await page.getByRole("option", { name: "plot_number" }).click()
    await page.getByTestId("line-name-column-select").click()
    await page.getByRole("option", { name: "germplasm" }).click()
    await page.getByTestId("trait-checkbox-yield").click()
    await page.getByTestId("collection-date-mode").click()
    await page.getByRole("option", { name: /unknown/i }).click()
    await page.getByTestId("season-fixed").fill("Summer 2022")
    await page.getByTestId("site-fixed").fill("Davis")

    await expect(page.getByTestId("mapping-continue")).toBeEnabled({
      timeout: 15_000,
    })
    await page.getByTestId("mapping-continue").click()

    // The ingest fails on the colliding plot. The wizard must show the
    // humanized hint — naming the fix ("From column" for Season/Site) —
    // not the raw "Accession mismatch on trait_records: plot <uuid>…".
    const hint = page.getByTestId("upload-error-hint")
    await expect(hint).toBeVisible({ timeout: 60_000 })
    await expect(hint).toContainText(/same plot number/i)
    await expect(page.getByTestId("upload-error")).toContainText(/from column/i)
    // The raw UUID-bearing message must NOT be the primary text.
    await expect(hint).not.toContainText(/trait_records: plot/i)
  })
})
