/**
 * ChartWidget — unified chart component supporting:
 *   - spatial bar chart (X=categorical, Y=metric, single record)
 *   - temporal line/area chart (X=date, Y=metric avg, multiple records)
 *   - correlation scatter (X=metric, Y=metric, single record)
 *   - histogram (distribution of one metric)
 */

import { useMemo } from "react"
import { Loader2 } from "lucide-react"
import {
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  ScatterChart, Scatter, ZAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts"
import {
  useTraitRecordGeojson,
  useMultiTraitGeojson,
  groupBy,
  groupByMulti,
  buildTemporalSeries,
  applyFilters,
} from "../hooks/useTraitData"
import { useTraitRecords } from "../hooks/useTraitData"
import type { ChartConfig } from "../types"

// 10-color palette for multi-series charts
const SERIES_COLORS = [
  "#4f46e5", "#0ea5e9", "#22c55e", "#f59e0b", "#ec4899",
  "#8b5cf6", "#14b8a6", "#f97316", "#64748b", "#a16207",
]

const BIN_COUNT = 10

function buildHistogram(values: number[]): { label: string; count: number }[] {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const step = (max - min) / BIN_COUNT || 1
  return Array.from({ length: BIN_COUNT }, (_, i) => {
    const lo = min + i * step
    const hi = lo + step
    return {
      label: lo.toFixed(2),
      count: values.filter((v) => v >= lo && (i === BIN_COUNT - 1 ? v <= hi : v < hi)).length,
    }
  })
}

function formatLabel(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── Spatial bar chart ─────────────────────────────────────────────────────────

function SpatialBarChart({ config }: { config: ChartConfig }) {
  const { data: geoData, isLoading, isError } = useTraitRecordGeojson(config.traitRecordId)

  // Effective y-axes: prefer yAxes array, fall back to legacy yAxis
  const effectiveYAxes = useMemo(
    () => ((config.yAxes?.length ?? 0) > 0 ? config.yAxes : config.yAxis ? [config.yAxis] : []),
    [config.yAxes, config.yAxis]
  )
  const isMulti = effectiveYAxes.length > 1

  const chartData = useMemo(() => {
    if (!geoData || !config.xAxis || effectiveYAxes.length === 0) return []
    const filtered = { ...geoData.geojson, features: applyFilters(geoData.geojson.features, config.filters) }
    if (isMulti) return groupByMulti(filtered, config.xAxis, effectiveYAxes)
    return groupBy(filtered, config.xAxis, effectiveYAxes[0])
  }, [geoData, config.xAxis, effectiveYAxes, config.filters, isMulti])

  if (isLoading) return <Loading />
  if (isError) return <ErrorMsg />
  if (!config.xAxis || effectiveYAxes.length === 0) return <Unconfigured />

  const dualAxis = isMulti && (config.dualAxis ?? false)

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 4, right: dualAxis ? 48 : 8, bottom: 24, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          label={{ value: formatLabel(config.xAxis), position: "insideBottom", offset: -12, fontSize: 11 }}
        />
        {/* Left y-axis (always present) */}
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        {/* Right y-axis only when dual-axis mode */}
        {dualAxis && (
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        )}
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
          formatter={(v, name) => [typeof v === "number" ? v.toFixed(4) : v, formatLabel(String(name))]}
        />
        {isMulti && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {isMulti ? (
          effectiveYAxes.map((metric, i) => (
            <Bar
              key={metric}
              yAxisId={dualAxis && i > 0 ? "right" : "left"}
              dataKey={metric}
              name={formatLabel(metric)}
              fill={SERIES_COLORS[i % SERIES_COLORS.length]}
              radius={[3, 3, 0, 0]}
            />
          ))
        ) : (
          <Bar yAxisId="left" dataKey="value" name={formatLabel(effectiveYAxes[0])} fill="#4f46e5" radius={[3, 3, 0, 0]} />
        )}
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Temporal line/area chart ──────────────────────────────────────────────────

function TemporalChart({ config }: { config: ChartConfig }) {
  const { data: records } = useTraitRecords()
  const relevantRecords = useMemo(() => {
    if (!records || !config.pipelineId) return []
    const ids = config.temporalRecordIds
    if (ids.length > 0) return records.filter((r) => ids.includes(r.id))
    return records.filter((r) => r.pipeline_id === config.pipelineId)
  }, [records, config.pipelineId, config.temporalRecordIds])

  const { data: geojsons, loading } = useMultiTraitGeojson(relevantRecords.map((r) => r.id))

  const effectiveYAxes = useMemo(
    () => ((config.yAxes?.length ?? 0) > 0 ? config.yAxes : config.yAxis ? [config.yAxis] : []),
    [config.yAxes, config.yAxis]
  )
  const isMultiY = effectiveYAxes.length > 1
  const dualAxis = isMultiY && (config.dualAxis ?? false)

  const { chartData, seriesKeys } = useMemo(() => {
    if (effectiveYAxes.length === 0) return { chartData: [], seriesKeys: [] as string[] }

    if (isMultiY) {
      // Build one series per metric and merge by date
      const byDate = new Map<string, Record<string, string | number>>()
      effectiveYAxes.forEach((metric) => {
        buildTemporalSeries(relevantRecords, geojsons, metric, null, config.filters).forEach((row) => {
          const key = String(row.date)
          if (!byDate.has(key)) byDate.set(key, { date: key })
          byDate.get(key)![metric] = row[metric] as number
        })
      })
      const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
      return { chartData: rows, seriesKeys: effectiveYAxes }
    }

    const rows = buildTemporalSeries(relevantRecords, geojsons, effectiveYAxes[0], config.groupBy, config.filters)
    const keys = config.groupBy
      ? [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => k !== "date")))]
      : [effectiveYAxes[0]]
    return { chartData: rows, seriesKeys: keys }
  }, [relevantRecords, geojsons, effectiveYAxes, isMultiY, config.groupBy, config.filters])

  if (loading) return <Loading />
  if (!config.pipelineId || effectiveYAxes.length === 0) return <Unconfigured />

  const ChartComponent = config.chartType === "area" ? AreaChart : LineChart

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ChartComponent data={chartData} margin={{ top: 4, right: dualAxis ? 48 : 8, bottom: 8, left: 0 }}>
        <defs>
          {seriesKeys.map((key, i) => (
            <linearGradient key={key} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0.3} />
              <stop offset="95%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        {dualAxis && (
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        )}
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
        {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {seriesKeys.map((key, i) =>
          config.chartType === "area" ? (
            <Area
              key={key}
              yAxisId={dualAxis && i > 0 ? "right" : "left"}
              type="monotone"
              dataKey={key}
              name={formatLabel(key)}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              fill={`url(#grad-${i})`}
              dot={false}
            />
          ) : (
            <Line
              key={key}
              yAxisId={dualAxis && i > 0 ? "right" : "left"}
              type="monotone"
              dataKey={key}
              name={formatLabel(key)}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          )
        )}
      </ChartComponent>
    </ResponsiveContainer>
  )
}

// ── Correlation scatter ───────────────────────────────────────────────────────

function CorrelationScatter({ config }: { config: ChartConfig }) {
  const { data: geoData, isLoading, isError } = useTraitRecordGeojson(config.traitRecordId)

  const scatterData = useMemo(() => {
    if (!geoData || !config.xAxis || !config.yAxis) return []
    return applyFilters(geoData.geojson.features, config.filters)
      .map((f) => ({
        x: f.properties?.[config.xAxis!] as number,
        y: f.properties?.[config.yAxis!] as number,
        name: String(f.properties?.plot_id ?? ""),
      }))
      .filter((d) => typeof d.x === "number" && typeof d.y === "number" && !isNaN(d.x) && !isNaN(d.y))
  }, [geoData, config.xAxis, config.yAxis, config.filters])

  if (isLoading) return <Loading />
  if (isError) return <ErrorMsg />
  if (!config.xAxis || !config.yAxis) return <Unconfigured />

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 4, right: 8, bottom: 24, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          type="number"
          dataKey="x"
          name={formatLabel(config.xAxis)}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          label={{ value: formatLabel(config.xAxis), position: "insideBottom", offset: -12, fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={formatLabel(config.yAxis)}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <ZAxis range={[20, 20]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
          formatter={(v, name) => [typeof v === "number" ? v.toFixed(4) : v, formatLabel(String(name))]}
        />
        <Scatter data={scatterData} fill="#4f46e5" fillOpacity={0.6} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

// ── Histogram ─────────────────────────────────────────────────────────────────

function HistogramChart({ config }: { config: ChartConfig }) {
  const { data: geoData, isLoading, isError } = useTraitRecordGeojson(config.traitRecordId)

  const histData = useMemo(() => {
    if (!geoData || !config.yAxis) return []
    const values = applyFilters(geoData.geojson.features, config.filters)
      .map((f) => f.properties?.[config.yAxis!] as number)
      .filter((v) => typeof v === "number" && !isNaN(v))
    return buildHistogram(values)
  }, [geoData, config.yAxis, config.filters])

  if (isLoading) return <Loading />
  if (isError) return <ErrorMsg />
  if (!config.yAxis) return <Unconfigured />

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={histData} margin={{ top: 4, right: 8, bottom: 24, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          label={{ value: formatLabel(config.yAxis), position: "insideBottom", offset: -12, fontSize: 11 }}
        />
        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
          formatter={(v) => [v, "Count"]}
          labelFormatter={(l) => `≥ ${l}`}
        />
        <Bar dataKey="count" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function Loading() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm h-full">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading data…
    </div>
  )
}

function ErrorMsg() {
  return <p className="text-sm text-destructive h-full flex items-center">Failed to load data.</p>
}

function Unconfigured() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-muted-foreground text-center">
      Open settings to configure data source and axes.
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

interface ChartWidgetProps {
  config: ChartConfig
}

export function ChartWidget({ config }: ChartWidgetProps) {
  if (config.mode === "temporal") return <TemporalChart config={config} />
  if (config.mode === "correlation") return <CorrelationScatter config={config} />
  if (config.chartType === "histogram") return <HistogramChart config={config} />
  return <SpatialBarChart config={config} />
}
