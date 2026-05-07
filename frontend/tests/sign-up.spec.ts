import type { Page } from "@playwright/test"

// Import `test` from helpers/fixtures so every case auto-attaches the
// console-error guard required by CLAUDE.md's strict-E2E rule.
import { expect, test } from "./helpers/fixtures"
import { randomEmail, randomPassword } from "./utils/random"

test.use({ storageState: { cookies: [], origins: [] } })

const fillForm = async (
  page: Page,
  full_name: string,
  email: string,
  password: string,
  confirm_password: string,
) => {
  await page.getByTestId("full-name-input").fill(full_name)
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByTestId("confirm-password-input").fill(confirm_password)
}

const verifyInput = async (page: Page, testId: string) => {
  const input = page.getByTestId(testId)
  await expect(input).toBeVisible()
  await expect(input).toHaveText("")
  await expect(input).toBeEditable()
}

test("Inputs are visible, empty and editable", async ({ page }) => {
  await page.goto("/signup")

  await verifyInput(page, "full-name-input")
  await verifyInput(page, "email-input")
  await verifyInput(page, "password-input")
  await verifyInput(page, "confirm-password-input")
})

test("Sign Up button is visible", async ({ page }) => {
  await page.goto("/signup")

  await expect(page.getByRole("button", { name: "Sign Up" })).toBeVisible()
})

test("Log In link is visible", async ({ page }) => {
  await page.goto("/signup")

  await expect(page.getByRole("link", { name: "Log In" })).toBeVisible()
})

test("Sign up with valid name, email, and password", async ({ page }) => {
  const full_name = "Test User"
  const email = randomEmail()
  const password = randomPassword()

  await page.goto("/signup")
  await fillForm(page, full_name, email, password, password)
  await page.getByRole("button", { name: "Sign Up" }).click()

  // The happy path navigates to /login; a success toast is also rendered.
  // If signup silently 500'd, the page would stay on /signup and this would
  // time out — which is the correct failure.
  await page.waitForURL("/login")
  await expect(page.getByText(/account created/i)).toBeVisible()
})

test("Sign up with invalid email", async ({ page }) => {
  await page.goto("/signup")

  await fillForm(
    page,
    "Playwright Test",
    "invalid-email",
    "changethis",
    "changethis",
  )
  await page.getByRole("button", { name: "Sign Up" }).click()

  await expect(page.getByText("Invalid email address")).toBeVisible()
})

test("Sign up with existing email", async ({ page, consoleErrorGuard }) => {
  // The duplicate-email path is the test's subject: the second signup POST
  // returns 400 with `{error:"Email taken", error_description:"..."}`, and
  // the form surfaces that as a toast. Declare the deliberate 400 so the
  // guard doesn't fail us on the resource-load failure.
  consoleErrorGuard.expectError(/\/api\/users\/signup/)
  const fullName = "Test User"
  const email = randomEmail()
  const password = randomPassword()

  // First signup. Wait for the POST to complete (and the post-success
  // navigation to /login) before attempting the duplicate, otherwise a
  // race between the cancelled-by-navigation first request and the second
  // request hits the backend's INSERT path with the email-existence check
  // skipped on the second call — surfacing as a 500 instead of the
  // expected 400.
  await page.goto("/signup")
  await fillForm(page, fullName, email, password, password)
  const firstSignupResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/users/signup") && r.request().method() === "POST",
  )
  await page.getByRole("button", { name: "Sign Up" }).click()
  await firstSignupResponse
  await page.waitForURL("/login")

  // Sign up again with the same email — must resolve to a structured
  // 400 with the "Email taken" detail.
  await page.goto("/signup")
  await fillForm(page, fullName, email, password, password)
  await page.getByRole("button", { name: "Sign Up" }).click()

  await expect(
    page.getByText(/(already registered|already exists|email taken)/i),
  ).toBeVisible()
})

test("Sign up with weak password", async ({ page }) => {
  const fullName = "Test User"
  const email = randomEmail()
  const password = "weak"

  await page.goto("/signup")

  await fillForm(page, fullName, email, password, password)
  await page.getByRole("button", { name: "Sign Up" }).click()

  await expect(
    page.getByText("Password must be at least 8 characters"),
  ).toBeVisible()
})

test("Sign up with mismatched passwords", async ({ page }) => {
  const fullName = "Test User"
  const email = randomEmail()
  const password = randomPassword()
  const password2 = randomPassword()

  await page.goto("/signup")

  await fillForm(page, fullName, email, password, password2)
  await page.getByRole("button", { name: "Sign Up" }).click()

  await expect(page.getByText("The passwords don't match")).toBeVisible()
})

test("Sign up with missing full name", async ({ page }) => {
  const fullName = ""
  const email = randomEmail()
  const password = randomPassword()

  await page.goto("/signup")

  await fillForm(page, fullName, email, password, password)
  await page.getByRole("button", { name: "Sign Up" }).click()

  await expect(page.getByText("Full Name is required")).toBeVisible()
})

test("Sign up with missing email", async ({ page }) => {
  const fullName = "Test User"
  const email = ""
  const password = randomPassword()

  await page.goto("/signup")

  await fillForm(page, fullName, email, password, password)
  await page.getByRole("button", { name: "Sign Up" }).click()

  await expect(page.getByText("Invalid email address")).toBeVisible()
})

test("Sign up with missing password", async ({ page }) => {
  const fullName = ""
  const email = randomEmail()
  const password = ""

  await page.goto("/signup")

  await fillForm(page, fullName, email, password, password)
  await page.getByRole("button", { name: "Sign Up" }).click()

  await expect(page.getByText("Password is required")).toBeVisible()
})
