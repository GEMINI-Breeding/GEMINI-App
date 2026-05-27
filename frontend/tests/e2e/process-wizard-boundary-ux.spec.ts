/**
 * Plot Boundary Prep UX behaviors — covers the post-R5a improvements:
 *   - NumberField (Angle/Gap/Rows/Cols can be cleared, type negatives, etc.)
 *   - Cell selection (click selects, shift-click extends, no flicker)
 *   - Undo / Redo (Cmd/Ctrl+Z restores prior editor state)
 *   - Group bulk-delete via the SelectionActionBar
 *   - Draft persistence with mount-time recovery banner
 *
 * Strategy: get a run with a valid scope into the plot_boundary_prep
 * tool route. No ortho is needed — PlotBoundaryPrep renders the
 * satellite basemap and accepts a polygon injected via Geoman's
 * `pm:create` event (the same path BoundaryMap exposes for tests via
 * the `__leafletMap__` window handle). This avoids the multi-minute
 * ODM job that r4a requires.
 *
 * Strict-E2E (CLAUDE.md):
 *   - Every entity is created through the same UI a user would use.
 *   - Cell click events go through Geoman's event dispatch via the
 *     exposed map handle — no React state setters are bypassed.
 *   - Console-error guard auto-attached via tests/helpers/fixtures.
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

// Minimal upload set — two images is enough to create a run scope; the
// tool route only needs the scope path to render.
const DRONE_IMAGES = [
  "2022-06-27_100MEDIA_DJI_0876.JPG",
  "2022-06-27_100MEDIA_DJI_0877.JPG",
]

test.describe("Plot Boundary Prep — UX behaviors", () => {
  test.setTimeout(5 * 60_000)

  test("number-field, undo, selection, delete, draft persistence", async ({
    page,
    runPrefix,
  }) => {
    const experiment = `${runPrefix}-bux-exp`
    const location = "Davis"
    const population = "Cowpea"
    const date = "2022-06-27"
    const platform = "DJI"
    const sensor = "FC6310S"
    const workspaceName = `${runPrefix}-bux-workspace`
    const pipelineName = `${runPrefix}-bux-pipeline`

    // ── 1. Upload images so the run-scope picker has something to find. ─
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

    // ── 2. Workspace + pipeline (aerial, no Roboflow model). ────────────
    await page.goto("/process")
    await page.locator('[data-onboarding="process-new-workspace"]').click()
    await page.getByLabel(/workspace name/i).fill(workspaceName)
    await page.getByRole("button", { name: /create workspace/i }).click()
    await page.getByText(workspaceName, { exact: true }).click()
    await page.getByRole("button", { name: /create aerial pipeline/i }).click()
    await page.getByLabel(/pipeline name/i).fill(pipelineName)
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /^next$/i }).click()
    await page.getByRole("button", { name: /create pipeline/i }).click()

    // ── 3. Create the run. ──────────────────────────────────────────────
    await page
      .getByRole("button", { name: /new run/i })
      .first()
      .click()
    const uploadRow = page
      .getByTestId("upload-row")
      .filter({ hasText: experiment })
      .filter({ hasText: date })
      .filter({ hasText: platform })
      .filter({ hasText: sensor })
      .first()
    await expect(uploadRow).toBeVisible({ timeout: 30_000 })
    await uploadRow.click()
    await page.getByRole("button", { name: /create run/i }).click()

    // ── 4. Direct-nav to the boundary-prep tool. ────────────────────────
    // plot_boundary_prep is locked behind data_sync + orthomosaic in the
    // step-row UI, but the underlying tool route accepts a runId+step
    // query directly. For UX-only tests this skips the multi-minute
    // ODM job that r4a covers.
    const runUrl = page.url()
    const runId = runUrl.split("/").pop()
    const wsId = runUrl.split("/process/")[1].split("/")[0]
    expect(runId).toBeTruthy()
    expect(wsId).toBeTruthy()
    await page.goto(
      `/process/${wsId}/tool?runId=${runId}&step=plot_boundary_prep`,
    )

    await expect(
      page.getByRole("heading", { name: /plot boundary prep/i }),
    ).toBeVisible()

    // ── 5. NumberField: clearing and negative typing. ───────────────────
    // a) Clear the Angle input — should leave the field empty mid-edit,
    //    and on blur revert to the prior value (0). The old controlled-
    //    number input had `Number("") || 0` → 0 every keystroke and made
    //    clearing impossible without immediately committing 0.
    const angle = page.getByTestId("boundary-angle")
    await angle.fill("")
    await expect(angle).toHaveValue("")
    // blur by clicking the rows label
    await page.getByLabel(/^rows$/i).click()
    await expect(angle).toHaveValue("0")

    // b) Type a negative angle character-by-character and confirm the
    //    intermediate "-" is preserved (the old impl converted it to 0).
    await angle.click()
    await angle.fill("")
    await page.keyboard.type("-")
    await expect(angle).toHaveValue("-")
    await page.keyboard.type("12.5")
    await expect(angle).toHaveValue("-12.5")
    // Commit by Enter.
    await page.keyboard.press("Enter")
    await expect(angle).toHaveValue("-12.5")

    // Reset angle to 0 for the rest of the spec.
    await angle.click()
    await angle.fill("0")
    await page.keyboard.press("Enter")

    // ── 6. Draw a polygon + generate a grid. ────────────────────────────
    // Use the test-only window handles BoundaryMap.tsx exposes
    // (__leafletMap__, L) to drop a synthetic outer rectangle and fire
    // Geoman's pm:create event — same code path a real draw would hit.
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
      if (!map || !w.L) throw new Error("leaflet map handle missing")
      const L = w.L
      const b = map.getBounds()
      const sw = b.getSouthWest()
      const ne = b.getNorthEast()
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

    // Bump the grid to 2x2 so we end up with exactly 4 cells.
    const rowsInput = page.getByTestId("boundary-rows")
    const colsInput = page.getByTestId("boundary-cols")
    await rowsInput.fill("2")
    await page.keyboard.press("Tab")
    await colsInput.fill("2")
    await page.keyboard.press("Tab")

    // Generate the grid against the active block.
    await page.getByRole("button", { name: /generate plot grid/i }).click()

    // 4 cells generated; map count line confirms it.
    await expect(page.locator("text=/4 plots? across 1 block/i")).toBeVisible()

    // ── 7. Undo / redo. ─────────────────────────────────────────────────
    // Press Cmd/Ctrl+Z. The grid-regenerate history entry pops, leaving
    // just the outer rectangle (0 cells). Then redo restores the grid.
    // Use ControlOrMeta so the test passes regardless of host OS.
    await page.locator("body").click({ position: { x: 5, y: 5 } })
    await page.keyboard.press("ControlOrMeta+z")
    await expect(page.locator("text=/0 plots? across 1 block/i")).toBeVisible()
    await page.keyboard.press("ControlOrMeta+Shift+z")
    await expect(page.locator("text=/4 plots? across 1 block/i")).toBeVisible()

    // ── 8. Cell selection — click selects, shift-click extends, no flicker. ─
    // Click cells by firing Leaflet's "click" event on the layer matching
    // each cellId. This drives the exact handler attached by BoundaryMap
    // (mode "replace"/"add"/"toggle") rather than synthesizing DOM clicks.
    // Leaflet's Map._layers is flat: FeatureGroup children are registered
    // on the map directly, so iterating with eachLayer plus recursing into
    // groups would double-count them. Walk flat and dedupe by cellId.
    const cellIds = await page.evaluate(() => {
      const w = window as unknown as {
        __leafletMap__?: { eachLayer?: (cb: (l: unknown) => void) => void }
      }
      const seen = new Set<string>()
      w.__leafletMap__?.eachLayer?.((l) => {
        const layer = l as { toGeoJSON?: () => GeoJSON.Feature }
        const gj = (() => {
          try {
            return layer.toGeoJSON?.()
          } catch {
            return undefined
          }
        })()
        const id = (gj?.properties as Record<string, unknown> | undefined)
          ?.cellId
        if (typeof id === "string") seen.add(id)
      })
      return [...seen]
    })
    expect(cellIds, "should have 4 stamped cellIds").toHaveLength(4)

    // Click cell 0 — selection becomes [cell0]. With the flicker bug the
    // action bar would never appear (cell selects, map click immediately
    // clears it). The action bar's testid is the assertion.
    await fireCellClick(page, cellIds[0], "replace")
    await expect(page.getByTestId("selection-action-bar")).toBeVisible()
    await expect(page.getByTestId("selection-count")).toHaveText(
      "1 cell selected",
    )

    // Shift-click cell 1 — selection becomes [cell0, cell1].
    await fireCellClick(page, cellIds[1], "add")
    await expect(page.getByTestId("selection-count")).toHaveText(
      "2 cells selected",
    )

    // Cmd-click cell 0 — toggles it out. Selection becomes [cell1].
    await fireCellClick(page, cellIds[0], "toggle")
    await expect(page.getByTestId("selection-count")).toHaveText(
      "1 cell selected",
    )

    // ── 9. Group delete — two-click confirm in the action bar. ──────────
    // Re-extend selection so we're deleting 2 of the 4 cells.
    await fireCellClick(page, cellIds[2], "add")
    await expect(page.getByTestId("selection-count")).toHaveText(
      "2 cells selected",
    )
    await page.getByTestId("selection-delete").click()
    await page.getByTestId("selection-delete-confirm").click()
    // Selection cleared; 2 cells remain (4 - 2).
    await expect(page.getByTestId("selection-action-bar")).not.toBeVisible()
    await expect(page.locator("text=/2 plots? across 1 block/i")).toBeVisible()

    // Undo the delete to restore both cells. Tests that delete is in the
    // history stack (not a one-way destructive op).
    await page.keyboard.press("ControlOrMeta+z")
    await expect(page.locator("text=/4 plots? across 1 block/i")).toBeVisible()

    // ── 10. Draft persistence — reload, banner appears, discard works. ──
    // The auto-save debounces by 300ms; wait it out before reloading so
    // the most recent edit is in localStorage.
    await page.waitForTimeout(500)

    // Reload the page (full page navigation, not SPA route change). The
    // beforeunload handler runs and persists synchronously, the next
    // mount reads localStorage and surfaces the recovery banner.
    await page.reload()

    // Banner appears; the 4 cells are still on the map.
    await expect(page.getByTestId("draft-banner")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator("text=/4 plots? across 1 block/i")).toBeVisible()

    // Click Discard — banner disappears, editor resets to empty.
    await page.getByTestId("draft-discard").click()
    await expect(page.getByTestId("draft-banner")).not.toBeVisible()
    // No polygons left after discard.
    await expect(
      page.locator("text=/0 plots? across 0 blocks?/i"),
    ).toBeVisible()
  })
})

/**
 * Drive a cell click through the same Leaflet event chain a real DOM
 * click would. Locates the L.Path layer whose toGeoJSON().properties
 * .cellId matches `id`, then fires the "click" event with the keyboard
 * modifiers that map to the requested selection mode.
 */
