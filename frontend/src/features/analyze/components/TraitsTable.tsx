import { useMemo, useState } from "react"
import { ArrowUpDown, Download, Eye, EyeOff, Scan, X, Tag, FlaskConical, ChevronLeft, ChevronRight } from "lucide-react"
import { PlotImage, type Prediction } from "@/components/Common/PlotImage"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ReferenceDataPanel, useHasReferenceData } from "./ReferenceDataPanel"

interface TraitsTableProps {
  geojson: GeoJSON.FeatureCollection
  /** Pipeline run ID — used to fetch inference results */
  runId?: string
  /** Trait record ID — used for the plot-image endpoint */
  recordId?: string | null
  /** Reference data context — if provided, enables the REF toggle in the plot viewer */
  refContext?: {
    workspaceId: string
    experiment: string
    location: string
    population: string
  }
  isGroundPipeline?: boolean
}

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

function authHeaders() {
  const token = localStorage.getItem("access_token") || ""
  return { Authorization: `Bearer ${token}` }
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",")
  const lines = rows.map((r) =>
    columns.map((c) => {
      const v = r[c]
      return typeof v === "string" && v.includes(",") ? `"${v}"` : String(v ?? "")
    }).join(","),
  )
  return [header, ...lines].join("\n")
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function fmt(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "number") return isNaN(v) ? "" : v.toFixed(3)
  return String(v)
}

