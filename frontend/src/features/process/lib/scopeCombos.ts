/**
 * Which season / site / population go together in an experiment, from
 * what exists: trait records, uploads and pipeline runs. Lets each scope
 * box list only what exists with the others' picks (Riverside: no Lima,
 * which was grown only at Coachella).
 */
export interface ScopeCombo {
  season: string
  site: string
  population: string
}

export interface ScopePick {
  season?: string | null
  site?: string | null
  population?: string | null
}

/** Names each box may list, or null when nothing is known (list all). */
export interface ScopeChoices {
  seasons: Set<string> | null
  sites: Set<string> | null
  populations: Set<string> | null
}

export function scopeChoices(
  combos: ScopeCombo[],
  pick: ScopePick,
): ScopeChoices {
  if (combos.length === 0)
    return { seasons: null, sites: null, populations: null }
  const fits = (c: ScopeCombo, skip: keyof ScopeCombo) =>
    (skip === "season" || !pick.season || c.season === pick.season) &&
    (skip === "site" || !pick.site || c.site === pick.site) &&
    (skip === "population" ||
      !pick.population ||
      c.population === pick.population)
  const names = (k: keyof ScopeCombo) =>
    new Set(combos.filter((c) => fits(c, k)).map((c) => c[k]))
  return {
    seasons: names("season"),
    sites: names("site"),
    populations: names("population"),
  }
}

/**
 * The options a box shows: those allowed, plus the current pick (so it
 * never vanishes from its own box). All of them if none would be left.
 */
export function narrowOptions<T extends { id: string; name: string }>(
  options: T[],
  allowed: Set<string> | null,
  currentId?: string | null,
): T[] {
  if (!allowed) return options
  const kept = options.filter((o) => allowed.has(o.name) || o.id === currentId)
  return kept.some((o) => o.id !== currentId) ? kept : options
}

export function addCombo(
  out: ScopeCombo[],
  season?: string | null,
  site?: string | null,
  population?: string | null,
) {
  if (!season || !site || !population) return
  if (
    !out.some(
      (c) =>
        c.season === season && c.site === site && c.population === population,
    )
  )
    out.push({ season, site, population })
}
