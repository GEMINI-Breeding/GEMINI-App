/**
 * Strict-E2E: the in-app console shows the worker containers' logs, not
 * just the REST API's.
 *
 * Every worker ships its log lines to Redis at startup and while it runs
 * (gemini/workers/log_shipping.py); GET /api/utils/logs merges them. Before,
 * a failed ODM or ML job left nothing a user could read without `docker
 * logs`. The workers' own startup lines ("Worker … starting") are enough to
 * prove the path end to end.
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Console — worker logs", () => {
  test("each worker's lines are listed and filterable by source", async ({
    page,
  }) => {
    await page.goto("/console")
    await expect(page.getByRole("heading", { name: "Console" })).toBeVisible()
    await expect(page.getByText("connected", { exact: true })).toBeVisible({
      timeout: 15_000,
    })

    const sourceFilter = page.getByTestId("console-source-filter")
    // All six workers ship their lines.
    for (const w of ["amiga", "geo", "gwas", "ml", "odm", "thermal"]) {
      await expect(
        sourceFilter.locator(`option[value="${w}"]`),
        `${w} worker lines should reach the console`,
      ).toHaveCount(1, { timeout: 15_000 })
    }

    // Filter to one worker: only its lines remain, and they are real ones.
    await sourceFilter.selectOption("odm")
    const lines = page.getByTestId("console-line")
    await expect(lines.first()).toBeVisible()
    const sources = await lines.evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-source")),
    )
    expect(new Set(sources)).toEqual(new Set(["odm"]))
    await expect(lines.filter({ hasText: "OdmWorker" }).first()).toBeVisible()
  })
})
