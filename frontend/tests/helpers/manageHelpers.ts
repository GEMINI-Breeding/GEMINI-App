import type { Locator, Page } from "@playwright/test"
import { expect } from "@playwright/test"

/** Navigate to the Files dashboard and activate the Manage section. */
export async function navigateToManage(page: Page): Promise<void> {
  await page.goto("/files")
  await page.locator('[data-onboarding="files-tab-manage"]').click()
  await expect(
    page.getByRole("heading", { name: /manage data/i }),
  ).toBeVisible()
}

/** Find the first DataTable row whose text includes the prefix. */
export async function findRowByPrefix(
  page: Page,
  prefix: string,
): Promise<Locator> {
  const row = page
    .getByRole("row")
    .filter({ hasText: prefix })
    .first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  return row
}

/**
 * Open the row's actions dropdown and click "View images", which mounts the
 * ImageViewerDialog. Returns the dialog Locator.
 */
export async function openImageViewer(
  page: Page,
  row: Locator,
): Promise<Locator> {
  // UploadActionsMenu renders an icon-only Button (DropdownMenuTrigger). It's
  // the only `<button>` in the row's actions cell.
  await row.getByRole("button").last().click()
  await page.getByRole("menuitem", { name: /view images/i }).click()

  // ImageViewerDialog is a fixed overlay; scope by the Loading/No-images text
  // or the range slider (unique to this component).
  const dialog = page.locator('div.fixed.inset-0.z-50.bg-black\\/80')
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  return dialog
}

/**
 * Assert the viewer's image element eventually renders with naturalWidth > 0.
 * ImageViewerDialog debounces image loads by 150 ms; give it a reasonable
 * window.
 */
export async function assertImageRenders(dialog: Locator): Promise<void> {
  const img = dialog.locator("img").first()
  await expect(img).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), {
      timeout: 30_000,
      intervals: [250, 500, 1000],
    })
    .toBeGreaterThan(0)
}
