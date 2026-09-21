/**
 * usePlotTraitValues — fetch trait records for the chosen trait
 * (scoped by experiment/season/site/population when supplied) and reduce
 * to a per-plot mean keyed by plot_number (population-scoped) or the
 * plot_number-row-col composite (otherwise).
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
  /** When set, records are filtered to this population AND reduced with a
   *  `plot_number`-only key (unique within a population). Without it the
   *  reduce falls back to the `plot_number-row-col` composite key. */
  populationName?: string | null
}

export type PlotTraitValues = {
  /** Per-plot mean keyed to match the polygon join (see keyMode above). */
  values: Map<string, number>
  /** Count of raw records returned (before reduction). Lets the map
   *  distinguish "no records in scope" from "records exist but none
   *  matched the displayed plots". */
  recordCount: number
  /** Min/max plot_number across the raw records, or null when none.
   *  Surfaced in the zero-overlap diagnostic so the user can see why a
   *  trait's records don't line up with the boundary plot numbering. */
  plotNumberRange: { min: number; max: number } | null
}

export function usePlotTraitValues(
  args: UsePlotTraitValuesArgs,
): UseQueryResult<PlotTraitValues, Error> {
  const { traitId, experimentName, seasonName, siteName, populationName } = args
  return useQuery<PlotTraitValues, Error>({
    queryKey: [
      "analyze",
      "plot-trait-values",
      traitId ?? null,
      experimentName ?? null,
      seasonName ?? null,
      siteName ?? null,
      populationName ?? null,
    ],
    enabled: Boolean(traitId),
    queryFn: async () => {
      if (!traitId)
        return { values: new Map(), recordCount: 0, plotNumberRange: null }
      const records = await fetchTraitRecords(traitId, {
        experimentName: experimentName ?? null,
        seasonName: seasonName ?? null,
        siteName: siteName ?? null,
        populationName: populationName ?? null,
      })
      // Population-scoped → join by plot_number alone (unique within a
      // population). Otherwise keep the composite plot+row+col key.
      const values = reduceTraitRecordsToMeanByPlot(records, {
        keyMode: populationName ? "plot" : "plotrc",
      })
      let min = Number.POSITIVE_INFINITY
      let max = Number.NEGATIVE_INFINITY
      for (const r of records) {
        const n = typeof r.plot_number === "number" ? r.plot_number : null
        if (n === null || !Number.isFinite(n)) continue
        if (n < min) min = n
        if (n > max) max = n
      }
      const plotNumberRange = Number.isFinite(min) ? { min, max } : null
      return { values, recordCount: records.length, plotNumberRange }
    },
    staleTime: 30_000,
  })
}
