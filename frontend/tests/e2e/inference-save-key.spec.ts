/**
 * Phase 8 strict-E2E: InferencePage's API-key persistence + run-button gating.
 *
 * The full LOCATE_PLANTS happy path needs a real Roboflow API key + plot
 * images already produced by SPLIT_ORTHOMOSAIC, both out of band for the
 * automated suite. But two slices of the page are testable today with
 * zero external dependencies:
 *
 *   1. API-key persistence — typing into the field + clicking Save updates
 *      `user_info.roboflow_api_key` via PATCH /api/users/me. Reload, and
 *      the field must re-hydrate from the user's `user_info`. (The page
 *      fetches /api/users/me via useAuth's currentUser query.)
 *
 *   2. Run-inference button gating — the button should be disabled until
 *      a model is registered AND a key is set AND a complete scope is
 *      picked AND plot images exist. We test the trivial side: with no
 *      model + no key + no scope, the button is disabled.
 *
 * Cleanup: the saved key is restored to its prior value at test end so the
 * suite is idempotent against repeated runs.
 */
import type { Response } from "@playwright/test"

import { expect, test } from "../helpers/fixtures"

function uniqueStamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

test.describe("Inference page: API key persistence + run-button gating", () => {
  test.setTimeout(60_000)

  test("save Roboflow key → reload → field rehydrates from user_info", async ({
    page,
    request,
  }) => {
    const stamp = uniqueStamp()
    const newKey = `pw-rf-${stamp}`

    await page.goto("/models/inference")
    await expect(
      page.getByRole("heading", { name: /run inference/i }),
    ).toBeVisible({ timeout: 15_000 })

    // Read the previous key value (so we can restore it at the end).
    // Wait until the page's `useEffect([user?.id])` has hydrated `apiKey`
    // from `user_info.roboflow_api_key` — without this, a race between
    // our fill() and the hydration can leave the field empty when we
    // click Save (the button is disabled when apiKey is empty).
    const keyField = page.getByTestId("inference-api-key")
    await expect(keyField).toBeVisible()
    // Brief settle so the hydration useEffect runs at least once.
    await page.waitForTimeout(250)
    const previousKey = await keyField.inputValue()

    // ── 1. Type the new key + click Save → assert real PATCH /api/users/me ─
    await keyField.fill(newKey)
    // Confirm React received the fill before we click — the Save button
    // is `disabled={!apiKey || isPending}` so without this assertion a
    // re-render race between fill and click can leave it disabled.
    await expect(keyField).toHaveValue(newKey)
    await expect(page.getByTestId("inference-save-key")).toBeEnabled()
    const patchWait = page.waitForResponse(
      (r: Response) =>
        /\/api\/users\/me$/.test(r.url()) && r.request().method() === "PATCH",
    )
    await page.getByTestId("inference-save-key").click()
    const patchResp = await patchWait
    expect(patchResp.ok(), `expected 2xx from /api/users/me PATCH`).toBe(true)

    // ── 2. Verify backend persistence via the SDK route directly. This
    //       cuts out the React layer so we know the key really lives in
    //       user_info, not in some local cache the page re-renders from. ──
    const token = await page.evaluate(() => localStorage.getItem("gemini.auth.token"))
    const meResp = await request.get("/api/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(meResp.ok()).toBe(true)
    const meBody = (await meResp.json()) as { user_info?: unknown }
    const info = (typeof meBody.user_info === "string"
      ? JSON.parse(meBody.user_info)
      : meBody.user_info) as { roboflow_api_key?: string } | null
    expect(info?.roboflow_api_key).toBe(newKey)

    // ── 3. Reload — the field must re-hydrate from the user's user_info.
    //       This is the assertion that catches a "save reaches the API but
    //       the page reads from local state on next visit" regression. ───
    await page.reload()
    await expect(
      page.getByRole("heading", { name: /run inference/i }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId("inference-api-key")).toHaveValue(newKey, {
      timeout: 10_000,
    })

    // ── 4. Cleanup — clear via the SDK directly. The Save button's
    //       disabled-when-empty rule rules out using the UI for a
    //       restore-to-empty path, and the previousKey may legitimately
    //       have been a value we want to preserve OR an empty string.
    //       The direct PATCH covers both cleanly. ────────────────────────
    const restoreInfo = { ...(info ?? {}), roboflow_api_key: previousKey || "" }
    const restoreResp = await request.patch("/api/users/me", {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_info: restoreInfo },
    })
    expect(restoreResp.ok()).toBe(true)
  })

  test("Run-inference button is disabled until model + key + scope + plot images", async ({
    page,
  }) => {
    await page.goto("/models/inference")
    await expect(
      page.getByRole("heading", { name: /run inference/i }),
    ).toBeVisible({ timeout: 15_000 })

    // Without a complete configuration, the button must be disabled. The
    // button is gated by `canRun` in the page (model + key + scope + plot
    // images) — we don't try to satisfy all four here; we just assert the
    // gate is wired (a button that's always-enabled would silently submit
    // bogus jobs).
    await expect(page.getByTestId("inference-run")).toBeDisabled()
  })
})
