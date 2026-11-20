/**
 * Regression: after a failed trait import into a freshly-created
 * experiment, the plots that attempt committed must be rolled back so a
 * corrected retry succeeds instead of inheriting the stale plot↔accession
 * link (which would raise the same "Accession mismatch" again).
 *
 * Flow (all real UI, no API seeding):
 *   1. New experiment + a CSV whose plot numbers repeat across two
 *      "sites" with different germplasm.
 *   2. Map germplasm + a FIXED site → collides → upload fails.
 *   3. The failure rolls back the plots it created.
 *   4. Go Back, set Site = From column (Location) → retry → succeeds.
 *
 * Without the rollback, step 4 fails because the plots from step 2 (under
 * the fixed site, with the first germplasm) are still there and the retry
 * resolves a subset of records to them.
 */
import { authHeader } from "../helpers/apiClient"
import { expect, test } from "../helpers/fixtures"

const API_URL =
  process.env.E2E_API_URL || process.env.VITE_API_URL || "http://127.0.0.1:7777"

// Two locations reuse plot numbers 1 & 2 with different germplasm. Under a
// fixed Site this collides; under Site=Location it's clean.
function csv(): string {
  return [
    "plot_number,location,germ,yield",
    "1,North,GA,10",
    "2,North,GB,11",
    "1,South,GC,12",
    "2,South,GD,13",
  ].join("\n")
}

test.describe("Trait import: rollback enables clean retry", () => {
  test.setTimeout(150_000)

  test("failed attempt rolls back its plots so the corrected retry succeeds", async ({
    page,
    runPrefix,
    consoleErrorGuard,
  }) => {
    consoleErrorGuard.expectError(/records\/bulk/)
    consoleErrorGuard.expectError(/Failed to load resource/)

    const experimentName = `${runPrefix}-rollback-exp`

    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")

    await page.getByTestId("upload-input").setInputFiles({
      name: `${runPrefix}-rollback.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv(), "utf8"),
    })
    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 30_000,
    })

    await page.getByTestId("plot-number-select").click()
    await page.getByRole("option", { name: "plot_number" }).click()
    await page.getByTestId("line-name-column-select").click()
    await page.getByRole("option", { name: /^germ$/ }).click()
    await page.getByTestId("trait-checkbox-yield").click()
    await page.getByTestId("collection-date-mode").click()
    await page.getByRole("option", { name: /unknown/i }).click()
    await page.getByTestId("season-fixed").fill("S1")

    // PASS 1 — fixed Site → collision → failure (then rollback).
    await page.getByTestId("site-fixed").fill("OneSite")
    await page.getByTestId("mapping-continue").click()
    await expect(page.getByTestId("upload-error")).toBeVisible({
      timeout: 60_000,
    })

    // The error message should report the rollback happened.
    await expect(page.getByTestId("upload-error")).toContainText(
      /rolled back|cleaned up/i,
    )

    // PASS 2 — go Back, fix Site to From column → Location → retry.
    await page.getByRole("button", { name: /^Back$/ }).click()
    await expect(page.getByTestId("step-column-mapping")).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId("site-mode").click()
    await page.getByRole("option", { name: /from column/i }).click()
    await page.getByTestId("site-column").click()
    await page.getByRole("option", { name: /^location$/ }).click()

    await page.getByTestId("mapping-continue").click()
    // The retry must reach completion — proving the stale plots are gone.
    await expect(page.getByTestId("upload-continue")).toBeEnabled({
      timeout: 90_000,
    })
    await page.getByTestId("upload-continue").click()
    await expect(page.getByTestId("import-step-confirm")).toBeVisible({
      timeout: 15_000,
    })

    // Backend read-only check: 4 plots exist (2 per location), none under
    // the bogus fixed "OneSite".
    const res = await fetch(
      `${API_URL}/api/plots?experiment_name=${encodeURIComponent(experimentName)}`,
      { headers: { Authorization: authHeader() } },
    )
    expect(res.ok).toBeTruthy()
    const plots = (await res.json()) as Array<{ site_id?: unknown }>
    expect(plots.length).toBe(4)
  })
})
