import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { TraitRecordOutput } from "@/client"
import { MultiSelectFilter } from "@/components/Common/MultiSelectFilter"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  fetchAnova,
  fetchGGE,
  fetchHeritability,
  fetchSpatial,
} from "../lib/multivariate"
import { fetchTraitRecords } from "../lib/traitRecords"
import { AnovaTable } from "./AnovaTable"
import { GgeBiplot } from "./GgeBiplot"
import { HeritabilityPanel } from "./HeritabilityPanel"
import { SpatialHeatmap } from "./SpatialHeatmap"

const COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#6366f1",
]

function generateColors(count: number): string[] {
  if (count <= 10) return COLORS.slice(0, count)
  const colors: string[] = []
  for (let i = 0; i < count; i++) {
    const hue = (i * 360) / count
    colors.push(`hsl(${hue}, 70%, 50%)`)
  }
  return colors
}

// MultiSelect lives in @/components/Common/MultiSelectFilter as
// `MultiSelectFilter`, used by both the View tab viewers and this page.

interface TraitChartsProps {
  traitId: string
  traitName: string
  traitUnits?: string
}

type ChartType =
  | "histogram"
  | "forest"
  | "season-trend"
  | "site-trend"
  | "spatial"
  | "anova"
  | "heritability"
  | "gge"
type GroupBy = "none" | "experiment" | "season" | "site"

function extractUnique(
  records: TraitRecordOutput[],
  key: keyof TraitRecordOutput,
): string[] {
  const set = new Set<string>()
  for (const r of records) {
    const v = r[key]
    if (v != null && String(v) !== "") set.add(String(v))
  }
  return [...set].sort()
}

function extractGenotypes(records: TraitRecordOutput[]): string[] {
  const set = new Set<string>()
  for (const r of records) {
    const info = r.record_info as Record<string, unknown> | undefined
    const g = info?.genotype
    if (g != null && String(g).trim() !== "") set.add(String(g).trim())
  }
  return [...set].sort()
}

interface HistogramBin {
  label: string
  binStart: number
  binEnd: number
  [seriesKey: string]: number | string
}

export function buildHistogram(
  records: TraitRecordOutput[],
  groupBy: GroupBy,
): { data: HistogramBin[]; seriesKeys: string[] } {
  const values = records
    .map((r) => r.trait_value!)
    .filter((v) => v != null && !Number.isNaN(v))
  if (values.length === 0) return { data: [], seriesKeys: [] }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const isInteger = values.every((v) => Number.isInteger(v))
  const intRange = Math.round(max) - Math.round(min)

  let binWidth: number
  let binCount: number
  let binBase: number

  if (isInteger && intRange <= 40) {
    binBase = Math.round(min)
    binCount = intRange + 1
    binWidth = 1
  } else if (isInteger && intRange <= 200) {
    const rawWidth = intRange / 20
    binWidth = Math.max(1, Math.ceil(rawWidth))
    binBase = Math.floor(min)
    binCount = Math.ceil((max - binBase) / binWidth) + 1
  } else {
    binCount = 20
    const range = max - min || 1
    binWidth = range / binCount
    binBase = min
  }

  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => {
    const binStart = binBase + i * binWidth
    const binEnd = binStart + binWidth
    const label =
      isInteger && binWidth === 1
        ? `${Math.round(binStart)}`
        : isInteger
          ? `${Math.round(binStart)}-${Math.round(binEnd - 1)}`
          : `${binStart.toFixed(1)}`
    return { label, binStart, binEnd }
  })

  const seriesSet = new Set<string>()

  for (const r of records) {
    const v = r.trait_value
    if (v == null || Number.isNaN(v)) continue
    let idx = Math.floor((v - binBase) / binWidth)
    if (idx >= binCount) idx = binCount - 1
    if (idx < 0) idx = 0

    let series = "Count"
    if (groupBy === "experiment") series = r.experiment_name || "Unknown"
    else if (groupBy === "season") series = r.season_name || "Unknown"
    else if (groupBy === "site") series = r.site_name || "Unknown"

    seriesSet.add(series)
    bins[idx][series] = ((bins[idx][series] as number) || 0) + 1
  }

  return { data: bins, seriesKeys: [...seriesSet].sort() }
}

