/**
 * React Query wrappers for trait data used by dashboard widgets.
 * Reuses the same query keys as the Analyze tab for cache sharing.
 */

import { useQuery, useQueries } from "@tanstack/react-query"
import { analyzeApi, type TraitRecord, type TraitsResponse } from "@/features/analyze/api"

// ── All trait records (catalog) ───────────────────────────────────────────────

export function useTraitRecords() {
  return useQuery({
    queryKey: ["trait-records"],
    queryFn: () => analyzeApi.listTraitRecords(),
    staleTime: 30_000,
    // Automatically re-check for new pipeline extractions every 30 seconds
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

// ── GeoJSON for a single trait record ─────────────────────────────────────────

export function useTraitRecordGeojson(recordId: string | null) {
  return useQuery({
    queryKey: ["trait-record-geojson", recordId],
    queryFn: () => analyzeApi.getTraitRecordGeojson(recordId!),
    enabled: !!recordId,
    staleTime: 5 * 60_000,
    // Re-fetch geojson when window regains focus (picks up any re-processed data)
    refetchOnWindowFocus: true,
  })
}

// ── GeoJSON for multiple records (temporal charts) ────────────────────────────

export function useMultiTraitGeojson(recordIds: string[]) {
  const results = useQueries({
    queries: recordIds.map((id) => ({
      queryKey: ["trait-record-geojson", id],
      queryFn: () => analyzeApi.getTraitRecordGeojson(id),
      staleTime: 5 * 60_000,
    })),
  })

  const loading = results.some((r) => r.isLoading)
  const error = results.find((r) => r.isError)?.error ?? null
  const data: (TraitsResponse | null)[] = results.map((r) => r.data ?? null)

  return { data, loading, error }
}

// ── Plot IDs with images for a record ─────────────────────────────────────────

export function useImagePlotIds(recordId: string | null) {
  return useQuery({
    queryKey: ["trait-record-image-plot-ids", recordId],
    queryFn: () => analyzeApi.getTraitRecordImagePlotIds(recordId!),
    enabled: !!recordId,
    staleTime: 5 * 60_000,
    select: (d) => d.plot_ids,
  })
}

// ── Value formatter ───────────────────────────────────────────────────────────

/**
 * Format a numeric dashboard value with column-name-aware precision.
 *
 * Rules:
 *  - Detection counts (model/class columns like "yolo/plant", or names containing
 *    "count" / "n_plants"): 1 decimal place
 *  - Height / vegetation fraction columns: 3 decimal places
 *  - Everything else: up to 4 significant decimals, trailing zeros stripped
 */
export function formatDashboardValue(value: unknown, col?: string): string {
  if (value == null) return "—"
  if (typeof value !== "number") return String(value)
  if (Number.isInteger(value)) return String(value)

  if (col) {
    const lower = col.toLowerCase()
    // Detection counts: model/class notation OR explicit count-like names
    const isCount =
      col.includes("/") ||
      lower.includes("count") ||
      lower === "n_plants" ||
      lower.startsWith("n_") && !lower.includes("ndvi")
    if (isCount) return value.toFixed(1)

    // Physical measurements: height and vegetation fraction
    const isMeasurement =
      lower.includes("height") ||
      lower.includes("vegetation") ||
      lower.includes("veg_frac") ||
      lower.includes("fraction")
    if (isMeasurement) return value.toFixed(3)
  }

  // Default: 4 decimals, strip trailing zeros
  return value.toFixed(4).replace(/\.?0+$/, "")
}

// ── Filter helper ─────────────────────────────────────────────────────────────

/**
 * Filter a feature array by a filters map.
 * Each entry is field → selected values; empty array = no filter for that field.
 */
export function applyFilters(
  features: GeoJSON.Feature[],
  filters: Record<string, string[]> | undefined,
): GeoJSON.Feature[] {
  if (!filters) return features
  const active = Object.entries(filters).filter(([, vals]) => vals.length > 0)
  if (active.length === 0) return features
  return features.filter((f) =>
    active.every(([field, vals]) =>
      vals.includes(String(f.properties?.[field] ?? ""))
    )
  )
}

// ── Aggregation helpers ───────────────────────────────────────────────────────

/**
 * Given a GeoJSON FeatureCollection, compute a single aggregate over a metric.
 */
export function computeAggregate(
  geojson: GeoJSON.FeatureCollection,
  metric: string,
  aggregation: "avg" | "min" | "max" | "count",
): number | null {
  const values = geojson.features
    .map((f) => f.properties?.[metric] as number)
    .filter((v) => typeof v === "number" && !isNaN(v))

  if (values.length === 0) return null
  switch (aggregation) {
    case "avg": return values.reduce((a, b) => a + b, 0) / values.length
    case "min": return Math.min(...values)
    case "max": return Math.max(...values)
    case "count": return values.length
  }
}

/**
 * Group features by a categorical field, return average of `metric` per group.
 * Returns `[{name, value}]` sorted by group name.
 */
export function groupBy(
  geojson: GeoJSON.FeatureCollection,
  groupField: string,
  metric: string,
): Array<{ name: string; value: number }> {
  const buckets = new Map<string, number[]>()
  geojson.features.forEach((f) => {
    const key = String(f.properties?.[groupField] ?? "(none)")
    const val = f.properties?.[metric] as number
    if (typeof val === "number" && !isNaN(val)) {
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(val)
    }
  })
  return [...buckets.entries()]
    .map(([name, vals]) => ({
      name,
      value: vals.reduce((a, b) => a + b, 0) / vals.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Group features by a categorical field and metric, returning avg per group.
 * Used for building multi-series data where each group becomes a separate bar/line.
 */
export function groupByMulti(
  geojson: GeoJSON.FeatureCollection,
  groupField: string,
  metrics: string[],
): Array<Record<string, string | number>> {
  const buckets = new Map<string, Map<string, number[]>>()
  geojson.features.forEach((f) => {
    const key = String(f.properties?.[groupField] ?? "(none)")
    if (!buckets.has(key)) buckets.set(key, new Map())
    const metricMap = buckets.get(key)!
    metrics.forEach((m) => {
      const val = f.properties?.[m] as number
      if (typeof val === "number" && !isNaN(val)) {
        if (!metricMap.has(m)) metricMap.set(m, [])
        metricMap.get(m)!.push(val)
      }
    })
  })
  return [...buckets.entries()]
    .map(([name, metricMap]) => {
      const row: Record<string, string | number> = { name }
      metrics.forEach((m) => {
        const vals = metricMap.get(m) ?? []
        row[m] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
      })
      return row
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

/**
 * Normalize a date string to a sortable ISO-like format regardless of input format.
 * Handles both MM-DD-YYYY (e.g. "03-15-2024") and YYYY-MM-DD (e.g. "2024-03-15").
 */
function normalizeDateForSort(date: string): string {
  // If it starts with 4 digits, assume YYYY-MM-DD — already sortable
  if (/^\d{4}/.test(date)) return date
  // Otherwise assume MM-DD-YYYY → convert to YYYY-MM-DD
  const parts = date.split("-")
  if (parts.length === 3 && parts[2].length === 4) {
    return `${parts[2]}-${parts[0]}-${parts[1]}`
  }
  return date // fall back to original if unrecognised
}

/**
 * For a temporal series: given (record, geojson) pairs, compute avg of `metric`
 * per date. Optionally split by `groupByField` (one series per group).
 */
export function buildTemporalSeries(
  records: TraitRecord[],
  responses: (TraitsResponse | null)[],
  metric: string,
  groupByField: string | null,
  filters?: Record<string, string[]>,
): Array<Record<string, string | number>> {
  const result: Array<Record<string, string | number>> = []

  records.forEach((record, i) => {
    const geojson = responses[i]?.geojson
    if (!geojson) return

    const row: Record<string, string | number> = { date: record.date }
    const features = applyFilters(geojson.features, filters)

    if (!groupByField) {
      // single series: overall average
      const vals = features
        .map((f) => f.properties?.[metric] as number)
        .filter((v) => typeof v === "number" && !isNaN(v))
      row[metric] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    } else {
      // multi-series: average per group
      const buckets = new Map<string, number[]>()
      features.forEach((f) => {
        const key = String(f.properties?.[groupByField] ?? "(none)")
        const val = f.properties?.[metric] as number
        if (typeof val === "number" && !isNaN(val)) {
          if (!buckets.has(key)) buckets.set(key, [])
          buckets.get(key)!.push(val)
        }
      })
      buckets.forEach((vals, key) => {
        row[key] = vals.reduce((a, b) => a + b, 0) / vals.length
      })
    }

    result.push(row)
  })

  return result.sort((a, b) =>
    normalizeDateForSort(String(a.date)).localeCompare(normalizeDateForSort(String(b.date)))
  )
}
