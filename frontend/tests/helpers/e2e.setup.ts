import { test as setup } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "../config"

const AUTH_FILE = "playwright/.auth/e2e-user.json"

/**
 * Obtain a real JWT from the backend's /login/access-token endpoint and
 * save it into localStorage as `access_token`. Tests in the e2e-workflows
 * project reuse this storageState so the frontend reads the token in every
 * page load.
 *
 * The app's `isLoggedIn()` is currently a stub that always returns true and
 * the backend's `get_current_user` ignores the Authorization header, so
 * auth isn't enforced end-to-end — but the frontend still reads
 * localStorage.access_token when composing some requests, so seeding a
 * valid token keeps the frontend code path realistic.
 */
setup("e2e-auth", async ({ page, request }) => {
  const apiUrl = process.env.VITE_API_URL ?? "http://localhost:8000"

  const res = await request.post(`${apiUrl}/api/v1/login/access-token`, {
    form: {
      username: firstSuperuser,
      password: firstSuperuserPassword,
    },
  })
  if (!res.ok()) {
    throw new Error(`login/access-token failed: ${res.status()} ${await res.text()}`)
  }
  const { access_token } = (await res.json()) as { access_token: string }

  // Seed the token into the frontend's origin localStorage via an
  // addInitScript-then-goto dance so storageState picks it up.
  await page.addInitScript((token: string) => {
    localStorage.setItem("access_token", token)
  }, access_token)
  await page.goto("/")

  await page.context().storageState({ path: AUTH_FILE })
})
