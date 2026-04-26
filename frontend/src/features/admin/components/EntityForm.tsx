/**
 * Generic form rendered from an EntityField[] schema.
 *
 * Used by both the Add and Edit dialogs in AdminEntityPage. Stays minimal —
 * each field type maps to a single shadcn input variant. Validation is
 * "required-only" because the underlying SDK already validates server-side
 * and surfaces errors via the toast handler. If a field needs richer
 * validation (e.g. min length), wire a `description` and rely on the
 * server's response.
 */
import type { ChangeEvent, FormEvent } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { EntityField } from "@/features/admin/lib/types"

export type EntityFormProps<TInput extends Record<string, unknown>> = {
  fields: EntityField<TInput>[]
  value: TInput
  onChange: (next: TInput) => void
  onSubmit: () => void
  /** Optional id so a parent <button form={id}> can submit from outside. */
  id?: string
}

function setField<TInput extends Record<string, unknown>>(
  prev: TInput,
  key: keyof TInput,
  value: unknown,
): TInput {
  return { ...prev, [key]: value } as TInput
}

export function EntityForm<TInput extends Record<string, unknown>>({
  fields,
  value,
  onChange,
  onSubmit,
  id,
}: EntityFormProps<TInput>) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSubmit()
  }

  return (
    <form id={id} onSubmit={handleSubmit} className="grid gap-3">
      {fields
        .filter((f) => !f.formHidden)
        .map((f) => {
          const v = value[f.key]
          const inputId = `entity-field-${f.key}`
          return (
            <div key={f.key} className="grid gap-1.5">
              <Label htmlFor={inputId} className="text-xs">
                {f.label}
                {f.required && <span className="ml-1 text-red-600">*</span>}
              </Label>
              {f.type === "text" && (
                <Input
                  id={inputId}
                  required={f.required}
                  placeholder={f.placeholder}
                  value={typeof v === "string" ? v : ""}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    onChange(setField(value, f.key, e.target.value))
                  }
                />
              )}
              {f.type === "textarea" && (
                <Textarea
                  id={inputId}
                  required={f.required}
                  placeholder={f.placeholder}
                  rows={3}
                  value={typeof v === "string" ? v : ""}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    onChange(setField(value, f.key, e.target.value))
                  }
                />
              )}
              {f.type === "number" && (
                <Input
                  id={inputId}
                  type="number"
                  required={f.required}
                  placeholder={f.placeholder}
                  value={typeof v === "number" || typeof v === "string" ? String(v) : ""}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const raw = e.target.value
                    onChange(setField(value, f.key, raw === "" ? null : Number(raw)))
                  }}
                />
              )}
              {f.type === "date" && (
                <Input
                  id={inputId}
                  type="date"
                  required={f.required}
                  value={typeof v === "string" ? v : ""}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    onChange(setField(value, f.key, e.target.value))
                  }
                />
              )}
              {f.type === "checkbox" && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={inputId}
                    checked={Boolean(v)}
                    onCheckedChange={(checked) =>
                      onChange(setField(value, f.key, Boolean(checked)))
                    }
                  />
                  {f.placeholder && (
                    <Label htmlFor={inputId} className="text-muted-foreground text-xs">
                      {f.placeholder}
                    </Label>
                  )}
                </div>
              )}
              {f.type === "json" && (
                <Textarea
                  id={inputId}
                  rows={4}
                  placeholder={f.placeholder ?? `{}`}
                  value={
                    typeof v === "string"
                      ? v
                      : v == null
                        ? ""
                        : JSON.stringify(v, null, 2)
                  }
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    onChange(setField(value, f.key, e.target.value))
                  }
                />
              )}
              {f.type === "select" && (
                <Select
                  value={v == null ? "" : String(v)}
                  onValueChange={(next) =>
                    onChange(
                      setField(
                        value,
                        f.key,
                        next === "" ? null : next,
                      ),
                    )
                  }
                >
                  <SelectTrigger id={inputId}>
                    <SelectValue placeholder={f.placeholder ?? "Select…"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(f.options ?? []).map((opt) => (
                      <SelectItem key={String(opt.value)} value={String(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {f.description && (
                <p className="text-muted-foreground text-xs">{f.description}</p>
              )}
            </div>
          )
        })}
    </form>
  )
}
