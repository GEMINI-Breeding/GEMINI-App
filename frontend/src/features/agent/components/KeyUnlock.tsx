/**
 * KeyUnlock — the passphrase of an SSH key, entered once.
 *
 * Every cluster command the app makes is an SSH connection that cannot ask
 * anything. A key locked with a passphrase is unlocked into ssh-agent on this
 * computer (the agent service does it); later connections find it there until
 * the computer restarts. The passphrase is not saved, except in the macOS
 * Keychain when "Remember" is ticked.
 */
import { useMutation } from "@tanstack/react-query"
import { KeyRound } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { agentApi } from "@/features/agent/lib/agentApi"

/** The key named in a "has a passphrase" error from the agent service, or null. */
export function lockedKeyOf(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error ?? "")
  const m = text.match(/The key (.+?) has a passphrase/)
  return m ? m[1] : null
}

const onMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform ?? "")

export function KeyUnlock({
  keyPath,
  onUnlocked,
}: {
  keyPath: string
  onUnlocked: () => void
}) {
  const [passphrase, setPassphrase] = useState("")
  const [remember, setRemember] = useState(false)
  const unlock = useMutation({
    mutationFn: () => agentApi.computeSshUnlock(keyPath, passphrase, remember),
    onSuccess: () => {
      setPassphrase("")
      onUnlocked()
    },
  })
  return (
    <form
      className="space-y-2 rounded-md border border-amber-300 p-3 text-sm"
      data-testid="key-unlock"
      onSubmit={(e) => {
        e.preventDefault()
        if (passphrase) unlock.mutate()
      }}
    >
      <p className="flex items-center gap-1.5">
        <KeyRound className="h-4 w-4" />
        The key <span className="font-mono text-xs">{keyPath}</span> has a
        passphrase.
      </p>
      <Input
        type="password"
        autoComplete="off"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        placeholder="Key passphrase"
        aria-label="Key passphrase"
        data-testid="key-unlock-passphrase"
      />
      <p className="text-muted-foreground text-xs">
        Unlocks the key on this computer until it restarts, so the app can reach
        the cluster without asking again. The passphrase is not saved
        {onMac ? " unless you tick Remember." : "."}
      </p>
      {onMac && (
        <div className="flex items-center gap-2 text-xs">
          <Checkbox
            id="key-unlock-remember"
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
            data-testid="key-unlock-remember"
          />
          <label htmlFor="key-unlock-remember">
            Remember in this Mac's Keychain
          </label>
        </div>
      )}
      <Button
        type="submit"
        size="sm"
        disabled={!passphrase || unlock.isPending}
        data-testid="key-unlock-go"
      >
        {unlock.isPending ? "Unlocking…" : "Unlock"}
      </Button>
      {unlock.error && (
        <p className="text-destructive text-xs" data-testid="key-unlock-error">
          {unlock.error instanceof Error
            ? unlock.error.message
            : String(unlock.error)}
        </p>
      )}
    </form>
  )
}
