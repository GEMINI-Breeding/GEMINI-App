import { ArrowUpRight, ArrowDownRight, Minus, Loader2 } from "lucide-react"
import { useTraitRecordGeojson, computeAggregate, applyFilters } from "../hooks/useTraitData"
import type { KpiConfig } from "../types"

function fmt(val: number, aggregation: string): string {
  if (aggregation === "count") return val.toLocaleString()
  if (Math.abs(val) >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return val.toFixed(3).replace(/\.?0+$/, "")
}

interface KpiWidgetProps {
  config: KpiConfig
}

export function KpiWidget({ config }: KpiWidgetProps) {
  const { traitRecordId, metric, aggregation, compareRecordId, filters } = config

  const primary = useTraitRecordGeojson(traitRecordId)
  const compare = useTraitRecordGeojson(compareRecordId)

  if (!traitRecordId || !metric) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Configure this widget to select a data source and metric.
      </div>
    )
  }

  if (primary.isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    )
  }

  if (primary.isError || !primary.data) {
    return <p className="text-sm text-destructive">Failed to load data.</p>
  }

  const filteredGeojson = {
    ...primary.data.geojson,
    features: applyFilters(primary.data.geojson.features, filters),
  }
  const value = computeAggregate(filteredGeojson, metric, aggregation)
  if (value === null) {
    return <p className="text-sm text-muted-foreground">No data for "{metric}".</p>
  }

  // Compute % change vs compare record
  let changeLabel: string | null = null
  let trend: "up" | "down" | "neutral" = "neutral"

  if (compareRecordId && compare.data) {
    const prev = computeAggregate(compare.data.geojson, metric, aggregation)
    if (prev !== null && prev !== 0) {
      const pct = ((value - prev) / Math.abs(prev)) * 100
      changeLabel = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
      trend = pct > 0 ? "up" : pct < 0 ? "down" : "neutral"
    }
  }

  const label = metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  const aggLabel = aggregation === "count" ? "count" : `${aggregation}.`

  return (
    <div className="flex flex-col justify-center h-full gap-1">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label} <span className="normal-case">({aggLabel})</span>
      </span>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold text-foreground">{fmt(value, aggregation)}</span>
        {changeLabel && (
          <span
            className={`flex items-center text-sm font-semibold ${
              trend === "up"
                ? "text-emerald-600"
                : trend === "down"
                ? "text-rose-600"
                : "text-muted-foreground"
            }`}
          >
            {trend === "up" && <ArrowUpRight className="w-4 h-4" />}
            {trend === "down" && <ArrowDownRight className="w-4 h-4" />}
            {trend === "neutral" && <Minus className="w-4 h-4" />}
            {changeLabel}
          </span>
        )}
      </div>
    </div>
  )
}
