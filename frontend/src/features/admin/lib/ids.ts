/**
 * Tiny helpers for the admin layer.
 */

/**
 * GEMINIbase entity ids round-trip as `string | number | null` in OpenAPI
 * outputs. Different SDK calls type the path-param as either `string` or
 * `number` (UUIDs vs sequential ints depending on the table). Use
 * `idAsString` when the SDK takes string, `idAsNumber` when number.
 */
export function idAsString(id: unknown): string {
  if (typeof id === "string") return id
  if (typeof id === "number") return String(id)
  throw new Error(`Cannot coerce id ${JSON.stringify(id)} to string`)
}

export function idAsNumber(id: unknown): number {
  if (typeof id === "number") return id
  if (typeof id === "string") {
    const n = Number(id)
    if (Number.isFinite(n)) return n
  }
  throw new Error(`Cannot coerce id ${JSON.stringify(id)} to number`)
}

/**
 * Parse the user's "Info (JSON)" textarea value into the shape the SDK
 * expects. The backend accepts `string | { [k: string]: unknown } | null`,
 * so we attempt JSON.parse; if it fails (or the box is empty) we return the
 * raw string / undefined respectively.
 */
export function parseInfoField(raw: unknown): unknown {
  if (raw == null) return undefined
  if (typeof raw !== "string") return raw
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}
