/**
 * Strict-E2E for the Home dashboard.
 *
 * The home route (`/`) renders DashboardBuilder, and until now NO spec
 * visited it — which is exactly why its data layer could sit there firing
 * requests at the old backend's `/api/v1/analyze/*` routes without anyone
 * noticing. The console-error guard (auto-attached by tests/helpers/fixtures)
 * is the real assertion here: it fails the test if the page logs an error or
 * raises a pageerror, so a reintroduced 404 breaks this spec.
 *
 * What it checks:
 *   1. The home dashboard mounts, with its shell interactive.
 *   2. It states plainly that widget data isn't wired to this backend yet,
 *      rather than rendering empty widgets that look like "no data".
 *   3. Adding a widget through the real UI doesn't trigger a doomed request.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("Home dashboard", () => {
  test.setTimeout(120_000)

  test("mounts cleanly, declares its data state, and survives adding a widget", async ({
    page,
  }) => {
    const requests: string[] = []
    page.on("request", (r) => {
      const url = r.url()
      if (url.includes("/api/")) requests.push(url)
    })

    await page.goto("/")

    // ── 1. The dashboard shell is present and interactive. ───────────────
    await expect(
      page
        .getByRole("heading", { name: "Dashboard" })
        .or(page.getByText("Dashboard", { exact: true }).first()),
    ).toBeVisible({ timeout: 15_000 })

    // ── 2. The unavailable-data notice is shown. If someone wires the
    //       dashboard up (Phase 3, 3D) they flip DASHBOARD_DATA_AVAILABLE,
    //       this assertion fails, and they update the spec deliberately —
    //       which is the point.
    await expect(page.getByTestId("dashboard-data-unavailable")).toBeVisible()

    // ── 3. Add a widget via the toolbox. The widget templates live in a
    //       left sidebar; clicking one adds it to the active tab and opens
    //       its config dialog. Nothing here may hit a dead route.
    const kpiTemplate = page.getByText("KPI", { exact: true }).first()
    if (await kpiTemplate.count()) {
      await kpiTemplate.click()
      // A config dialog may open; close it however it offers.
      const cancel = page.getByRole("button", { name: /cancel/i }).first()
      if (await cancel.count()) await cancel.click()
    }

    // Give any misrouted query a chance to fire before asserting.
    await page.waitForTimeout(1500)

    // ── 4. No request may target the retired /api/v1 surface. The console
    //       guard catches the resulting error; this catches the request even
    //       if a handler swallowed the failure quietly.
    const v1 = requests.filter((u) => u.includes("/api/v1/"))
    expect(
      v1,
      `home dashboard must not call the old backend's /api/v1 routes:\n${v1.join("\n")}`,
    ).toEqual([])
  })
})
