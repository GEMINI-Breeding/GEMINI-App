/**
 * Import from the previous GEMI app (Phase 5, tier 1).
 *
 * The dev stack mounts a fixture "previous install" read-only
 * (tests/fixtures/legacy, built by make_fixture.py from GEMI v0.0.5's own
 * schema): an Image Data upload (2 drone images), a Field Design, and an
 * upload the old app had marked missing.
 *
 * Through the UI: Settings shows what would be imported and what can't be
 * (and why) → Import → progress → result → the uploads are in Files →
 * Manage Data, at the new layout (per-dataset folder for images) → the
 * page then says everything is imported. Read-only checks confirm the
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
    await expect(plan).toContainText("2 (3 files")
    await expect(plan).toContainText(EXPERIMENT)
    await expect(plan).toContainText("2025")
    await expect(section.getByTestId("legacy-import-skipped")).toContainText(
      "2025-06-20/Drone/RGB/Images: the old app had already marked its folder missing",
    )

    // ── Import ───────────────────────────────────────────────────────────
    await section.getByTestId("legacy-import-start").click()
    const result = section.getByTestId("legacy-import-result")
    await expect(result).toContainText("Imported 2 uploads (3 files copied)", {
      timeout: 120_000,
    })
    await result.getByRole("button", { name: "OK" }).click()
    // The dry run now knows it's done.
    await expect(plan).toContainText("2 already imported")
    await expect(section.getByTestId("legacy-import-start")).toHaveText(
      "Everything is imported",
    )
    await expect(section.getByTestId("legacy-import-start")).toBeDisabled()

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
    expect(keys).toHaveLength(3)
    expect(keys[0]).toMatch(
      new RegExp(
        `^${base}/2025-06-10/Drone/RGB/[0-9a-f]{8}/Images/test_image_001\\.jpg$`,
      ),
    )
    expect(keys[2]).toBe(`${base}/FieldDesign/field_design.csv`)

    // ── The previous install is exactly as it was ───────────────────────
    expect(fingerprint(FIXTURE)).toBe(before)
  })
})
