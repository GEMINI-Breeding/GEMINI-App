/**
 * usePlotTraitValues — fetch trait records for the chosen trait
 * (scoped by experiment/season/site when supplied) and reduce to a
 * per-plot mean keyed by (plot_number-row-col).
 *
 * Pairs with `usePlotPolygons` and `joinTraitToPolygons` to drive the
 * geospatial heatmap on the Analyze map tab. Works uniformly for
 * traits produced by EXTRACT_TRAITS (auto-ingested by the worker) and
 * traits imported manually via the CSV wizard — both land in the same
 * `trait_records` table.
 */
import { type UseQueryResult, useQuery } from "@tanstack/react-query"
import { reduceTraitRecordsToMeanByPlot } from "@/features/analyze/lib/joinTraitToPolygons"
import { fetchTraitRecords } from "@/features/analyze/lib/traitRecords"

export type UsePlotTraitValuesArgs = {
  traitId: string | null | undefined
  experimentName?: string | null
  seasonName?: string | null
  siteName?: string | null
}

export function usePlotTraitValues(
  args: UsePlotTraitValuesArgs,
): UseQueryResult<Map<string, number>, Error> {
  const { traitId, experimentName, seasonName, siteName } = args
  return useQuery<Map<string, number>, Error>({
    queryKey: [
      "analyze",
      "plot-trait-values",
      traitId ?? null,
      experimentName ?? null,
      seasonName ?? null,
      siteName ?? null,
    ],
    enabled: Boolean(traitId),
    queryFn: async () => {
      if (!traitId) return new Map()
      const records = await fetchTraitRecords(traitId, {
        experimentName: experimentName ?? null,
        seasonName: seasonName ?? null,
        siteName: siteName ?? null,
      })
      return reduceTraitRecordsToMeanByPlot(records)
    },
    staleTime: 30_000,
  })
}
