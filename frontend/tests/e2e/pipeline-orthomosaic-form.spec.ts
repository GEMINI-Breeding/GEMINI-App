/**
 * Phase 7 form-rigor: OrthomosaicTool form fields ACTUALLY reach the
 * backend with the values the user typed.
 *
 * The pre-existing pipeline-orthomosaic spec runs RUN_ODM end-to-end
 * for ~3 min but never touches the form's two most error-prone inputs:
 *   - Reconstruction quality dropdown
 *   - Custom NodeODM options textbox
 * Both shipped silently broken for weeks (quality ignored entirely;
 * custom_options ignored unless quality=="Custom"). An audit caught
 * 8/8 plausible bugs would still ship green.
 *
 * This spec runs in seconds, no ODM, no real worker — it just drives
 * the form, intercepts the POST /api/jobs/submit body, and asserts the
 * field values land verbatim under `parameters`. If a future regression
 * silently drops a field, this fails immediately.
 */
import type { Page, Response } from "@playwright/test"

import { firstSuperuser, firstSuperuserPassword } from "../config"
import { expect, test } from "../helpers/fixtures"

interface SeedHandles {
  authHeader: { Authorization: string }
  experiment: string
  date: string
}

/**
 * Pre-seed: register the entities the picker reads from the sidebar
 * selectors and drop one placeholder JPG so the AerialScopePicker
 * discovers a (date, platform, sensor) combo. This is prereq state —
 * the test isn't about upload. Returns handles the spec uses to drive
 * the rest of the flow.
 */
async function seedScope(
  request: import("@playwright/test").APIRequestContext,
  baseURL: string,
  stamp: string,
): Promise<SeedHandles> {
  const experiment = `pw-of-${stamp}`
  const date = "2026-04-27"

  const loginRes = await request.post(
    new URL("/api/users/login/access-token", baseURL).toString(),
    {
      data: { email: firstSuperuser, password: firstSuperuserPassword },
      headers: { "Content-Type": "application/json" },
    },
  )
  expect(loginRes.ok()).toBe(true)
  const { access_token } = (await loginRes.json()) as { access_token: string }
  const authHeader = { Authorization: `Bearer ${access_token}` }

  for (const [path, body] of [
    ["/api/experiments", { experiment_name: experiment }],
    ["/api/sites", { site_name: "Davis", experiment_name: experiment }],
    ["/api/populations", { population_name: "Cowpea", experiment_name: experiment }],
    ["/api/sensor_platforms", { sensor_platform_name: "Drone", experiment_name: experiment }],
    [
      "/api/sensors",
      {
        sensor_name: "RGB",
        experiment_name: experiment,
        sensor_platform_name: "Drone",
      },
    ],
  ] as const) {
    await request.post(new URL(path, baseURL).toString(), {
      headers: { ...authHeader, "Content-Type": "application/json" },
      data: body,
    })
  }

  // Associate the just-created experiment with the admin user so the
  // sidebar selector lists it.
  const meRes = await request.get(new URL("/api/users/me", baseURL).toString(), {
    headers: authHeader,
  })
  const me = (await meRes.json()) as { id: string }
  const expRows = (await (
    await request.get(
      new URL(
        `/api/experiments?experiment_name=${encodeURIComponent(experiment)}`,
        baseURL,
      ).toString(),
      { headers: authHeader },
    )
  ).json()) as Array<{ id: string }>
  const expId = expRows[0]?.id ?? ""
  await request.post(new URL("/api/users/me/experiments", baseURL).toString(), {
    headers: { ...authHeader, "Content-Type": "application/json" },
    data: { experiment_id: expId },
  })
  void me

  // Placeholder JPG so the AerialScopePicker discovers (date, Drone, RGB).
  await request.post(
    new URL("/api/files/upload_chunk", baseURL).toString(),
    {
      headers: authHeader,
      multipart: {
        file_chunk: {
          name: "placeholder.part0",
          mimeType: "image/jpeg",
          buffer: Buffer.from("x"),
        },
        chunk_index: "0",
        total_chunks: "1",
        file_identifier: `of-seed-${stamp}`,
        object_name: `Raw/2026/${experiment}/Davis/Cowpea/${date}/Drone/RGB/Images/placeholder.jpg`,
      },
    },
  )

  return { authHeader, experiment, date }
}

async function pickAerialScope(page: Page, date: string): Promise<void> {
  await page.getByTestId("aerial-date-select").click()
  await page.getByRole("option", { name: date }).click()
  await page.getByTestId("aerial-platform-select").click()
  await page.getByRole("option", { name: "Drone" }).click()
  await page.getByTestId("aerial-sensor-select").click()
  await page.getByRole("option", { name: "RGB" }).click()
}

async function selectExperimentInSidebar(page: Page, experiment: string): Promise<void> {
  await page.getByTestId("experiment-selector").click()
  await page.getByRole("option", { name: experiment }).click()
}

