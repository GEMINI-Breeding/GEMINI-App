/**
 * Phase R4a smoke: aerial wizard end-to-end against the real ODM worker.
 *
 * Drives the restored Workspace → Pipeline → Run → Steps wizard:
 *   1. Upload 5 drone images via the Files UI.
 *   2. Create a workspace bound to a real experiment.
 *   3. Walk the 3-step pipeline wizard (name → quality → roboflow=skip).
 *   4. Create a Run, pick its date/platform/sensor in the Run Setup card.
 *   5. Run the data_sync step → assert step row flips to "completed".
 *   6. Run the orthomosaic step → assert step row goes "running" → terminal.
 *   7. Verify the bug fixes from manual testing on 2026-04-28:
 *        a. Progress log timestamps differ across entries (bug 1).
 *        b. Step row's status flips off "running" once the WS terminal
 *           frame arrives — the StepRow's data-status flips and the
 *           action button label changes from "Running…" to "Re-run"
 *           (bug 2).
 *
 * Strict-E2E (CLAUDE.md):
 *   - Real upload, real RUN_ODM submission, real wsManager subscription.
 *   - Asserts user-visible outcome (StepRow status flip, log timestamps).
 *   - Console-error guard auto-attached via tests/helpers/fixtures.
 *
 * Cost: ~3-5 min in steady state (most of it is ODM compute).
 */
import { firstSuperuser, firstSuperuserPassword } from "../config"
import { fixturePath } from "../helpers/fixturePath"
import { expect, test } from "../helpers/fixtures"
import {
  dropFiles,
  fillUploadForm,
  navigateToUpload,
  selectDataType,
  submitUploadAndWait,
} from "../helpers/uploadHelpers"

const ODM_TIMEOUT_MS = 15 * 60_000

const DRONE_IMAGES = [
  "2022-06-27_100MEDIA_DJI_0876.JPG",
  "2022-06-27_100MEDIA_DJI_0877.JPG",
  "2022-06-27_100MEDIA_DJI_0878.JPG",
  "2022-06-27_100MEDIA_DJI_0879.JPG",
  "2022-06-27_100MEDIA_DJI_0880.JPG",
]

// ODM is the heaviest job in the suite — NodeODM + worker-odm consume
// several GB and stitching 5 drone images takes 5-10 minutes even on
// fast hardware. GitHub's free runners (2 vCPU / 7 GB) blow past the
// 15-minute timeout consistently. Gate the test on RUN_HEAVY_E2E=1
// so it still runs locally (where the user has the full stack up
// with the ODM workers) but doesn't pin CI red. The CI compose-up
// step doesn't even bring up nodeodm + worker-odm.
const HEAVY_E2E = process.env.RUN_HEAVY_E2E === "1"

