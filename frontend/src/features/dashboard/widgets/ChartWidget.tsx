/**
 * ChartWidget — unified chart component supporting:
 *   - spatial bar chart (X=categorical, Y=metric, single record)
 *   - temporal line/area chart (X=date, Y=metric avg, multiple records)
 *   - correlation scatter (X=metric, Y=metric, single record)
 *   - histogram (distribution of one metric)
 */

import React, { useMemo } from "react"
import { Loader2 } from "lucide-react"
import {
  ComposedChart,
  BarChart, Bar, Cell as BarCell,
  ScatterChart, Scatter, ZAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Line, Area, ReferenceLine,
} from "recharts"
import {
  useTraitRecordGeojson,
  useMultiTraitGeojson,
  groupBy,
  groupByMulti,
  buildTemporalSeries,
  applyFilters,
  formatDashboardValue,
} from "../hooks/useTraitData"
import { useTraitRecords } from "../hooks/useTraitData"
import { useMultiSourceData } from "../hooks/useMultiSourceData"
import type { ChartConfig } from "../types"
import { sourceKey } from "../types"

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

  const leftLabel = dualAxis ? formatLabel(effectiveYAxes[0]) : undefined
  const rightLabel = dualAxis ? effectiveYAxes.slice(1).map(formatLabel).join(", ") : undefined

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 4, right: dualAxis ? 48 : 8, bottom: 24, left: dualAxis ? 16 : 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          label={{ value: formatLabel(config.xAxis), position: "insideBottom", offset: -12, fontSize: 11 }}
        />
        {/* Left y-axis (always present) */}
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
          label={leftLabel ? { value: leftLabel, angle: -90, position: "insideLeft", fontSize: 10, offset: 10 } : undefined}
        />
        {/* Right y-axis only when dual-axis mode */}
        {dualAxis && (
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
            label={rightLabel ? { value: rightLabel, angle: 90, position: "insideRight", fontSize: 10, offset: 10 } : undefined}
          />
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
  const showBand = (config.showErrorBand ?? false) && !config.groupBy
  const bandType = config.errorBandType ?? "std"

  const { chartData, seriesKeys } = useMemo(() => {
    if (effectiveYAxes.length === 0) return { chartData: [], seriesKeys: [] as string[] }

    if (isMultiY) {
      // Build one series per metric and merge by date
      const byDate = new Map<string, Record<string, string | number>>()
      effectiveYAxes.forEach((metric) => {
        const agg = config.yAxesAggregation?.[metric] ?? "avg"
        buildTemporalSeries(relevantRecords, geojsons, metric, null, config.filters, {
          aggregation: agg,
          bandType: showBand ? bandType : undefined,
        }).forEach((row) => {
          const key = String(row.date)
          if (!byDate.has(key)) byDate.set(key, { date: key })
          Object.assign(byDate.get(key)!, row)
        })
      })
      const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
      return { chartData: rows, seriesKeys: effectiveYAxes }
    }

    const agg = config.yAxesAggregation?.[effectiveYAxes[0]] ?? "avg"
    const rows = buildTemporalSeries(
      relevantRecords, geojsons, effectiveYAxes[0], config.groupBy, config.filters,
      { aggregation: agg, bandType: showBand ? bandType : undefined }
    )
    const keys = config.groupBy
      ? [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => k !== "date" && !k.endsWith("_lo") && !k.endsWith("_range"))))]
      : [effectiveYAxes[0]]
    return { chartData: rows, seriesKeys: keys }
  }, [relevantRecords, geojsons, effectiveYAxes, isMultiY, config.groupBy, config.filters, config.yAxesAggregation, showBand, bandType])

  if (loading) return <Loading />
  if (!config.pipelineId || effectiveYAxes.length === 0) return <Unconfigured />
  const failedCount = geojsons.filter((g) => g === null).length
  const hasPartialData = failedCount > 0 && chartData.length > 0

  if (failedCount > 0 && chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
        <p className="text-sm text-muted-foreground">No data available</p>
        <p className="text-xs text-destructive">{failedCount} extraction{failedCount > 1 ? "s" : ""} could not be loaded — re-run trait extraction</p>
      </div>
    )
  }

  const isArea = config.chartType === "area"
  const temporalLeftLabel = dualAxis ? formatLabel(effectiveYAxes[0]) : undefined
  const temporalRightLabel = dualAxis ? effectiveYAxes.slice(1).map(formatLabel).join(", ") : undefined

  return (
    <div className="flex flex-col h-full">
      {hasPartialData && (
        <p className="text-[10px] text-destructive px-2 pt-1 flex-shrink-0">
          {failedCount} date{failedCount > 1 ? "s" : ""} missing — re-run extraction to complete the series
        </p>
      )}
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 4, right: dualAxis ? 48 : 8, bottom: 8, left: dualAxis ? 16 : 0 }}>
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
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
          label={temporalLeftLabel ? { value: temporalLeftLabel, angle: -90, position: "insideLeft", fontSize: 10, offset: 10 } : undefined}
        />
        {dualAxis && (
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
            label={temporalRightLabel ? { value: temporalRightLabel, angle: 90, position: "insideRight", fontSize: 10, offset: 10 } : undefined}
          />
        )}
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            const visible = payload.filter(
              (p) => !String(p.dataKey).endsWith("_lo") && !String(p.dataKey).endsWith("_range")
            )
            return (
              <div style={{ fontSize: 12, background: "var(--background)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px" }}>
                <p style={{ marginBottom: 4, fontWeight: 500 }}>{label}</p>
                {visible.map((p) => (
                  <p key={String(p.dataKey)} style={{ color: p.color, margin: "2px 0" }}>
                    {formatLabel(String(p.dataKey))}: {formatDashboardValue(p.value as number, String(p.dataKey))}
                  </p>
                ))}
              </div>
            )
          }}
        />
        {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}

        {seriesKeys.map((key, i) => {
          const color = SERIES_COLORS[i % SERIES_COLORS.length]
          const axisId = dualAxis && i > 0 ? "right" : "left"
          return (
            <React.Fragment key={key}>
              {/* Error band — stacked area trick: transparent base + colored range on top */}
              {showBand && (
                <>
                  <Area
                    yAxisId={axisId}
                    dataKey={`${key}_lo`}
                    stackId={`band_${i}`}
                    fill="transparent"
                    stroke="none"
                    legendType="none"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                  <Area
                    yAxisId={axisId}
                    dataKey={`${key}_range`}
                    stackId={`band_${i}`}
                    fill={color}
                    fillOpacity={0.15}
                    stroke="none"
                    legendType="none"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                </>
              )}
              {/* Main series */}
              {isArea ? (
                <Area
                  yAxisId={axisId}
                  type="monotone"
                  dataKey={key}
                  name={formatLabel(key)}
                  stroke={color}
                  fill={`url(#grad-${i})`}
                  dot={false}
                />
              ) : (
                <Line
                  yAxisId={axisId}
                  type="monotone"
                  dataKey={key}
                  name={formatLabel(key)}
                  stroke={color}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              )}
            </React.Fragment>
          )
        })}
      </ComposedChart>
    </ResponsiveContainer>
    </div>
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

