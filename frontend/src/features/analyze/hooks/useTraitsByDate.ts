/**
 * Trait values per plot on each flight date of a scope: one matrix request
 * per date (the server's per-date mode), merged into a row per plot per
 * date. Shared by the Table and Query views (and their cache).
 */
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { useTraitRecords } from "@/features/dashboard/hooks/useTraitData"
import { mapDates } from "../lib/mapDate"
import { fetchMatrix, type MatrixResponse } from "../lib/multivariate"
import { rowsByDate } from "../lib/traitTable"

export interface ScopeNames {
  experiment: string
  season: string
  site: string
  population?: string | null
}

/** The scope's flight dates with trait records, earliest first. */
export function useScopeDates(scope: Partial<ScopeNames>) {
  const catalog = useTraitRecords()
  const dates = useMemo(
    () =>
      mapDates(catalog.data ?? [], [], {
        experiment: scope.experiment || null,
        season: scope.season || null,
        site: scope.site || null,
        population: scope.population || null,
      })
        .filter((d) => d.traits)
        .map((d) => d.date)
        .sort(),
    [
      catalog.data,
      scope.experiment,
      scope.season,
      scope.site,
      scope.population,
    ],
  )
  return { dates, isLoading: catalog.isLoading }
}

export function matrixKey(scope: Partial<ScopeNames>, traits: string[]) {
  return [
    "analyze",
    "table",
    "matrix",
    scope.experiment,
    scope.season,
    scope.site,
    scope.population || "",
    traits.join("\u0000"),
  ]
}

/**
 * Every date in one request (the server's per_date mode). A server without
 * that mode answers with undated rows or an error; then each date is asked
 * for on its own, as before.
 */
async function fetchByDate(
  scope: Partial<ScopeNames>,
  traits: string[],
  dates: string[],
): Promise<MatrixResponse> {
  const base = {
    trait_names: traits,
    experiment_names: [scope.experiment as string],
    season_names: [scope.season as string],
    site_names: [scope.site as string],
    ...(scope.population ? { populations: [scope.population] } : {}),
  }
  try {
    const res = await fetchMatrix({
      ...base,
      aggregation: "mean",
      per_date: true,
    })
    if (res.status !== "ok" || res.rows.some((r) => r.collection_date))
      return res
  } catch {
    // older server: fall through
  }
  const perDate = await Promise.all(
    dates.map(async (d) => ({
      date: d,
      res: await fetchMatrix({
        ...base,
        aggregation: "date",
        aggregation_date: d,
      }),
    })),
  )
  const ok = perDate.filter((x) => x.res.status === "ok")
  const merged = rowsByDate(
    ok.map((x) => ({
      date: x.date,
      rows: x.res.rows,
      trait_names: x.res.trait_names,
    })),
  )
  const firstBad = perDate.find((x) => x.res.status !== "ok")?.res
  return {
    status: ok.length ? "ok" : (firstBad?.status ?? "insufficient_data"),
    message: ok.length ? null : firstBad?.message,
    n_records_fetched: ok.reduce((n, x) => n + x.res.n_records_fetched, 0),
    n_rows: merged.rows.length,
    trait_names: traits.filter((t) => merged.trait_names.includes(t)),
    rows: merged.rows,
  }
}

export function useTraitsByDate({
  scope,
  traits,
  dates,
  enabled = true,
}: {
  scope: Partial<ScopeNames>
  traits: string[]
  dates: string[]
  enabled?: boolean
}) {
  const ready =
    enabled &&
    Boolean(scope.experiment && scope.season && scope.site) &&
    traits.length > 0
  return useQuery({
    queryKey: [...matrixKey(scope, traits), "by-date", dates.join(",")],
    queryFn: () => fetchByDate(scope, traits, dates),
    enabled: ready,
    staleTime: 60_000,
  })
}
