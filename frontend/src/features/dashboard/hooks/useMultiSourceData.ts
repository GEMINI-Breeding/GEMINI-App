/**
 * useMultiSourceData — unified multi-source data resolution for dashboard widgets.
 *
 * Accepts a DataSource[] and resolves each source into a SeriesResult with
 * temporal points or a single aggregate value. Uses useQueries internally
 * (never conditional hooks) to batch all fetches.
 *
 * Temporal alignment: the union of all dates across sources is used for the
 * X-axis. Missing dates for a given source get null values.
 *
 * When groupByField is set:
 *   - categoricalData: one row per unique field value, one column per source.
 *     Use this for categorical X-axis bar charts.
 *   - groupedTemporalData: date rows but each source is split into sub-series
 *     (one per group value). Use this for "show each accession's trend over time".
 */

import { useMemo } from "react"
import { useQueries } from "@tanstack/react-query"
import { analyzeApi } from "@/features/analyze/api"
import { applyFilters, buildTemporalSeries } from "./useTraitData"
import { useTraitRecords } from "./useTraitData"
import type { DataSource } from "../types"
import { sourceKey } from "../types"

// ── Color palette (matches existing SERIES_COLORS in ChartWidget) ─────────────

export const SERIES_COLORS = [
  "#4f46e5", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#f97316", "#84cc16",
  "#ec4899", "#64748b",
]

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TemporalPoint {
  date: string
  value: number | null
}

export interface SeriesResult {
  key: string
  label: string
  color: string
  loading: boolean
  error: Error | null
  /** Single aggregate value (for spatial/KPI mode) */
  aggregateValue: number | null
  /** Time-series points (for temporal mode) */
  points: TemporalPoint[]
  sourceType: DataSource["type"]
  /** For reference sources rendered as a horizontal baseline */
  isBaseline: boolean
}

// ── Helper: derive a display label for a source ───────────────────────────────

function defaultLabel(src: DataSource, records: any[], _datasets: any[]): string {
  if (src.label) return src.label
  if (src.type === "pipeline-run") {
    const rec = records.find((r: any) => r.id === src.recordId)
    return rec
      ? `${rec.pipeline_name} · ${rec.date} · ${src.metric}`
      : src.metric
  }
  if (src.type === "pipeline-avg") {
    const rec = records.find((r: any) => r.pipeline_id === src.pipelineId)
    return rec ? `${rec.pipeline_name} (avg) · ${src.metric}` : src.metric
  }
  if (src.type === "reference") {
    return `Ref · ${src.metric}`
  }
  return (src as any).metric as string
}

// ── Aggregation util ──────────────────────────────────────────────────────────

function aggregate(values: number[], method: string): number {
  if (values.length === 0) return 0
  switch (method) {
    case "min": return Math.min(...values)
    case "max": return Math.max(...values)
    case "sum": return values.reduce((a, b) => a + b, 0)
    case "median": {
      const sorted = [...values].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }
    default: return values.reduce((a, b) => a + b, 0) / values.length // avg
  }
}

// ── groupByValues — partition features by a field, aggregate metric per bucket ─

function groupByValues(
  features: any[],
  groupField: string,
  metric: string,
  agg: string,
): Map<string, number | null> {
  const buckets = new Map<string, number[]>()
  features.forEach((f) => {
    const gv = String(f.properties?.[groupField] ?? "")
    if (!gv || gv === "undefined" || gv === "null") return
    const val = f.properties?.[metric] as number
    if (typeof val !== "number" || isNaN(val)) return
    if (!buckets.has(gv)) buckets.set(gv, [])
    buckets.get(gv)!.push(val)
  })
  const result = new Map<string, number | null>()
  buckets.forEach((vals, k) => result.set(k, vals.length ? aggregate(vals, agg) : null))
  return result
}

// ── Inline helpers (to keep hook self-contained) ──────────────────────────────

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? import.meta.env.VITE_API_URL ?? ""
  return base ? `${base}${path}` : path
}

function authHeaders() {
  const token = localStorage.getItem("access_token") || ""
  return { Authorization: `Bearer ${token}` }
}

// ── Main hook ──────────────────────────────────────────────────────────────────

