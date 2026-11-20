/**
 * Backend regression: re-importing the same plots with a corrected/changed
 * germplasm must update the plot's accession, not silently keep the first
 * one. Before the fix, `Plot.create_bulk` used INSERT ... ON CONFLICT DO
 * NOTHING, so a plot kept the germplasm it was first created with; a later
 * import supplying a different germplasm for the same plot then tripped the
 * `populate_trait_record_ids` "Accession mismatch" trigger.
 *
 * This drives two FULL, SUCCESSFUL imports through the real UI (no API
 * seeding): pass 1 links plots to accession A, pass 2 re-imports the same
 * plots with accession B. The second import must complete — proving the
 * plot accession was upserted. This is independent of the frontend's
 * on-failure plot rollback (both passes succeed, so rollback never runs).
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { authHeader } from "../helpers/apiClient"
import { expect, test } from "../helpers/fixtures"

const API_URL =
  process.env.E2E_API_URL || process.env.VITE_API_URL || "http://127.0.0.1:7777"

// Same 3 plots both passes; the two germplasm columns hold different
// names. Which one becomes the plot's accession depends on the mapping
// (geno_a in pass 1, geno_b in pass 2).
function csv(): string {
  return [
    "plot_number,plot_row,plot_col,geno_a,geno_b,yield",
    "1,1,1,AccA1,AccB1,10",
    "2,1,2,AccA2,AccB2,11",
    "3,1,3,AccA3,AccB3,12",
  ].join("\n")
}

async function runImport(
  page: import("@playwright/test").Page,
  experimentName: string,
  fileName: string,
  genoCol: "geno_a" | "geno_b",
) {
  await page.goto("/files")
  await page.getByTestId("files-data-type-selector").click()
  await page.getByRole("menuitem", { name: "Trait Data" }).click()
  await page.getByTestId("entity-select-experiment").click()
  // First pass creates the experiment; second pass picks the existing one.
  const createBtn = page.getByTestId("entity-create-experiment")
  if (await createBtn.isVisible().catch(() => false)) {
    await createBtn.click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")
  }

  await page.getByTestId("upload-input").setInputFiles({
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from(csv(), "utf8"),
  })
  await expect(page.getByTestId("step-column-mapping")).toBeVisible({
    timeout: 30_000,
  })

  await page.getByTestId("plot-number-select").click()
  await page.getByRole("option", { name: "plot_number" }).click()
  await page.getByTestId("line-name-column-select").click()
  await page.getByRole("option", { name: new RegExp(`^${genoCol}$`) }).click()
  await page.getByTestId("trait-checkbox-yield").click()
  await page.getByTestId("collection-date-mode").click()
  await page.getByRole("option", { name: /unknown/i }).click()
  await page.getByTestId("season-fixed").fill("S1")
  await page.getByTestId("site-fixed").fill("Site1")

  await page.getByTestId("mapping-continue").click()
  await expect(page.getByTestId("upload-continue")).toBeEnabled({
    timeout: 60_000,
  })
  await page.getByTestId("upload-continue").click()
  await expect(page.getByTestId("import-step-confirm")).toBeVisible({
    timeout: 15_000,
  })
}

test.describe("Trait import: re-import updates plot accession", () => {
  test.setTimeout(150_000)

  test("second import with a different germplasm succeeds (accession upserted)", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-reimport-exp`

    // Pass 1 — plots linked to AccA*.
    await runImport(page, experimentName, `${runPrefix}-a.csv`, "geno_a")
    // Pass 2 — same plots, AccB*. Must NOT raise an accession mismatch.
    await runImport(page, experimentName, `${runPrefix}-b.csv`, "geno_b")

    // Read-only backend check: the plots now resolve to the AccB* accessions
    // (the upsert refreshed them), not the stale AccA*.
    const res = await fetch(
      `${API_URL}/api/plots?experiment_name=${encodeURIComponent(experimentName)}&season_name=S1&site_name=Site1`,
      { headers: { Authorization: authHeader() } },
    )
    expect(res.ok).toBeTruthy()
    const plots = (await res.json()) as Array<{
      id?: string
      accession_id?: string | null
    }>
    expect(plots.length).toBe(3)

    // Resolve each plot's accession name and assert it's the B-series.
    for (const p of plots) {
      if (!p.id) continue
      const accRes = await fetch(`${API_URL}/api/plots/id/${p.id}/accession`, {
        headers: { Authorization: authHeader() },
      })
      if (!accRes.ok) continue
      const acc = (await accRes.json()) as { accession_name?: string }
      expect(
        acc.accession_name,
        "plot accession should be refreshed to B",
      ).toMatch(/^AccB/)
    }
  })
})