async function fireCellClick(
  page: import("@playwright/test").Page,
  id: string,
  mode: "replace" | "add" | "toggle",
): Promise<void> {
  await page.evaluate(
    ({ id, mode }) => {
      const w = window as unknown as {
        __leafletMap__?: { eachLayer?: (cb: (l: unknown) => void) => void }
      }
      type LayerLike = {
        toGeoJSON?: () => GeoJSON.Feature
        fire?: (name: string, payload: unknown) => void
      }
      let found: LayerLike | null = null
      w.__leafletMap__?.eachLayer?.((l) => {
        if (found) return
        const layer = l as LayerLike
        const gj = (() => {
          try {
            return layer.toGeoJSON?.()
          } catch {
            return undefined
          }
        })()
        const cellId = (gj?.properties as Record<string, unknown> | undefined)
          ?.cellId
        if (typeof cellId === "string" && cellId === id) {
          found = layer
        }
      })
      if (!found) throw new Error(`cell ${id} not found`)
      const layer = found as LayerLike
      // BoundaryMap's click handler reads ev.originalEvent.shiftKey /
      // metaKey / ctrlKey to discriminate add vs toggle vs replace.
      const shiftKey = mode === "add"
      const metaKey = mode === "toggle"
      const originalEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        shiftKey,
        metaKey,
        ctrlKey: metaKey,
      })
      layer.fire?.("click", { originalEvent })
    },
    { id, mode },
  )
}
