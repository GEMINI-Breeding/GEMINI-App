import type { Page } from "@playwright/test"

import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
// Import `test` from helpers/fixtures so every case auto-attaches the
// console-error guard required by CLAUDE.md's strict-E2E rule.
import { expect, test } from "./helpers/fixtures"
import { randomPassword } from "./utils/random.ts"

// Every test in this file starts from an anonymous browser context so the
// login form is actually reachable.
test.use({ storageState: { cookies: [], origins: [] } })

const fillForm = async (page: Page, email: string, password: string) => {
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
}

const verifyInput = async (page: Page, testId: string) => {
  const input = page.getByTestId(testId)
  await expect(input).toBeVisible()
  await expect(input).toHaveText("")
  await expect(input).toBeEditable()
}

const waitForLoggedInShell = async (page: Page) => {
  // After a successful login we land on /. The post-migration shell puts
  // the user menu in the sidebar footer — use it as the "logged in" signal
  // since the legacy "Welcome back…" string is gone.
  await page.waitForURL("/")
  await expect(page.getByTestId("user-menu")).toBeVisible()
}

test("Inputs are visible, empty and editable", async ({ page }) => {
  await page.goto("/login")
  await verifyInput(page, "email-input")
  await verifyInput(page, "password-input")
})

test("Log In button is visible", async ({ page }) => {
  await page.goto("/login")
  await expect(page.getByRole("button", { name: "Log In" })).toBeVisible()
})

test("Forgot Password link is visible", async ({ page }) => {
  await page.goto("/login")
  await expect(
    page.getByRole("link", { name: "Forgot your password?" }),
  ).toBeVisible()
})

test("Log in with valid email and password", async ({ page }) => {
  await page.goto("/login")
  await fillForm(page, firstSuperuser, firstSuperuserPassword)
  await page.getByRole("button", { name: "Log In" }).click()
  await waitForLoggedInShell(page)
})

test("Log in with invalid email", async ({ page }) => {
  await page.goto("/login")
  await fillForm(page, "invalidemail", firstSuperuserPassword)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page.getByText(/invalid email/i)).toBeVisible()
})

test("Log in with invalid password", async ({ page }) => {
  const password = randomPassword()
  await page.goto("/login")
  await fillForm(page, firstSuperuser, password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page.getByText(/incorrect email or password/i)).toBeVisible()
})

// ── Log out ────────────────────────────────────────────────────────────────

test("Successful log out", async ({ page }) => {
  await page.goto("/login")
  await fillForm(page, firstSuperuser, firstSuperuserPassword)
  await page.getByRole("button", { name: "Log In" }).click()
  await waitForLoggedInShell(page)

  // Sanity check: the token is actually in storage before we log out.
  const tokenBefore = await page.evaluate(() =>
    localStorage.getItem("gemini.auth.token"),
  )
  expect(tokenBefore, "token must be set after login").toBeTruthy()

  await page.getByTestId("user-menu").click()
  await page.getByTestId("logout-menu-item").click()
  await page.waitForURL("/login")

  // Logging out must actually clear the token — a logout that only fires the
  // event without touching storage would leave the user effectively logged
  // in across reloads.
  const tokenAfter = await page.evaluate(() =>
    localStorage.getItem("gemini.auth.token"),
  )
  expect(tokenAfter, "token must be cleared on logout").toBeFalsy()
})

test("Logged-out user cannot access protected routes", async ({ page }) => {
  await page.goto("/login")
  await fillForm(page, firstSuperuser, firstSuperuserPassword)
  await page.getByRole("button", { name: "Log In" }).click()
  await waitForLoggedInShell(page)

  await page.getByTestId("user-menu").click()
  await page.getByTestId("logout-menu-item").click()
  await page.waitForURL("/login")

  await page.goto("/settings")
  await page.waitForURL("/login")
})

test("Redirects to /login when token is wrong", async ({ page }) => {
  // Visit /login once so we have an origin against which to seed localStorage,
  // then store a syntactically-invalid token and navigate to a protected
  // route; the 401 interceptor should kick in and bounce us back.
  await page.goto("/login")
  await page.evaluate(() => {
    localStorage.setItem("gemini.auth.token", "invalid_token")
  })
  await page.goto("/settings")
  await page.waitForURL("/login")
  await expect(page).toHaveURL("/login")
})
