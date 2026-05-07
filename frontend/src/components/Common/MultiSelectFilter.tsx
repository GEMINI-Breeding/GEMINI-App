import { ChevronDown } from "lucide-react"
import { useEffect, useRef, useState } from "react"

/**
 * Multi-select dropdown with checkboxes. An empty `selected` set means
 * "All" — no filter applied. Toggling the "All" row clears the selection.
 *
 * Used by the View tab's TraitDataViewer + ImageViewer and by the Analyze
 * page's TraitCharts. Single source of truth so filter UX stays consistent.
 */
interface MultiSelectFilterProps {
  label: string
  options: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  width?: string
  testId?: string
}

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  width = "w-44",
  testId,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  const isAll = selected.size === 0
  const summary = isAll
    ? `All (${options.length})`
    : selected.size === 1
      ? [...selected][0]
      : `${selected.size} selected`

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  const triggerId = testId ? `${testId}-trigger` : undefined

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground" htmlFor={triggerId}>
        {label}
      </label>
      <div ref={containerRef} className="relative">
        <button
          id={triggerId}
          type="button"
          onClick={() => setOpen(!open)}
          className={`${width} flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring`}
          data-testid={testId}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="w-4 h-4 shrink-0 opacity-60" />
        </button>
        {open && (
          <div className="absolute z-50 mt-1 max-h-64 min-w-full overflow-auto rounded-md border bg-background shadow-lg">
            <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent border-b">
              <input
                type="checkbox"
                checked={isAll}
                onChange={() => onChange(new Set())}
                className="accent-primary w-4 h-4"
              />
              <span className="font-medium">All ({options.length})</span>
            </label>
            {options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={selected.has(opt)}
                  onChange={() => toggle(opt)}
                  className="accent-primary w-4 h-4"
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