test.describe("R4a: aerial wizard happy path", () => {
  test.setTimeout(ODM_TIMEOUT_MS + 3 * 60_000)
  test.skip(!HEAVY_E2E, "Set RUN_HEAVY_E2E=1 to run the ODM-bound spec")

  test("upload → workspace → pipeline → run → orthomosaic → step settles", async ({
    page,
    request,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")

    const stamp = Date.now()
    const experiment = `pw-r4a-${stamp}`
    const location = "Davis"
    const population = "Cowpea"
    const date = "2022-06-27"
    const platform = "DJI"
    const sensor = "FC6310S"
    const workspaceName = `R4a Workspace ${stamp}`
    const pipelineName = `R4a Aerial ${stamp}`

    // ── 1. Upload 5 drone images via the Files UI. ───────────────────────
    await navigateToUpload(page)
    await selectDataType(page, "Image Data")
    await fillUploadForm(page, {
      experiment,
      location,
      population,
      date,
      platform,
      sensor,
    })
    await dropFiles(
      page,
      DRONE_IMAGES.map((n) => fixturePath("images", "drone", n)),
    )
    await submitUploadAndWait(page, DRONE_IMAGES.length)

    // ── 2. Create a workspace tied to the just-created experiment. ───────
    await page.goto("/process")
    await expect(
      page.getByRole("heading", { name: /^process$/i }),
    ).toBeVisible()
    await page.locator('[data-onboarding="process-new-workspace"]').click()
    await page.getByLabel(/workspace name/i).fill(workspaceName)
    await page.getByRole("combobox", { name: /experiment/i }).click()
    await page.getByRole("option", { name: experiment }).click()
    await page.getByRole("button", { name: /create workspace/i }).click()

    // The new card is identifiable by its name; click into the workspace.
    const card = page.getByText(workspaceName, { exact: true })
    await expect(card).toBeVisible()
    await card.click()

    // ── 3. Walk the 3-step pipeline wizard (Aerial). ─────────────────────
    await expect(
      page.getByRole("heading", { name: workspaceName }),
    ).toBeVisible()
    await page.getByRole("button", { name: /create aerial pipeline/i }).click()

    // Step 1: name
    await page.getByLabel(/pipeline name/i).fill(pipelineName)
    await page.getByRole("button", { name: /^next$/i }).click()

    // Step 2: default quality (leave on Default), then Next
    await expect(
      page.getByText(/default reconstruction quality/i),
    ).toBeVisible()
    await page.getByRole("button", { name: /^next$/i }).click()

    // Step 3: leave Roboflow empty, click Create Pipeline
    await page.getByRole("button", { name: /create pipeline/i }).click()

    // ── 4. Create a Run from the pipeline card. ──────────────────────────
    await expect(
      page.getByRole("heading", { name: workspaceName }),
    ).toBeVisible()
    await page
      .getByRole("button", { name: /new run/i })
      .first()
      .click()

    // Lands on RunDetail. Pick the run's date/platform/sensor in the
    // Run Setup card. The picker auto-selects the workspace's experiment
    // because the workspace's defaultScope.experimentId was seeded from
    // the create dialog.
    await expect(
      page.getByText(/run setup/i, { exact: false }).first(),
    ).toBeVisible()
    await page.getByTestId("aerial-date-select").click()
    await page.getByRole("option", { name: date }).click()
    await page.getByTestId("aerial-platform-select").click()
    await page.getByRole("option", { name: platform }).click()
    await page.getByTestId("aerial-sensor-select").click()
    await page.getByRole("option", { name: sensor }).click()

    await expect(
      page.getByText(new RegExp(`${DRONE_IMAGES.length} images? found`)),
    ).toBeVisible({ timeout: 30_000 })

    // ── 5. Run data_sync. Should flip to completed near-instantly. ───────
    const dataSyncRow = page.getByTestId("step-row-data_sync")
    await expect(dataSyncRow).toHaveAttribute("data-status", "ready")
    await dataSyncRow.getByRole("button", { name: /run step/i }).click()
    await expect(dataSyncRow).toHaveAttribute("data-status", "completed", {
      timeout: 5_000,
    })

    // ── 6. Submit orthomosaic and wait through the wsManager terminal. ───
    const orthoRow = page.getByTestId("step-row-orthomosaic")
    // gcp_selection is optional, so orthomosaic must be "ready" once
    // data_sync is completed.
    await expect(orthoRow).toHaveAttribute("data-status", "ready", {
      timeout: 5_000,
    })
    const orthoRunBtn = orthoRow.getByRole("button", { name: /run step/i })
    await orthoRunBtn.click()

    // Status flips to "running" almost immediately (RUN_ODM submission
    // returns a job id, runApi.appendStepJobId flips status, the
    // useEffect picks up the new running step and subscribes to WS).
    await expect(orthoRow).toHaveAttribute("data-status", "running", {
      timeout: 30_000,
    })

    // Bottom ProcessPanel registers the orthomosaic process.
    await expect(
      page.locator(`text=orthomosaic — ${pipelineName}`).first(),
    ).toBeVisible({ timeout: 30_000 })

    // ── 7. Wait for terminal — bug 2 reproduction surface. ──────────────
    // The pre-fix bug left data-status="running" forever even after the
    // WS reported COMPLETED. The expectation below would have failed
    // until setStepState was wired into the terminal-event branch.
    await expect(orthoRow).toHaveAttribute("data-status", "completed", {
      timeout: ODM_TIMEOUT_MS,
    })

    // Action button label flips from "Running…" to "Re-run" on the
    // completed step (and is no longer disabled).
    const reRunBtn = orthoRow.getByRole("button", { name: /^re-run$/i })
    await expect(reRunBtn).toBeVisible()
    await expect(reRunBtn).toBeEnabled()

    // ── R4b assertion: OrthoVersionsPanel renders with v1 row. ──────────
    // Sanity-check that the version table appears under the completed
    // step and lists the just-produced ortho. The synthesized v1 entry
    // exists because RUN_ODM landed an `odm_orthophoto.tif` even before
    // we saved any rename metadata.
    const orthoPanel = orthoRow.getByTestId("ortho-versions-panel")
    await expect(orthoPanel).toBeVisible({ timeout: 30_000 })
    await expect(orthoPanel.getByTestId("ortho-version-row-1")).toBeVisible({
      timeout: 30_000,
    })

    // ── R4c assertion: trait_extraction step row is gated by boundaries. ─
    // plot_boundary_prep is a non-optional prereq, so trait_extraction's
    // row stays in "locked" status with a disabled Run Step button until
    // the user completes plot_boundary_prep.
    const traitRow = page.getByTestId("step-row-trait_extraction")
    await expect(traitRow).toHaveAttribute("data-status", "locked")
    await expect(
      traitRow.getByRole("button", { name: /run step/i }),
    ).toBeDisabled()

    // ── 7a. Bug 1 reproduction surface: log timestamps must differ. ─────
    // Expand the completed log via the chevron toggle (only present on
    // completed rows in the StepRow). The progress log entries each
    // carry data-timestamp set at WS arrival time; if all entries share
    // a timestamp the bug is back.
    //
    // Done BEFORE the R5a tool-route assertion below because Open Tool
    // navigates the page; orthoRow is only resolvable on the run page.
    await orthoRow.getByRole("button", { name: /expand details/i }).click()
    const logEntries = orthoRow.getByTestId("progress-log-entry")
    const entryCount = await logEntries.count()
    expect(entryCount).toBeGreaterThan(1)
    const timestamps = new Set<string>()
    for (let i = 0; i < entryCount; i++) {
      const ts = await logEntries.nth(i).getAttribute("data-timestamp")
      if (ts) timestamps.add(ts)
    }
    // ODM emits progress over many seconds; expect more than one distinct
    // arrival timestamp. Tolerant assertion: even if some chunks arrive
    // in the same millisecond, the start frame is synthesized at
    // subscribe time and any later progress frame must differ.
    expect(
      timestamps.size,
      `progress log timestamps should differ across entries; got ${timestamps.size} distinct values from ${entryCount} entries`,
    ).toBeGreaterThan(1)

    // ── R5a assertion: plot_boundary_prep tool route renders. ───────────
    // Click "Open Tool" on plot_boundary_prep. RunTool dispatches to the
    // restored PlotBoundaryPrep component, which renders the Save and
    // Generate Grid affordances. End-to-end polygon drawing requires
    // pixel-perfect mouse events on Leaflet — that's covered by manual
    // testing and the component-level unit test. The e2e just confirms
    // the dispatch and primary controls are present. Done LAST because
    // navigating to the tool page makes orthoRow / step rows above
    // unreachable.
    const boundaryRow = page.getByTestId("step-row-plot_boundary_prep")
    await expect(boundaryRow).toHaveAttribute("data-status", "ready")
    await boundaryRow.getByRole("button", { name: /open tool/i }).click()
    await expect(
      page.getByRole("heading", { name: /plot boundary prep/i }),
    ).toBeVisible()
    await expect(page.getByTestId("boundary-rows")).toBeVisible()
    await expect(page.getByTestId("boundary-cols")).toBeVisible()
    await expect(page.getByTestId("boundary-save-and-complete")).toBeDisabled() // disabled until the user draws a polygon

    // Basemap toggle: Leaflet's built-in layers control sits in the top-right
    // and is collapsed by default. Hovering expands it; we then look for the
    // OSM/Esri labels.
    const layersControl = page.locator(".leaflet-control-layers")
    await expect(layersControl).toBeVisible()
    await layersControl.hover()
    await expect(page.locator(".leaflet-control-layers-list")).toContainText(
      "Streets (OSM)",
    )
    await expect(page.locator(".leaflet-control-layers-list")).toContainText(
      "Satellite (Esri)",
    )

    // Ortho overlay: this run just produced odm_orthophoto.tif, so TiTiler
    // must be able to read it. We assert the tilejson endpoint resolves
    // (proves the COG is valid + reachable end-to-end) and that the
    // <img> tile elements are appended to the DOM (proves the leaflet
    // layer is actually mounted and pointed at our COG). We don't assert
    // on .leaflet-tile-loaded because drone orthos are non-rectangular
    // within their bbox — the corner tiles 404 with no visible tile
    // ever loading at the auto-fit zoom for a small 5-image dataset.
    await expect(
      page.locator('img.leaflet-tile[src*="/titiler/cog/tiles/"]').first(),
    ).toBeAttached({ timeout: 30_000 })
    // At least one tile <img> must have actually loaded (naturalWidth > 0).
    // toBeAttached is too lax — a tilesize/tileSize mismatch would render
    // every <img> with src pointing at TiTiler but with naturalWidth 0
    // (broken-image), and the "ortho is on the map" assertion would still
    // pass while the user sees nothing. This catches that.
    await expect
      .poll(
        async () =>
          page
            .locator('img.leaflet-tile[src*="/titiler/cog/tiles/"]')
            .evaluateAll((imgs) =>
              imgs.some((el) => (el as HTMLImageElement).naturalWidth > 0),
            ),
        { timeout: 20_000 },
      )
      .toBe(true)
    const tilejsonProbe = await request.get(
      new URL(
        `/titiler/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(
          `s3://gemini/Processed/2022/${experiment}/${location}/${population}/${date}/DJI/FC6310S/odm_orthophoto.tif`,
        )}`,
        // The /titiler proxy is only available on the dev server; from
        // Playwright's `request` we hit the dev server's port directly.
        baseURL,
      ).toString(),
    )
    expect(tilejsonProbe.ok()).toBe(true)

    // ── Visible ortho assertion: top element at the map center. ──────────
    //
    // The DOM checks above pass even for bugs that hide the ortho from
    // the user (z-order regressions, layer teardown after first paint).
    // What we actually care about: when the auto-fit lands, is the
    // top-most rendered element at the map's geographic centroid an
    // ortho tile? document.elementFromPoint(centerX, centerY) returns
    // the top element — for a healthy ortho, that's a TiTiler-served
    // <img>. For a z-order regression, it's a basemap tile. For a
    // layer-teardown bug, the test polls until the assertion holds,
    // so a brief flash isn't enough — the ortho must be the top
    // element after the page has settled.
    //
    // Why elementFromPoint and not pixel sampling: cross-origin tile
    // images (TiTiler, Esri, OSM) without crossOrigin="anonymous" can
    // taint a canvas read in WebKit, returning null. The DOM-level
    // check is robust to that.
    //
    // Don't wait for networkidle: the wizard keeps WS connections alive
    // and the page never goes idle. Rely on expect.poll below to wait
    // for the ortho tile to finish loading.
    // Identify which tile layer is on top at the map's center point.
    //
    // We can't use document.elementFromPoint here: Leaflet panes have
    // pointer-events:none so click/drag pass through to the map, which
    // means elementFromPoint returns the .leaflet-container div, not
    // the actual tile <img>. Instead, enumerate all loaded leaflet
    // tile <img>s, find the ones whose bounding box contains the
    // centroid, and pick the one with the highest CSS z-index (the
    // ortho lives in a custom orthoPane at z-index 250; basemap tiles
    // are in tilePane at z-index 200). Whichever wins identifies the
    // visually-top layer at center.
    const topLayerAtCenter = async (): Promise<string> =>
      page.evaluate(() => {
        const mapDiv = document.querySelector(
          ".leaflet-container",
        ) as HTMLElement | null
        if (!mapDiv) return "no-map"
        const mapRect = mapDiv.getBoundingClientRect()
        const cx = mapRect.left + mapRect.width / 2
        const cy = mapRect.top + mapRect.height / 2
        const tiles = Array.from(
          document.querySelectorAll<HTMLImageElement>("img.leaflet-tile"),
        )
        type Hit = { src: string; z: number }
        const hits: Hit[] = []
        for (const img of tiles) {
          if (!img.complete || !img.naturalWidth) continue
          const r = img.getBoundingClientRect()
          if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom)
            continue
          // Walk up to the nearest .leaflet-pane to read its z-index.
          let pane: HTMLElement | null = img.parentElement
          while (pane && !pane.classList.contains("leaflet-pane")) {
            pane = pane.parentElement
          }
          const z = pane ? parseInt(getComputedStyle(pane).zIndex, 10) || 0 : 0
          hits.push({ src: img.src, z })
        }
        if (hits.length === 0) return "no-tile-at-center"
        hits.sort((a, b) => b.z - a.z)
        const top = hits[0]
        if (top.src.includes("/titiler/cog/tiles/")) return "ortho"
        if (top.src.includes("openstreetmap")) return "osm"
        if (top.src.includes("arcgisonline")) return "esri"
        return `unknown:${top.src.slice(0, 60)}`
      })

    // Poll because Leaflet finishes layout slightly after networkidle.
    try {
      await expect
        .poll(topLayerAtCenter, {
          timeout: 15_000,
          message:
            "Top element at map center should be a /titiler/cog/tiles/ <img>; " +
            "a non-ortho result indicates a z-order regression, layer-teardown " +
            "bug, or wrong auto-fit (ortho rendered offscreen).",
        })
        .toBe("ortho")
    } catch (err) {
      // Surface what the page actually showed so future failures
      // self-diagnose (which layer was on top, what tile URLs existed).
      const diag = await page.evaluate(() => {
        const mapDiv = document.querySelector(
          ".leaflet-container",
        ) as HTMLElement | null
        if (!mapDiv) return { kind: "no-map" as const }
        const rect = mapDiv.getBoundingClientRect()
        const cx = Math.round(rect.left + rect.width / 2)
        const cy = Math.round(rect.top + rect.height / 2)
        const tiles = Array.from(
          document.querySelectorAll<HTMLImageElement>("img.leaflet-tile"),
        ).map((img) => ({
          src: img.src,
          loaded: img.complete && img.naturalWidth > 0,
          x: img.getBoundingClientRect().x,
          y: img.getBoundingClientRect().y,
          w: img.getBoundingClientRect().width,
          h: img.getBoundingClientRect().height,
        }))
        const topEl = document.elementFromPoint(cx, cy)
        const topElInfo = topEl
          ? {
              tag: (topEl as HTMLElement).tagName,
              src: (topEl as HTMLImageElement).src,
              cls: (topEl as HTMLElement).className,
            }
          : null
        return {
          kind: "diag" as const,
          mapRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          centerXY: { cx, cy },
          tiles,
          topEl: topElInfo,
        }
      })
      // eslint-disable-next-line no-console
      console.log("ORTHO DIAGNOSTIC:", JSON.stringify(diag, null, 2))
      throw err
    }

    // ── Interaction: basemap toggle keeps the ortho on top. ───────────────
    //
    // Regression test for the z-order bug: when L.control.layers swaps
    // basemaps, the new basemap was landing above the ortho. Fixed by
    // putting the ortho on a custom orthoPane at z-index 250.
    //
    // The Leaflet layers control collapses on mouseout, which races with
    // .check() — between hovering and clicking the radio, the flyout
    // hides and the input gets display:none. Force-expand the control
    // by adding the `leaflet-control-layers-expanded` class directly,
    // then click radios with force:true so actionability isn't blocked
    // if Leaflet collapses again mid-click.
    await page.evaluate(() => {
      document
        .querySelector(".leaflet-control-layers")
        ?.classList.add("leaflet-control-layers-expanded")
    })
    await page
      .locator('input[type="radio"].leaflet-control-layers-selector')
      .nth(1)
      .check({ force: true })
    await page.waitForTimeout(500)
    await page.evaluate(() => {
      document
        .querySelector(".leaflet-control-layers")
        ?.classList.add("leaflet-control-layers-expanded")
    })
    await page
      .locator('input[type="radio"].leaflet-control-layers-selector')
      .nth(0)
      .check({ force: true })
    await page.waitForTimeout(500)
    await expect
      .poll(topLayerAtCenter, {
        timeout: 10_000,
        message:
          "After basemap toggle, top element at map center should still be the ortho. " +
          "A non-ortho result indicates a z-order regression in the basemap-toggle path.",
      })
      .toBe("ortho")

    // ── Interaction: zoom out — exercises the proxy 404 rewrite path. ────
    //
    // Drone orthos are non-rectangular within their WGS84 bounding box.
    // When the user zooms out, Leaflet requests tiles that TiTiler 404s
    // on (no pixel data at those coords). Without the /titiler proxy's
    // 404→200 rewrite, those errors trip the console-error guard and
    // fail the test. Click the Zoom out button several times to
    // guarantee at least one out-of-footprint tile request fires.
    for (let i = 0; i < 4; i++) {
      await page.locator(".leaflet-control-zoom-out").click()
      await page.waitForTimeout(250)
    }
    // Settle: allow tile fetches to complete so any 404 surfaces before
    // the assertions in the next phase / consoleErrorGuard.assertClean.
    await page.waitForTimeout(2_000)

    // ── 8. Backend assertion: ODM actually wrote the orthomosaic. ────────
    // Mirrors the Phase 7 spec — confirms the wizard's RUN_ODM payload
    // produced a real artifact, not just a green-looking UI.
    const tokenRes = await request.post(
      new URL("/api/users/login/access-token", baseURL).toString(),
      {
        data: { email: firstSuperuser, password: firstSuperuserPassword },
        headers: { "Content-Type": "application/json" },
      },
    )
    expect(tokenRes.ok()).toBe(true)
    const { access_token } = (await tokenRes.json()) as { access_token: string }

    const processedPrefix = `Processed/2022/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/`
    const listRes = await request.get(
      new URL(`/api/files/list/gemini/${processedPrefix}`, baseURL).toString(),
      { headers: { Authorization: `Bearer ${access_token}` } },
    )
    expect(listRes.ok()).toBe(true)
    const files = (await listRes.json()) as Array<{ object_name: string }>
    const orthoNames = files
      .map((f) => f.object_name ?? "")
      .filter((n) => n.endsWith("odm_orthophoto.tif"))
    expect(
      orthoNames.length,
      `expected odm_orthophoto.tif under ${processedPrefix}, got ${JSON.stringify(
        files.map((f) => f.object_name),
      )}`,
    ).toBeGreaterThan(0)

    // ── Field-design CSV upload + label injection. ───────────────────────
    //
    // Page is still on PlotBoundaryPrep with the ortho rendered. Exercise
    // the full field-design flow: switch to the FD tab → upload CSV → map
    // columns → confirm rows/cols auto-populate → draw a polygon →
    // generate grid → assert labels rode onto the saved snapshot.
    //
    // The fixture (e2e-field-design.csv, 4 rows: 2 rows × 2 cols) has
    // clean column names (`row`, `column`, `plot`, `accession`) so the
    // dialog's autoDetect resolves them without manual mapping.
    await page.getByTestId("grid-mode-fd").click()
    await expect(page.getByTestId("field-design-banner")).toContainText(
      /upload a csv/i,
    )
    await page.getByTestId("field-design-upload").click({ noWaitAfter: false })
    await page
      .getByTestId("field-design-file")
      .setInputFiles(fixturePath("csv", "e2e-field-design.csv"))
    // autoDetect should land mapping on `row`/`column` etc. Confirm the
    // required dropdowns are non-empty before clicking Confirm.
    await expect(page.getByTestId("field-design-map-row")).toHaveValue("row")
    await expect(page.getByTestId("field-design-map-col")).toHaveValue("column")
    await page.getByTestId("field-design-confirm").click()

    // Banner now shows the loaded plot count + the auto-derived
    // dimensions, replace button is visible.
    await expect(page.getByTestId("field-design-banner")).toContainText(
      /4\s*plots loaded/,
    )
    await expect(page.getByTestId("field-design-banner")).toContainText(
      /\(2\s*×\s*2\)/,
    )
    await expect(page.getByTestId("field-design-replace")).toBeVisible()

    // Sanity-check the underlying rows/cols state by switching back to
    // Manual: the inputs should reflect the auto-populated dimensions.
    // Then return to the FD tab so we generate with field-design labels.
    await page.getByTestId("grid-mode-manual").click()
    await expect(page.getByTestId("boundary-rows")).toHaveValue("2")
    await expect(page.getByTestId("boundary-cols")).toHaveValue("2")
    await page.getByTestId("grid-mode-fd").click()

    // Draw a small outer rectangle programmatically through the BoundaryMap
    // API surface: PlotBoundaryPrep accepts a feature list via Leaflet
    // Geoman. Triggering the user-flow draw via simulated mouse events
    // is brittle on a non-deterministic ortho; instead, use the page's
    // exposed test helper to inject a polygon. If no helper is exposed,
    // skip ahead to clicking Generate against an existing geometry.
    //
    // We inject by dispatching a Leaflet Geoman create event directly.
    // The component's onFeaturesChange handler picks it up and renders.
    await page.evaluate(() => {
      const w = window as unknown as {
        __leafletMap__?: {
          getBounds(): {
            getSouthWest(): { lat: number; lng: number }
            getNorthEast(): { lat: number; lng: number }
          }
          fire(name: string, payload: unknown): void
        }
        L?: {
          polygon(ring: [number, number][]): { addTo(map: unknown): unknown }
        }
      }
      const map = w.__leafletMap__
      if (!map || !w.L) return
      const L = w.L
      const bounds = map.getBounds()
      const sw = bounds.getSouthWest()
      const ne = bounds.getNorthEast()
      // Inscribe a small rectangle in the ortho viewport.
      const w2 = (ne.lng - sw.lng) * 0.4
      const h2 = (ne.lat - sw.lat) * 0.4
      const cx = (sw.lng + ne.lng) / 2
      const cy = (sw.lat + ne.lat) / 2
      const ring: [number, number][] = [
        [cy - h2 / 2, cx - w2 / 2],
        [cy - h2 / 2, cx + w2 / 2],
        [cy + h2 / 2, cx + w2 / 2],
        [cy + h2 / 2, cx - w2 / 2],
        [cy - h2 / 2, cx - w2 / 2],
      ]
      const layer = L.polygon(ring)
      layer.addTo(map)
      map.fire("pm:create", { layer, shape: "Polygon" })
    })

    // Click Generate — labels should be injected into the grid features.
    await page.getByRole("button", { name: /generate plot grid/i }).click()

    // Save & complete: confirms the snapshot round-trips with field_design.
    const saveBtn = page.getByTestId("boundary-save-and-complete")
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    // RunTool's `onSaved={goBack}` navigates away from the tool route once
    // save+activate succeed. Waiting for the URL to leave the tool route is
    // the most direct signal that the mutations actually completed (rather
    // than just the button text reverting before the network round trip).
    await page.waitForURL((url) => !url.pathname.includes("/tool/"), {
      timeout: 15_000,
    })
    // Then wait for the boundary step row to flip to "completed" on the
    // run detail page — that's downstream of the activate mutation
    // settling and proves the version is selectable for trait extraction.
    await expect(
      page.getByTestId("step-row-plot_boundary_prep"),
    ).toHaveAttribute("data-status", "completed", { timeout: 15_000 })

    // Backend assertion: load the active plot-geometry version and verify
    // its state_snapshot.field_design carries the CSV's accession values.
    // processedPrefix() in src/features/process/lib/paths.ts has a
    // trailing slash; list_for_directory matches by exact equality.
    const dirPath = `Processed/2022/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/`
    const versionsRes = await request.post(
      new URL("/api/plot_geometry/versions/list", baseURL).toString(),
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access_token}`,
        },
        data: { directory: dirPath },
      },
    )
    expect(versionsRes.ok()).toBe(true)
    const versions = (await versionsRes.json()) as Array<{
      version: number
      is_active: boolean
    }>
    const active = versions.find((v) => v.is_active)
    expect(active, `expected an active plot-geometry version`).toBeTruthy()

    const loadRes = await request.post(
      new URL("/api/plot_geometry/versions/load", baseURL).toString(),
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access_token}`,
        },
        data: { directory: dirPath, version: active!.version },
      },
    )
    expect(loadRes.ok()).toBe(true)
    const loaded = (await loadRes.json()) as {
      state_snapshot: {
        boundaries: { features: Array<{ properties: Record<string, unknown> }> }
        field_design?: { rows: Array<Record<string, string>> }
      }
    }
    expect(
      loaded.state_snapshot.field_design,
      "field_design must persist on the snapshot",
    ).toBeTruthy()
    expect(loaded.state_snapshot.field_design!.rows).toHaveLength(4)
    // At least one polygon must carry an `accession` from the CSV.
    const accessions = loaded.state_snapshot.boundaries.features
      .map((f) => f.properties?.accession)
      .filter(Boolean)
    expect(
      accessions.length,
      `expected at least one polygon to be tagged with accession; got properties: ${JSON.stringify(
        loaded.state_snapshot.boundaries.features.map((f) => f.properties),
      )}`,
    ).toBeGreaterThan(0)
  })
})
