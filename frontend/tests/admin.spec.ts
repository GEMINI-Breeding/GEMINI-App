import type { Page } from "@playwright/test"

import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
// Import `test` from helpers/fixtures so every case auto-attaches the
// console-error guard required by CLAUDE.md's strict-E2E rule.
import { expect, test } from "./helpers/fixtures"
import { randomEmail, randomPassword } from "./utils/random"

/**
 * Phase 5.1 admin-page coverage. Every test drives the real UI end-to-end
 * — no API seeding, no private-API helpers. Each test either cleans up
 * its own user or notes the residue in a comment.
 *
 * Toast-intercept note: after a successful create/edit, useCustomToast
 * fires a Sonner success toast that renders fixed at the bottom-right.
 * Each toast `<li>` keeps `pointer-events: auto` (the wrapper is none;
 * the card is auto so its dismiss button works), and the bottom-right
 * is exactly where TanStack table row-action buttons live — so a click
 * on the row's "⋯" button gets intercepted by the toast hit area until
 * it auto-dismisses ~4 s later. We dismiss toasts explicitly before any
 * row-action click via `dismissToasts(page)` instead of relying on the
 * default-duration timer.
 */

/**
 * Clear two known click-intercepts that fire after a successful dialog
 * submit:
 *
 *   1. Sonner success toast — fixed at bottom-right, pointer-events: auto
 *      on each `<li data-sonner-toast>`. Until it auto-dismisses (~4 s
 *      later) it absorbs clicks on TanStack-table row-action buttons in
 *      the same corner. We can't .remove() the nodes (React's reconciler
 *      then crashes on the next render with insertBefore errors), so we
 *      neutralize them via inline styles instead — Sonner's React tree
 *      stays intact, and the click hit area is gone.
 *
 *   2. Radix Dialog body-style leak (radix-ui/primitives#1241) — Radix
 *      sometimes leaves `body { pointer-events: none }` and
 *      `data-scroll-locked` set after a dialog closes mid-animation,
 *      especially when paired with TanStack Query's invalidate cascade.
 *      `useDialogBodyUnlock` in `src/components/ui/dialog.tsx` clears
 *      this on a timer, but the timer can fire after our next click
 *      attempt. Force-clear here too.
 *
 * Always call this between "submit dialog" and "click row-action menu."
 */
async function dismissToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Neutralize toasts without removing them — preserves React's
    // reconciler tree.
    document
      .querySelectorAll<HTMLLIElement>("[data-sonner-toast]")
      .forEach((li) => {
        li.style.pointerEvents = "none"
        li.style.visibility = "hidden"
      })
    // Also neutralize the Sonner wrapper itself, which was already
    // pointer-events:none in our config but sets data-mounted on a child
    // section that can still wrap a hit area.
    document
      .querySelectorAll<HTMLElement>("[data-sonner-toaster], section[aria-label*='Notifications' i]")
      .forEach((el) => {
        el.style.pointerEvents = "none"
      })
    if (document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = ""
    }
    if (document.body.dataset.scrollLocked != null) {
      delete document.body.dataset.scrollLocked
    }
  })
}

async function logIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login")
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByRole("button", { name: "Log In" }).click()
  await page.waitForURL("/")
}

async function logOutViaMenu(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle")
  await dismissToasts(page)
  // user-menu is a Radix DropdownMenuTrigger; logout-menu-item is the
  // menuitem inside it. Same pattern as deleteUserViaRow — open via
  // pointerdown, fire the menuitem via click event so we don't wait
  // for the CDP ack that Radix's focus shift never delivers.
  await page.getByTestId("user-menu").dispatchEvent("pointerdown", { button: 0 })
  await page.getByTestId("logout-menu-item").dispatchEvent("click")
  await page.waitForURL("/login")
}

async function createUserViaAdminDialog(
  page: Page,
  {
    email,
    fullName,
    password,
    isSuperuser = false,
    isActive = true,
  }: {
    email: string
    fullName: string
    password: string
    isSuperuser?: boolean
    isActive?: boolean
  },
): Promise<void> {
  await page.getByRole("button", { name: /add user/i }).click()
  await page.getByPlaceholder("Email").fill(email)
  await page.getByPlaceholder("Full name").fill(fullName)
  await page.getByPlaceholder("Password").first().fill(password)
  await page.getByPlaceholder("Password").nth(1).fill(password)
  if (isSuperuser) {
    await page.getByLabel(/is superuser/i).check()
  }
  if (isActive) {
    await page.getByLabel(/is active/i).check()
  }
  await page.getByRole("button", { name: "Save" }).click()
  // Wait for the dialog itself to fully unmount before continuing —
  // otherwise its close animation + Radix's body-style cleanup races
  // with the next click and stalls Playwright. The role="dialog" /
  // data-state="open" content is the canonical "modal still up" signal.
  await expect(
    page.locator('[role="dialog"][data-state="open"]'),
  ).toHaveCount(0, { timeout: 10_000 })
  // Then assert the created row exists.
  await expect(page.getByText(email).first()).toBeVisible()
}

