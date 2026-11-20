/**
 * Settings → Sign-in. By default the app opens without a login screen,
 * signed in with this computer's own account; this is the switch for asking
 * for one instead (shared computers, more than one account).
 */
import { useState } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import useAuth from "@/hooks/useAuth"
import { setSignInRequired, signInRequired } from "@/lib/autoSignIn"

export function SignInSettings() {
  const { user } = useAuth()
  const [required, setRequired] = useState(signInRequired())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const change = async (on: boolean) => {
    setSaving(true)
    setError(null)
    try {
      await setSignInRequired(on)
      setRequired(on)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4" data-testid="signin-settings">
      <div>
        <h2 className="text-sm font-medium">Sign-in</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          GEMI opens without a login screen: it signs in with this computer's
          own account{user?.email ? ` (${user.email})` : ""}. Turn the login
          screen on if this computer is shared, or if people should use their
          own accounts.
        </p>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="require-sign-in"
          data-testid="require-sign-in"
          className="mt-0.5"
          checked={required}
          disabled={saving}
          onCheckedChange={(v) => void change(v === true)}
        />
        <label htmlFor="require-sign-in" className="text-sm">
          Ask for an email and password when the app opens
          <span className="text-muted-foreground block text-xs">
            Takes effect the next time the app is opened or you sign out. Make
            sure you know this account's password first: it can be changed on
            the Account tab.
          </span>
        </label>
      </div>
      {error && (
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}
