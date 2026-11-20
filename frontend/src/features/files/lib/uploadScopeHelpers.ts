/**
 * Shared search-or-create factory for upload-form scope resolution.
 *
 * The five experiment-scoped entities (Site, Population, Season,
 * SensorPlatform, Sensor) all do the same thing: given an EntityChoice,
 * either pass through the existing id/name, or search-by-name within
 * the parent experiment and create a new row on miss. Sensor adds a
 * `sensor_platform_name` to its create body; otherwise the shape is
 * identical.
 *
 * Pulling this out lets `useResolveScope`'s six near-identical functions
 * collapse to thin config wrappers, and lets us cover the four code
 * paths (existing pass-through, search-hit, search-miss create,
 * blank-name reject) with one set of unit tests.
 */
import type { EntityChoice } from "@/features/files/components/EntitySelectField"

export interface ResolvedEntity {
  id: string
  name: string
}

/**
 * Adapter the factory uses to talk to a specific GEMINIbase entity table.
 * Each entity (Site, Population, etc.) supplies one of these.
 */
export interface EntityResolver<TRow> {
  /** Human-readable label, used in error messages. e.g. "site". */
  entityLabel: string
  /** Search the SDK; return null/[] when nothing matches. */
  search: (trimmedName: string) => Promise<TRow[] | null>
  /** Read the search result row's name field for exact-match checking. */
  getName: (row: TRow) => string | null | undefined
  /** Read the search result row's id (coerced to string by the factory). */
  getId: (row: TRow) => string | number | null | undefined
  /** POST a new row; return the freshly-created row. */
  create: (trimmedName: string) => Promise<TRow>
  /** Optional side-effect after a successful resolve (typically queryClient.invalidate). */
  onResolved?: () => void
}

/**
 * Shared "existing → pass through; new → search + create" flow.
 *
 * Throws when the choice is `kind: "none"` (the upload form must
 * collect every entity it needs) or when a `kind: "new"` choice has
 * a blank/whitespace-only name.
 */
export async function resolveOrCreateEntity<TRow>(
  choice: EntityChoice,
  resolver: EntityResolver<TRow>,
): Promise<ResolvedEntity> {
  if (choice.kind === "existing") {
    return { id: choice.id, name: choice.name }
  }
  if (choice.kind === "new") {
    const trimmed = choice.name.trim()
    if (!trimmed) {
      throw new Error(`New ${resolver.entityLabel} name is empty`)
    }
    const existing = await resolver.search(trimmed)
    const match = existing?.find((row) => resolver.getName(row) === trimmed)
    const matchId = match ? resolver.getId(match) : null
    if (matchId != null) {
      resolver.onResolved?.()
      return { id: String(matchId), name: trimmed }
    }
    const created = await resolver.create(trimmed)
    resolver.onResolved?.()
    return { id: String(resolver.getId(created) ?? ""), name: trimmed }
  }
  throw new Error(`${resolver.entityLabel} is required`)
}
