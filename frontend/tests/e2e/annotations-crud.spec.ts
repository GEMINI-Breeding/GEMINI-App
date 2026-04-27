/**
 * Phase 8 strict-E2E: AnnotationsPage end-to-end.
 *
 * Drives `/annotations` against the live GEMINIbase REST API:
 *   - CVAT button → POST /api/annotations/start_cvat → status text renders.
 *   - Pick a YOLO `.txt` label file → POST /api/annotations/check_labels →
 *     "new" badge appears (file is unique-stamped, so the server never has it).
 *   - Click Upload → POST /api/annotations/upload_labels → file appears in
 *     the "Existing labels" listing once the labels-list query refetches.
 *   - Reload → file is still listed (proves backend persistence; rules out a
 *     "client-side only" upload bug).
 *
 * No external services. The CVAT POST returns a stub URL; check_labels and
 * upload_labels write to the same MinIO the rest of the suite uses.
 */
import type { Response } from "@playwright/test"

import { expect, test } from "../helpers/fixtures"

function uniqueStamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

async function waitForApi(
  page: import("@playwright/test").Page,
  fn: () => Promise<unknown>,
  matcher: (resp: Response) => boolean,
): Promise<Response> {
  const [resp] = await Promise.all([page.waitForResponse(matcher), fn()])
  expect(resp.ok(), `expected 2xx from ${resp.url()}, got ${resp.status()}`).toBe(true)
  return resp
}

test.describe("Annotations: CVAT link + label upload", () => {
  test.setTimeout(90_000)

  test("CVAT stub renders + new label uploads + survives reload", async ({ page }) => {
    const stamp = uniqueStamp()
    const labelName = `pw-label-${stamp}.txt`
    // Use a unique prefix per run so an accumulated server doesn't muddy the
    // "no existing labels" assertion. The dirPath input is editable so we
    // just type into it.
    const dirPath = `Labels/pw-${stamp}/`

    await page.goto("/annotations")
    await expect(
      page.getByRole("heading", { name: /^annotations$/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })

    // ── 1. CVAT button: assert real backend POST + status text renders ─────
    const cvatResp = await waitForApi(
      page,
      () => page.getByTestId("annotations-cvat-open").click(),
      (r) =>
        /\/api\/annotations\/start_cvat$/.test(r.url()) &&
        r.request().method() === "POST",
    )
    const cvatBody = (await cvatResp.json()) as { status?: string }
    // Inline span next to the button. Sonner renders a toast with the same
    // text, so the assertion uses a dedicated data-testid scoped to the
    // CVAT card.
    if (cvatBody.status) {
      await expect(page.getByTestId("annotations-cvat-status")).toContainText(
        cvatBody.status,
        { timeout: 5_000 },
      )
    }

    // ── 2. Override dirPath so this run is isolated from prior runs ────────
    const dirInput = page.getByTestId("annotations-dirpath")
    await dirInput.fill(dirPath)

    // The labels-list query fires on dirPath change. Initially the prefix is
    // empty: assert the "No labels yet" copy is visible (rules out a stale
    // listing carrying over from a previous unrelated run).
    await expect(
      page.locator('[data-testid="annotations-existing-row"]'),
    ).toHaveCount(0, { timeout: 10_000 })
    await expect(page.getByText("No labels yet at")).toBeVisible({ timeout: 5_000 })

    // ── 3. Pick a label file. Use setInputFiles with an in-memory buffer so
    //       the spec doesn't depend on a fixture file. ─────────────────────
    const checkResp = waitForApi(
      page,
      async () => {
        await page.getByTestId("annotations-picker").setInputFiles({
          name: labelName,
          mimeType: "text/plain",
          buffer: Buffer.from("0 0.5 0.5 0.2 0.2\n", "utf-8"),
        })
      },
      (r) =>
        /\/api\/annotations\/check_labels$/.test(r.url()) &&
        r.request().method() === "POST",
    )
    await checkResp

    // The "new" badge should land on this file's row (server confirmed it
    // doesn't already exist at this prefix).
    const pendingRow = page.locator('[data-testid="annotations-pending-row"]', {
      hasText: labelName,
    })
    await expect(pendingRow).toBeVisible({ timeout: 5_000 })
    await expect(pendingRow.getByText(/^new$/)).toBeVisible({ timeout: 5_000 })

    // ── 4. Click Upload → assert backend POST → file appears in listing ────
    await waitForApi(
      page,
      () => page.getByTestId("annotations-upload").click(),
      (r) =>
        /\/api\/annotations\/upload_labels$/.test(r.url()) &&
        r.request().method() === "POST",
    )

    // The page invalidates the labels-list query on upload success. Wait for
    // the row in the "Existing labels" table to appear (assert against the
    // file path, since the listing renders full object_name).
    const existingRow = page.locator('[data-testid="annotations-existing-row"]', {
      hasText: labelName,
    })
    await expect(existingRow).toBeVisible({ timeout: 15_000 })

    // ── 5. Reload — listing must still include the file (real persistence) ─
    await page.reload()
    // The dirPath input resets to its default ("Labels/") on reload, so
    // type the test prefix again to refetch the matching listing.
    await page.getByTestId("annotations-dirpath").fill(dirPath)
    const persistedRow = page.locator('[data-testid="annotations-existing-row"]', {
      hasText: labelName,
    })
    await expect(persistedRow).toBeVisible({ timeout: 15_000 })
  })

  test("re-picking a now-existing file shows 'already on server' (check_labels round-trip)", async ({
    page,
  }) => {
    // This second case proves /check_labels actually consults MinIO: pick the
    // SAME filename twice, and the second pick should report "already on
    // server" without us asserting it through any other path.
    const stamp = uniqueStamp()
    const labelName = `pw-label-existing-${stamp}.txt`
    const dirPath = `Labels/pw-${stamp}/`
    const buffer = Buffer.from("0 0.4 0.4 0.1 0.1\n", "utf-8")

    await page.goto("/annotations")
    await page.getByTestId("annotations-dirpath").fill(dirPath)

    // First pick + upload
    await page.getByTestId("annotations-picker").setInputFiles({
      name: labelName,
      mimeType: "text/plain",
      buffer,
    })
    const firstRow = page.locator('[data-testid="annotations-pending-row"]', {
      hasText: labelName,
    })
    await expect(firstRow.getByText(/^new$/)).toBeVisible({ timeout: 5_000 })
    await waitForApi(
      page,
      () => page.getByTestId("annotations-upload").click(),
      (r) =>
        /\/api\/annotations\/upload_labels$/.test(r.url()) &&
        r.request().method() === "POST",
    )

    // Second pick — same filename, same prefix; server should now say it
    // exists.
    await page.getByTestId("annotations-picker").setInputFiles({
      name: labelName,
      mimeType: "text/plain",
      buffer,
    })
    const secondRow = page.locator('[data-testid="annotations-pending-row"]', {
      hasText: labelName,
    })
    await expect(secondRow.getByText(/already on server/i)).toBeVisible({
      timeout: 10_000,
    })
  })
})
