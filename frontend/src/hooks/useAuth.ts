import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { UsersService } from "@/client"
import type { UserOutput } from "@/client"
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
  const { data: user } = useQuery<UserOutput | null, Error>({
    queryKey: ["currentUser"],
    queryFn: async () => {
      if (!loggedIn) return null
      return UsersService.apiUsersMeReadMe()
    },
    enabled: loggedIn,
  })

  return {
    isLoggedIn: loggedIn,
    logout: _logout,
    user: user ?? null,
  }
}

// Non-hook helper for router beforeLoad checks (where hooks can't run).
const isLoggedIn = _isLoggedIn

export { isLoggedIn }
export default useAuth
