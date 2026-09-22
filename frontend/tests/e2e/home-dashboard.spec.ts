/**
 * Strict-E2E for the Home dashboard.
 *
 * The dashboard's widgets were written against main's "trait record" API
 * and sat disconnected on this branch. They now read GEMINIbase through
 * the catalog adapter (`features/dashboard/lib/traitCatalog.ts`). This spec
 * drives the whole path through the UI:
 *
 *   1. Import trait records with the real import wizard.
 *   2. On the home dashboard, drag a KPI widget from the toolbox onto the
 *      canvas (the real pointer-drag the toolbox uses).
 *   3. Pick the imported record and a trait in the config dialog.
 *   4. The KPI shows the true average of the imported values, and still
 *      does after a reload (saved widgets resolve their record again).
 *
 * The console-error guard (tests/helpers/fixtures) fails the test on any
 * logged error; the request log below fails it on any call to the retired
 * /api/v1 surface even if a handler swallowed the failure.
 */
import type { Page } from "@playwright/test"

import { expect, test } from "../helpers/fixtures"

async function dragTemplateToCanvas(page: Page, templateId: string) {
  const from = await page
    .getByTestId(`widget-template-${templateId}`)
    .boundingBox()
  const to = await page.getByTestId("dashboard-canvas").boundingBox()
  if (!from || !to) throw new Error("toolbox template or canvas not laid out")
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 3, {
    steps: 10,
  })
  await page.mouse.up()
}

test.describe("Home dashboard", () => {
  test.setTimeout(240_000)

  test("imported traits drive a KPI widget, which survives a reload", async ({
    page,
    runPrefix,
  }) => {
    const experimentName = `${runPrefix}-dash-exp`
    const height = `${runPrefix}-Height`
    const seasonName = `${runPrefix}-Season`
    const siteName = `${runPrefix}-Site`
    const date = "2026-05-01"

    const requests: string[] = []
    page.on("request", (r) => {
      if (r.url().includes("/api/")) requests.push(r.url())
    })

    // ── 1. Import 3 plots: height 10 / 20 / 30 → average 20. ────────────
    const csv = [
      `plot_number,plot_row,plot_col,accession,${height}`,
      `1,1,1,CB27,10`,
      `2,1,2,IT93,20`,
      `3,1,3,CB46,30`,
    ].join("\n")
    await page.goto("/files")
    await page.getByTestId("files-data-type-selector").click()
    await page.getByRole("menuitem", { name: "Trait Data" }).click()
    await page.getByTestId("entity-select-experiment").click()
    await page.getByTestId("entity-create-experiment").click()
    await page.getByTestId("entity-new-experiment").fill(experimentName)
    await page.keyboard.press("Escape")
    await page.getByTestId("upload-input").setInputFiles({
      name: `${runPrefix}-dash.csv`,
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
    await page.getByTestId(`trait-checkbox-${height}`).click()
    await page.getByTestId("population-select").click()
    await page.getByRole("option", { name: "+ Create new…" }).click()
    await page.getByTestId("population-name").fill("Cowpea")
    await page.getByTestId("collection-date-fixed").fill(date)
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

    // ── 2. Home → drag a KPI widget onto the canvas. ─────────────────────
    await page.goto("/")
    await expect(page.getByTestId("widget-template-kpi")).toBeVisible({
      timeout: 15_000,
    })
    await dragTemplateToCanvas(page, "kpi")

    // ── 3. Configure: this experiment's record for the date, the trait. ──
    const dialog = page.getByRole("dialog")
    await expect(
      dialog.getByRole("heading", { name: "Configure Widget" }),
    ).toBeVisible({ timeout: 10_000 })
    await dialog.getByTestId("widget-record-data").click()
    await page
      .getByRole("option", {
        name: new RegExp(`${experimentName}.*${siteName}.*${date}`),
      })
      .click()
    await dialog.getByTestId("widget-metric-metric").click()
    await page.getByRole("option", { name: height }).click()
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(dialog).toBeHidden()

    // ── 4. The KPI is the real average, now and after a reload. ─────────
    const kpi = page.getByTestId("kpi-value")
    await expect(kpi).toHaveText("20", { timeout: 30_000 })
    await page.reload()
    await expect(kpi).toHaveText("20", { timeout: 30_000 })

    const v1 = requests.filter((u) => u.includes("/api/v1/"))
    expect(
      v1,
      `home dashboard must not call the old backend's /api/v1 routes:\n${v1.join("\n")}`,
    ).toEqual([])
  })
})
