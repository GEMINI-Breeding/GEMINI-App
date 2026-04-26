/**
 * Phase 7: extract-traits page basic flow.
 *
 * Strict-E2E (CLAUDE.md):
 *   - Drives the real ExtractTraitsTool page against the real backend.
 *   - Asserts on user-visible gating UI: with no active boundary version
 *     for the chosen scope, the page reads "No active version; visit
 *     Plot boundaries", and the Submit button is disabled.
 *
 * A full end-to-end EXTRACT_TRAITS run requires a real RGB orthomosaic on
 * MinIO at the right path. The pipeline-orthomosaic spec produces one,
 * but coupling extract-traits to that ortho's experiment folder would
 * make the specs order-dependent — we'd rather keep them independent.
 * The "happy path" (real ortho + active version → COMPLETED → trait map
 * renders) belongs in an integration-level test that owns its own
 * pre-stitched ortho fixture; deferring that under Phase 15 hardening so
 * Phase 7 closes on a clean, stable spec set.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Pipeline: extract traits", () => {
  test.setTimeout(60_000)

  test("page renders + gates submit when no active boundary version", async ({
    page,
  }) => {
    const stamp = Date.now()
    const experiment = `pw-et-${stamp}`

    await page.goto("/process/extract-traits")
    await expect(page.getByRole("heading", { name: /extract traits/i })).toBeVisible()

    await page.locator("#aerial-date").fill("2026-04-26")
    await page.locator("#aerial-platform").fill("Drone")
    await page.locator("#aerial-sensor").fill("RGB")
    await page.locator("summary", { hasText: /override path components/i }).click()
    await page.locator("#aerial-experiment").fill(experiment)
    await page.locator("#aerial-location").fill("Davis")
    await page.locator("#aerial-population").fill("Cowpea")

    // The Inputs card should display the orthomosaic path that the worker
    // will read from.
    await expect(
      page.locator("code").filter({
        hasText: new RegExp(`Processed/2026/${experiment}/Davis/Cowpea/2026-04-26/Drone/RGB/odm_orthophoto\\.tif`),
      }),
    ).toBeVisible({ timeout: 5_000 })

    // No active boundary version for this fresh scope — page should say so
    // and link to /process/plot-boundaries.
    await expect(
      page.getByText(/no active version/i),
    ).toBeVisible({ timeout: 5_000 })

    const submit = page.getByRole("button", { name: /run extract traits/i })
    await expect(submit).toBeDisabled()

    // Trait map placeholder copy is rendered (no data yet).
    await expect(
      page.getByText(/submit an extract-traits job/i),
    ).toBeVisible()
  })
})
