import { useMemo, useState, useEffect, useRef } from "react"
import { ArrowUpDown, Download, Eye, EyeOff, Scan, X, Loader2 } from "lucide-react"
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

interface TraitsTableProps {
  geojson: GeoJSON.FeatureCollection
  /** Pipeline run ID — used to fetch inference results */
  runId?: string
  /** Trait record ID — used for the plot-image endpoint */
  recordId?: string | null
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

// ── Inline plot image viewer with detection overlay ───────────────────────────

const CLASS_COLOURS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
]

function classColour(cls: string): string {
  let hash = 0
  for (let i = 0; i < cls.length; i++) hash = (hash * 31 + cls.charCodeAt(i)) | 0
  return CLASS_COLOURS[Math.abs(hash) % CLASS_COLOURS.length]
}

interface Prediction {
  image: string
  class: string
  confidence: number
  x: number; y: number; width: number; height: number
  points?: Array<{ x: number; y: number }>
}

interface PlotViewerProps {
  recordId: string
  plotId: string
  predictions: Prediction[]
  showDetections: boolean
}

function PlotViewer({ recordId, plotId, predictions, showDetections }: PlotViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    setBlobUrl(null); setError(false); setDims(null)
    let revoked = false; let objectUrl: string | null = null
    fetch(apiUrl(`/api/v1/analyze/trait-records/${recordId}/plot-image/${plotId}`), { headers: authHeaders() })
      .then((r) => { if (!r.ok) throw new Error(); return r.blob() })
      .then((blob) => { if (!revoked) { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl) } })
      .catch(() => setError(true))
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [recordId, plotId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    if (!dims || !showDetections || predictions.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width; canvas.height = rect.height
    ctx.clearRect(0, 0, rect.width, rect.height)
    const sx = rect.width / dims.w, sy = rect.height / dims.h
    for (const p of predictions) {
      const color = classColour(p.class)
      const x = (p.x - p.width / 2) * sx, y = (p.y - p.height / 2) * sy
      const w = p.width * sx, h = p.height * sy
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h)
      const label = `${p.class} ${(p.confidence * 100).toFixed(0)}%`
      ctx.font = "11px monospace"
      const tw = ctx.measureText(label).width
      ctx.fillStyle = color; ctx.fillRect(x, y - 16, tw + 6, 16)
      ctx.fillStyle = "#fff"; ctx.fillText(label, x + 3, y - 3)
    }
  }, [dims, predictions, showDetections])

  if (error) return <div className="flex items-center justify-center h-full text-xs text-muted-foreground">Image not available</div>
  if (!blobUrl) return <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>

  return (
    <div className="relative w-full h-full">
      <img
        ref={imgRef}
        src={blobUrl}
        alt={`Plot ${plotId}`}
        className="w-full h-full object-contain"
        onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }} />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function TraitsTable({ geojson, runId, recordId }: TraitsTableProps) {
  const [search, setSearch] = useState("")
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [viewPlotId, setViewPlotId] = useState<string | null>(null)
  const [showDetections, setShowDetections] = useState(false)

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

      <div className="rounded-md border overflow-auto max-h-[480px]">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
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
                              setShowDetections(false)
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
                <button
                  type="button"
                  title={showDetections ? "Hide detections" : "Show detections"}
                  className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${showDetections ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input hover:text-foreground"}`}
                  onClick={() => setShowDetections((v) => !v)}
                >
                  <Scan className="w-3 h-3" />
                  {showDetections ? "Hide detections" : "Show detections"}
                </button>
              )}
              <button
                type="button"
                title="Close"
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { setViewPlotId(null); setShowDetections(false) }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div style={{ height: 360 }}>
            <PlotViewer
              key={viewPlotId}
              recordId={recordId}
              plotId={viewPlotId}
              predictions={viewPredictions}
              showDetections={showDetections}
            />
          </div>
        </div>
      )}
    </div>
  )
}
