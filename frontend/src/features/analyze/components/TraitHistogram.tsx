import { useMemo, useState } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { MetricSelector } from "./MetricSelector"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const BIN_COUNT = 10

interface TraitHistogramProps {
  geojson: GeoJSON.FeatureCollection
  metricColumns: string[]
  initialMetric: string | null
}

function buildHistogram(
  values: number[],
  bins: number,
): { label: string; count: number }[] {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const step = (max - min) / bins || 1
  const counts = Array(bins).fill(0)
  values.forEach((v) => {
    const idx = Math.min(Math.floor((v - min) / step), bins - 1)
    counts[idx]++
  })
  return counts.map((count, i) => ({
    label: (min + i * step).toFixed(2),
    count,
  }))
}

export function TraitHistogram({ geojson, metricColumns, initialMetric }: TraitHistogramProps) {
  const [selectedMetric, setSelectedMetric] = useState<string | null>(initialMetric)
  const [selectedAccession, setSelectedAccession] = useState<string>("__all__")

  const accessions: string[] = useMemo(() => {
    const set = new Set<string>()
    geojson.features.forEach((f) => {
      const a = f.properties?.accession
      if (a) set.add(String(a))
    })
    return [...set].sort()
  }, [geojson])

  const histData = useMemo(() => {
    if (!selectedMetric) return []
    const values = geojson.features
      .filter((f) => selectedAccession === "__all__" || String(f.properties?.accession ?? "") === selectedAccession)
      .map((f) => f.properties?.[selectedMetric] as number)
      .filter((v) => typeof v === "number" && !isNaN(v))
    return buildHistogram(values, BIN_COUNT)
  }, [geojson, selectedMetric, selectedAccession])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-52">
          <MetricSelector
            columns={metricColumns}
            value={selectedMetric}
            onChange={setSelectedMetric}
          />
        </div>
        {accessions.length > 0 && (
          <Select value={selectedAccession} onValueChange={setSelectedAccession}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder="All accessions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All accessions</SelectItem>
              {accessions.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!selectedMetric ? (
        <p className="text-sm text-muted-foreground">Select a metric above to view its distribution.</p>
      ) : histData.length === 0 ? (
        <p className="text-sm text-muted-foreground">No numeric data for this metric / accession.</p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={histData} margin={{ top: 4, right: 16, bottom: 24, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              label={{ value: selectedMetric.replace(/_/g, " "), position: "insideBottom", offset: -12, fontSize: 11 }}
            />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(v) => [v ?? 0, "Count"]}
              labelFormatter={(l) => `≥ ${l}`}
            />
            <Bar dataKey="count" fill="#2563eb" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
