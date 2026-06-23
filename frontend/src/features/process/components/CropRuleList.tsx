import { Plus, Trash2, Crop } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"

export type CropFilterMode = "plot" | "heading"
export type CropDirection = "up" | "down" | "left" | "right"
export type HeadingDirection = "north" | "south" | "east" | "west"

export interface CropRule {
  id: string
  filterMode?: CropFilterMode   // "plot" (default) or "heading"
  directions: CropDirection[]   // used when filterMode === "plot"
  headings?: HeadingDirection[] // used when filterMode === "heading"
  mask_left: number
  mask_right: number
  mask_top: number
  mask_bottom: number
}

export function newCropRule(): CropRule {
  return {
    id: crypto.randomUUID(),
    filterMode: "heading",
    directions: [],
    headings: [],
    mask_left: 0,
    mask_right: 0,
    mask_top: 0,
    mask_bottom: 0,
  }
}

const PLOT_DIR_OPTIONS: { value: CropDirection; icon: string; label: string }[] = [
  { value: "up",    icon: "↑", label: "Up"    },
  { value: "down",  icon: "↓", label: "Down"  },
  { value: "left",  icon: "←", label: "Left"  },
  { value: "right", icon: "→", label: "Right" },
]

const HEADING_OPTIONS: { value: HeadingDirection; label: string }[] = [
  { value: "north", label: "N" },
  { value: "south", label: "S" },
  { value: "east",  label: "E" },
  { value: "west",  label: "W" },
]

interface CropRuleListProps {
  rules: CropRule[]
  onChange: (rules: CropRule[]) => void
  onEdit: (ruleId: string) => void
  hasMsgsData?: boolean
}

