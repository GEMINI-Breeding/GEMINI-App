/**
 * PlotViewerWidget — search plots within one or more TraitRecords and pin them
 * for side-by-side image comparison with trait values.
 *
 * Supports:
 * - Multi-source: merge plots from multiple records
 * - Collapsible plot-selection table
 * - Per-column value filters inline in the table header
 */

import { useState, useMemo } from "react"
import { useQueries } from "@tanstack/react-query"
import { Loader2, Pin, PinOff, Search, ImageOff, X, ChevronDown, ChevronUp, ListFilter, ScanSearch, ChevronLeft, ChevronRight, Tag } from "lucide-react"
import { PlotImage, type Prediction, authHeaders } from "@/components/Common/PlotImage"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  useTraitRecordGeojson, useMultiTraitGeojson, useImagePlotIds, applyFilters, formatDashboardValue,
} from "../hooks/useTraitData"
import { useTraitRecords } from "../hooks/useTraitData"
import type { PlotViewerConfig } from "../types"

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

// ── Column filter dropdown ────────────────────────────────────────────────────

function ColFilterDropdown({
  col, uniqueValues, selected, onChange,
}: {
  col: string
  uniqueValues: string[]
  selected: string[]
  onChange: (vals: string[]) => void
}) {
  const isActive = selected.length > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`ml-0.5 inline-flex items-center rounded p-0.5 transition-colors hover:bg-muted ${isActive ? "text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
          title={`Filter ${col.replace(/_/g, " ")}`}
        >
          <ListFilter className="w-3 h-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">{col.replace(/_/g, " ")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isActive && (
          <>
            <DropdownMenuItem className="text-xs" onClick={() => onChange([])}>Clear filter</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {uniqueValues.map((v) => (
          <DropdownMenuCheckboxItem
            key={v}
            className="text-xs"
            checked={selected.includes(v)}
            onCheckedChange={() =>
              onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
            }
            onSelect={(e) => e.preventDefault()}
          >
            {v}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Main widget ───────────────────────────────────────────────────────────────

interface PlotEntry {
  recordId: string
  plotId: string
  accession: string
  properties: Record<string, unknown>
  hasImage: boolean
  source?: string
}

interface PlotViewerWidgetProps {
  config: PlotViewerConfig
  onUpdateConfig?: (patch: Partial<PlotViewerConfig>) => void
}

export function PlotViewerWidget({ config, onUpdateConfig }: PlotViewerWidgetProps) {
  const { pinnedPlotIds, filters } = config
  const [search, setSearch] = useState("")
  const [tableCollapsed, setTableCollapsed] = useState(false)
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({})
  const [showDetections, setShowDetections] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [activeClass, setActiveClass] = useState<string | null>(null)

  const { data: allRecords } = useTraitRecords()

  // Resolve active record IDs
  const activeIds = useMemo((): string[] => {
    if ((config.traitRecordIds?.length ?? 0) > 0) return config.traitRecordIds
    if (config.traitRecordId) return [config.traitRecordId]
    return []
  }, [config.traitRecordIds, config.traitRecordId])

  // Batch-fetch inference results for all active records (for detection overlay)
  const activeRunIds = useMemo(() => {
    if (!allRecords) return [] as string[]
    const ids = new Set<string>()
    activeIds.forEach((rid) => {
      const rec = allRecords.find((r) => r.id === rid)
      if (rec?.run_id) ids.add(rec.run_id)
    })
    return [...ids]
  }, [allRecords, activeIds])

  const inferenceResults = useQueries({
    queries: activeRunIds.map((runId) => ({
      queryKey: ["inference-results", runId],
      queryFn: () =>
        fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/inference-results`), { headers: authHeaders() })
          .then((r) => r.ok ? r.json() : null),
      staleTime: 60_000,
    })),
  })

  const predsByPlot = useMemo<Record<string, Prediction[]>>(() => {
    const map: Record<string, Prediction[]> = {}
    inferenceResults.forEach((res) => {
      const data = res.data
      if (!data?.available) return
      const images: Array<{ name: string; plot?: string }> = data.images ?? []
      const predictions: Prediction[] = data.predictions ?? []
      for (const img of images) {
        if (!img.plot) continue
        const preds = predictions.filter((p) => p.image === img.name)
        if (preds.length > 0) map[img.plot] = preds
      }
    })
    return map
  }, [inferenceResults])

  const inferenceAvailable = Object.keys(predsByPlot).length > 0

  const uniqueClasses = useMemo(() => {
    const all = Object.values(predsByPlot).flat().map((p) => p.class)
    return [...new Set(all)].sort()
  }, [predsByPlot])

  const isMultiSource = activeIds.length > 1

  // Single-source
  const singleGeo = useTraitRecordGeojson(activeIds.length === 1 ? activeIds[0] : null)
  const singleImages = useImagePlotIds(activeIds.length === 1 ? activeIds[0] : null)

  // Multi-source
  const multiGeo = useMultiTraitGeojson(activeIds.length > 1 ? activeIds : [])

  const isLoading = activeIds.length === 1 ? singleGeo.isLoading : multiGeo.loading

  // Merge all plots
  const { allPlots, metricCols } = useMemo((): { allPlots: PlotEntry[]; metricCols: string[] } => {
    if (activeIds.length === 0) return { allPlots: [], metricCols: [] }

    if (activeIds.length === 1) {
      const geoData = singleGeo.data
      if (!geoData) return { allPlots: [], metricCols: [] }
      const imagePlotIds = singleImages.data ?? []
      const plots = applyFilters(geoData.geojson.features, filters).map((f) => {
        const p = f.properties ?? {}
        const plotId = String(p.plot_id ?? p.plot ?? p.plot_number ?? p.PlotID ?? "")
        return {
          recordId: activeIds[0],
          plotId,
          accession: String(p.accession ?? p.Accession ?? p.genotype ?? ""),
          properties: p,
          hasImage: imagePlotIds.includes(plotId),
        }
      })
      return { allPlots: plots, metricCols: geoData.metric_columns.slice(0, 4) }
    }

    // Multi-source
    const plots: PlotEntry[] = []
    const metricSet = new Set<string>()
    multiGeo.data.forEach((geoData, i) => {
      if (!geoData) return
      const recordId = activeIds[i]
      const record = allRecords?.find((r) => r.id === recordId)
      const label = record ? `${record.pipeline_name} · ${record.date}` : recordId
      applyFilters(geoData.geojson.features, filters).forEach((f) => {
        const p = f.properties ?? {}
        const plotId = String(p.plot_id ?? p.plot ?? p.plot_number ?? p.PlotID ?? "")
        plots.push({
          recordId,
          plotId,
          accession: String(p.accession ?? p.Accession ?? p.genotype ?? ""),
          properties: { ...p, _source: label },
          hasImage: false,
          source: label,
        })
      })
      geoData.metric_columns.slice(0, 4).forEach((m) => metricSet.add(m))
    })
    return { allPlots: plots, metricCols: [...metricSet].slice(0, 4) }
  }, [activeIds, singleGeo.data, singleImages.data, multiGeo.data, filters, allRecords])

  // Columns shown in the selection table
  const tableCols: string[] = useMemo(() => {
    const base = ["plotId", "accession"]
    if (isMultiSource) base.push("_source")
    return [...base, ...metricCols]
  }, [isMultiSource, metricCols])

  // Unique values per column for col filters
  const uniqueByCol = useMemo(() => {
    const out: Record<string, string[]> = {}
    const checkCols = ["accession", "_source", ...metricCols]
    checkCols.forEach((col) => {
      const vals = [...new Set(allPlots.map((p) => {
        if (col === "accession") return p.accession
        return String(p.properties[col] ?? "")
      }).filter(Boolean))].sort()
      if (vals.length > 0 && vals.length <= 200) out[col] = vals
    })
    return out
  }, [allPlots, metricCols])

  // Search + column filter
  const filtered = useMemo(() => {
    let result = allPlots
    const q = search.toLowerCase().trim()
    if (q) {
      result = result.filter(
        (p) => p.plotId.toLowerCase().includes(q) || p.accession.toLowerCase().includes(q)
      )
    }
    const activeCF = Object.entries(colFilters).filter(([, vals]) => vals.length > 0)
    if (activeCF.length > 0) {
      result = result.filter((p) =>
        activeCF.every(([col, vals]) => {
          const v = col === "accession" ? p.accession : String(p.properties[col] ?? "")
          return vals.includes(v)
        })
      )
    }
    return result
  }, [allPlots, search, colFilters])

  const pinnedPlots = allPlots.filter((p) => pinnedPlotIds.includes(`${p.recordId}:${p.plotId}`))

  function pinKey(p: PlotEntry) { return `${p.recordId}:${p.plotId}` }

  function togglePin(p: PlotEntry) {
    if (!onUpdateConfig) return
    const key = pinKey(p)
    const next = pinnedPlotIds.includes(key)
      ? pinnedPlotIds.filter((id) => id !== key)
      : [...pinnedPlotIds, key]
    onUpdateConfig({ pinnedPlotIds: next })
  }

  function clearPinned() { onUpdateConfig?.({ pinnedPlotIds: [] }) }

  const activeColFilterCount = Object.values(colFilters).filter((v) => v.length > 0).length

  if (activeIds.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Configure this widget to select a data source.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Selection table header */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by plot ID or accession…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
        </div>
        {activeColFilterCount > 0 && (
          <button className="text-xs text-primary hover:underline whitespace-nowrap" onClick={() => setColFilters({})}>
            Clear {activeColFilterCount} filter{activeColFilterCount > 1 ? "s" : ""}
          </button>
        )}
        <button
          className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setTableCollapsed((v) => !v)}
          title={tableCollapsed ? "Show plot list" : "Hide plot list"}
        >
          {tableCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          <span>{tableCollapsed ? "Show" : "Hide"}</span>
        </button>
      </div>

      {/* Plot selection table (collapsible) */}
      {!tableCollapsed && (
        <div className="overflow-auto border rounded-md max-h-48 flex-shrink-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-8" />
                {tableCols.map((col) => (
                  <TableHead key={col} className="text-xs whitespace-nowrap">
                    <span className="flex items-center gap-0.5">
                      {col === "_source" ? "Source" : col === "plotId" ? "Plot ID" : col.replace(/_/g, " ")}
                      {uniqueByCol[col] && (
                        <ColFilterDropdown
                          col={col}
                          uniqueValues={uniqueByCol[col]}
                          selected={colFilters[col] ?? []}
                          onChange={(vals) => setColFilters((prev) => ({ ...prev, [col]: vals }))}
                        />
                      )}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 50).map((p) => {
                const key = pinKey(p)
                const isPinned = pinnedPlotIds.includes(key)
                return (
                  <TableRow key={key} className={isPinned ? "bg-primary/5" : ""}>
                    <TableCell className="py-1">
                      <button
                        onClick={() => togglePin(p)}
                        className={`p-0.5 rounded transition-colors ${isPinned ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                        title={isPinned ? "Unpin" : "Pin plot"}
                      >
                        {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="text-xs py-1 font-mono">{p.plotId}</TableCell>
                    <TableCell className="text-xs py-1">{p.accession || "—"}</TableCell>
                    {isMultiSource && (
                      <TableCell className="text-xs py-1 text-muted-foreground">{p.source || "—"}</TableCell>
                    )}
                    {metricCols.map((m) => (
                      <TableCell key={m} className="text-xs py-1">
                        {typeof p.properties[m] === "number"
                          ? formatDashboardValue(p.properties[m], m)
                          : "—"}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pinned comparison */}
      {pinnedPlots.length > 0 && (
        <div className="flex-1 overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">
              Pinned Plots{" "}
              <Badge variant="secondary" className="text-[10px]">{pinnedPlots.length}</Badge>
            </span>
            <div className="flex items-center gap-1">
              {inferenceAvailable && (
                <>
                  <button
                    onClick={() => setShowDetections((v) => !v)}
                    title={showDetections ? "Hide detections" : "Show detections"}
                    className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${showDetections ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input hover:text-foreground"}`}
                  >
                    <ScanSearch className="w-3 h-3" />
                    {showDetections ? "Hide" : "Detections"}
                  </button>
                  {showDetections && (
                    <button
                      onClick={() => setShowLabels((v) => !v)}
                      className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${showLabels ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input hover:text-foreground"}`}
                    >
                      <Tag className="w-3 h-3" />
                      Labels
                    </button>
                  )}
                  {showDetections && uniqueClasses.length > 1 && (
                    <div className="flex items-center gap-0.5 border rounded text-xs">
                      <button
                        onClick={() => setActiveClass((c) => {
                          const i = uniqueClasses.indexOf(c ?? "")
                          return i <= 0 ? null : uniqueClasses[i - 1]
                        })}
                        className="px-1 py-0.5 hover:bg-muted transition-colors"
                      ><ChevronLeft className="w-3 h-3" /></button>
                      <span className="px-1 min-w-[56px] text-center truncate">
                        {activeClass ?? "All"}
                      </span>
                      <button
                        onClick={() => setActiveClass((c) => {
                          const i = uniqueClasses.indexOf(c ?? "")
                          return i >= uniqueClasses.length - 1 ? null : uniqueClasses[i + 1]
                        })}
                        className="px-1 py-0.5 hover:bg-muted transition-colors"
                      ><ChevronRight className="w-3 h-3" /></button>
                    </div>
                  )}
                </>
              )}
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearPinned}>
                <X className="w-3 h-3 mr-1" /> Clear
              </Button>
            </div>
          </div>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${Math.min(pinnedPlots.length, 3)}, minmax(0, 1fr))` }}
          >
            {pinnedPlots.map((p) => {
              const key = pinKey(p)
              return (
                <div key={key} className="border rounded-lg p-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-medium truncate">{p.plotId}</span>
                    <button onClick={() => togglePin(p)} className="text-muted-foreground hover:text-destructive">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {isMultiSource && p.source && (
                    <p className="text-[10px] text-muted-foreground truncate">{p.source}</p>
                  )}
                  {p.hasImage ? (
                    <div className="w-full" style={{ height: 220 }}>
                      <PlotImage
                        recordId={p.recordId}
                        plotId={p.plotId}
                        rotate={allRecords?.find((r) => r.id === p.recordId)?.pipeline_type === "ground"}
                        predictions={predsByPlot[p.plotId] ?? []}
                        showDetections={showDetections}
                        showLabels={showLabels}
                        activeClass={activeClass}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center bg-muted rounded w-full" style={{ height: 220 }}>
                      <ImageOff className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  {metricCols.length > 0 && (
                    <div className="space-y-0.5">
                      {metricCols.map((m) => (
                        <div key={m} className="flex justify-between text-[10px]">
                          <span className="text-muted-foreground">{m.replace(/_/g, " ")}</span>
                          <span className="font-medium">
                            {typeof p.properties[m] === "number"
                              ? (p.properties[m] as number).toFixed(3)
                              : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
