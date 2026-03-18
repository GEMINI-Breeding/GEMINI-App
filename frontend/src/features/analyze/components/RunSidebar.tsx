import { useState } from "react"
import { ChevronLeft, ChevronRight, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MetricSelector } from "./MetricSelector"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface RunInfo {
  pipeline_name: string
  pipeline_type: string
  date: string
  experiment: string
  location: string
  population: string
  platform: string
  sensor: string
}

interface RunSidebarProps {
  run: RunInfo
  metricColumns: string[]
  selectedMetric: string | null
  onMetricChange: (col: string) => void
  accessions: string[]
  selectedAccession: string
  onAccessionChange: (a: string) => void
  onDownloadAll: () => void
  onDownloadFiltered: () => void
  hasFilter: boolean
}

export function RunSidebar({
  run,
  metricColumns,
  selectedMetric,
  onMetricChange,
  accessions,
  selectedAccession,
  onAccessionChange,
  onDownloadAll,
  onDownloadFiltered,
  hasFilter,
}: RunSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div
      className={`relative flex flex-col bg-background border-l transition-all duration-200 ${collapsed ? "w-10" : "w-64"} h-full`}
    >
      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((p) => !p)}
        className="absolute -left-3 top-4 z-10 rounded-full border bg-background shadow p-0.5 hover:bg-muted"
      >
        {collapsed ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {!collapsed && (
        <div className="p-4 space-y-5 overflow-y-auto flex-1">
          {/* Run info */}
          <div className="space-y-1">
            <p className="font-semibold text-sm">{run.pipeline_name}</p>
            <div className="flex gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-xs capitalize">{run.pipeline_type}</Badge>
              <Badge variant="secondary" className="text-xs">{run.date}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {[run.experiment, run.location, run.population].filter(Boolean).join(" / ")}
            </p>
            <p className="text-xs text-muted-foreground">
              {[run.platform, run.sensor].filter(Boolean).join(" / ")}
            </p>
          </div>

          {/* Metric selector */}
          {metricColumns.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Color by</p>
              <MetricSelector
                columns={metricColumns}
                value={selectedMetric}
                onChange={onMetricChange}
              />
            </div>
          )}

          {/* Accession filter */}
          {accessions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Filter by accession</p>
              <Select value={selectedAccession} onValueChange={onAccessionChange}>
                <SelectTrigger className="w-full h-8 text-xs">
                  <SelectValue placeholder="All accessions" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="__all__">All accessions</SelectItem>
                  {accessions.map((a) => (
                    <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Download */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Export</p>
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={onDownloadAll}>
              <Download className="w-3 h-3 mr-1.5" />
              Download All CSV
            </Button>
            {hasFilter && (
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={onDownloadFiltered}>
                <Download className="w-3 h-3 mr-1.5" />
                Download Filtered CSV
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