interface GenotypePoint {
  genotype: string
  value: number
  series: string
}

export function buildGenotypeData(
  records: TraitRecordOutput[],
  groupBy: GroupBy,
): {
  points: GenotypePoint[]
  genotypes: string[]
  seriesKeys: string[]
  minVal: number
  maxVal: number
} {
  const points: GenotypePoint[] = []
  const seriesSet = new Set<string>()
  const genotypeMeans = new Map<string, number[]>()

  for (const r of records) {
    const info = r.record_info as Record<string, unknown> | undefined
    const genotype = info?.genotype ? String(info.genotype).trim() : null
    if (!genotype || r.trait_value == null) continue

    let series = "All"
    if (groupBy === "experiment") series = r.experiment_name || "Unknown"
    else if (groupBy === "season") series = r.season_name || "Unknown"
    else if (groupBy === "site") series = r.site_name || "Unknown"

    seriesSet.add(series)
    points.push({ genotype, value: r.trait_value, series })
    if (!genotypeMeans.has(genotype)) genotypeMeans.set(genotype, [])
    genotypeMeans.get(genotype)!.push(r.trait_value)
  }

  const genotypes = [...genotypeMeans.entries()]
    .sort((a, b) => {
      const meanA = a[1].reduce((s, v) => s + v, 0) / a[1].length
      const meanB = b[1].reduce((s, v) => s + v, 0) / b[1].length
      return meanB - meanA
    })
    .map(([g]) => g)

  const values = points.map((p) => p.value)
  const minVal = values.length > 0 ? Math.min(...values) : 0
  const maxVal = values.length > 0 ? Math.max(...values) : 1

  return {
    points,
    genotypes,
    seriesKeys: [...seriesSet].sort(),
    minVal,
    maxVal,
  }
}