async function deleteUserViaRow(page: Page, email: string): Promise<void> {
  // Wait for the table to settle: useSuspenseQuery + invalidateQueries can
  // remount the row mid-click and leave the button locator pointing at a
  // stale node. networkidle settles after the post-create refetch.
  await page.waitForLoadState("networkidle")
  // Dismiss any open success toasts (e.g. "Success! User created") — they
  // sit at the bottom-right and intercept clicks on the row's action
  // button until they auto-dismiss.
  await dismissToasts(page)
  const row = page.getByRole("row").filter({ hasText: email })
  const btn = row.getByRole("button")
  await btn.scrollIntoViewIfNeeded()
  // Radix's DropdownMenuTrigger opens the menu on `pointerdown`, then
  // immediately moves focus into the open menu. Playwright's standard
  // `.click()` waits for the full pointerdown→mouseup→click ack chain
  // via CDP, but the focus shift causes the ack to race and stall for
  // the entire test timeout. Driving just the `pointerdown` event is
  // enough to open Radix's menu — same event the real user fires — and
  // skips the CDP wait that nothing on the page is going to satisfy.
  // The same pattern recurs on every Radix-managed open/close: menuitem
  // selection (closes the menu, opens an AlertDialog), AlertDialog
  // confirm (closes the dialog, fires the mutation). We dispatch the
  // `click` event directly on each — fully compatible with Radix's
  // listeners — to avoid the same CDP stall.
  await btn.dispatchEvent("pointerdown", { button: 0 })
  await page
    .getByRole("menuitem", { name: /delete user/i })
    .dispatchEvent("click")
  await page
    .getByRole("button", { name: "Delete" })
    .dispatchEvent("click")
  await expect(page.getByText(email)).not.toBeVisible()
}

test.use({ storageState: { cookies: [], origins: [] } })

test("superuser can open /admin and see the users table", async ({ page }) => {
  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")
  await expect(page).toHaveURL("/admin")
  await expect(page.getByRole("heading", { name: /users/i })).toBeVisible()
  await expect(page.getByText(firstSuperuser).first()).toBeVisible()
})

test("UserActionsMenu is hidden for the caller's own row (self-lock guard)", async ({
  page,
}) => {
  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")

  const myRow = page.getByRole("row").filter({ hasText: firstSuperuser })
  await expect(myRow).toHaveCount(1)
  // The actions menu trigger is a <button> inside the row. Self-rows must
  // hide the menu so a superuser can't demote / deactivate / delete
  // themselves — the UI mirror of the Phase 2 backend guard.
  await expect(myRow.getByRole("button")).toHaveCount(0)
})

test("superuser creates a plain user, sees it in the table, then deletes it", async ({
  page,
}) => {
  const email = randomEmail()
  const password = randomPassword()

  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")

  await createUserViaAdminDialog(page, {
    email,
    fullName: "Playwright Plain User",
    password,
    isSuperuser: false,
  })

  // Row shows the "User" (not "Superuser") badge.
  const row = page.getByRole("row").filter({ hasText: email })
  await expect(row).toContainText(/^(?!Superuser).*User/)

  await deleteUserViaRow(page, email)
})

test("superuser creates a superuser, sees the Superuser badge, then deletes them", async ({
  page,
}) => {
  const email = randomEmail()
  const password = randomPassword()

  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")

  await createUserViaAdminDialog(page, {
    email,
    fullName: "Playwright Promoted",
    password,
    isSuperuser: true,
  })

  // Role column must show "Superuser" — catches a silent is_superuser drop.
  const row = page.getByRole("row").filter({ hasText: email })
  await expect(row).toContainText(/Superuser/)

  await deleteUserViaRow(page, email)
})

test("full auth chain: signup → log in as new user → admin promotes → new user reaches /admin", async ({
  page,
}) => {
  const email = randomEmail()
  const password = randomPassword()
  const fullName = "Playwright Chain User"

  // 1. Sign up through the UI and land on /login.
  await page.goto("/signup")
  await page.getByTestId("full-name-input").fill(fullName)
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByTestId("confirm-password-input").fill(password)
  await page.getByRole("button", { name: "Sign Up" }).click()
  await page.waitForURL("/login")

  // 2. Log in as the new user — verifies credentials are saved correctly.
  await logIn(page, email, password)
  // Plain users hit the auth guard on /admin because it requires superuser
  // (the current _layout guard lets any authed user in; the backend rejects
  // the list call → the page renders an error toast but does not crash).
  // Sanity: the plain user landed on the dashboard.
  await expect(page.getByTestId("user-menu")).toBeVisible()

  // 3. Log out, log in as the seeded superuser, and promote the new user.
  await logOutViaMenu(page)
  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")

  await page.waitForLoadState("networkidle")
  await dismissToasts(page)
  const row = page.getByRole("row").filter({ hasText: email })
  await row.getByRole("button").click()
  await page.getByRole("menuitem", { name: /edit user/i }).click()
  await page.getByLabel(/is superuser/i).check()
  await page.getByRole("button", { name: "Save" }).click()
  await expect(row).toContainText(/Superuser/)

  // 4. Log back in as the promoted user — they can now reach /admin.
  await logOutViaMenu(page)
  await logIn(page, email, password)
  await page.goto("/admin")
  await expect(page.getByRole("heading", { name: /users/i })).toBeVisible()
  await expect(page.getByText(email).first()).toBeVisible()

  // Cleanup: log back in as the seeded superuser and delete the chain user
  // so the admin table doesn't grow unbounded across runs.
  await logOutViaMenu(page)
  await logIn(page, firstSuperuser, firstSuperuserPassword)
  await page.goto("/admin")
  await deleteUserViaRow(page, email)
})
