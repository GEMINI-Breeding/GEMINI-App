/**
 * Bearer-token auth for the GEMINIbase backend.
 *
 * Token lifecycle:
 *   login()     → POST /api/users/login/access-token, store JWT in localStorage
 *   getToken()  → read JWT from localStorage (used by OpenAPI.TOKEN resolver)
 *   logout()    → clear JWT, dispatch a browser event so hooks can react
 *   isLoggedIn  → presence of a token (not a liveness check; the backend
 *                 will 401 on expired tokens and the interceptor handles
 *                 that case)
 *
 * The backend enforces auth on /api/* (except the small open whitelist
 * in gemini/rest_api/guards.py). When GEMINI_JWT_SECRET is empty on the
 * backend the guard is a no-op; calls still work without a token.
 */
import axios, { AxiosError } from "axios"

import { UsersService } from "@/client"
import { OpenAPI } from "@/client/core/OpenAPI"

const STORAGE_KEY = "gemini.auth.token"
const LOGOUT_EVENT = "gemini:logout"

export function getToken(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ""
  } catch {
    // localStorage can throw in private-mode Safari and some SSR contexts.
    return ""
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token)
  } catch {
    // Best-effort; fall through if storage is unavailable.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Same as above.
  }
}

export function isLoggedIn(): boolean {
  return getToken().length > 0
}

export function logout(): void {
  clearToken()
  // Components that read user state listen for this so they don't have to
  // poll localStorage. Router guards check `isLoggedIn()` on navigation.
  window.dispatchEvent(new Event(LOGOUT_EVENT))
}

export function onLogout(handler: () => void): () => void {
  window.addEventListener(LOGOUT_EVENT, handler)
  return () => window.removeEventListener(LOGOUT_EVENT, handler)
}

/**
 * Exchange an email+password for a JWT and stash it in localStorage.
 * Returns the token string on success; throws on bad credentials.
 */
export async function login(email: string, password: string): Promise<string> {
  const resp = await UsersService.apiUsersLoginAccessTokenLoginAccessToken({
    requestBody: { email, password },
  })
  const token = resp?.access_token
  if (!token) {
    throw new Error("Login succeeded but the response had no access_token.")
  }
  setToken(token)
  return token
}

/**
 * Wire OpenAPI.TOKEN to read from localStorage on every request, and
 * install a 401 interceptor that forces logout when the backend rejects
 * our token. Call this once at app startup.
 *
 * We pass a resolver (not a static string) so token rotation and the
 * `logout()` path take effect without re-mounting the client.
 */
export function installAuthInterceptors(): void {
  OpenAPI.TOKEN = async () => getToken()

  // Axios response interceptor — triggers logout on 401 so the caller lands
  // back on the login page instead of seeing a stale "not found" state.
  axios.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      const status = error?.response?.status
      const url = (error?.config?.url ?? "") as string
      // Don't fire logout when the 401 comes from the login endpoint itself
      // (bad-credentials responses are 401 and handling them as "logout"
      // would put the user in a loop).
      if (status === 401 && !url.includes("/login/access-token")) {
        logout()
      }
      return Promise.reject(error)
    },
  )
}