export function CropRuleList({ rules, onChange, onEdit, hasMsgsData }: CropRuleListProps) {
  // Global mode is derived from the first rule (all rules share the same mode)
  const globalMode: CropFilterMode = rules[0]?.filterMode ?? "heading"

  // All headings/directions already claimed by any rule
  const usedHeadings = new Set<HeadingDirection>(rules.flatMap((r) => r.headings ?? []))
  const usedDirections = new Set<CropDirection>(rules.flatMap((r) => r.directions))

  function updateRule(id: string, patch: Partial<CropRule>) {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function setGlobalMode(mode: CropFilterMode) {
    if (mode === "heading" && hasMsgsData === false) {
      toast.error("Something went wrong!", {
        description:
          "No GPS metadata found for this pipeline. Upload and sync your data first to use heading-based crop rules.",
      })
      return
    }
    onChange(rules.map((r) => ({ ...r, filterMode: mode })))
  }

  function toggleDirection(ruleId: string, dir: CropDirection) {
    const rule = rules.find((r) => r.id === ruleId)!
    const has = rule.directions.includes(dir)
    // Prevent selecting a direction already used in another rule
    if (!has && usedDirections.has(dir)) return
    updateRule(ruleId, {
      directions: has ? rule.directions.filter((d) => d !== dir) : [...rule.directions, dir],
    })
  }

  function toggleHeading(ruleId: string, h: HeadingDirection) {
    const rule = rules.find((r) => r.id === ruleId)!
    const current = rule.headings ?? []
    const has = current.includes(h)
    // Prevent selecting a heading already used in another rule
    if (!has && usedHeadings.has(h)) return
    updateRule(ruleId, {
      headings: has ? current.filter((x) => x !== h) : [...current, h],
    })
  }

  function addRule() {
    onChange([...rules, { ...newCropRule(), filterMode: globalMode }])
  }

  function removeRule(id: string) {
    if (rules.length <= 1) return
    onChange(rules.filter((r) => r.id !== id))
  }

  return (
    <div className="space-y-2">
      {/* Global mode toggle — applies to all rules */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground font-medium">Filter by</span>
        <div className="flex rounded border overflow-hidden text-[10px] font-medium">
          <button
            type="button"
            onClick={() => setGlobalMode("plot")}
            className={`px-2 py-1 transition-colors ${
              globalMode === "plot"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Apply crop based on plot direction (set in Plot Marking)"
          >
            Plot Direction
          </button>
          <button
            type="button"
            onClick={() => setGlobalMode("heading")}
            className={`px-2 py-1 transition-colors border-l ${
              globalMode === "heading"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Apply crop based on GPS heading from msgs_synced.csv"
          >
            GPS Heading
          </button>
        </div>
      </div>

      {/* Rules */}
      <div className="space-y-1.5">
        {rules.map((rule) => {
          const activeDirections = rule.directions
          const activeHeadings = rule.headings ?? []
          const hasFilter = globalMode === "plot" ? activeDirections.length > 0 : activeHeadings.length > 0

          return (
            <div
              key={rule.id}
              className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-2"
            >
              {/* Direction / heading chips */}
              <div className="flex items-center gap-0.5 shrink-0">
                {!hasFilter && (
                  <span className="text-[10px] text-muted-foreground leading-none mr-1">All</span>
                )}
                {globalMode === "plot"
                  ? PLOT_DIR_OPTIONS.map(({ value, icon, label }) => {
                      const active = activeDirections.includes(value)
                      const takenElsewhere = !active && usedDirections.has(value)
                      return (
                        <button
                          key={value}
                          type="button"
                          title={
                            takenElsewhere
                              ? `${label} is already used in another rule`
                              : active
                              ? `${label} — click to remove`
                              : `Add ${label}`
                          }
                          disabled={takenElsewhere}
                          onClick={() => toggleDirection(rule.id, value)}
                          className={`h-6 w-6 rounded text-xs font-medium transition-colors ${
                            active
                              ? "bg-primary text-primary-foreground"
                              : takenElsewhere
                              ? "border text-muted-foreground/40 cursor-not-allowed"
                              : "border text-muted-foreground hover:text-foreground hover:bg-accent"
                          }`}
                        >
                          {icon}
                        </button>
                      )
                    })
                  : HEADING_OPTIONS.map(({ value, label }) => {
                      const active = activeHeadings.includes(value)
                      const takenElsewhere = !active && usedHeadings.has(value)
                      return (
                        <button
                          key={value}
                          type="button"
                          title={
                            takenElsewhere
                              ? `${label} is already used in another rule`
                              : active
                              ? `${label} — click to remove`
                              : `Add ${label}`
                          }
                          disabled={takenElsewhere}
                          onClick={() => toggleHeading(rule.id, value)}
                          className={`h-6 w-6 rounded text-xs font-medium transition-colors ${
                            active
                              ? "bg-primary text-primary-foreground"
                              : takenElsewhere
                              ? "border text-muted-foreground/40 cursor-not-allowed"
                              : "border text-muted-foreground hover:text-foreground hover:bg-accent"
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
              </div>

              {/* L / R / T / B inputs */}
              {(["mask_left", "mask_right", "mask_top", "mask_bottom"] as const).map((side) => (
                <div key={side} className="flex flex-col items-center gap-0.5 flex-1 min-w-0">
                  <span className="text-[9px] text-muted-foreground uppercase leading-none">
                    {side.replace("mask_", "")[0]}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    value={rule[side]}
                    className="h-7 text-xs text-center px-1"
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10)
                      updateRule(rule.id, { [side]: isNaN(v) ? 0 : Math.max(0, v) })
                    }}
                  />
                </div>
              ))}

              {/* Visual editor */}
              <button
                type="button"
                title="Open visual crop tool"
                onClick={() => onEdit(rule.id)}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <Crop className="h-4 w-4 text-orange-500" />
              </button>

              {/* Remove */}
              <button
                type="button"
                title="Remove rule"
                disabled={rules.length <= 1}
                onClick={() => removeRule(rule.id)}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}

        <button
          type="button"
          onClick={addRule}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Add rule
        </button>
      </div>
    </div>
  )
}
