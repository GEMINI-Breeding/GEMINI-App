/**
 * Phase 8 strict-E2E: Models registry CRUD via the real /models page.
 *
 * Drives the new ModelsDashboard against the live GEMINIbase REST API,
 * proving backend persistence by reloading after every mutation. Each
 * mutating click is also paired with an explicit waitForResponse on the
 * matching /api/models/* call so a regression that swallows the network
 * layer (closes the dialog without dispatching, hits the wrong verb,
 * silently catches and toasts success, etc.) cannot pass.
 *
 * Coverage notes:
 *   - Every form field is exercised (name, Roboflow id, task_type Select,
 *     model_url, description). The earlier version of this spec relied on
 *     EMPTY_FORM defaults, which left the Select + URL field untested.
 *   - Promote-best is toggled on AND off (the on-only test would let a
 *     stuck-true bug pass).
 *   - Validation: empty-name save is rejected without a network call.
 *   - Delete-cancel restores the row.
 *   - Every assertion that the row's content reflects the new backend
 *     state happens AFTER page.reload(), so cached optimistic state
 *     can't paper over a backend write that didn't happen.
 */
import type { Response } from "@playwright/test"

import { expect, test } from "../helpers/fixtures"

function uniqueStamp(): string {
  // Date.now() can collide across rapid CI re-runs; mix in a short random
  // suffix so two parallel runs never see each other's row.
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

test.describe("Models registry CRUD", () => {
  test.setTimeout(120_000)

  test("full CRUD with persistence + every form field + both toggle directions", async ({
    page,
  }) => {
    const stamp = uniqueStamp()
    const initialName = `pw-model-${stamp}`
    const initialRoboflowId = `pw/test/${stamp}-initial`
    const renamedRoboflowId = `pw/test/${stamp}-renamed`
    const initialUrl = `https://detect.roboflow.com/pw/${stamp}`
    const initialDescription = `Phase 8 spec ${stamp}`

    await page.goto("/models")
    await expect(
      page.getByRole("heading", { name: /^models$/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })

    // ── 1. Validation: empty-name save is rejected with no API call ─────────
    await page.getByTestId("model-add").click()
    await expect(page.getByRole("dialog")).toBeVisible()

    let sawCreateCall = false
    const onValidation = (resp: Response) => {
      if (/\/api\/models(\?|$)/.test(resp.url()) && resp.request().method() === "POST") {
        sawCreateCall = true
      }
    }
    page.on("response", onValidation)
    await page.getByTestId("model-add-save").click()
    // Brief wait — if a request were going to fly, it would by now.
    await page.waitForTimeout(500)
    page.off("response", onValidation)
    expect(sawCreateCall, "empty-name save must not POST /api/models").toBe(false)
    await expect(page.getByRole("dialog")).toBeVisible()

    // ── 2. Add — every field exercised, network call observed ───────────────
    await page.getByTestId("model-field-name").fill(initialName)
    await page.getByTestId("model-field-roboflow-id").fill(initialRoboflowId)
    await page.getByTestId("model-field-url").fill(initialUrl)
    await page.getByTestId("model-field-description").fill(initialDescription)

    // task_type is a Radix Select — open it, pick a non-default option, and
    // verify the trigger reflects the change. Using a non-default value
    // proves the value actually round-tripped.
    await page.getByTestId("model-field-task-type").click()
    await page.getByRole("option", { name: "instance-segmentation" }).click()
    await expect(page.getByTestId("model-field-task-type")).toContainText(
      "instance-segmentation",
    )

    await waitForApi(
      page,
      () => page.getByTestId("model-add-save").click(),
      (r) => /\/api\/models(\?|$)/.test(r.url()) && r.request().method() === "POST",
    )

    // Reload from a clean cache before asserting any field content.
    await page.reload()
    const persistedRow = page.locator('[data-testid="model-row"]', { hasText: initialName })
    await expect(persistedRow).toBeVisible({ timeout: 15_000 })
    await expect(persistedRow).toContainText(initialRoboflowId)
    await expect(persistedRow).toContainText("instance-segmentation")
    await expect(persistedRow).toContainText(initialUrl)

    // ── 3. Promote best — toggle ON, reload, verify badge survives ──────────
    await waitForApi(
      page,
      () => persistedRow.getByTestId("model-promote").click(),
      (r) => /\/api\/models\/id\//.test(r.url()) && r.request().method() === "PATCH",
    )
    await page.reload()
    const rowAfterPromote = page.locator('[data-testid="model-row"]', {
      hasText: initialName,
    })
    await expect(rowAfterPromote.locator("text=best")).toBeVisible({ timeout: 10_000 })

    // ── 4. Promote best — toggle OFF, reload, verify badge gone ─────────────
    await waitForApi(
      page,
      () => rowAfterPromote.getByTestId("model-promote").click(),
      (r) => /\/api\/models\/id\//.test(r.url()) && r.request().method() === "PATCH",
    )
    await page.reload()
    const rowAfterUnpromote = page.locator('[data-testid="model-row"]', {
      hasText: initialName,
    })
    await expect(rowAfterUnpromote.locator("text=best")).toHaveCount(0, {
      timeout: 10_000,
    })

    // ── 5. Edit — change Roboflow id + task_type, reload, verify backend ───
    await rowAfterUnpromote.getByTestId("model-edit").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByTestId("model-field-roboflow-id").fill(renamedRoboflowId)
    await page.getByTestId("model-field-task-type").click()
    await page.getByRole("option", { name: "classification" }).click()
    await waitForApi(
      page,
      () => page.getByTestId("model-edit-save").click(),
      (r) => /\/api\/models\/id\//.test(r.url()) && r.request().method() === "PATCH",
    )

    await page.reload()
    const rowAfterEdit = page.locator('[data-testid="model-row"]', { hasText: initialName })
    await expect(rowAfterEdit).toContainText(renamedRoboflowId)
    await expect(rowAfterEdit).toContainText("classification")
    await expect(rowAfterEdit).not.toContainText(initialRoboflowId)

    // ── 6. Delete — cancel first, row stays; then real delete + reload ─────
    await rowAfterEdit.getByTestId("model-delete").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: /^cancel$/i }).click()
    await expect(rowAfterEdit).toBeVisible()

    await rowAfterEdit.getByTestId("model-delete").click()
    await waitForApi(
      page,
      () => page.getByTestId("model-delete-confirm").click(),
      (r) => /\/api\/models\/id\//.test(r.url()) && r.request().method() === "DELETE",
    )

    await page.reload()
    await expect(
      page.locator('[data-testid="model-row"]', { hasText: initialName }),
    ).toHaveCount(0, { timeout: 10_000 })
  })
})