test.describe("Pipeline: orthomosaic form fields reach the worker", () => {
  test.setTimeout(120_000)

  test("Custom quality + custom_options: every typed value lands in the submit body", async ({
    page,
    request,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const { experiment, date } = await seedScope(request, baseURL, stamp)
    const customFlags = "--fast-orthophoto --skip-3dmodel"

    await page.goto("/")
    await selectExperimentInSidebar(page, experiment)
    await page.goto("/process/orthomosaic")
    await expect(
      page.getByRole("heading", { name: /orthomosaic \(run_odm\)/i }),
    ).toBeVisible({ timeout: 10_000 })

    // Pick scope (date/platform/sensor populated by the seeded JPG).
    await pickAerialScope(page, date)

    // Switch quality to Custom — the textbox should appear.
    await page.getByTestId("ortho-quality").click()
    await page.getByRole("option", { name: "Custom" }).click()
    const customInput = page.getByTestId("ortho-custom-options")
    await expect(customInput).toBeVisible()
    await customInput.fill(customFlags)

    // Submit; intercept the POST body and assert every field landed.
    const submitWait = page.waitForRequest(
      (r) =>
        /\/api\/jobs\/submit$/.test(r.url()) && r.method() === "POST",
    )
    await page.getByRole("button", { name: /run orthomosaic/i }).click()
    const req = await submitWait
    const body = JSON.parse(req.postData() ?? "{}") as {
      job_type?: string
      parameters?: Record<string, unknown>
    }
    expect(body.job_type).toBe("RUN_ODM")
    expect(body.parameters?.reconstruction_quality).toBe("Custom")
    expect(body.parameters?.custom_options).toBe(customFlags)
    expect(body.parameters?.date).toBe(date)
    expect(body.parameters?.platform).toBe("Drone")
    expect(body.parameters?.sensor).toBe("RGB")
    expect(body.parameters?.experiment).toBe(experiment)
  })

  test("Ultra preset: dropdown value reaches the worker (preset application is unit-tested separately)", async ({
    page,
    request,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const { experiment, date } = await seedScope(request, baseURL, stamp)

    await page.goto("/")
    await selectExperimentInSidebar(page, experiment)
    await page.goto("/process/orthomosaic")
    await expect(
      page.getByRole("heading", { name: /orthomosaic \(run_odm\)/i }),
    ).toBeVisible({ timeout: 10_000 })
    await pickAerialScope(page, date)

    await page.getByTestId("ortho-quality").click()
    await page.getByRole("option", { name: "Ultra" }).click()
    // Hint copy mentions "ultra" — verifies the dropdown actually
    // wired its value through to the description below.
    await expect(page.getByTestId("ortho-quality-hint")).toContainText(/ultra/i)
    // Custom textbox stays hidden for non-Custom selections.
    await expect(page.getByTestId("ortho-custom-options")).toHaveCount(0)

    const submitWait = page.waitForRequest(
      (r) =>
        /\/api\/jobs\/submit$/.test(r.url()) && r.method() === "POST",
    )
    await page.getByRole("button", { name: /run orthomosaic/i }).click()
    const req = await submitWait
    const body = JSON.parse(req.postData() ?? "{}") as {
      parameters?: Record<string, unknown>
    }
    expect(body.parameters?.reconstruction_quality).toBe("Ultra")
    // No custom_options key when textbox isn't shown.
    expect(body.parameters?.custom_options).toBeUndefined()
  })

  test("Cancel after submit: a real POST to /cancel fires", async ({
    page,
    request,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const { experiment, date } = await seedScope(request, baseURL, stamp)

    await page.goto("/")
    await selectExperimentInSidebar(page, experiment)
    await page.goto("/process/orthomosaic")
    await expect(
      page.getByRole("heading", { name: /orthomosaic \(run_odm\)/i }),
    ).toBeVisible({ timeout: 10_000 })
    await pickAerialScope(page, date)

    // Use Lowest quality — the worker will burn time matching the
    // placeholder JPG against itself before failing, plenty of window
    // to cancel from the UI.
    await page.getByTestId("ortho-quality").click()
    await page.getByRole("option", { name: "Lowest" }).click()

    // Submit, capture the resulting job id.
    const submitWait = page.waitForResponse(
      (r: Response) =>
        /\/api\/jobs\/submit$/.test(r.url()) && r.request().method() === "POST",
    )
    await page.getByRole("button", { name: /run orthomosaic/i }).click()
    const submitResp = await submitWait
    expect(submitResp.ok()).toBe(true)
    const job = (await submitResp.json()) as { id?: string }
    const jobId = String(job.id ?? "")
    expect(jobId.length).toBeGreaterThan(0)

    // Navigate to the JobDetail page where the Cancel button lives,
    // then click it. Asserts a POST /api/jobs/{id}/cancel actually
    // fires — the bug we want to catch is "UI flips state but no
    // API call".
    await page.goto(`/process/jobs/${jobId}`)
    const cancelWait = page.waitForResponse(
      (r: Response) =>
        new RegExp(`/api/jobs/${jobId}/cancel$`).test(r.url()) &&
        r.request().method() === "POST",
    )
    await page.getByRole("button", { name: /^cancel job$/i }).click()
    const cancelResp = await cancelWait
    expect(cancelResp.ok()).toBe(true)
  })
})
