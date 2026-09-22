/**
 * Reference datasets (hand measurements) that describe the current
 * experiment + site (+ population), with their plots, ready for
 * `attachReference`.
 */
import { useQuery } from "@tanstack/react-query"

import {
  ReferenceDataService,
  type ReferenceDatasetOutput,
  type ReferencePlotOutput,
} from "@/client"
import { idAsString } from "@/features/admin/lib/ids"
import {
  datasetsForScope,
  type RefDataset,
  type RefPlot,
} from "../lib/referenceJoin"

function asObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object") return v as Record<string, unknown>
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v)
      return parsed && typeof parsed === "object" ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

export function toRefDataset(d: ReferenceDatasetOutput): RefDataset {
  return {
    id: idAsString(d.id),
    name: d.name ?? "",
    experiment: d.experiment,
    location: d.location,
    population: d.population,
    trait_columns: d.trait_columns ?? [],
  }
}

function toRefPlot(p: ReferencePlotOutput): RefPlot {
  return {
    plot_id: p.plot_id,
    plot_row: p.plot_row,
    plot_column: p.plot_column,
    traits: asObject(p.traits),
  }
}

export const REFERENCE_DATASETS_KEY = ["reference-data", "datasets"] as const

export function useReferenceDatasets() {
  return useQuery({
    queryKey: REFERENCE_DATASETS_KEY,
    queryFn: async () =>
      ((await ReferenceDataService.apiReferenceDataListDatasets()) ??
        []) as ReferenceDatasetOutput[],
  })
}

export function useScopeReference(scope: {
  experiment?: string | null
  location?: string | null
  population?: string | null
}) {
  const datasets = useReferenceDatasets()
  const ready = Boolean(scope.experiment && scope.location)
  const inScope = ready
    ? datasetsForScope((datasets.data ?? []).map(toRefDataset), {
        experiment: scope.experiment as string,
        location: scope.location as string,
        population: scope.population,
      })
    : []
  const ids = inScope.map((d) => d.id)
  return useQuery({
    queryKey: ["reference-data", "scope-plots", ...ids],
    queryFn: () =>
      Promise.all(
        inScope.map(async (dataset) => {
          const res =
            await ReferenceDataService.apiReferenceDataIdDatasetIdPlotsAllGetAllPlots(
              { datasetId: dataset.id },
            )
          return { dataset, plots: (res.data ?? []).map(toRefPlot) }
        }),
      ),
    enabled: ready && datasets.isSuccess,
  })
}
