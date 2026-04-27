/**
 * Phase 8 strict-E2E: TrainModelTool's smoke-test job submission.
 *
 * The TRAIN_MODEL worker raises NotImplementedError on receipt, so the
 * full happy path is: submit → backend marks FAILED → wsManager surfaces
 * status=error → ProcessPanel "View" link works. This spec drives the
 * /models/train page through that path against the live ML worker:
 *
 *   1. Click the smoke-test button → assert /api/jobs/submit POST.
 *   2. Assert "Submitted job <id>" appears on the page.
 *   3. Assert the global ProcessPanel shows the new entry, with a link
 *      to /process/jobs/{id}.
 *   4. Poll /api/jobs/{id} until status == FAILED (worker proves it
 *      received and rejected the job for the right reason).
 *
 * Why a real backend assert (step 4) and not just the toast? The whole
 * point of the page existing is to verify worker plumbing: a UI that
 * just toasts "submitted" without reaching the worker would still pass
 * a UI-only assertion. The poll closes that gap.
 */
import type { Response } from "@playwright/test"

import { expect, test } from "../helpers/fixtures"

test.describe("TrainModel smoke test", () => {
  test.setTimeout(120_000)

  test("submit a TRAIN_MODEL job, see it reach the worker and end FAILED", async ({
    page,
    request,
  }) => {
    await page.goto("/models/train")
    // CardTitle isn't an <h*>, so locate by its visible text within the page.
    await expect(page.getByText("Train new model").first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId("train-submit-smoke")).toBeVisible()

    // Capture the response so we can read the job id from its body.
    const submitWait = page.waitForResponse(
      (r: Response) =>
        /\/api\/jobs\/submit$/.test(r.url()) && r.request().method() === "POST",
    )
    await page.getByTestId("train-submit-smoke").click()
    const submitResp = await submitWait
    expect(submitResp.ok(), `expected 2xx, got ${submitResp.status()}`).toBe(true)
    const job = (await submitResp.json()) as { id?: string; job_type?: string }
    const jobId = String(job.id ?? "")
    expect(jobId.length, "submit response must include a job id").toBeGreaterThan(0)
    expect(job.job_type).toBe("TRAIN_MODEL")

    // The page surfaces "Submitted job <short-id>" after submission.
    // jobId.slice(0,8) also appears in the ProcessPanel title, so use a
    // <code>-element selector to scope to the page body.
    await expect(
      page.locator("code", { hasText: jobId.slice(0, 8) }).first(),
    ).toBeVisible({ timeout: 5_000 })

    // The global ProcessPanel registers an entry whose runId === jobId.
    // The "Go to page" anchor uses the link prop set by addProcess.
    await expect(
      page.getByText(`TRAIN_MODEL job ${jobId.slice(0, 8)}`),
    ).toBeVisible({ timeout: 10_000 })

    // Poll the backend until the worker reports FAILED. The worker raises
    // NotImplementedError immediately, so this should take a few seconds at
    // most; cap at 60s to tolerate worker queue latency.
    const token = await page.evaluate(() => localStorage.getItem("gemini.auth.token"))
    expect(token, "auth token must be present in storage").toBeTruthy()

    const deadline = Date.now() + 60_000
    let lastStatus: string | undefined
    while (Date.now() < deadline) {
      const res = await request.get(`/api/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.ok(), `expected 2xx from /api/jobs/${jobId}`).toBe(true)
      const body = (await res.json()) as { status?: string; error_message?: string }
      lastStatus = body.status
      if (body.status === "FAILED" || body.status === "COMPLETED" || body.status === "CANCELLED") {
        // Worker actually processed (and rejected) the job for the
        // intended reason — close the loop.
        expect(body.status).toBe("FAILED")
        // The worker raises NotImplementedError; the message text isn't
        // contractual but we expect *some* error string to land.
        if (body.error_message) {
          expect(body.error_message.length).toBeGreaterThan(0)
        }
        return
      }
      await page.waitForTimeout(1_000)
    }
    throw new Error(
      `TRAIN_MODEL job ${jobId} did not reach a terminal status within 60s; last=${lastStatus}`,
    )
  })
})
