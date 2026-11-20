/**
 * The traits measured in the chosen experiment, season, site and
 * population, with their flight dates: read from the trait record catalog,
 * so traits run only elsewhere (another site or crop) are left out.
 */
import { useMemo } from "react"
import type { TraitRecord } from "@/features/analyze/api"
import { useTraitRecords } from "@/features/dashboard/hooks/useTraitData"
import { seasonOf } from "../lib/mapDate"

export interface TraitScopeNames {
  experimentName?: string | null
  seasonName?: string | null
  siteName?: string | null
  populationName?: string | null
}

export function traitDatesInScope(
  records: TraitRecord[],
  s: TraitScopeNames,
): Map<string, Set<string>> {
  const dates = new Map<string, Set<string>>()
  for (const r of records) {
    if (s.experimentName && r.experiment !== s.experimentName) continue
    if (s.siteName && r.location !== s.siteName) continue
    if (s.populationName && r.population !== s.populationName) continue
    if (s.seasonName && seasonOf(r) !== s.seasonName) continue
    for (const t of r.trait_columns) {
      const set = dates.get(t) ?? new Set<string>()
      set.add(r.date.slice(0, 10))
      dates.set(t, set)
    }
  }
  return dates
}

export function useScopeTraits(s: TraitScopeNames) {
  const catalog = useTraitRecords()
  const { experimentName, seasonName, siteName, populationName } = s
  const dates = useMemo(
    () =>
      traitDatesInScope(catalog.data ?? [], {
        experimentName,
        seasonName,
        siteName,
        populationName,
      }),
    [catalog.data, experimentName, seasonName, siteName, populationName],
  )
  return { dates, isLoading: catalog.isLoading, catalog }
}
