/**
 * Per-data-type "required form fields" gate, shared between the Files
 * page (`UploadData`) and `UploadList`.
 *
 * The Files page uses these to disable the dropzone until every field
 * the selected data type declares is filled — gating earlier than the
 * old submit-time "Required fields are blank" dialog so the user can't
 * even stage files into an undefined target. `UploadList` still calls
 * the same helpers at upload time as a defense-in-depth check.
 */
import { dataTypes } from "@/config/dataTypes"
import type { EntityChoice } from "@/features/files/components/EntitySelectField"

export function requiredFormFields(
  dataType: string | null | undefined,
): string[] {
  if (!dataType) return []
  const cfg = dataTypes[dataType as keyof typeof dataTypes]
  return ((cfg as { fields?: string[] } | undefined)?.fields ?? []).slice()
}

/**
 * A form field counts as filled when either:
 *   - it has a non-empty plain value (date, name), OR
 *   - the parent passed an EntityChoice that is `existing`, or `new`
 *     with a non-blank trimmed name (the upload click resolves it
 *     before posting).
 */
export function isFieldFilled(
  field: string,
  formValues: Record<string, string>,
  scope: Record<string, EntityChoice> | undefined,
): boolean {
  if (formValues[field]?.trim()) return true
  const c = scope?.[field]
  if (!c) return false
  if (c.kind === "existing") return Boolean(c.id && c.name)
  if (c.kind === "new") return c.name.trim().length > 0
  return false
}

export function missingFormFields(
  dataType: string | null | undefined,
  formValues: Record<string, string>,
  scope: Record<string, EntityChoice> | undefined,
): string[] {
  return requiredFormFields(dataType).filter(
    (field) => !isFieldFilled(field, formValues, scope),
  )
}

const FIELD_LABELS: Record<string, string> = {
  experiment: "experiment",
  season: "season",
  location: "site",
  population: "population",
  platform: "sensor platform",
  sensor: "sensor",
  date: "date",
  name: "name",
}

export function humanFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}
