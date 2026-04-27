/**
 * Phase 7 form-rigor: SplitOrthomosaicTool POSTs the right body.
 *
 * Pre-this-commit, no spec covered the SPLIT_ORTHOMOSAIC submit path
 * at all. The audit's bug-introduction matrix flagged "SPLIT submitted
 * with wrong scope path" and "boundaries empty / wrong shape" as
 * silently-shipping-green failures.
 *
 * This spec runs in seconds: seeds entities + an active plot-geometry
 * version + a Raw placeholder so the picker dropdowns populate, drives
 * the form to Submit, intercepts the request body, and asserts the
 * `boundaries` FeatureCollection actually has features and the path
 * components match.
 */
import type { Page } from "@playwright/test"

import { firstSuperuser, firstSuperuserPassword } from "../config"
import { expect, test } from "../helpers/fixtures"

test.describe("Pipeline: split orthomosaic", () => {
  test.setTimeout(60_000)

  test("Run split: submit body carries non-empty boundaries + correct scope", async ({
    page,
    request,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const experiment = `pw-sp-${stamp}`
    const date = "2026-04-27"
    const directory = `Processed/2026/${experiment}/Davis/Cowpea/${date}/Drone/RGB/`

    // Login + token.
    const loginRes = await request.post(
      new URL("/api/users/login/access-token", baseURL).toString(),
      {
        data: { email: firstSuperuser, password: firstSuperuserPassword },
        headers: { "Content-Type": "application/json" },
      },
    )
    const { access_token } = (await loginRes.json()) as { access_token: string }
    const authHeader = { Authorization: `Bearer ${access_token}` }

    // Seed entities.
    for (const [path, body] of [
      ["/api/experiments", { experiment_name: experiment }],
      ["/api/sites", { site_name: "Davis", experiment_name: experiment }],
      ["/api/populations", { population_name: "Cowpea", experiment_name: experiment }],
      ["/api/sensor_platforms", { sensor_platform_name: "Drone", experiment_name: experiment }],
      [
        "/api/sensors",
        { sensor_name: "RGB", experiment_name: experiment, sensor_platform_name: "Drone" },
      ],
    ] as const) {
      await request.post(new URL(path, baseURL).toString(), {
        headers: { ...authHeader, "Content-Type": "application/json" },
        data: body,
      })
    }
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

    // Raw placeholder so the picker discovers (date, Drone, RGB).
    await request.post(new URL("/api/files/upload_chunk", baseURL).toString(), {
      headers: authHeader,
      multipart: {
        file_chunk: { name: "p.part0", mimeType: "image/jpeg", buffer: Buffer.from("x") },
        chunk_index: "0",
        total_chunks: "1",
        file_identifier: `sp-seed-${stamp}`,
        object_name: `Raw/2026/${experiment}/Davis/Cowpea/${date}/Drone/RGB/Images/p.jpg`,
      },
    })

    // Seed an active plot-geometry version with one polygon.
    const seedFc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { plot: 1, accession: "test" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-121.7826, 38.5333],
                [-121.7825, 38.5333],
                [-121.7825, 38.5334],
                [-121.7826, 38.5334],
                [-121.7826, 38.5333],
              ],
            ],
          },
        },
      ],
    }
    await request.post(
      new URL("/api/plot_geometry/versions/save", baseURL).toString(),
      {
        headers: { ...authHeader, "Content-Type": "application/json" },
        data: {
          directory,
          name: "spec-seed",
          state_snapshot: { boundaries: seedFc, created_from: "import" },
        },
      },
    )

    // Drive the UI: switch to the test experiment, navigate, pick scope,
    // submit, intercept the body.
    await page.goto("/")
    await page.getByTestId("experiment-selector").click()
    await page.getByRole("option", { name: experiment }).click()
    await page.goto("/process/split")
    await expect(
      page.getByRole("heading", { name: /split orthomosaic/i }),
    ).toBeVisible({ timeout: 10_000 })

    await pickScope(page, date)

    const submitWait = page.waitForRequest(
      (r) =>
        /\/api\/jobs\/submit$/.test(r.url()) && r.method() === "POST",
    )
    await page.getByRole("button", { name: /^run split$/i }).click()
    const req = await submitWait
    const body = JSON.parse(req.postData() ?? "{}") as {
      job_type?: string
      parameters?: Record<string, unknown>
    }
    expect(body.job_type).toBe("SPLIT_ORTHOMOSAIC")
    expect(body.parameters?.year).toBe("2026")
    expect(body.parameters?.experiment).toBe(experiment)
    expect(body.parameters?.location).toBe("Davis")
    expect(body.parameters?.population).toBe("Cowpea")
    expect(body.parameters?.date).toBe(date)
    const boundaries = body.parameters?.boundaries as GeoJSON.FeatureCollection
    expect(boundaries?.type).toBe("FeatureCollection")
    expect(boundaries?.features?.length).toBeGreaterThan(0)
  })
})

async function pickScope(page: Page, date: string): Promise<void> {
  await page.getByTestId("aerial-date-select").click()
  await page.getByRole("option", { name: date }).click()
  await page.getByTestId("aerial-platform-select").click()
  await page.getByRole("option", { name: "Drone" }).click()
  await page.getByTestId("aerial-sensor-select").click()
  await page.getByRole("option", { name: "RGB" }).click()
}
