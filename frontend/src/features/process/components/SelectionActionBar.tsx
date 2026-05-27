import { useState } from "react"

import { Button } from "@/components/ui/button"
import { NumberField } from "@/components/ui/number-field"

export type SelectionActionBarProps = {
  count: number
  onRotate: (degrees: number) => void
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
 * Group-translate happens directly on the map via Geoman drag and is
 * wired into BoundaryMap — no button here for it.
 */
export function SelectionActionBar({
  count,
  onRotate,
  onDelete,
  onClear,
  onSelectAllInBlock,
  onSelectAll,
  hasActiveBlock,
}: SelectionActionBarProps) {
  const [rotateInput, setRotateInput] = useState(0)
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
