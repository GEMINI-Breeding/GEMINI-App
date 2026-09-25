/**
 * Import from the previous GEMI app (Phase 5, tier 1).
 *
 * The dev stack mounts a fixture "previous install" read-only
 * (tests/fixtures/legacy, built by make_fixture.py from GEMI v0.0.5's own
 * schema): uploads (drone images, a field design, an Amiga log the old app
 * had extracted, one it had marked missing), a workspace with an aerial
 * and a ground pipeline and a run of each (orthomosaic, two boundary
 * versions, per-plot traits — one on a plot id that isn't a number —,
 * plot images; plot marking, a stitch), and two reference datasets with
 * the same name.
 *
 * Through the UI: Settings shows what would be imported and what can't be
 * (and why) → Import → progress → result → the uploads are in Files →
 * Manage Data, at the new layout (per-dataset folder for images) → the
 * page then says everything is imported, and importing again adds
 * nothing. Read-only checks confirm the
 * storage keys; the fixture's files are unchanged (it's mounted
 * read-only, so the import couldn't have touched them).
 *
 * The imported names come from the fixture ("E2E-legacy-fixture"), not
 * the run prefix, so they're swept via fixedNamePrefixes.
 */
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test } from "../helpers/fixtures"

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/legacy",
)
const EXPERIMENT = "E2E-legacy-fixture"

function fingerprint(dir: string): string {
  const h = createHash("sha256")
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else h.update(p).update(readFileSync(p))
    }
  }
  walk(dir)
  return h.digest("hex")
}

test.use({ fixedNamePrefixes: [EXPERIMENT] })

