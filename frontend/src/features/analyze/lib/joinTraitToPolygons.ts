/**
 * Join a per-plot trait-value map onto a FeatureCollection of plot
 * polygons so deck.gl's GeoJsonLayer (in TraitMap) can color each
 * feature by `feature.properties[column]`.
 *
 * The polygon FeatureCollection comes from `usePlotPolygons`, which
 * already normalizes per-feature `plot_number` / `plot_row_number` /
 * `plot_column_number`. The value map's key format MUST match
 * `plotKeyFromRowColumn` so the lookups line up.
 */
import type { TraitRecordOutput } from "@/client"
import type { PlotPolygonFC } from "@/features/analyze/hooks/usePlotPolygons"

/**
 * Build a stable lookup key from a plot's (plot_number, row, column).
 *
 * Trade-off: encoding all three gives a deterministic join even when
 * two plots share the same plot_number across rows. Falling back to
 * `${plot_number}` alone (when row/col are missing) loses that
 * disambiguation but keeps older snapshots — which only carried a
 * scalar `plot` — joinable. Callers reduce values from the same key
 * by mean.
 */
export function plotKey(
  plotNumber: number | string | null | undefined,
  row?: number | string | null,
  col?: number | string | null,
): string | null {
  if (plotNumber === null || plotNumber === undefined || plotNumber === "")
    return null
  const p = String(plotNumber)
  const hasRC =
    row !== null &&
    row !== undefined &&
    row !== "" &&
    col !== null &&
    col !== undefined &&
    col !== ""
  return hasRC ? `${p}-${String(row)}-${String(col)}` : p
}

/**
 * Reduce a list of trait records to a per-plot mean. Used by
 * `usePlotTraitValues` to collapse multiple measurements (e.g. several
 * collection dates) into a single value the map can render.
 *
 * Records without a usable plot key are ignored. Records with
 * non-numeric `trait_value` are ignored. The mean is plain
 * (sum/count); we explicitly don't weight by accession or season
 * because the user picks scope upstream.
 */
export function reduceTraitRecordsToMeanByPlot(
  records: TraitRecordOutput[],
): Map<string, number> {
  const sums = new Map<string, { sum: number; count: number }>()
  for (const r of records) {
    const v =
      typeof r.trait_value === "number" && Number.isFinite(r.trait_value)
        ? r.trait_value
        : null
    if (v === null) continue
    const key = plotKey(
      r.plot_number ?? null,
      (r as { plot_row_number?: number | null }).plot_row_number ?? null,
      (r as { plot_column_number?: number | null }).plot_column_number ?? null,
    )
    if (key === null) continue
    const prev = sums.get(key)
    if (prev) {
      prev.sum += v
      prev.count += 1
    } else {
      sums.set(key, { sum: v, count: 1 })
    }
  }
  const out = new Map<string, number>()
  for (const [k, { sum, count }] of sums) {
    out.set(k, sum / count)
  }
  return out
}

/**
 * Decorate each polygon feature with `properties[column] = mean` from
 * the values map. Returns a *new* FeatureCollection — the input isn't
 * mutated, so the same upstream FC can be re-used with multiple traits
 * stacked or compared.
 *
 * Features without a matching value get the column omitted (TraitMap
 * renders these as the "no value" gray).
 */
export function joinTraitToPolygons(
  fc: PlotPolygonFC,
  values: Map<string, number>,
  column: string,
): PlotPolygonFC {
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => {
      const props = f.properties ?? {}
      const key = plotKey(
        props.plot_number ?? null,
        props.plot_row_number ?? null,
        props.plot_column_number ?? null,
      )
      const v = key !== null ? values.get(key) : undefined
      const nextProps =
        v !== undefined
          ? { ...props, [column]: v }
          : ({ ...props } as typeof props)
      return { ...f, properties: nextProps }
    }),
  }
}
