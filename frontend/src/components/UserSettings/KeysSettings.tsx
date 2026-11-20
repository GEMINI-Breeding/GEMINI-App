/**
 * Settings → Keys & tokens: the person's own keys for model providers, saved
 * with their account and used by any model whose own settings have none.
 */
import { Check, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  KEY_FIELDS,
  maskKey,
  useCredentials,
  useSaveCredentials,
} from "@/lib/credentials"

export default function KeysSettings() {
  const saved = useCredentials()
  const save = useSaveCredentials()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)

  // Start from what is saved.
  useEffect(() => {
    if (saved.data) setDraft({ ...saved.data })
  }, [saved.data])

  const changed = KEY_FIELDS.some(
    (f) => (draft[f.key] ?? "") !== (saved.data?.[f.key] ?? ""),
  )

  const submit = async () => {
    setBusy(true)
    try {
      const patch: Record<string, string> = {}
      for (const f of KEY_FIELDS) patch[f.key] = (draft[f.key] ?? "").trim()
      await save(patch)
      toast.success("Keys saved")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the keys")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-4 pt-3" data-testid="keys-settings">
      <div>
        <h2 className="flex items-center gap-2 text-base font-medium">
          <KeyRound className="size-4" /> Keys &amp; tokens
        </h2>
        <p className="text-muted-foreground text-sm">
          Saved with your account and used by any model whose own settings have
          no key. Only you can see them; other people on this GEMI use their
          own.
        </p>
      </div>

      {saved.isError && (
        <p className="text-destructive text-sm">
          Your keys could not be read. The server may need restarting with the
          latest version.
        </p>
      )}

      <div className="space-y-4">
        {KEY_FIELDS.map((f) => {
          const value = draft[f.key] ?? ""
          const has = Boolean(saved.data?.[f.key])
          return (
            <div key={f.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={`key-${f.key}`}>{f.label}</Label>
                {has && (
                  <span className="text-muted-foreground flex items-center gap-1 text-xs">
                    <Check className="size-3 text-green-600" /> saved{" "}
                    {maskKey(saved.data?.[f.key] ?? "")}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  id={`key-${f.key}`}
                  type={shown[f.key] ? "text" : "password"}
                  autoComplete="off"
                  placeholder={f.placeholder}
                  value={value}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                  }
                  data-testid={`key-input-${f.key}`}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setShown((s) => ({ ...s, [f.key]: !s[f.key] }))
                  }
                  aria-label={shown[f.key] ? "Hide" : "Show"}
                >
                  {shown[f.key] ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                {f.use}{" "}
                <a
                  href={f.link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {f.link.text}
                </a>
                . Leave empty to remove it.
              </p>
            </div>
          )
        })}
      </div>

      <Button
        onClick={() => void submit()}
        disabled={busy || !changed || saved.isLoading}
        data-testid="keys-save"
      >
        {busy && <Loader2 className="mr-1.5 size-4 animate-spin" />}
        Save keys
      </Button>
      <p className="text-muted-foreground text-xs">
        A key entered on a model in a pipeline still wins for that model. The
        agent's own model key is set where you choose its model; online-storage
        connections under Files → Upload → Online storage.
      </p>
    </div>
  )
}
