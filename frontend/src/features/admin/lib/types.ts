/**
 * Field-schema and entity-config types shared by the admin abstraction.
 *
 * Each Phase-11 entity becomes a small `EntityConfig` describing:
 *   - which SDK calls to invoke (list / create / update / delete),
 *   - which fields to show in the table + form,
 *   - how to identify rows (id selector).
 *
 * The shape is intentionally narrow: there's no plugin system, no codegen,
 * no schema reflection. If a special case shows up that doesn't fit
 * (e.g. AccessionAliases bulk import), build a separate page for it
 * rather than over-generalising this layer.
 */

export type EntityFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "checkbox"
  | "json"
  | "select"

export type EntityField<TInput> = {
  /** Object key on the entity's input/output type. */
  key: keyof TInput & string
  label: string
  type: EntityFieldType
  required?: boolean
  placeholder?: string
  /** Render the value in a table cell. Defaults to `String(value ?? "")`. */
  formatCell?: (value: unknown) => string
  /** When `type === "select"`, the option list. */
  options?: Array<{ value: string | number; label: string }>
  /**
   * When `type === "select"` and the option list comes from another entity:
   * a hook returning an array of options. The hook will be called from a
   * top-level component, so it must follow the rules of hooks.
   */
  optionsHook?: () => Array<{ value: string | number; label: string }>
  /** Hide from the table view (still appears in the form). */
  tableHidden?: boolean
  /** Hide from the form (only appears in the table). */
  formHidden?: boolean
  /** Help text under the form field. */
  description?: string
}

export type EntityConfig<TOutput, TInput> = {
  /** Identifier used in URLs and console messages, e.g. "sensor-types". */
  slug: string
  /** Singular human-readable name, e.g. "Sensor type". */
  singular: string
  /** Plural human-readable name, e.g. "Sensor types". */
  plural: string
  /** TanStack-query cache key root, e.g. ["sensor_types"]. */
  queryKey: readonly unknown[]
  /** Returns the row id for delete/update calls. */
  rowId: (row: TOutput) => string

  /** Fetch the full list of rows. */
  list: () => Promise<TOutput[]>
  /** Create from form input. */
  create: (input: TInput) => Promise<TOutput>
  /** Update by id with form input. Receives the full original row to allow
   *  callers to derive their own id-shaped argument. */
  update: (row: TOutput, input: TInput) => Promise<TOutput>
  /** Delete by id. */
  delete: (row: TOutput) => Promise<unknown>

  /** Field schema; controls both the table columns and the form inputs. */
  fields: EntityField<TInput>[]

  /** Build a default form-input for the Add dialog. */
  emptyInput: () => TInput
  /** Build a populated form-input from an existing row for the Edit dialog. */
  toInput: (row: TOutput) => TInput
}