// ── Multi-source chart ────────────────────────────────────────────────────────

function MultiSourceChart({ config }: { config: ChartConfig }) {
  const sources = config.sources ?? []
  const groupByField = config.groupByField ?? null
  const barLayout = config.barLayout ?? "grouped"
  const { series, loading, anyError, temporalData, categoricalData, groupedTemporalData } =
    useMultiSourceData(sources, groupByField)

  const hasTemporal = series.some((s) => !s.isBaseline && s.points.length > 0)
  const isArea = config.chartType === "area"
  const isBar = config.chartType === "bar"
  const dualAxis = sources.some((s) => s.yAxis === "right")

  if (loading) return <Loading />
  if (sources.length === 0) return <Unconfigured />

  if (anyError && series.every((s) => s.aggregateValue === null && s.points.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
        <p className="text-sm text-muted-foreground">Could not load data</p>
        <p className="text-xs text-destructive">One or more sources failed — check that extractions completed successfully</p>
      </div>
    )
  }

  const nonBaselineSeries = series.filter((s) => !s.isBaseline)
  const baselineSeries = series.filter((s) => s.isBaseline)

  // ── Case 1: categorical X-axis (groupByField set + categorical data ready) ──

  if (groupByField && categoricalData.length > 0) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={categoricalData} margin={{ top: nonBaselineSeries.length > 1 ? 28 : 4, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
            formatter={(v: any, name: any) => {
              const s = nonBaselineSeries.find((s) => s.key === String(name))
              return [formatDashboardValue(v), s?.label ?? String(name)]
            }}
          />
          {nonBaselineSeries.length > 1 && (
            <Legend
              verticalAlign="top"
              formatter={(name) => nonBaselineSeries.find((s) => s.key === name)?.label ?? name}
              wrapperStyle={{ fontSize: 11, paddingBottom: 4 }}
            />
          )}
          {nonBaselineSeries.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.key}
              fill={s.color}
              stackId={barLayout === "stacked" ? "stack" : undefined}
              radius={barLayout === "grouped" ? [3, 3, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
          {baselineSeries.filter((s) => s.aggregateValue !== null).map((s) => (
            <ReferenceLine key={s.key} y={s.aggregateValue!} stroke={s.color}
              strokeDasharray="6 3" strokeWidth={1.5}
              label={{ value: s.label, position: "insideTopRight", fontSize: 10, fill: s.color }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    )
  }

  // ── Case 2: temporal with group split (groupByField set + grouped temporal data) ──

  if (groupByField && groupedTemporalData.data.length > 0) {
    const { data: gtData, subKeys } = groupedTemporalData
    return (
      <div className="flex flex-col h-full">
        {anyError && (
          <p className="text-[10px] text-destructive px-2 pt-1 flex-shrink-0">
            Some sources could not be loaded — data may be incomplete
          </p>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={gtData} margin={{ top: 28, right: 8, bottom: 8, left: 0 }}>
            <defs>
              {subKeys.map((sk, i) => (
                <linearGradient key={sk} id={`grad-gt-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }}
              formatter={(v: any, name: any) => {
                const parts = String(name).split("__")
                return [formatDashboardValue(v), parts[parts.length - 1] ?? String(name)]
              }}
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{ fontSize: 11, paddingBottom: 4 }}
              formatter={(name) => { const parts = String(name).split("__"); return parts[parts.length - 1] ?? name }}
            />
            {subKeys.map((sk, i) => {
              const color = SERIES_COLORS[i % SERIES_COLORS.length]
              if (isArea) {
                return <Area key={sk} yAxisId="left" type="monotone" dataKey={sk} name={sk}
                  stroke={color} fill={`url(#grad-gt-${i})`} strokeWidth={2}
                  dot={false} activeDot={{ r: 4 }} connectNulls={false} />
              }
              return <Line key={sk} yAxisId="left" type="monotone" dataKey={sk} name={sk}
                stroke={color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
            })}
            {baselineSeries.filter((s) => s.aggregateValue !== null).map((s) => (
              <ReferenceLine key={s.key} yAxisId="left" y={s.aggregateValue!} stroke={s.color}
                strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: s.label, position: "insideTopRight", fontSize: 10, fill: s.color }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // ── Case 3: aggregate bar (each source = one bar, side by side) ───────────

  if (isBar || !hasTemporal) {
    // When there are no non-baseline series (reference-only chart), show reference values as bars
    const effectiveSeries = nonBaselineSeries.length > 0 ? nonBaselineSeries : series
    const barData = effectiveSeries.map((s) => ({
      name: s.label,
      value: s.aggregateValue ?? 0,
      _key: s.key,
      _color: s.color,
    }))
    // Extend Y-axis to include reference line values (which may be outside bar range)
    const refLineValues = nonBaselineSeries.length > 0
      ? baselineSeries.filter((s) => s.aggregateValue !== null).map((s) => s.aggregateValue as number)
      : []
    const barMax = barData.reduce((m, d) => Math.max(m, d.value), 0)
    const yDomainMax = refLineValues.length > 0
      ? Math.ceil(Math.max(barMax, ...refLineValues) * 1.1)
      : undefined
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
            domain={yDomainMax !== undefined ? [0, yDomainMax] : undefined} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
            formatter={(v: any) => [formatDashboardValue(v), ""]}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {barData.map((d) => (
              <BarCell key={d._key} fill={d._color} />
            ))}
          </Bar>
          {nonBaselineSeries.length > 0 && baselineSeries.filter((s) => s.aggregateValue !== null).map((s) => (
            <ReferenceLine key={s.key} y={s.aggregateValue!} stroke={s.color}
              strokeDasharray="6 3" strokeWidth={1.5}
              label={{ value: s.label, position: "insideTopRight", fontSize: 10, fill: s.color }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    )
  }

  // ── Case 4: temporal mode (lines/areas, no groupBy) ───────────────────────

  return (
    <div className="flex flex-col h-full">
      {anyError && (
        <p className="text-[10px] text-destructive px-2 pt-1 flex-shrink-0">
          Some sources could not be loaded — data may be incomplete
        </p>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={temporalData} margin={{ top: 28, right: dualAxis ? 48 : 8, bottom: 8, left: dualAxis ? 16 : 0 }}>
          <defs>
            {nonBaselineSeries.map((s) => (
              <linearGradient key={s.key} id={`grad-ms-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
            label={dualAxis ? {
              value: nonBaselineSeries.filter((s) => sources.find((src) => sourceKey(src) === s.key)?.yAxis !== "right").map((s) => s.label).join(", "),
              angle: -90, position: "insideLeft", fontSize: 10, offset: 10,
            } : undefined}
          />
          {dualAxis && (
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
              label={{
                value: nonBaselineSeries.filter((s) => sources.find((src) => sourceKey(src) === s.key)?.yAxis === "right").map((s) => s.label).join(", "),
                angle: 90, position: "insideRight", fontSize: 10, offset: 10,
              }}
            />
          )}
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
            formatter={(value: any, name: any) => {
              const s = series.find((s) => s.key === String(name))
              return [formatDashboardValue(value), s?.label ?? String(name)]
            }}
          />
          <Legend
            verticalAlign="top"
            formatter={(name) => series.find((s) => s.key === name)?.label ?? name}
            wrapperStyle={{ fontSize: 11, paddingBottom: 4 }}
          />

          {nonBaselineSeries.map((s) => {
            const src = sources.find((src) => sourceKey(src) === s.key)
            const axisId = src?.yAxis === "right" ? "right" : "left"
            if (isArea) {
              return (
                <Area key={s.key} yAxisId={axisId} type="monotone" dataKey={s.key} name={s.key}
                  stroke={s.color} fill={`url(#grad-ms-${s.key})`} strokeWidth={2}
                  dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
              )
            }
            return (
              <Line key={s.key} yAxisId={axisId} type="monotone" dataKey={s.key} name={s.key}
                stroke={s.color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
            )
          })}

          {baselineSeries.filter((s) => s.aggregateValue !== null).map((s) => {
            const src = sources.find((src) => sourceKey(src) === s.key)
            const axisId = src?.yAxis === "right" ? "right" : "left"
            return (
              <ReferenceLine key={s.key} yAxisId={axisId} y={s.aggregateValue!}
                stroke={s.color} strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: s.label, position: "insideTopRight", fontSize: 10, fill: s.color }}
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

interface ChartWidgetProps {
  config: ChartConfig
}

export function ChartWidget({ config }: ChartWidgetProps) {
  if ((config.sources?.length ?? 0) > 0 || config.mode === "multi-source")
    return <MultiSourceChart config={config} />
  if (config.mode === "temporal") return <TemporalChart config={config} />
  if (config.mode === "correlation") return <CorrelationScatter config={config} />
  if (config.chartType === "histogram") return <HistogramChart config={config} />
  return <SpatialBarChart config={config} />
}
