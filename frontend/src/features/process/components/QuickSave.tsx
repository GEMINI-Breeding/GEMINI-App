/**
 * QuickSave — a small save control floating on the boundary map, so plots can
 * be saved without opening the "Versions & saving" panel. It saves and
 * activates under a default name. When a version already has that name, it
 * asks first: another name (a new version) or overwrite that version.
 */
import { EyeOff, Save } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { PlotGeometryVersion } from "@/features/process/hooks/usePlotGeometry"

/** "Name" → "Name (2)", "Name (3)"… the first one no version has. */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  const stem = base.replace(/\s\(\d+\)$/, "")
  for (let n = 2; ; n += 1) {
    const c = `${stem} (${n})`
    if (!taken.has(c)) return c
  }
}

export function QuickSave({
  defaultName,
  versions,
  busy,
  disabled,
  onSave,
}: {
  defaultName: string
  versions: PlotGeometryVersion[]
  busy: boolean
  disabled: boolean
  onSave: (opts: { name: string; version?: number }) => Promise<boolean>
}) {
  const [hidden, setHidden] = useState(false)
  // Set when the name is taken: the person picks a name or overwrites.
  const [asking, setAsking] = useState<{ name: string } | null>(null)

  const taken = new Set(versions.map((v) => (v.name ?? "").trim()))
  const sameName = (name: string) =>
    // The newest version with this name is the one to overwrite.
    versions
      .filter((v) => (v.name ?? "").trim() === name.trim())
      .sort((a, b) => b.version - a.version)[0]

  async function save(name: string, version?: number) {
    if (await onSave({ name: name.trim(), version })) setAsking(null)
  }

  function quick() {
    if (sameName(defaultName))
      setAsking({ name: uniqueName(defaultName, taken) })
    else void save(defaultName)
  }

  const box =
    "absolute bottom-3 left-3 z-[1000] rounded-lg border bg-background/80 shadow-md backdrop-blur-sm"

  if (hidden) {
    return (
      <Button
        size="icon"
        variant="outline"
        className={`${box} size-8 p-0`}
        title="Show quick save"
        aria-label="Show quick save"
        data-testid="quick-save-show"
        onClick={() => setHidden(false)}
      >
        <Save className="size-4" />
      </Button>
    )
  }

  const clash = asking ? sameName(asking.name) : undefined
  return (
    <div className={`${box} w-64 p-2 text-xs`} data-testid="quick-save">
      {!asking ? (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            className="h-7 min-w-0 flex-1 justify-start gap-1.5 text-xs"
            disabled={disabled || busy}
            title={`Save and activate as “${defaultName}”`}
            data-testid="quick-save-button"
            onClick={quick}
          >
            <Save className="size-3.5 shrink-0" />
            <span className="truncate">
              {busy ? "Saving…" : `Save “${defaultName}”`}
            </span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            title="Hide (the save button stays in the corner)"
            aria-label="Hide quick save"
            onClick={() => setHidden(true)}
          >
            <EyeOff className="size-3.5" />
          </Button>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (asking.name.trim() && !clash) void save(asking.name)
          }}
        >
          <p className="text-muted-foreground leading-snug">
            A version is already named “{defaultName}”. Save under another name,
            or overwrite it.
          </p>
          <Input
            autoFocus
            className="h-7 text-xs"
            aria-label="Version name"
            data-testid="quick-save-name"
            value={asking.name}
            onChange={(e) => setAsking({ name: e.target.value })}
          />
          {clash && (
            <p className="text-amber-600 dark:text-amber-400">
              “{asking.name.trim()}” is taken too (v{clash.version}).
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="submit"
              size="sm"
              className="h-7 text-xs"
              disabled={busy || !asking.name.trim() || !!clash}
              data-testid="quick-save-new"
            >
              Save as new
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={busy}
              data-testid="quick-save-overwrite"
              onClick={() => {
                const v = clash ?? sameName(defaultName)
                if (v) void save(v.name ?? defaultName, v.version)
              }}
            >
              Overwrite v{(clash ?? sameName(defaultName))?.version}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setAsking(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
