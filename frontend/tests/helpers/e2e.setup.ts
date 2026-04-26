import { test as setup } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "../config"

const AUTH_FILE = "playwright/.auth/e2e-user.json"
const STORAGE_KEY = "gemini.auth.token"

/**
 * Obtain a real JWT from the GEMINIbase REST API and persist it into
 * localStorage under the key the frontend's auth module reads
 * (`gemini.auth.token`). Subsequent specs in the `e2e-workflows` project
 * reuse this storageState so every page load sees an authenticated user.
 *
 * Uses the page's baseURL (configured in playwright.config.ts) for the
 * login request so changing the dev-server port doesn't require touching
 * this file. The dev server proxies `/api` to http://127.0.0.1:7777.
 */
setup("e2e-auth", async ({ page, request, baseURL }) => {
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
