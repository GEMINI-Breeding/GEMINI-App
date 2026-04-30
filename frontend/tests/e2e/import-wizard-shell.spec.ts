/**
 * Phase 9c shell E2E: confirm `/import` loads, accepts a file via the
 * native input, runs detection, and shows the right stub branch for the
 * file type detected.
 *
 * No backend mutation happens in 9c — every "Next" lands on a clearly
 * labelled placeholder for 9d (genomic) or 9e (trait). The spec proves:
 *   - Sidebar entry routes to /import.
 *   - Detect step renders + accepts a CSV via the hidden file input.
 *   - Detection summary appears with the right category badge.
 *   - For a tabular CSV, "Continue" advances to the Metadata stub.
 *   - For a genomic CSV (variant_name + IUPAC calls), the GenomicWizard
 *     stub renders.
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

const GENOMIC_CSV = [
  "variant_name,chromosome,position,LINE_A,LINE_B,LINE_C",
  "SNP_001,1,100,AA,AG,GG",
  "SNP_002,1,200,CC,CT,TT",
  "SNP_003,2,300,AA,AG,GG",
].join("\n")

test.describe("Phase 9c: Import wizard shell", () => {
  test.setTimeout(60_000)

  test("trait CSV → Detect → Metadata stub", async ({ page }) => {
    await page.goto("/import")
    await expect(
      page.getByRole("heading", { name: /import data/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId("import-step-detect")).toBeVisible()

    // Drop the CSV via the hidden file input. UploadZone exposes the
    // input under data-testid="upload-input".
    await page.getByTestId("upload-input").setInputFiles({
      name: "traits.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(TRAIT_CSV, "utf8"),
    })

    // Detection summary renders with the CSV / Tabular badge.
    const summary = page.getByTestId("detection-summary")
    await expect(summary).toBeVisible({ timeout: 10_000 })
    await expect(summary).toContainText(/CSV \/ Tabular/i)

    // Continue → Metadata stub for the tabular path.
    await page.getByTestId("detect-continue").click()
    await expect(page.getByTestId("import-stub-Metadata")).toBeVisible()
  })

  test("genomic-shaped CSV → GenomicWizard stub", async ({ page }) => {
    await page.goto("/import")
    await page.getByTestId("upload-input").setInputFiles({
      name: "genotypes.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(GENOMIC_CSV, "utf8"),
    })

    // Detection short-circuits to the genomic wizard immediately —
    // the GenomicWizardStub renders without an explicit Continue click
    // because WizardShell branches on the detection result.
    const summary = page.getByTestId("detection-summary")
    await expect(summary).toBeVisible({ timeout: 10_000 })
    await expect(summary).toContainText(/Genomic/i)

    await page.getByTestId("detect-continue").click()
    await expect(page.getByTestId("import-stub-Genomic wizard")).toBeVisible()
  })

  test("Sidebar 'Import' entry routes to /import", async ({ page }) => {
    await page.goto("/")
    // Sidebar uses anchor-or-button with the title text.
    const importLink = page.getByRole("link", { name: /import/i }).first()
    await expect(importLink).toBeVisible({ timeout: 10_000 })
    await importLink.click()
    await expect(page).toHaveURL(/\/import$/, { timeout: 10_000 })
    await expect(page.getByTestId("import-step-detect")).toBeVisible()
  })
})
