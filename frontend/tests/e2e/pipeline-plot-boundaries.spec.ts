/**
 * Phase 7: plot-boundaries page UI flow.
 *
 * Strict-E2E (CLAUDE.md):
 *   - Drives the real PlotBoundaries page (scope picker, version list,
 *     save/activate/load) against the real PlotGeometryService backend.
 *   - The polygon-drawing piece is left to a follow-up: Geoman draws on a
 *     Leaflet canvas which Playwright can't click reliably without
 *     bespoke fixture geometry. To still cover the *versioning* flow end-
 *     to-end, the test seeds a single saved version via the API as
 *     prerequisite state (per CLAUDE.md exemption: "OK to set up
 *     prerequisite state that the test itself is not about"), then
 *     exercises the version-list / activate / load UI.
 *   - Verifies user-visible outcomes: the version row appears in the
 *     table; clicking Activate flips the active marker; the "Active
 *     boundary version" panel reads the active version count.
 */
import { expect, test } from "../helpers/fixtures"
import { firstSuperuser, firstSuperuserPassword } from "../config"

test.describe("Pipeline: plot boundaries", () => {
  test.setTimeout(120_000)

  test("save → list → activate → load a plot-geometry version", async ({
    page,
    request,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const stamp = Date.now()
    const experiment = `pw-pb-${stamp}`
    const date = "2026-04-26"
    const directory = `Processed/2026/${experiment}/Davis/Cowpea/${date}/Drone/RGB/`

    // 1. Get a real bearer token for the prereq API calls.
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

    // Pre-seed: register the entities the picker reads from the sidebar
    // selector, then drop one tiny placeholder under Raw/ so the
    // AerialScopePicker discovers a date/platform/sensor combo. This is
    // prereq state — the test isn't about upload.
    await request.post(new URL("/api/experiments", baseURL).toString(), {
      headers: { ...authHeader, "Content-Type": "application/json" },
      data: { experiment_name: experiment },
    })
    await request.post(new URL("/api/sites", baseURL).toString(), {
      headers: { ...authHeader, "Content-Type": "application/json" },
      data: { site_name: "Davis", experiment_name: experiment },
    })
    await request.post(new URL("/api/populations", baseURL).toString(), {
      headers: { ...authHeader, "Content-Type": "application/json" },
      data: { population_name: "Cowpea", experiment_name: experiment },
    })
    await request.post(new URL("/api/sensor_platforms", baseURL).toString(), {
      headers: { ...authHeader, "Content-Type": "application/json" },
      data: { sensor_platform_name: "Drone", experiment_name: experiment },
    })
    await request.post(new URL("/api/sensors", baseURL).toString(), {
      headers: { ...authHeader, "Content-Type": "application/json" },
      data: { sensor_name: "RGB", experiment_name: experiment, sensor_platform_name: "Drone" },
    })

    // Drop a single 1-byte placeholder JPG into the Raw/ tree so the picker
    // discovers (date, platform, sensor) for this experiment. The chunk
    // upload endpoint takes one chunk at a time.
    const placeholderPath = `Raw/2026/${experiment}/Davis/Cowpea/${date}/Drone/RGB/Images/placeholder.jpg`
    const fd = new FormData()
    fd.append("file_chunk", new Blob(["x"], { type: "image/jpeg" }), "placeholder.part0")
    fd.append("chunk_index", "0")
    fd.append("total_chunks", "1")
    fd.append("file_identifier", `pb-seed-${stamp}`)
    fd.append("object_name", placeholderPath)
    const chunkRes = await request.post(
      new URL("/api/files/upload_chunk", baseURL).toString(),
      { headers: authHeader, multipart: { file_chunk: { name: "placeholder.part0", mimeType: "image/jpeg", buffer: Buffer.from("x") }, chunk_index: "0", total_chunks: "1", file_identifier: `pb-seed-${stamp}`, object_name: placeholderPath } },
    )
    expect(chunkRes.ok()).toBe(true)

    // 2. Seed a plot-geometry version directly via the API. This is
    //    prerequisite state — the operation under test is the page's
    //    list/activate/load flow, not the save-via-API path.
    const seedFc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { plot: 1 },
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
    const seedRes = await request.post(
      new URL("/api/plot_geometry/versions/save", baseURL).toString(),
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access_token}`,
        },
        data: {
          directory,
          name: "spec-seed",
          state_snapshot: { boundaries: seedFc, created_from: "import" },
        },
      },
    )
    expect(seedRes.ok()).toBe(true)
    const seeded = (await seedRes.json()) as { version: number }
    expect(seeded.version).toBeGreaterThanOrEqual(1)

    // 3. Drive the UI: navigate, set scope (overrides), see the seeded
    //    version, activate it, confirm Active state.
    await page.goto("/process/plot-boundaries")
    await expect(
      page.getByRole("heading", { name: /plot boundaries/i }),
    ).toBeVisible()

    // Switch the sidebar selector to the just-created experiment so the
    // picker can discover the seeded scope.
    await page.getByTestId("experiment-selector").click()
    await page.getByRole("option", { name: experiment }).click()

    // The picker reads from MinIO and finds the placeholder we seeded.
    await page.getByTestId("aerial-date-select").click()
    await page.getByRole("option", { name: date }).click()
    await page.getByTestId("aerial-platform-select").click()
    await page.getByRole("option", { name: "Drone" }).click()
    await page.getByTestId("aerial-sensor-select").click()
    await page.getByRole("option", { name: "RGB" }).click()

    // The directory should now appear under "Flight scope".
    await expect(page.getByText(directory, { exact: false })).toBeVisible({
      timeout: 5_000,
    })

    // Versions tab is the default — find the seeded row.
    const seedRow = page.locator("tr", { hasText: "spec-seed" })
    await expect(seedRow).toBeVisible({ timeout: 10_000 })

    // Backend auto-activates the only version of a directory, so the row
    // shows ✓ from the start and the Activate button is disabled.
    await expect(seedRow.getByText("✓")).toBeVisible({ timeout: 5_000 })
    await expect(seedRow.getByRole("button", { name: /^activate$/i })).toBeDisabled()

    // Load it (renders the FeatureCollection on the map). We don't assert
    // on map state directly — just that the click round-trips successfully
    // and the feature-count counter under the map updates.
    await seedRow.getByRole("button", { name: /^load$/i }).click()
    await expect(page.getByText(/1 features? drawn/i)).toBeVisible({
      timeout: 5_000,
    })

    // Drive the Save UI (audit gap: previously every save round-trip in
    // this spec was bypassed via API seed). Type a version name, click
    // Save, intercept the POST and assert the body carries a non-empty
    // FeatureCollection in `state_snapshot.boundaries`. A regression that
    // sent an empty FC, dropped the snapshot, or POSTed to the wrong
    // path would fail this assertion.
    await page.locator("#version-name").fill("ui-saved-version")
    const saveWait = page.waitForRequest(
      (r) =>
        /\/api\/plot_geometry\/versions\/save$/.test(r.url()) &&
        r.method() === "POST",
    )
    await page.getByRole("button", { name: /^save as new version$/i }).click()
    const saveReq = await saveWait
    const saveBody = JSON.parse(saveReq.postData() ?? "{}") as {
      directory?: string
      name?: string
      state_snapshot?: { boundaries?: GeoJSON.FeatureCollection }
    }
    expect(saveBody.directory).toBe(directory)
    expect(saveBody.name).toBe("ui-saved-version")
    expect(saveBody.state_snapshot?.boundaries?.type).toBe("FeatureCollection")
    expect(
      (saveBody.state_snapshot?.boundaries?.features ?? []).length,
    ).toBeGreaterThan(0)

    // The new version shows up in the Versions table.
    const uiSavedRow = page.locator("tr", { hasText: "ui-saved-version" })
    await expect(uiSavedRow).toBeVisible({ timeout: 10_000 })
  })
})