export function useMultiSourceData(sources: DataSource[], groupByField?: string | null) {
  const { data: allRecords = [] } = useTraitRecords()

  // ── Batch-fetch GeoJSON for all pipeline sources ──────────────────────────

  const pipelineRunIds = useMemo(() => {
    const ids = new Set<string>()
    sources.forEach((src) => {
      if (src.type === "pipeline-run") ids.add(src.recordId)
    })
    return [...ids]
  }, [sources])

  const pipelineAvgPipelineIds = useMemo(() => {
    const ids = new Set<string>()
    sources.forEach((src) => {
      if (src.type === "pipeline-avg") ids.add(src.pipelineId)
    })
    return [...ids]
  }, [sources])

  const avgRecordIds = useMemo(() => {
    const ids = new Set<string>()
    pipelineAvgPipelineIds.forEach((pid) => {
      allRecords.filter((r) => r.pipeline_id === pid).forEach((r) => ids.add(r.id))
    })
    return [...ids]
  }, [pipelineAvgPipelineIds, allRecords])

  const allGeoJsonIds = useMemo(
    () => [...new Set([...pipelineRunIds, ...avgRecordIds])],
    [pipelineRunIds, avgRecordIds]
  )

  const geoJsonResults = useQueries({
    queries: allGeoJsonIds.map((id) => ({
      queryKey: ["trait-record-geojson", id],
      queryFn: () => analyzeApi.getTraitRecordGeojson(id),
      staleTime: 5 * 60_000,
      retry: (failureCount: number, error: any) => error?.status !== 404 && failureCount < 2,
    })),
  })

  const geoJsonByRecordId = useMemo(() => {
    const map = new Map<string, any>()
    allGeoJsonIds.forEach((id, i) => {
      if (geoJsonResults[i]?.data) map.set(id, geoJsonResults[i].data)
    })
    return map
  }, [allGeoJsonIds, geoJsonResults])

  // ── Batch-fetch reference plots (for groupBy categorical mode) ───────────

  // Unique dataset IDs that appear in reference sources (only need plots when groupByField is set)
  const refDatasetIds = useMemo(() => {
    if (!groupByField) return [] as string[]
    return [...new Set(
      sources.filter((s) => s.type === "reference").map((s) => (s as any).datasetId as string)
    )]
  }, [sources, groupByField])

  const refPlotResults = useQueries({
    queries: refDatasetIds.map((datasetId) => ({
      queryKey: ["reference-plots-all", datasetId],
      queryFn: () =>
        fetch(apiUrl(`/api/v1/reference-data/${datasetId}/plots-all`), { headers: authHeaders() })
          .then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            return json.data as Array<{
              id: string; dataset_id: string; plot_id: string; col: string | null
              row: string | null; accession: string | null; traits: Record<string, number> | null
            }>
          }),
      staleTime: 10 * 60_000,
      retry: (failureCount: number, error: any) => error?.status !== 404 && failureCount < 2,
    })),
  })

  const refPlotsByDatasetId = useMemo(() => {
    const map = new Map<string, any[]>()
    refDatasetIds.forEach((id, i) => {
      if (refPlotResults[i]?.data) map.set(id, refPlotResults[i].data!)
    })
    return map
  }, [refDatasetIds, refPlotResults])

  // ── Batch-fetch reference aggregates ─────────────────────────────────────

  const refAggRequests = useMemo(() =>
    sources
      .filter((s) => s.type === "reference")
      .map((s) => ({
        srcId: s.id,
        datasetId: (s as any).datasetId as string,
        metric: s.metric,
        aggregation: s.aggregation,
      })),
    [sources]
  )

  const refAggResults = useQueries({
    queries: refAggRequests.map(({ datasetId, metric, aggregation }) => ({
      queryKey: ["reference-aggregate", datasetId, metric, aggregation],
      queryFn: () =>
        fetch(
          apiUrl(`/api/v1/reference-data/${datasetId}/aggregate?metric=${encodeURIComponent(metric)}&aggregation=${aggregation}`),
          { headers: authHeaders() }
        ).then(async (res) => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }))
            const e: any = new Error(err.detail ?? `HTTP ${res.status}`)
            e.status = res.status
            throw e
          }
          return res.json()
        }),
      staleTime: 10 * 60_000,
      retry: (failureCount: number, error: any) => error?.status !== 404 && failureCount < 2,
    })),
  })

  const refAggBySourceId = useMemo(() => {
    const map = new Map<string, any>()
    refAggRequests.forEach(({ srcId }, i) => {
      if (refAggResults[i]?.data) map.set(srcId, refAggResults[i].data)
    })
    return map
  }, [refAggRequests, refAggResults])

  // ── Resolve each source into a SeriesResult ───────────────────────────────

  const series: SeriesResult[] = useMemo(() => {
    return sources.map((src, i) => {
      const key = sourceKey(src)
      const color = SERIES_COLORS[i % SERIES_COLORS.length]
      const label = defaultLabel(src, allRecords, [])

      if (src.type === "pipeline-run") {
        const geo = geoJsonByRecordId.get(src.recordId)
        const geoResult = geoJsonResults[allGeoJsonIds.indexOf(src.recordId)]
        const loading = geoResult?.isLoading ?? false
        const error = geoResult?.error as Error | null ?? null

        if (!geo) {
          return { key, label, color, loading, error, aggregateValue: null, points: [], sourceType: src.type, isBaseline: false }
        }

        const filtered = applyFilters(geo.geojson.features, src.filters)
        const vals = filtered
          .map((f: any) => f.properties?.[src.metric] as number)
          .filter((v: any) => typeof v === "number" && !isNaN(v))

        const aggregateValue = vals.length ? aggregate(vals, src.aggregation) : null
        const rec = allRecords.find((r) => r.id === src.recordId)
        const points: TemporalPoint[] = rec && aggregateValue !== null
          ? [{ date: rec.date, value: aggregateValue }]
          : []

        return { key, label, color, loading, error, aggregateValue, points, sourceType: src.type, isBaseline: false }
      }

      if (src.type === "pipeline-avg") {
        const pipelineRecords = allRecords.filter((r) => r.pipeline_id === src.pipelineId)
        const allLoading = pipelineRecords.some((r) => {
          const idx = allGeoJsonIds.indexOf(r.id)
          return idx !== -1 && (geoJsonResults[idx]?.isLoading ?? false)
        })

        const points: TemporalPoint[] = buildTemporalSeries(
          pipelineRecords,
          pipelineRecords.map((r) => geoJsonByRecordId.get(r.id) ?? null),
          src.metric,
          null,
          src.filters,
          { aggregation: src.aggregation }
        ).map((row) => ({ date: String(row.date), value: row[src.metric] as number ?? null }))

        const aggregateValue = points.length
          ? aggregate(points.map((p) => p.value).filter((v): v is number => v !== null), src.aggregation)
          : null

        return { key, label, color, loading: allLoading, error: null, aggregateValue, points, sourceType: src.type, isBaseline: false }
      }

      if (src.type === "reference") {
        const refResult = refAggResults[refAggRequests.findIndex((r) => r.srcId === src.id)]
        const datasetId = (src as any).datasetId as string
        const plotsLoading = groupByField
          ? (refPlotResults[refDatasetIds.indexOf(datasetId)]?.isLoading ?? false)
          : false
        const loading = (refResult?.isLoading ?? false) || plotsLoading
        const error = refResult?.error as Error | null ?? null
        const agg = refAggBySourceId.get(src.id)
        const aggregateValue = agg?.value ?? null
        // When groupByField is set and plots are available, this source contributes
        // to categoricalData as a regular bar (not a baseline reference line).
        const hasPlotData = groupByField && (refPlotsByDatasetId.get(datasetId)?.length ?? 0) > 0
        return {
          key, label, color, loading, error,
          aggregateValue,
          points: [],
          sourceType: src.type,
          isBaseline: !hasPlotData,
        }
      }

      return { key, label, color, loading: false, error: null, aggregateValue: null, points: [], sourceType: (src as any).type, isBaseline: false }
    })
  }, [sources, allRecords, geoJsonByRecordId, geoJsonResults, allGeoJsonIds, refAggBySourceId, refAggResults, refAggRequests, groupByField, refPlotsByDatasetId, refPlotResults, refDatasetIds])

  const loading = series.some((s) => s.loading)
  const anyError = series.some((s) => s.error !== null)

  // ── Standard temporal data (no groupBy) ───────────────────────────────────

  const temporalData: Array<Record<string, string | number | null>> = useMemo(() => {
    if (groupByField) return []
    const nonBaseline = series.filter((s) => !s.isBaseline)
    if (nonBaseline.length === 0) return []

    const allDates = [...new Set(nonBaseline.flatMap((s) => s.points.map((p) => p.date)))]
      .sort()

    return allDates.map((date) => {
      const row: Record<string, string | number | null> = { date }
      nonBaseline.forEach((s) => {
        const pt = s.points.find((p) => p.date === date)
        row[s.key] = pt?.value ?? null
      })
      return row
    })
  }, [series, groupByField])

  // ── Categorical data (groupByField set — aggregate per group value) ────────

  const categoricalBySource = useMemo(() => {
    if (!groupByField) return new Map<string, Map<string, number | null>>()
    const result = new Map<string, Map<string, number | null>>()

    sources.forEach((src) => {
      const key = sourceKey(src)
      if (src.type === "pipeline-run") {
        const geo = geoJsonByRecordId.get(src.recordId)
        if (!geo) return
        const filtered = applyFilters(geo.geojson.features, src.filters)
        result.set(key, groupByValues(filtered, groupByField, src.metric, src.aggregation))
      } else if (src.type === "pipeline-avg") {
        const pRecs = allRecords.filter((r) => r.pipeline_id === src.pipelineId)
        const allFeats: any[] = []
        pRecs.forEach((r) => {
          const geo = geoJsonByRecordId.get(r.id)
          if (geo) allFeats.push(...applyFilters(geo.geojson.features, src.filters))
        })
        result.set(key, groupByValues(allFeats, groupByField, src.metric, src.aggregation))
      } else if (src.type === "reference") {
        const datasetId = (src as any).datasetId as string
        const plots = refPlotsByDatasetId.get(datasetId) ?? []
        if (plots.length === 0) return
        // Apply reference-level filters (matching on top-level fields: accession, col, row, plot_id)
        const filters = src.filters ?? {}
        const filtered = plots.filter((p) =>
          Object.entries(filters).every(([field, vals]) => {
            if (vals.length === 0) return true
            const v = String((p as any)[field] ?? "")
            return vals.includes(v)
          })
        )
        // Group by field: look in top-level fields first, then traits
        const buckets = new Map<string, number[]>()
        filtered.forEach((p) => {
          const gv = String((p as any)[groupByField] ?? "")
          if (!gv || gv === "null" || gv === "undefined" || gv === "") return
          const raw = p.traits?.[src.metric]
          if (raw == null || (typeof raw === "number" && isNaN(raw))) return
          const val = typeof raw === "number" ? raw : parseFloat(raw)
          if (isNaN(val)) return
          if (!buckets.has(gv)) buckets.set(gv, [])
          buckets.get(gv)!.push(val)
        })
        const groupMap = new Map<string, number | null>()
        buckets.forEach((vals, k) => groupMap.set(k, vals.length ? aggregate(vals, src.aggregation) : null))
        result.set(key, groupMap)
      }
    })

    return result
  }, [groupByField, sources, geoJsonByRecordId, allRecords, refPlotsByDatasetId])

  const categoricalData: Array<Record<string, string | number | null>> = useMemo(() => {
    if (!groupByField || categoricalBySource.size === 0) return []
    const nonBaseline = series.filter((s) => !s.isBaseline)
    const allCats = new Set<string>()
    nonBaseline.forEach((s) => {
      categoricalBySource.get(s.key)?.forEach((_, k) => allCats.add(k))
    })
    if (allCats.size === 0) return []

    const sorted = [...allCats].sort((a, b) => {
      const na = Number(a), nb = Number(b)
      return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b)
    })

    return sorted.map((cat) => {
      const row: Record<string, string | number | null> = { name: cat }
      nonBaseline.forEach((s) => {
        row[s.key] = categoricalBySource.get(s.key)?.get(cat) ?? null
      })
      return row
    })
  }, [groupByField, categoricalBySource, series])

  // ── Grouped temporal data (groupByField + temporal sources) ───────────────
  // Each pipeline source is split into sub-series keyed `${sourceKey}__${groupValue}`.

  const groupedTemporalData = useMemo((): {
    data: Array<Record<string, string | number | null>>
    subKeys: string[]
  } => {
    if (!groupByField) return { data: [], subKeys: [] }

    const byDate = new Map<string, Record<string, string | number | null>>()
    const allSubKeys: string[] = []

    sources.forEach((src) => {
      const key = sourceKey(src)

      if (src.type === "pipeline-avg") {
        const pRecs = allRecords.filter((r) => r.pipeline_id === src.pipelineId)
        const rows = buildTemporalSeries(
          pRecs,
          pRecs.map((r) => geoJsonByRecordId.get(r.id) ?? null),
          src.metric,
          groupByField,
          src.filters,
          { aggregation: src.aggregation }
        )
        rows.forEach((row) => {
          const date = String(row.date)
          if (!byDate.has(date)) byDate.set(date, { date })
          const rowData = byDate.get(date)!
          Object.keys(row).forEach((k) => {
            if (k === "date") return
            const subKey = `${key}__${k}`
            if (!allSubKeys.includes(subKey)) allSubKeys.push(subKey)
            rowData[subKey] = (row[k] as number) ?? null
          })
        })
      } else if (src.type === "pipeline-run") {
        const geo = geoJsonByRecordId.get(src.recordId)
        if (!geo) return
        const rec = allRecords.find((r) => r.id === src.recordId)
        if (!rec) return
        const date = rec.date
        if (!byDate.has(date)) byDate.set(date, { date })
        const rowData = byDate.get(date)!
        groupByValues(
          applyFilters(geo.geojson.features, src.filters),
          groupByField, src.metric, src.aggregation
        ).forEach((val, groupVal) => {
          const subKey = `${key}__${groupVal}`
          if (!allSubKeys.includes(subKey)) allSubKeys.push(subKey)
          rowData[subKey] = val
        })
      }
    })

    const data = [...byDate.values()].sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    )
    return { data, subKeys: allSubKeys }
  }, [groupByField, sources, allRecords, geoJsonByRecordId])

  return { series, loading, anyError, temporalData, categoricalData, groupedTemporalData }
}
