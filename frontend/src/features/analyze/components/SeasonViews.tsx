/**
 * A trait through the season: a chart of the plots' spread at each flight
 * date, and a table of every plot's reading per date (with its accession).
 */
import { Download } from "lucide-react"
import { useMemo, useState } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { TraitRecordOutput } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { chartActiveDot, chartTooltip } from "@/lib/chartTheme"
import { usePlotPolygons } from "../hooks/usePlotPolygons"
import { byDate, seasonCsv, seasonTable } from "../lib/seasonTraits"

const fmt = (v: number) =>
  Math.abs(v) >= 100
    ? v.toFixed(1)
    : Math.abs(v) >= 1
      ? v.toFixed(2)
      : v.toFixed(3)

export function SeasonDateTrend({
  records,
  valueLabel,
}: {
  records: TraitRecordOutput[]
  valueLabel: string
}) {
  // Outliers are left out unless asked for (a bad plot stretches the bands).
  const [keepOutliers, setKeepOutliers] = useState(false)
  const points = useMemo(
    () => byDate(records, { excludeOutliers: !keepOutliers }),
    [records, keepOutliers],
  )
  const leftOut = points.reduce((n, p) => n + p.outliers, 0)
  if (points.length === 0)
    return (
      <p className="text-muted-foreground py-4 text-sm">
        No dated readings for these filters.
      </p>
    )
  return (
    <div className="space-y-2" data-testid="season-date-trend">
      <ResponsiveContainer width="100%" height={420}>
        <ComposedChart
          data={points}
          margin={{ top: 5, right: 20, bottom: 25, left: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            label={{
              value: "Flight date",
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
            {...chartTooltip}
            formatter={(v, name) =>
              Array.isArray(v)
                ? [`${fmt(Number(v[0]))} – ${fmt(Number(v[1]))}`, String(name)]
                : [fmt(Number(v)), String(name)]
            }
          />
          <Legend verticalAlign="top" height={28} />
          <Area
            dataKey="range"
            name={
              keepOutliers
                ? "All plots (min – max)"
                : "Plots, outliers left out (min – max)"
            }
            stroke="none"
            fill="var(--primary)"
            fillOpacity={0.12}
            isAnimationActive={false}
          />
          <Area
            dataKey="iqr"
            name="Middle half of plots"
            stroke="none"
            fill="var(--primary)"
            fillOpacity={0.28}
            isAnimationActive={false}
          />
          <Line
            dataKey="mean"
            name="Mean"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--primary)", strokeWidth: 0 }}
            activeDot={chartActiveDot}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <label
          htmlFor="season-keep-outliers"
          className="flex items-center gap-1.5"
          title="Outliers: readings more than 1.5 × the interquartile range beyond the quartiles of their date (as a box plot marks them)"
        >
          <Checkbox
            id="season-keep-outliers"
            checked={keepOutliers}
            onCheckedChange={(v) => setKeepOutliers(v === true)}
            data-testid="season-keep-outliers"
          />
          Include outliers
        </label>
        <span data-testid="season-outliers">
          {keepOutliers
            ? "All readings shown"
            : leftOut
              ? `${leftOut} outlier reading${leftOut === 1 ? "" : "s"} left out`
              : "No outliers"}
        </span>
        <span
          className="cursor-help underline decoration-dotted underline-offset-2"
          title={points
            .map(
              (p) =>
                `${p.date}: ${p.n} plots${p.outliers ? ` (${p.outliers} left out)` : ""}`,
            )
            .join("\n")}
        >
          {points.length} flight date{points.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  )
}

export function SeasonTable({
  records,
  valueLabel,
  fileName,
}: {
  records: TraitRecordOutput[]
  valueLabel: string
  fileName: string
}) {
  // One experiment, year and site: its plots give each plot's accession
  // (trait extraction records carry the plot, not the accession).
  const scope = useMemo(() => {
    const one = (k: "experiment_id" | "season_id" | "site_id") => {
      const ids = new Set(records.map((r) => r[k]).filter((v) => v != null))
      return ids.size === 1 ? String([...ids][0]) : undefined
    }
    return {
      experimentId: one("experiment_id"),
      seasonId: one("season_id"),
      siteId: one("site_id"),
    }
  }, [records])
  const plots = usePlotPolygons(scope)
  const accessionOfPlot = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of plots.data?.features ?? []) {
      const id = f.properties?.plot_id
      const acc = f.properties?.accession_name
      if (id && acc) m.set(String(id), acc)
    }
    return m
  }, [plots.data])
  const table = useMemo(
    () => seasonTable(records, accessionOfPlot),
    [records, accessionOfPlot],
  )
  const [q, setQ] = useState("")
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s
      ? table.rows.filter(
          (r) =>
            r.plot.toLowerCase().includes(s) ||
            (r.accession ?? "").toLowerCase().includes(s),
        )
      : table.rows
  }, [table, q])
  if (table.rows.length === 0)
    return (
      <p className="text-muted-foreground py-4 text-sm">
        No plot readings for these filters.
      </p>
    )
  const download = () => {
    const blob = new Blob([seasonCsv(table)], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-2" data-testid="season-table">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-56 text-xs"
          placeholder="Find a plot or accession…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-muted-foreground text-xs">
          {rows.length} plots × {table.dates.length} dates · {valueLabel}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-8"
          onClick={download}
        >
          <Download className="mr-1.5 size-3.5" /> CSV
        </Button>
      </div>
      <div className="max-h-[60vh] overflow-auto rounded-md border">
        <table className="w-full min-w-max text-xs whitespace-nowrap tabular-nums">
          <thead className="bg-muted sticky top-0 z-10">
            <tr>
              <th className="bg-muted sticky left-0 px-2 py-1.5 text-left">
                Plot
              </th>
              <th className="px-2 py-1.5 text-left">Accession</th>
              {table.dates.map((d) => (
                <th key={d} className="px-2 py-1.5 text-right font-mono">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.plot} className="border-t">
                <td className="bg-background sticky left-0 px-2 py-1">
                  {r.plot}
                </td>
                <td className="text-muted-foreground px-2 py-1">
                  {r.accession ?? "—"}
                </td>
                {table.dates.map((d) => (
                  <td key={d} className="px-2 py-1 text-right">
                    {r.values[d] == null ? "" : fmt(r.values[d])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
