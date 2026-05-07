import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import type { UserOutput } from "@/client"
import { UsersService } from "@/client"
import {
  isLoggedIn as _isLoggedIn,
  logout as _logout,
  onLogout,
} from "@/lib/auth"

/**
 * Reactive login-state hook. Synchronized with the Logout event dispatched
 * by `lib/auth.ts` so components re-render when the token is cleared from
 * any source (login page, 401 interceptor, explicit logout button).
 */
function useIsLoggedIn(): boolean {
  const [value, setValue] = useState(_isLoggedIn())
  useEffect(() => {
    const recompute = () => setValue(_isLoggedIn())
    // Fires on explicit logout() and on our 401 interceptor.
    const off = onLogout(recompute)
    // Storage event lets cross-tab logout propagate.
    const onStorage = (e: StorageEvent) => {
      if (e.key === "gemini.auth.token") recompute()
    }
    window.addEventListener("storage", onStorage)
    return () => {
      off()
      window.removeEventListener("storage", onStorage)
    }
  }, [])
  return value
}

const useAuth = () => {
  const loggedIn = useIsLoggedIn()
  const {
    data: user,
    isLoading: userLoading,
    error: userError,
  } = useQuery<UserOutput | null, Error>({
    queryKey: ["currentUser"],
    queryFn: async () => {
      if (!loggedIn) return null
      return UsersService.apiUsersMeReadMe()
    },
    enabled: loggedIn,
    // Don't keep retrying a busted token — one rejection means the JWT
    // is expired / signed with a different secret / outright invalid,
    // and the only recovery is to log out.
    retry: false,
  })

  // Failsafe: the global axios 401 interceptor in lib/auth.ts is supposed
  // to fire logout on any 401, but the SDK's exception path can swallow
  // the response and surface the failure here as a TanStack Query error
  // instead. Treat any failure of /api/users/me as token-rejection so
  // the _layout's onLogout listener can bounce the user to /login.
  useEffect(() => {
    if (loggedIn && userError) _logout()
  }, [loggedIn, userError])

  return {
    isLoggedIn: loggedIn,
    logout: _logout,
    user: user ?? null,
    /**
     * True until /api/users/me has resolved at least once. Useful for
     * components that need to wait on `is_superuser` before deciding
     * whether to filter scoped data.
     */
    isUserLoading: loggedIn && (userLoading || user === undefined),
  }
}

// Non-hook helper for router beforeLoad checks (where hooks can't run).
const isLoggedIn = _isLoggedIn

export { isLoggedIn }
export default useAuth
