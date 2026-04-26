import { test as setup } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"

const AUTH_FILE = "playwright/.auth/user.json"
const STORAGE_KEY = "gemini.auth.token"

/**
 * Obtain a real JWT from the GEMINIbase REST API and persist it into
 * localStorage under the key the frontend's auth module reads
 * (`gemini.auth.token`). The legacy chromium project reuses this
 * storageState so every page load sees an authenticated user, just like
 * the e2e-workflows project does via tests/helpers/e2e.setup.ts.
 *
 * Older versions of this file logged in via the UI form, but that path
 * is brittle: a bug in the login form (or a regression in the redirect)
 * would silently produce a "logged-in" storage state without a real token,
 * and downstream specs would fail in confusing ways. Calling
 * `/api/users/login/access-token` directly fails loudly if the token can't
 * be obtained.
 */
setup("authenticate", async ({ page, request, baseURL }) => {
  if (!baseURL) {
    throw new Error("baseURL is not configured; check playwright.config.ts")
  }
  const res = await request.post(
    new URL("/api/users/login/access-token", baseURL).toString(),
    {
      data: { email: firstSuperuser, password: firstSuperuserPassword },
      headers: { "Content-Type": "application/json" },
    },
  )
  if (!res.ok()) {
    throw new Error(
      `login/access-token failed: ${res.status()} ${await res.text()}`,
    )
  }
  const { access_token } = (await res.json()) as { access_token: string }

  await page.addInitScript(
    ({ token, key }: { token: string; key: string }) => {
      localStorage.setItem(key, token)
    },
    { token: access_token, key: STORAGE_KEY },
  )
  await page.goto("/")

  await page.context().storageState({ path: AUTH_FILE })
})