export function TraitCharts({
  traitId,
  traitName,
  traitUnits,
}: TraitChartsProps) {
  const [chartType, setChartType] = useState<ChartType>("histogram")
  const [groupBy, setGroupBy] = useState<GroupBy>("none")
  const [filterExperiment, setFilterExperiment] = useState<Set<string>>(
    new Set(),
  )
  const [filterSeason, setFilterSeason] = useState<Set<string>>(new Set())
  const [filterSite, setFilterSite] = useState<Set<string>>(new Set())
  const [filterDataset, setFilterDataset] = useState<Set<string>>(new Set())
  const [filterPopulation, setFilterPopulation] = useState<Set<string>>(
    new Set(),
  )

  const { data: allRecords, isLoading } = useQuery({
    queryKey: ["traitRecords", traitId],
    queryFn: () => fetchTraitRecords(traitId),
    enabled: Boolean(traitId),
  })

  const experiments = useMemo(
    () => extractUnique(allRecords ?? [], "experiment_name"),
    [allRecords],
  )
  const seasons = useMemo(
    () => extractUnique(allRecords ?? [], "season_name"),
    [allRecords],
  )
  const sites = useMemo(
    () => extractUnique(allRecords ?? [], "site_name"),
    [allRecords],
  )
  const datasets = useMemo(
    () => extractUnique(allRecords ?? [], "dataset_name"),
    [allRecords],
  )
  const populations = useMemo(() => {
    const set = new Set<string>()
    for (const r of allRecords ?? []) {
      const info = r.record_info as Record<string, unknown> | undefined
      const pop = info?.population
      if (pop != null && String(pop).trim() !== "") set.add(String(pop).trim())
    }
    return [...set].sort()
  }, [allRecords])
  const hasGenotypes = useMemo(
    () => extractGenotypes(allRecords ?? []).length > 0,
    [allRecords],
  )

  const filtered = useMemo(() => {
    if (!allRecords) return []
    return allRecords.filter((r) => {
      if (
        filterExperiment.size > 0 &&
        (!r.experiment_name || !filterExperiment.has(r.experiment_name))
      )
        return false
      if (
        filterSeason.size > 0 &&
        (!r.season_name || !filterSeason.has(r.season_name))
      )
        return false
      if (filterSite.size > 0 && (!r.site_name || !filterSite.has(r.site_name)))
        return false
      if (
        filterDataset.size > 0 &&
        (!r.dataset_name || !filterDataset.has(r.dataset_name))
      )
        return false
      if (filterPopulation.size > 0) {
        const info = r.record_info as Record<string, unknown> | undefined
        const pop = info?.population ? String(info.population).trim() : ""
        if (!filterPopulation.has(pop)) return false
      }
      return true
    })
  }, [
    allRecords,
    filterExperiment,
    filterSeason,
    filterSite,
    filterDataset,
    filterPopulation,
  ])

  const valueLabel = traitUnits ? `${traitName} (${traitUnits})` : traitName

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading records...</span>
      </div>
    )
  }

  if (!allRecords || allRecords.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground py-4"
        data-testid="trait-charts-empty"
      >
        No trait records to visualize.
      </p>
    )
  }

  return (
    <div className="space-y-4" data-testid="trait-charts">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label
            htmlFor="trait-charts-chart-type"
            className="text-xs text-muted-foreground"
          >
            Chart type
          </label>
          <Select
            value={chartType}
            onValueChange={(v) => setChartType(v as ChartType)}
          >
            <SelectTrigger
              id="trait-charts-chart-type"
              className="w-44"
              data-testid="trait-charts-chart-type"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="histogram">Histogram</SelectItem>
              <SelectItem value="forest" disabled={!hasGenotypes}>
                Genotype range
              </SelectItem>
              <SelectItem value="season-trend" disabled={!hasGenotypes}>
                Season trend
              </SelectItem>
              <SelectItem value="site-trend" disabled={!hasGenotypes}>
                Site trend
              </SelectItem>
              <SelectItem value="spatial">Field layout</SelectItem>
              <SelectItem value="anova">ANOVA</SelectItem>
              <SelectItem value="heritability">Heritability + BLUPs</SelectItem>
              <SelectItem value="gge">GGE biplot</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {chartType !== "season-trend" &&
          chartType !== "site-trend" &&
          chartType !== "spatial" &&
          chartType !== "anova" &&
          chartType !== "heritability" &&
          chartType !== "gge" && (
            <div className="space-y-1">
              <label
                htmlFor="trait-charts-group-by"
                className="text-xs text-muted-foreground"
              >
                Group by
              </label>
              <Select
                value={groupBy}
                onValueChange={(v) => setGroupBy(v as GroupBy)}
              >
                <SelectTrigger id="trait-charts-group-by" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="experiment">Experiment</SelectItem>
                  <SelectItem value="season">Season</SelectItem>
                  <SelectItem value="site">Site</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

        <div className="h-6 w-px bg-border mx-1" />

        <MultiSelectFilter
          label="Experiment"
          options={experiments}
          selected={filterExperiment}
          onChange={setFilterExperiment}
          width="w-44"
          testId="filter-experiment"
        />
        <MultiSelectFilter
          label="Season"
          options={seasons}
          selected={filterSeason}
          onChange={setFilterSeason}
          width="w-40"
          testId="filter-season"
        />
        <MultiSelectFilter
          label="Site"
          options={sites}
          selected={filterSite}
          onChange={setFilterSite}
          width="w-40"
          testId="filter-site"
        />
        <MultiSelectFilter
          label="Dataset"
          options={datasets}
          selected={filterDataset}
          onChange={setFilterDataset}
          width="w-40"
          testId="filter-dataset"
        />
        {populations.length > 0 && (
          <MultiSelectFilter
            label="Population"
            options={populations}
            selected={filterPopulation}
            onChange={setFilterPopulation}
            width="w-44"
            testId="filter-population"
          />
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setFilterExperiment(new Set())
            setFilterSeason(new Set())
            setFilterSite(new Set())
            setFilterDataset(new Set())
            setFilterPopulation(new Set())
          }}
          className="self-end"
        >
          Reset filters
        </Button>
      </div>

      <div
        className="text-xs text-muted-foreground"
        data-testid="trait-charts-record-count"
      >
        {filtered.length} of {allRecords.length} records
      </div>

      {chartType === "histogram" && (
        <Histogram
          records={filtered}
          groupBy={groupBy}
          valueLabel={valueLabel}
        />
      )}
      {chartType === "forest" && (
        <ForestPlot
          records={filtered}
          groupBy={groupBy}
          valueLabel={valueLabel}
        />
      )}
      {chartType === "season-trend" && (
        <SeasonTrend records={filtered} valueLabel={valueLabel} />
      )}
      {chartType === "site-trend" && (
        <SiteTrend records={filtered} valueLabel={valueLabel} />
      )}
      {chartType === "spatial" && (
        <SpatialChart
          traitName={traitName}
          experimentNames={[...filterExperiment]}
          seasonNames={[...filterSeason]}
          siteNames={[...filterSite]}
        />
      )}
      {chartType === "anova" && (
        <AnovaChart
          traitName={traitName}
          experimentNames={[...filterExperiment]}
          seasonNames={[...filterSeason]}
          siteNames={[...filterSite]}
        />
      )}
      {chartType === "heritability" && (
        <HeritabilityChart
          traitName={traitName}
          experimentNames={[...filterExperiment]}
          seasonNames={[...filterSeason]}
          siteNames={[...filterSite]}
        />
      )}
      {chartType === "gge" && (
        <GgeChart
          traitName={traitName}
          experimentNames={[...filterExperiment]}
          seasonNames={[...filterSeason]}
          siteNames={[...filterSite]}
        />
      )}
    </div>
  )
}

interface StatsChartProps {
  traitName: string
  experimentNames: string[]
  seasonNames: string[]
  siteNames: string[]
}

function AnovaChart({
  traitName,
  experimentNames,
  seasonNames,
  siteNames,
}: StatsChartProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: [
      "anova",
      traitName,
      experimentNames.join(","),
      seasonNames.join(","),
      siteNames.join(","),
    ],
    queryFn: () =>
      fetchAnova({
        trait_names: [traitName],
        experiment_names: experimentNames.length ? experimentNames : undefined,
        season_names: seasonNames.length ? seasonNames : undefined,
        site_names: siteNames.length ? siteNames : undefined,
        aggregation: "mean",
        collapse_replicates: false,
      }),
    enabled: Boolean(traitName),
  })

  if (isLoading) {
    return <ChartLoader label="Running ANOVA…" />
  }
  if (error) {
    return <ChartError error={error} />
  }
  if (!data) return null
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        ANOVA uses raw per-plot values — averaging replicates would erase
        the within-genotype variation the F-test measures.
      </p>
      <AnovaTable response={data} />
    </div>
  )
}

