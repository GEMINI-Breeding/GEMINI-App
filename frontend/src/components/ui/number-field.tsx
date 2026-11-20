import * as React from "react"

import { cn } from "@/lib/utils"

export type NumberFieldProps = {
  value: number
  onCommit: (next: number) => void
  min?: number
  max?: number
  /** Arrow/keyboard step (default 1). */
  step?: number
  /** When true, only integers are accepted and the parsed value is rounded. */
  integer?: boolean
  /** When false (default), the input rejects a leading minus. */
  allowNegative?: boolean
  id?: string
  className?: string
  "aria-label"?: string
  "data-testid"?: string
  disabled?: boolean
}

function buildPattern(integer: boolean, allowNegative: boolean): RegExp {
  // Anchor to full match; allow an in-flight "" / "-" / "0." while the user
  // is typing, plus full numbers. We don't accept exponential form — this is
  // a UI for degrees and meters, not scientific notation.
  const sign = allowNegative ? "-?" : ""
  if (integer) return new RegExp(`^${sign}\\d*$`)
  return new RegExp(`^${sign}\\d*(?:\\.\\d*)?$`)
}

function clamp(n: number, min?: number, max?: number): number {
  if (typeof min === "number" && n < min) return min
  if (typeof max === "number" && n > max) return max
  return n
}

function NumberField({
  value,
  onCommit,
  min,
  max,
  step = 1,
  integer = false,
  allowNegative = false,
  id,
  className,
  disabled,
  ...rest
}: NumberFieldProps) {
  const [draft, setDraft] = React.useState<string>(() => String(value))
  const [focused, setFocused] = React.useState(false)
  const pattern = React.useMemo(
    () => buildPattern(integer, allowNegative),
    [integer, allowNegative],
  )

  // Re-sync draft when value changes externally — but only when the input
  // isn't focused, so a remote update (undo/redo, snapshot load) doesn't
  // interrupt mid-typing.
  React.useEffect(() => {
    if (!focused) setDraft(String(value))
  }, [value, focused])

  function commit(rawDraft: string) {
    const trimmed = rawDraft.trim()
    if (trimmed === "" || trimmed === "-" || trimmed === ".") {
      setDraft(String(value))
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const rounded = integer ? Math.round(parsed) : parsed
    const next = clamp(rounded, min, max)
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    if (v === "" || pattern.test(v)) setDraft(v)
  }

  function onBlur() {
    setFocused(false)
    commit(draft)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      commit(draft)
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setDraft(String(value))
      return
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault()
      const dir = e.key === "ArrowUp" ? 1 : -1
      const base = Number(draft.trim())
      const start = Number.isFinite(base) ? base : value
      const stepped = start + dir * step
      const rounded = integer ? Math.round(stepped) : stepped
      const next = clamp(rounded, min, max)
      setDraft(String(next))
      if (next !== value) onCommit(next)
    }
  }

  return (
    <input
      id={id}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      data-slot="input"
      disabled={disabled}
      value={draft}
      onChange={onChange}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className,
      )}
      {...rest}
    />
  )
}

export { NumberField }
