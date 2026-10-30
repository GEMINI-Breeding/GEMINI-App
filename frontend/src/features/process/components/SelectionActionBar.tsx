import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NumberField } from "@/components/ui/number-field"

export type SelectionActionBarProps = {
  count: number
  onRotate: (degrees: number) => void
  /** Move the selection by metres: east (+) / west (-), north (+) / south (-). */
  onNudge?: (eastM: number, northM: number) => void
  /** The nudge step, metres (shared with the arrow keys). */
  nudgeStep?: number
  onNudgeStepChange?: (m: number) => void
  /** One plot selected: its name, to keep or change. */
  plotName?: string
  onRenamePlot?: (name: string) => void
  /** Renumber from the opposite side: rows = top↔bottom, cols = left↔right. */
  onFlip: (axis: "rows" | "cols") => void
  onDelete: () => void
  onClear: () => void
  onSelectAllInBlock: () => void
  onSelectAll: () => void
  /** Whether an active block is set — used to gate "select all in block". */
  hasActiveBlock: boolean
}

/**
 * Floating toolbar that appears when one or more cells are selected.
 * Exposes the bulk operations the user asked for: select-all helpers,
 * rotation (steppers + exact-degree input), and delete.
 *
 * Moving: drag a selected cell on the map, or nudge by a step in metres
 * (the buttons here, or the arrow keys).
 */
export function SelectionActionBar({
  count,
  onRotate,
  onNudge,
  nudgeStep = 0.1,
  onNudgeStepChange,
  plotName,
  onRenamePlot,
  onFlip,
  onDelete,
  onClear,
  onSelectAllInBlock,
  onSelectAll,
  hasActiveBlock,
}: SelectionActionBarProps) {
  const [rotateInput, setRotateInput] = useState(0)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div
      className="rounded-md border bg-amber-50/40 p-3 text-sm dark:bg-amber-950/20"
      data-testid="selection-action-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium" data-testid="selection-count">
          {count} cell{count === 1 ? "" : "s"} selected
        </span>
        <span className="text-muted-foreground text-xs">
          Drag any selected cell to move the group · Shift-click to extend ·
          Cmd/Ctrl-click to toggle
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            data-testid="select-all-in-block"
            disabled={!hasActiveBlock}
            onClick={onSelectAllInBlock}
          >
            All in block
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid="select-all"
            onClick={onSelectAll}
          >
            All
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="selection-clear"
            onClick={onClear}
          >
            Clear
          </Button>
        </div>
      </div>

      {plotName !== undefined && onRenamePlot && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          data-testid="plot-rename"
          onSubmit={(e) => {
            e.preventDefault()
            const v = (nameDraft ?? plotName).trim()
            if (v) onRenamePlot(v)
            setNameDraft(null)
          }}
        >
          <label htmlFor="plot-rename-input" className="text-xs">
            Plot name:
          </label>
          <Input
            id="plot-rename-input"
            className="h-8 w-40"
            value={nameDraft ?? plotName}
            onChange={(e) => setNameDraft(e.target.value)}
            data-testid="plot-rename-input"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={
              nameDraft === null || !nameDraft.trim() || nameDraft === plotName
            }
          >
            Rename
          </Button>
        </form>
      )}

      {onNudge && (
        <div
          className="mt-3 flex flex-wrap items-center gap-2"
          data-testid="nudge-controls"
        >
          <span className="text-xs">Move:</span>
          <Button
            size="sm"
            variant="outline"
            aria-label="Move west"
            data-testid="nudge-west"
            onClick={() => onNudge(-nudgeStep, 0)}
          >
            ←
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="Move north"
            data-testid="nudge-north"
            onClick={() => onNudge(0, nudgeStep)}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="Move south"
            data-testid="nudge-south"
            onClick={() => onNudge(0, -nudgeStep)}
          >
            ↓
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="Move east"
            data-testid="nudge-east"
            onClick={() => onNudge(nudgeStep, 0)}
          >
            →
          </Button>
          <span className="text-xs">by</span>
          <NumberField
            value={nudgeStep}
            onCommit={(v) => onNudgeStepChange?.(v > 0 ? v : 0.1)}
            min={0}
            step={0.05}
            data-testid="nudge-step"
            className="h-8 w-20"
            aria-label="Move step in metres"
          />
          <span className="text-muted-foreground text-xs">
            m · arrow keys too (Shift: ×10)
          </span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs">Rotate:</span>
        <Button
          size="sm"
          variant="outline"
          data-testid="rotate-minus-10"
          onClick={() => onRotate(-10)}
        >
          −10°
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="rotate-minus-1"
          onClick={() => onRotate(-1)}
        >
          −1°
        </Button>
        <div className="flex items-center gap-1">
          <NumberField
            value={rotateInput}
            onCommit={setRotateInput}
            allowNegative
            step={0.1}
            data-testid="rotate-input"
            className="h-8 w-20"
            aria-label="Rotation degrees"
          />
          <Button
            size="sm"
            data-testid="rotate-apply"
            disabled={rotateInput === 0}
            onClick={() => {
              onRotate(rotateInput)
              setRotateInput(0)
            }}
          >
            Apply
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          data-testid="rotate-plus-1"
          onClick={() => onRotate(1)}
        >
          +1°
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="rotate-plus-10"
          onClick={() => onRotate(10)}
        >
          +10°
        </Button>

        <span className="ml-2 text-xs">Flip:</span>
        <Button
          size="sm"
          variant="outline"
          data-testid="selection-flip-rows"
          title="Renumber top ↔ bottom (plots keep their numbers, swap footprints)"
          onClick={() => onFlip("rows")}
        >
          ↕
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="selection-flip-cols"
          title="Renumber left ↔ right (plots keep their numbers, swap footprints)"
          onClick={() => onFlip("cols")}
        >
          ↔
        </Button>

        <div className="ml-auto">
          {confirmingDelete ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                data-testid="selection-delete-confirm"
                onClick={() => {
                  onDelete()
                  setConfirmingDelete(false)
                }}
              >
                Delete {count}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              data-testid="selection-delete"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete…
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