function HeritabilityChart({
  traitName,
  experimentNames,
  seasonNames,
  siteNames,
}: StatsChartProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: [
      "heritability",
      traitName,
      experimentNames.join(","),
      seasonNames.join(","),
      siteNames.join(","),
    ],
    queryFn: () =>
      fetchHeritability({
        trait_names: [traitName],
        experiment_names: experimentNames.length ? experimentNames : undefined,
        season_names: seasonNames.length ? seasonNames : undefined,
        site_names: siteNames.length ? siteNames : undefined,
        aggregation: "mean",
        collapse_replicates: false,
      }),
    enabled: Boolean(traitName),
  })

  if (isLoading) {
    return <ChartLoader label="Estimating heritability…" />
  }
  if (error) {
    return <ChartError error={error} />
  }
  if (!data) return null
  return <HeritabilityPanel response={data} />
}

function GgeChart({
  traitName,
  experimentNames,
  seasonNames,
  siteNames,
}: StatsChartProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: [
      "gge",
      traitName,
      experimentNames.join(","),
      seasonNames.join(","),
      siteNames.join(","),
    ],
    queryFn: () =>
      fetchGGE({
        trait_names: [traitName],
        experiment_names: experimentNames.length ? experimentNames : undefined,
        season_names: seasonNames.length ? seasonNames : undefined,
        site_names: siteNames.length ? siteNames : undefined,
        aggregation: "mean",
        // /gge force-enables collapse_replicates on the backend regardless,
        // but be explicit so the request is self-documenting.
        collapse_replicates: true,
      }),
    enabled: Boolean(traitName),
  })

  if (isLoading) return <ChartLoader label="Building GGE biplot…" />
  if (error) return <ChartError error={error} />
  if (!data) return null
  if (data.status !== "ok") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="mv-gge-empty">
        {data.message ?? data.status}
      </p>
    )
  }
  return <GgeBiplot response={data} />
}

