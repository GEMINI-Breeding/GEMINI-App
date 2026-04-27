/**
 * EntitySelectField — pick an existing entity OR create a new one inline.
 *
 * Mirrors the pattern in `backend/gemini-ui/src/components/import-wizard/
 * step-metadata.tsx`: a dropdown of existing options ends with a sentinel
 * "+ Create new..." choice that reveals a text input for the new name.
 *
 * The selection is held by the parent as a discriminated state object so
 * downstream code can tell:
 *   - kind: "existing"  → use `id` and `name` (lookup result),
 *   - kind: "new"       → POST a new entity with `name` before upload,
 *   - kind: "none"      → form invalid; block submit with a clear message.
 *
 * The component is pure UI; the parent owns mutations and persistence.
 */
import { Loader2 } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type EntityChoice =
  | { kind: "none" }
  | { kind: "existing"; id: string; name: string }
  | { kind: "new"; name: string }

const CREATE_NEW = "__create_new__"
const NOT_SELECTED = "__not_selected__"

export type EntityOption = { id: string; name: string }

export interface EntitySelectFieldProps {
  /** Visible label, e.g. "Experiment". */
  label: string
  /** Stable key used for testids: e.g. "experiment", "sensor-platform". */
  fieldKey: string
  value: EntityChoice
  onChange: (next: EntityChoice) => void
  options: EntityOption[]
  isLoading?: boolean
  required?: boolean
  /** Disables both the select and the input. */
  disabled?: boolean
  /** Hint shown under the field. */
  description?: string
  /** Pre-fills the new-name input when "+ Create new..." is first picked. */
  newNameSuggestion?: string
}

/**
 * Resolve the form-state representation of a selection back into an
 * `EntityChoice` discriminated union. Useful when the parent serializes
 * the form state and needs to translate it back.
 */
export function chooseExisting(option: EntityOption): EntityChoice {
  return { kind: "existing", id: option.id, name: option.name }
}
export function chooseNew(name: string): EntityChoice {
  return { kind: "new", name }
}

export function isChoiceComplete(c: EntityChoice): boolean {
  if (c.kind === "existing") return Boolean(c.id && c.name)
  if (c.kind === "new") return c.name.trim().length > 0
  return false
}

export function EntitySelectField({
  label,
  fieldKey,
  value,
  onChange,
  options,
  isLoading,
  required,
  disabled,
  description,
  newNameSuggestion,
}: EntitySelectFieldProps) {
  const slugTestId = fieldKey.toLowerCase().replace(/_/g, "-")
  const selectValue =
    value.kind === "existing"
      ? value.id
      : value.kind === "new"
        ? CREATE_NEW
        : NOT_SELECTED

  const handleSelect = (next: string) => {
    if (next === CREATE_NEW) {
      onChange({ kind: "new", name: newNameSuggestion ?? "" })
      return
    }
    if (next === NOT_SELECTED) {
      onChange({ kind: "none" })
      return
    }
    const opt = options.find((o) => o.id === next)
    if (opt) onChange(chooseExisting(opt))
  }

  const newName = value.kind === "new" ? value.name : ""

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`entity-${slugTestId}`}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {isLoading ? (
        <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <Select
          value={selectValue}
          onValueChange={handleSelect}
          disabled={disabled}
        >
          <SelectTrigger
            id={`entity-${slugTestId}`}
            data-testid={`entity-select-${slugTestId}`}
          >
            <SelectValue
              placeholder={`Select ${label.toLowerCase()} or create new…`}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CREATE_NEW} data-testid={`entity-create-${slugTestId}`}>
              + Create new…
            </SelectItem>
            {options.length === 0 ? (
              <SelectItem value="__none_yet__" disabled>
                No {label.toLowerCase()}s exist yet — pick "Create new…"
              </SelectItem>
            ) : (
              options.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      )}
      {value.kind === "new" && (
        <Input
          id={`entity-new-${slugTestId}`}
          data-testid={`entity-new-${slugTestId}`}
          value={newName}
          onChange={(e) => onChange({ kind: "new", name: e.target.value })}
          placeholder={`New ${label.toLowerCase()} name`}
          disabled={disabled}
          autoFocus
        />
      )}
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
