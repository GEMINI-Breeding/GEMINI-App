/**
 * Strict-E2E for the Files View tab — Images sub-tab.
 *
 * Uploads JPGs to two distinct experiments through the real Files →
 * Upload UI, switches to View → Images, and asserts:
 *   - the inner <img> elements actually load (naturalWidth > 0) — proves
 *     the blob-fetch thumbnail path works end-to-end, not just that the
 *     wrapper tile rendered;
 *   - the experiment filter narrows the gallery to the matching count
 *     (2 vs 1 — distinct counts confirm the filter is wired into the
 *     server-side prefix, not just the displayed dropdown label).
 *
 * Console-error guard auto-attached via tests/helpers/fixtures.
 */
import { fixturePath } from "../helpers/fixturePath"
import { expect, test } from "../helpers/fixtures"
import {
  dropFiles,
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"

test.describe("Files View tab — image gallery", () => {
  // Two upload runs back-to-back: budget ~5 min on a warm stack.
  test.setTimeout(360_000)

  test("uploaded images render thumbnails and the experiment filter narrows", async ({
    page,
    runPrefix,
  }) => {
    const expA = `${runPrefix}-view-img-A`
    const expB = `${runPrefix}-view-img-B`
    const date = "2026-05-06"
    const platform = "drone"
    const sensor = "rgb"
    const jpg1 = fixturePath("images", "test_image_001.jpg")
    const jpg2 = fixturePath("images", "test_image_002.jpg")

    // Upload run 1: experiment A, 2 JPGs.
    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, {
      experiment: expA,
      location: `${runPrefix}-loc-A`,
      population: `${runPrefix}-pop-A`,
      date,
      platform,
      sensor,
    })
    await dropFiles(page, [jpg1, jpg2])
    await submitUploadAndWait(page, 2, { timeoutMs: 120_000 })

    // Upload run 2: experiment B, 1 JPG.
    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, {
      experiment: expB,
      location: `${runPrefix}-loc-B`,
      population: `${runPrefix}-pop-B`,
      date,
      platform,
      sensor,
    })
    await dropFiles(page, [jpg1])
    await submitUploadAndWait(page, 1, { timeoutMs: 120_000 })

    // ---- View tab → Images ----
    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-view"]').first().click()
    await expect(
      page.getByRole("heading", { name: /^view data$/i }),
    ).toBeVisible({ timeout: 10_000 })
    await page.getByTestId("view-tab-images").click()

    // Pick experiment A → expect 2 thumbnails. The Raw/{exp}/.../Images/
    // listing is recursive so the gallery shows BOTH JPGs even though the
    // upload deposited them under the .../Images/ subprefix.
    await page.getByTestId("image-viewer-experiment").click()
    await page.getByRole("option", { name: expA }).first().click()

    const gallery = page.getByTestId("image-gallery")
    await expect(gallery).toBeVisible({ timeout: 30_000 })
    await expect(gallery.getByTestId("image-thumbnail")).toHaveCount(2, {
      timeout: 30_000,
    })

    // Prove the inner <img> actually rendered with pixel data — a
    // theatrical assertion against the wrapper alone would pass even
    // when the thumbnail endpoint is broken. naturalWidth > 0 means
    // the browser decoded the blob the hook fetched.
    const firstImg = gallery
      .getByTestId("image-thumbnail")
      .first()
      .locator("img")
    await expect(firstImg).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(
        () => firstImg.evaluate((el: HTMLImageElement) => el.naturalWidth),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0)

    // Switch to experiment B → expect exactly 1 thumbnail. Distinct
    // counts (2 → 1) prove the filter actually narrows; an assertion
    // that just said ">= 1" would pass even if the experiment switch
    // were a no-op.
    await page.getByTestId("image-viewer-experiment").click()
    await page.getByRole("option", { name: expB }).first().click()
    await expect(gallery.getByTestId("image-thumbnail")).toHaveCount(1, {
      timeout: 30_000,
    })
  })
})