function ChartLoader({ label }: { label: string }) {
  return (
    <div className="flex h-32 items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}

function ChartError({ error }: { error: unknown }) {
  return (
    <p className="text-sm text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </p>
  )
}

function SpatialChart({
  traitName,
  experimentNames,
  seasonNames,
  siteNames,
}: StatsChartProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: [
      "spatial",
      traitName,
      experimentNames.join(","),
      seasonNames.join(","),
      siteNames.join(","),
    ],
    queryFn: () =>
      fetchSpatial({
        trait_names: [traitName],
        experiment_names: experimentNames.length ? experimentNames : undefined,
        season_names: seasonNames.length ? seasonNames : undefined,
        site_names: siteNames.length ? siteNames : undefined,
        aggregation: "mean",
      }),
    enabled: Boolean(traitName),
  })

  if (isLoading) return <ChartLoader label="Loading field layout…" />
  if (error) return <ChartError error={error} />
  if (!data) return null
  return <SpatialHeatmap response={data} />
}

function Histogram({
  records,
  groupBy,
  valueLabel,
}: {
  records: TraitRecordOutput[]
  groupBy: GroupBy
  valueLabel: string
}) {
  const { data, seriesKeys } = useMemo(
    () => buildHistogram(records, groupBy),
    [records, groupBy],
  )

  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">No data to display.</p>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart
        data={data}
        margin={{ top: 5, right: 20, bottom: 25, left: 10 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          label={{ value: valueLabel, position: "insideBottom", offset: -15 }}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          label={{
            value: "Count",
            angle: -90,
            position: "insideLeft",
            offset: 10,
          }}
          tick={{ fontSize: 11 }}
          allowDecimals={false}
        />
        <Tooltip />
        {seriesKeys.length > 1 && <Legend verticalAlign="top" />}
        {seriesKeys.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            fill={COLORS[i % COLORS.length]}
            name={key}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function ForestPlot({
  records,
  groupBy,
  valueLabel,
}: {
  records: TraitRecordOutput[]
  groupBy: GroupBy
  valueLabel: string
}) {
  const { points, genotypes, seriesKeys, minVal, maxVal } = useMemo(
    () => buildGenotypeData(records, groupBy),
    [records, groupBy],
  )
  const [page, setPage] = useState(0)
  const [hoveredGenotype, setHoveredGenotype] = useState<string | null>(null)
  const pageSize = 30
  const totalPages = Math.ceil(genotypes.length / pageSize)
  const pageGenotypes = genotypes.slice(page * pageSize, (page + 1) * pageSize)

  if (genotypes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No genotype data available. Map a genotype column during import to use
        this chart.
      </p>
    )
  }

  const margin = { top: 20, right: 30, bottom: 35, left: 120 }
  const rowHeight = 24
  const chartHeight =
    margin.top + margin.bottom + pageGenotypes.length * rowHeight
  const chartWidth = 800
  const plotWidth = chartWidth - margin.left - margin.right
  const plotHeight = chartHeight - margin.top - margin.bottom

  const pad = (maxVal - minVal) * 0.05 || 0.5
  const xMin = minVal - pad
  const xMax = maxVal + pad
  const xScale = (v: number) =>
    margin.left + ((v - xMin) / (xMax - xMin)) * plotWidth
  const yScale = (idx: number) => margin.top + idx * rowHeight + rowHeight / 2

  const xTicks: number[] = []
  const tickCount = 6
  for (let i = 0; i <= tickCount; i++) {
    xTicks.push(xMin + (i / tickCount) * (xMax - xMin))
  }

  return (
    <div className="space-y-3">
      {seriesKeys.length > 1 && (
        <div className="flex items-center gap-4 text-xs">
          {seriesKeys.map((key, i) => (
            <div key={key} className="flex items-center gap-1.5">
              <svg
                width={10}
                height={10}
                role="img"
                aria-label={`${key} series color`}
              >
                <circle cx={5} cy={5} r={4} fill={COLORS[i % COLORS.length]} />
              </svg>
              <span>{key}</span>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <svg
          width={chartWidth}
          height={chartHeight}
          className="select-none"
          data-testid="forest-plot-svg"
          role="img"
          aria-label={`Genotype range plot for ${valueLabel}`}
        >
          {xTicks.map((tick) => (
            <line
              key={tick}
              x1={xScale(tick)}
              y1={margin.top}
              x2={xScale(tick)}
              y2={margin.top + plotHeight}
              stroke="#e5e7eb"
              strokeDasharray="3 3"
            />
          ))}
          {xTicks.map((tick) => (
            <text
              key={`label-${tick}`}
              x={xScale(tick)}
              y={chartHeight - margin.bottom + 16}
              textAnchor="middle"
              fontSize={10}
              fill="#6b7280"
            >
              {tick.toFixed(1)}
            </text>
          ))}
          <text
            x={margin.left + plotWidth / 2}
            y={chartHeight - 4}
            textAnchor="middle"
            fontSize={11}
            fill="#374151"
          >
            {valueLabel}
          </text>

          {pageGenotypes.map((genotype, idx) => {
            const y = yScale(idx)
            const genotypePoints = points.filter((p) => p.genotype === genotype)
            const isHovered = hoveredGenotype === genotype
            const bySeries = new Map<string, number[]>()
            for (const p of genotypePoints) {
              if (!bySeries.has(p.series)) bySeries.set(p.series, [])
              bySeries.get(p.series)!.push(p.value)
            }
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover is decorative; values exposed via per-circle <title>.
              <g
                key={genotype}
                onMouseEnter={() => setHoveredGenotype(genotype)}
                onMouseLeave={() => setHoveredGenotype(null)}
              >
                {isHovered && (
                  <rect
                    x={margin.left}
                    y={y - rowHeight / 2}
                    width={plotWidth}
                    height={rowHeight}
                    fill="#f3f4f6"
                  />
                )}
                <text
                  x={margin.left - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="central"
                  fontSize={11}
                  fill={isHovered ? "#111827" : "#374151"}
                  fontWeight={isHovered ? 600 : 400}
                >
                  {genotype.length > 16
                    ? `${genotype.slice(0, 15)}…`
                    : genotype}
                </text>
                {seriesKeys.map((series, si) => {
                  const vals = bySeries.get(series)
                  if (!vals || vals.length < 2) return null
                  const sMin = Math.min(...vals)
                  const sMax = Math.max(...vals)
                  const seriesOffset =
                    seriesKeys.length > 1
                      ? (si - (seriesKeys.length - 1) / 2) * 4
                      : 0
                  return (
                    <line
                      key={series}
                      x1={xScale(sMin)}
                      y1={y + seriesOffset}
                      x2={xScale(sMax)}
                      y2={y + seriesOffset}
                      stroke={COLORS[si % COLORS.length]}
                      strokeWidth={1.5}
                      opacity={0.6}
                    />
                  )
                })}
                {genotypePoints.map((p, pi) => {
                  const si = seriesKeys.indexOf(p.series)
                  const seriesOffset =
                    seriesKeys.length > 1
                      ? (si - (seriesKeys.length - 1) / 2) * 4
                      : 0
                  return (
                    <circle
                      key={pi}
                      cx={xScale(p.value)}
                      cy={y + seriesOffset}
                      r={3.5}
                      fill={COLORS[si % COLORS.length]}
                      opacity={0.8}
                      stroke="white"
                      strokeWidth={0.5}
                    >
                      <title>{`${genotype}: ${p.value} (${p.series})`}</title>
                    </circle>
                  )
                })}
              </g>
            )
          })}

          <line
            x1={margin.left}
            y1={margin.top}
            x2={margin.left}
            y2={margin.top + plotHeight}
            stroke="#d1d5db"
          />
        </svg>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-muted-foreground">
            Genotypes {page * pageSize + 1}-
            {Math.min((page + 1) * pageSize, genotypes.length)} of{" "}
            {genotypes.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

function buildTrendChart(
  records: TraitRecordOutput[],
  axisKey: "season_name" | "site_name",
) {
  const genotypeByAxis = new Map<string, Map<string, number[]>>()
  const axisSet = new Set<string>()
  for (const r of records) {
    const info = r.record_info as Record<string, unknown> | undefined
    const genotype = info?.genotype ? String(info.genotype).trim() : null
    const axisVal = r[axisKey]
    if (!genotype || r.trait_value == null || !axisVal) continue
    axisSet.add(axisVal)
    if (!genotypeByAxis.has(genotype)) genotypeByAxis.set(genotype, new Map())
    const axisMap = genotypeByAxis.get(genotype)!
    if (!axisMap.has(axisVal)) axisMap.set(axisVal, [])
    axisMap.get(axisVal)!.push(r.trait_value)
  }
  const axisOrder = [...axisSet].sort()
  const genotypeKeys = [...genotypeByAxis.keys()].sort()
  const chartData = axisOrder.map((axis) => {
    const entry: Record<string, unknown> = { axis }
    for (const genotype of genotypeKeys) {
      const vs = genotypeByAxis.get(genotype)?.get(axis)
      if (vs && vs.length > 0)
        entry[genotype] = vs.reduce((a, b) => a + b, 0) / vs.length
    }
    return entry
  })
  return { chartData, axisOrder, genotypeKeys }
}

function TrendChart({
  records,
  valueLabel,
  axisKey,
  axisLabel,
}: {
  records: TraitRecordOutput[]
  valueLabel: string
  axisKey: "season_name" | "site_name"
  axisLabel: string
}) {
  const { chartData, axisOrder, genotypeKeys } = useMemo(
    () => buildTrendChart(records, axisKey),
    [records, axisKey],
  )
  const [hoveredGeno, setHoveredGeno] = useState<string | null>(null)

  if (genotypeKeys.length === 0 || axisOrder.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No genotype data with {axisLabel.toLowerCase()} information available.
      </p>
    )
  }

  const colors = generateColors(genotypeKeys.length)

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={450}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 20, bottom: 25, left: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="axis"
            tick={{ fontSize: 11 }}
            label={{
              value: axisLabel,
              position: "insideBottom",
              offset: -15,
            }}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            label={{
              value: valueLabel,
              angle: -90,
              position: "insideLeft",
              offset: 10,
            }}
          />
          <Tooltip
            isAnimationActive={false}
            content={({ active, label }) => {
              if (!active || !hoveredGeno || !label) return null
              const row = chartData.find((d) => d.axis === label)
              const val = row?.[hoveredGeno]
              if (val == null) return null
              return (
                <div className="rounded border bg-background px-2 py-1 text-xs shadow-sm">
                  <p className="font-medium">{hoveredGeno}</p>
                  <p className="text-muted-foreground">
                    {String(label)}: {(val as number).toFixed(2)}
                  </p>
                </div>
              )
            }}
          />
          {genotypeKeys.map((genotype, i) => (
            <Line
              key={genotype}
              type="monotone"
              dataKey={genotype}
              stroke={
                hoveredGeno && hoveredGeno !== genotype
                  ? `${colors[i]}30`
                  : colors[i]
              }
              strokeWidth={hoveredGeno === genotype ? 2.5 : 1.5}
              dot={{ r: 3, fill: colors[i], strokeWidth: 0 }}
              activeDot={{
                r: 5,
                onMouseEnter: () => setHoveredGeno(genotype),
                onMouseLeave: () => setHoveredGeno(null),
              }}
              connectNulls
              name={genotype}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="text-xs text-muted-foreground">
        {genotypeKeys.length} genotypes plotted across {axisOrder.length}{" "}
        {axisLabel.toLowerCase()}
        {axisOrder.length === 1 ? "" : "s"}.
      </div>
    </div>
  )
}

function SeasonTrend({
  records,
  valueLabel,
}: {
  records: TraitRecordOutput[]
  valueLabel: string
}) {
  return (
    <TrendChart
      records={records}
      valueLabel={valueLabel}
      axisKey="season_name"
      axisLabel="Season"
    />
  )
}

function SiteTrend({
  records,
  valueLabel,
}: {
  records: TraitRecordOutput[]
  valueLabel: string
}) {
  return (
    <TrendChart
      records={records}
      valueLabel={valueLabel}
      axisKey="site_name"
      axisLabel="Site"
    />
  )
}
