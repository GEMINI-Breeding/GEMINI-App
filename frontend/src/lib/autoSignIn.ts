/**
 * No login step by default.
 *
 * The app is normally used by the one person whose computer it runs on, so
 * it signs in for them with the install's own account:
 *
 *   - desktop app: the account of the local stack (`stack_credentials`);
 *   - browser against a stack on this computer or a cluster: the agent
 *     service on this computer hands out a session (`/agent/auto_login`,
 *     answered for requests from this computer only).
 *
 * The stack itself still requires a session on every API call; only the
 * typing of a password is skipped. A login screen is shown when the person
 * asks for one (Settings → Sign-in), after a deliberate sign-out, or when
 * neither path is available (then the app behaves as it always did).
 */
import { agentApi } from "@/features/agent/lib/agentApi"
import { isLoggedIn, login, setToken } from "@/lib/auth"
import { isManagedStack, stackCredentials } from "@/lib/stack"

const REQUIRE_KEY = "gemini.auth.requireSignIn"
const SIGNED_OUT_KEY = "gemini.auth.signedOut"
const AUTO_KEY = "gemini.auth.automatic" // this session came from autoSignIn

function read(store: () => Storage, key: string): boolean {
  try {
    return store().getItem(key) === "1"
  } catch {
    return false
  }
}

function write(store: () => Storage, key: string, on: boolean): void {
  try {
    if (on) store().setItem(key, "1")
    else store().removeItem(key)
  } catch {
    // Storage unavailable: the default (no login step) applies.
  }
}

/** The person asked for a login screen when the app opens. */
export function signInRequired(): boolean {
  return read(() => localStorage, REQUIRE_KEY)
}

/**
 * Turn the login screen on or off. Stored in this browser and, when the
 * agent service is there, in the service too: with it on, the service stops
 * handing out sessions at all.
 */
export async function setSignInRequired(on: boolean): Promise<void> {
  if (!isManagedStack()) await agentApi.setRequireSignIn(on)
  write(() => localStorage, REQUIRE_KEY, on)
}

/** A deliberate sign-out holds until the person signs in again or closes the tab. */
export function markSignedOut(): void {
  write(() => sessionStorage, SIGNED_OUT_KEY, true)
}

export function clearSignedOut(): void {
  write(() => sessionStorage, SIGNED_OUT_KEY, false)
}

/** The person typed a login: there are accounts, show whose session this is. */
export function markManualSignIn(): void {
  write(() => localStorage, AUTO_KEY, false)
}

/**
 * Nobody signs in here: the app opened with the install's own account and no
 * login screen was asked for. There is then no "user" to show or sign out of;
 * signing out would only lock the person out of their own app.
 */
export function noAccountsInUse(): boolean {
  return !signInRequired() && read(() => localStorage, AUTO_KEY)
}

let inFlight: Promise<boolean> | null = null
// When the agent service last said there is no automatic session here (a
// member of someone's shared session signs in with their own account). The
// sign-in page asks again right after the app's start did: not for a while.
let declinedAt = 0
const DECLINED_FOR_MS = 60_000

/**
 * Sign in without a login screen if that is allowed and possible.
 * Resolves true when the app is signed in afterwards.
 */
export function autoSignIn(
  options: { afterSignOut?: boolean } = {},
): Promise<boolean> {
  if (isLoggedIn()) return Promise.resolve(true)
  if (signInRequired()) return Promise.resolve(false)
  if (!options.afterSignOut && read(() => sessionStorage, SIGNED_OUT_KEY))
    return Promise.resolve(false)
  if (Date.now() - declinedAt < DECLINED_FOR_MS) return Promise.resolve(false)
  inFlight ??= (async () => {
    try {
      if (isManagedStack()) {
        const { email, password } = await stackCredentials()
        await login(email, password)
      } else {
        const r = await agentApi.autoLogin().catch((e: unknown) => {
          // "No account to sign in with" is an answer, not an outage: remember it.
          if (e instanceof Error && /no account/i.test(e.message))
            declinedAt = Date.now()
          throw e
        })
        // Not enabled: a login screen was asked for. Not remembered here, so
        // switching it back off takes effect in every browser.
        if (!r.enabled || !r.token) {
          declinedAt = Date.now()
          return false
        }
        setToken(r.token)
      }
      clearSignedOut()
      write(() => localStorage, AUTO_KEY, true)
      return true
    } catch {
      return false // no agent service, no stack, bad account: fall back to the login page
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}