test.describe("Import from the previous GEMI app", () => {
  test.setTimeout(180_000)

  test("dry run → import → uploads in Manage Data; the old install untouched", async ({
    page,
    request,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("baseURL not configured")
    const before = fingerprint(FIXTURE)

    // ── Settings → Data & services: the dry run ─────────────────────────
    await page.goto("/")
    await page.locator('[data-onboarding="nav-settings"]').click()
    const section = page.getByTestId("legacy-import")
    await expect(section).toBeVisible({ timeout: 30_000 })
    const plan = section.getByTestId("legacy-import-plan")
    await expect(plan).toContainText("3 (12 files")
    await expect(plan).toContainText(EXPERIMENT)
    await expect(plan).toContainText("2025")
    await expect(plan).toContainText(
      "1 workspace · 2 pipelines · 2 runs · 1 orthomosaic version · 2 plot boundary versions · 1 set of plot traits · 1 plot marking version · 1 stitch · 2 reference datasets",
    )
    await expect(plan).toContainText("kept as they were under Imported/GEMI")
    await expect(section.getByTestId("legacy-import-skipped")).toContainText(
      "2025-06-20/Drone/RGB/Images: the old app had already marked its folder missing",
    )

    // ── Import ───────────────────────────────────────────────────────────
    await section.getByTestId("legacy-import-start").click()
    const result = section.getByTestId("legacy-import-result")
    await expect(result).toContainText("Imported 3 uploads (12 files copied)", {
      timeout: 120_000,
    })
    await expect(section.getByTestId("legacy-import-processing")).toContainText(
      "2 runs · 1 orthomosaic version · 2 plot boundary versions · 1 set of plot traits",
    )
    await expect(section.getByTestId("legacy-import-processing")).toContainText(
      "2 reference datasets",
    )
    // Plot "5A" can't be a plot number: its values are kept, and said so.
    await expect(section.getByTestId("legacy-import-notes")).toContainText(
      "kept without a plot link",
    )
    await expect(section.getByTestId("legacy-import-failed")).toHaveCount(0)
    await result.getByRole("button", { name: "OK" }).click()
    // The dry run now knows it's done.
    await expect(plan).toContainText("3 already imported")
    await expect(section.getByTestId("legacy-import-all-done")).toBeVisible()
    await expect(section.getByTestId("legacy-import-start")).toHaveText(
      "Import again",
    )
    // Importing again copies nothing and duplicates nothing (checked below).
    await section.getByTestId("legacy-import-start").click()
    await expect(result).toContainText("(0 files copied)", {
      timeout: 120_000,
    })
    await expect(section.getByTestId("legacy-import-notes")).toHaveCount(0)
    await result.getByRole("button", { name: "OK" }).click()

    // ── Files → Manage Data: the uploads are there ──────────────────────
    await page.locator('[data-onboarding="nav-files"]').click()
    await page.locator('[data-onboarding="files-tab-manage"]').click()
    await page.locator('[data-testid="manage-data-filter"]').fill(EXPERIMENT)
    const expRow = page.locator(
      `[data-testid="manage-data-experiment-${EXPERIMENT}"]`,
    )
    await expect(expRow).toBeVisible({ timeout: 30_000 })
    await expRow.getByRole("button", { name: "Expand" }).click()
    const images = page
      .locator('[data-testid^="manage-data-dataset-"]')
      .filter({ has: page.locator(`text=${EXPERIMENT}__ImageData__`) })
    await expect(images).toHaveCount(1)
    await expect(images).toContainText("2 files")
    await expect(images).toContainText("2025-06-10")
    const design = page
      .locator('[data-testid^="manage-data-dataset-"]')
      .filter({ has: page.locator(`text=${EXPERIMENT}__FieldDesign__`) })
    await expect(design).toContainText("1 file")

    const traits = page
      .locator('[data-testid^="manage-data-dataset-"]')
      .filter({ has: page.locator("text=Traits from GEMI") })
    await expect(traits).toHaveCount(1)
    // Both reference datasets (same name, different data), each once.
    await expect(page.getByTestId("reference-data-row-LAI survey")).toHaveCount(
      2,
    )
    const refPlots = page.getByTestId("reference-data-plots-LAI survey")
    await expect(refPlots).toHaveCount(2)
    expect(
      (await refPlots.allInnerTexts()).map((t) => t.trim()).sort(),
    ).toEqual(["2", "4"])

    // ── Process: the old workspace, its pipelines and runs ──────────────
    await page.locator('[data-onboarding="nav-process"]').click()
    await page.getByTestId("workspace-card-E2E-legacy-fixture WS").click()
    await expect(page.getByText("Drone pipe")).toBeVisible()
    await expect(page.getByText("Amiga pipe")).toBeVisible()
    await page.getByText("2025-06-10 Drone/RGB").click()
    await expect(page.getByTestId("step-row-orthomosaic")).toHaveAttribute(
      "data-status",
      "completed",
      { timeout: 30_000 },
    )
    await expect(page.getByTestId("ortho-version-row-1")).toContainText(
      "First ODM",
    )
    await expect(
      page.getByTestId("step-row-plot_boundary_prep"),
    ).toHaveAttribute("data-status", "completed")
    await page.goBack()
    await page.getByText("2025-07-15 Amiga/RGB").click()
    await expect(page.getByTestId("step-row-plot_marking")).toHaveAttribute(
      "data-status",
      "completed",
      { timeout: 30_000 },
    )
    await expect(page.getByTestId("step-row-stitching")).toHaveAttribute(
      "data-status",
      "completed",
    )

    // ── Storage keys (read-only check): the new layout ──────────────────
    const auth = await page.context().storageState()
    const token =
      auth.origins
        .flatMap((o) => o.localStorage)
        .find((e) => e.name === "gemini.auth.token")?.value ?? ""
    const listing = (await (
      await request.get(
        new URL(
          `/api/files/list/gemini/Raw/2025/${EXPERIMENT}/`,
          baseURL,
        ).toString(),
        { headers: { Authorization: `Bearer ${token}` } },
      )
    ).json()) as { object_name: string }[]
    const keys = listing.map((f) => f.object_name).sort()
    const base = `Raw/2025/${EXPERIMENT}/Davis/Cowpea MAGIC`
    expect(keys).toHaveLength(12)
    expect(keys[0]).toMatch(
      new RegExp(
        `^${base}/2025-06-10/Drone/RGB/[0-9a-f]{8}/Images/test_image_001\\.jpg$`,
      ),
    )
    expect(keys).toContain(`${base}/FieldDesign/field_design.csv`)
    // The old Amiga extraction, laid out like the new extractor's.
    expect(
      keys.some((k) =>
        /\/2025-07-15\/Amiga\/RGB\/[0-9a-f]{8}\/RGB\/Images\/top\/rgb-\d+\.jpg$/.test(
          k,
        ),
      ),
    ).toBe(true)
    expect(
      keys.some((k) =>
        /\/Amiga\/RGB\/[0-9a-f]{8}\/RGB\/Metadata\/msgs_synced\.csv$/.test(k),
      ),
    ).toBe(true)

    // ── The previous install is exactly as it was ───────────────────────
    expect(fingerprint(FIXTURE)).toBe(before)
  })
})