function formatHeader(col: string): string {
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── Main component ─────────────────────────────────────────────────────────────

export function TraitsTable({ geojson, runId, recordId, refContext, isGroundPipeline = false }: TraitsTableProps) {
  const [search, setSearch] = useState("")
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [viewPlotId, setViewPlotId] = useState<string | null>(null)
  const [viewRow, setViewRow] = useState<Record<string, unknown> | null>(null)
  const [showDetections, setShowDetections] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [showRefData, setShowRefData] = useState(false)
  const [activeClass, setActiveClass] = useState<string | null>(null)

  const refProps = refContext && viewPlotId && viewRow ? {
    workspaceId: refContext.workspaceId,
    experiment: refContext.experiment,
    location: refContext.location,
    population: refContext.population,
    plotId: viewPlotId,
    col: viewRow.col ? String(viewRow.col) : null,
    row: viewRow.row ? String(viewRow.row) : null,
  } : null

  const hasRefData = useHasReferenceData(refProps)

  // Fetch inference results (only if runId provided)
  const { data: inferenceData } = useQuery({
    queryKey: ["inference-results-analyze", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/inference-results`), { headers: authHeaders() })
      if (!res.ok) return null
      return res.json()
    },
    enabled: !!runId,
    staleTime: 60_000,
  })

  const inferenceAvailable: boolean = inferenceData?.available ?? false

  // Map plotId → predictions
  const predsByPlot = useMemo<Record<string, Prediction[]>>(() => {
    if (!inferenceData?.available) return {}
    const images: Array<{ name: string; plot?: string }> = inferenceData.images ?? []
    const predictions: Prediction[] = inferenceData.predictions ?? []
    const map: Record<string, Prediction[]> = {}
    for (const img of images) {
      if (!img.plot) continue
      const preds = predictions.filter((p) => p.image === img.name)
      if (preds.length > 0) map[img.plot] = preds
    }
    return map
  }, [inferenceData])

  const uniqueClasses = useMemo(() => {
    const all = Object.values(predsByPlot).flat().map((p) => p.class)
    return [...new Set(all)].sort()
  }, [predsByPlot])

  const rows: Record<string, unknown>[] = useMemo(
    () => geojson.features.map((f) => f.properties ?? {}),
    [geojson],
  )

  const columns: string[] = useMemo(() => {
    const keys = new Set<string>()
    rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)))
    const priority = ["plot_id", "plot", "accession"]
    const rest = [...keys].filter((k) => !priority.includes(k)).sort()
    return [...priority.filter((k) => keys.has(k)), ...rest]
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rows.filter((r) =>
      !q || Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)),
    )
  }, [rows, search])

  const sorted = useMemo(() => {
    if (!sortCol) return filtered
    return [...filtered].sort((a, b) => {
      const av = a[sortCol] ?? ""
      const bv = b[sortCol] ?? ""
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv))
      return sortAsc ? cmp : -cmp
    })
  }, [filtered, sortCol, sortAsc])

  function toggleSort(col: string) {
    if (sortCol === col) setSortAsc((p) => !p)
    else { setSortCol(col); setSortAsc(true) }
  }

  function handleDownload() {
    downloadCsv(toCsv(sorted, columns), "traits.csv")
  }

  // Get plot ID from a row
  function getPlotId(row: Record<string, unknown>): string {
    return String(row.plot_id ?? row.plot ?? "")
  }

  // Currently viewed row predictions
  const viewPredictions = viewPlotId ? (predsByPlot[viewPlotId] ?? []) : []
  const viewHasDetections = viewPlotId ? (viewPlotId in predsByPlot) : false

  const showActions = !!recordId || inferenceAvailable

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Download CSV
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {sorted.length} / {rows.length} rows
        </span>
      </div>

      <div className="rounded-md border overflow-auto max-h-[calc(100vh-340px)]">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
            <TableRow>
              {showActions && <TableHead className="w-16 text-xs">View</TableHead>}
              {columns.map((col) => (
                <TableHead
                  key={col}
                  className="whitespace-nowrap cursor-pointer select-none text-xs"
                  onClick={() => toggleSort(col)}
                >
                  <span className="flex items-center gap-1">
                    {formatHeader(col)}
                    <ArrowUpDown className="w-3 h-3 opacity-50" />
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row, i) => {
              const plotId = getPlotId(row)
              const isViewing = viewPlotId === plotId
              const hasDetections = plotId ? (plotId in predsByPlot) : false
              return (
                <TableRow key={i} className={isViewing ? "bg-muted/30" : undefined}>
                  {showActions && (
                    <TableCell className="py-1 px-2">
                      <div className="flex items-center gap-1">
                        {recordId && plotId && (
                          <button
                            type="button"
                            title={isViewing ? "Close viewer" : "View plot image"}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => {
                              setViewPlotId(isViewing ? null : plotId)
                              setViewRow(isViewing ? null : row)
                              setShowDetections(false)
                              setShowRefData(false)
                            }}
                          >
                            {isViewing ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {inferenceAvailable && hasDetections && recordId && (
                          <button
                            type="button"
                            title="View detections"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => {
                              setViewPlotId(plotId)
                              setViewRow(row)
                              setShowDetections(true)
                            }}
                          >
                            <Scan className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  )}
                  {columns.map((col) => (
                    <TableCell key={col} className="text-xs font-mono whitespace-nowrap py-1.5 px-3">
                      {fmt(row[col])}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Inline plot image viewer */}
      {viewPlotId && recordId && (
        <div className="rounded-lg border overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
            <span className="text-xs font-semibold">Plot {viewPlotId}</span>
            <div className="flex items-center gap-2">
              {viewHasDetections && (
                <>
                  <button
                    type="button"
                    title={showDetections ? "Hide detections" : "Show detections"}
                    className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${showDetections ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input hover:text-foreground"}`}
                    onClick={() => setShowDetections((v) => !v)}
                  >
                    <Scan className="w-3 h-3" />
                    {showDetections ? "Hide detections" : "Show detections"}
                  </button>
                  {showDetections && (
                    <button
                      type="button"
                      title={showLabels ? "Hide labels" : "Show labels"}
                      className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${showLabels ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input hover:text-foreground"}`}
                      onClick={() => setShowLabels((v) => !v)}
                    >
                      <Tag className={`w-3 h-3 ${showLabels ? "" : "opacity-40"}`} />
                      {showLabels ? "Hide labels" : "Show labels"}
                    </button>
                  )}
                  {showDetections && uniqueClasses.length > 1 && (
                    <div className="flex items-center gap-0.5 border rounded text-xs">
                      <button onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i <= 0 ? null : uniqueClasses[i - 1] })} className="px-1.5 py-0.5 hover:bg-muted"><ChevronLeft className="w-3 h-3" /></button>
                      <span className="px-1 min-w-[56px] text-center truncate">{activeClass ?? "All"}</span>
                      <button onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i >= uniqueClasses.length - 1 ? null : uniqueClasses[i + 1] })} className="px-1.5 py-0.5 hover:bg-muted"><ChevronRight className="w-3 h-3" /></button>
                    </div>
                  )}
                </>
              )}
              {refContext && (
                <button
                  type="button"
                  title={hasRefData ? (showRefData ? "Hide reference data" : "Show reference data") : "No reference data for this plot"}
                  disabled={!hasRefData}
                  className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${
                    !hasRefData
                      ? "opacity-40 cursor-not-allowed border-input text-muted-foreground"
                      : showRefData
                        ? "bg-orange-500 text-white border-orange-500"
                        : "text-orange-500 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950"
                  }`}
                  onClick={() => hasRefData && setShowRefData((v) => !v)}
                >
                  <FlaskConical className="w-3 h-3" />
                  REF
                </button>
              )}
              <button
                type="button"
                title="Close"
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { setViewPlotId(null); setViewRow(null); setShowDetections(false); setShowRefData(false) }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex" style={{ height: 360 }}>
            <div className={showRefData && refProps ? "flex-1 min-w-0 min-h-0" : "w-full min-h-0"}>
              <PlotImage
                key={viewPlotId}
                recordId={recordId}
                plotId={viewPlotId}
                rotate={isGroundPipeline}
                predictions={viewPredictions}
                showDetections={showDetections}
                showLabels={showLabels}
                activeClass={activeClass}
              />
            </div>
            {showRefData && refProps && (
              <div className="w-52 shrink-0 border-l px-3 py-3 overflow-y-auto">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Reference Data
                </p>
                <ReferenceDataPanel {...refProps} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
