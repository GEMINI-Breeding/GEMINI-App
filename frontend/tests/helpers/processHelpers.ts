/**
 * Process-page helpers shared by the pipeline specs.
 */
import { expect, type Page } from "@playwright/test"

/**
 * Run the Data Sync step through its dialog: own metadata by default, or
 * from another sensor's track (picked by its label) when `source` is given.
 * Waits for the DATA_SYNC job to finish.
 */
export async function runDataSync(
  page: Page,
  opts: { source?: RegExp; maxExtrapolationSec?: number } = {},
) {
  const row = page.getByTestId("step-row-data_sync")
  await expect(row).toHaveAttribute("data-status", "ready", { timeout: 15_000 })
  await row.getByRole("button", { name: /run step/i }).click()
  const dialog = page.getByTestId("data-sync-dialog")
  await expect(dialog).toBeVisible()
  if (opts.source) {
    const cross = dialog.getByLabel("Sync from another sensor")
    await expect(cross).toBeEnabled({ timeout: 15_000 })
    await cross.check()
    const select = dialog.getByTestId("data-sync-source")
    const label = await select
      .locator("option")
      .filter({ hasText: opts.source })
      .first()
      .textContent()
    await select.selectOption({ label: label ?? "" })
    if (opts.maxExtrapolationSec != null)
      await dialog
        .getByLabel("Out-of-range threshold")
        .fill(String(opts.maxExtrapolationSec))
  }
  await dialog.getByTestId("data-sync-start").click()
  await expect(dialog).toHaveCount(0)
  await expect(row).toHaveAttribute("data-status", "completed", {
    timeout: 120_000,
  })
  return row
}
