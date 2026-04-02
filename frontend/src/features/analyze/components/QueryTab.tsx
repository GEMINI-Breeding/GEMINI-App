/**
 * QueryTab — plot browser with pin-to-compare and detection overlay support.
 *
 * Layout:
 *  - Top: search input + plot list table (plot_id, accession, metrics)
 *    Each row has: Eye (view image), Pin (add to comparison), Detections icon (if any)
 *  - Bottom: "Pinned Plots" / Comparison section with expand-to-fullscreen button
 *
 * Uses the EXPAND UTILITY from "@/components/Common/ExpandableSection".
 */

import { useState, useEffect, useRef, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Eye, EyeOff, Pin, PinOff, Download, Scan, X, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useExpandable, ExpandButton, FullscreenModal } from "@/components/Common/ExpandableSection"
import { analyzeApi } from "../api"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Prediction {
  image: string
  class: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
  points?: Array<{ x: number; y: number }>
}

interface InferenceImage {
  name: string
  path: string
  plot?: string
}

interface PlotRow {
  plotId: string
  accession: string
  properties: Record<string, unknown>
}

interface QueryTabProps {
  geojson: GeoJSON.FeatureCollection
  metricColumns: string[]
  runId: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

function authHeaders() {
  const token = localStorage.getItem("access_token") || ""
  return { Authorization: `Bearer ${token}` }
}

const CLASS_COLOURS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
]

function classColour(cls: string): string {
  let hash = 0
  for (let i = 0; i < cls.length; i++) hash = (hash * 31 + cls.charCodeAt(i)) | 0
  return CLASS_COLOURS[Math.abs(hash) % CLASS_COLOURS.length]
}

function fmt(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "number") return isNaN(v) ? "" : v.toFixed(3)
  return String(v)
}

// ── Plot image viewer with optional detection overlay ─────────────────────────

interface PlotImageViewerProps {
  recordId: string
  plotId: string
  predictions: Prediction[]
  showDetections: boolean
}

function PlotImageViewer({ recordId, plotId, predictions, showDetections }: PlotImageViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    setBlobUrl(null)
    setError(false)
    setDims(null)
    let revoked = false
    let objectUrl: string | null = null
    fetch(apiUrl(`/api/v1/analyze/trait-records/${recordId}/plot-image/${plotId}`), {
      headers: authHeaders(),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (!revoked) {
          objectUrl = URL.createObjectURL(blob)
          setBlobUrl(objectUrl)
        }
      })
      .catch(() => setError(true))
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [recordId, plotId])

  // Draw detection overlay on canvas after image loads
  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !dims || !showDetections) {
      if (canvas) {
        const ctx = canvas.getContext("2d")
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const { width: cw, height: ch } = canvas.getBoundingClientRect()
    canvas.width = cw
    canvas.height = ch

    const scaleX = cw / dims.w
    const scaleY = ch / dims.h

    ctx.clearRect(0, 0, cw, ch)

    for (const pred of predictions) {
      const color = classColour(pred.class)
      const x = (pred.x - pred.width / 2) * scaleX
      const y = (pred.y - pred.height / 2) * scaleY
      const w = pred.width * scaleX
      const h = pred.height * scaleY

      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, w, h)

      const label = `${pred.class} ${(pred.confidence * 100).toFixed(0)}%`
      ctx.font = "11px monospace"
      const tw = ctx.measureText(label).width
      ctx.fillStyle = color
      ctx.fillRect(x, y - 16, tw + 6, 16)
      ctx.fillStyle = "#fff"
      ctx.fillText(label, x + 3, y - 3)
    }
  }, [dims, predictions, showDetections])

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Image not available
      </div>
    )
  }

  if (!blobUrl) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      <img
        ref={imgRef}
        src={blobUrl}
        alt={`Plot ${plotId}`}
        className="w-full h-full object-contain"
        onLoad={(e) => {
          const el = e.currentTarget
          setDims({ w: el.naturalWidth, h: el.naturalHeight })
        }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: "none" }}
      />
    </div>
  )
}

// ── Pinned plot card ───────────────────────────────────────────────────────────

interface PinnedCardProps {
  row: PlotRow
  recordId: string
  predictions: Prediction[]
  hasDetections: boolean
  onUnpin: () => void
  onDownload: () => void
}

function PinnedCard({ row, recordId, predictions, hasDetections, onUnpin, onDownload }: PinnedCardProps) {
  const [showDetections, setShowDetections] = useState(false)

  return (
    <div className="rounded-lg border overflow-hidden flex flex-col">
      {/* Card header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="min-w-0">
          <p className="text-xs font-semibold truncate">Plot {row.plotId}</p>
          {row.accession && (
            <p className="text-xs text-muted-foreground truncate">{row.accession}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {hasDetections && (
            <button
              type="button"
              title={showDetections ? "Hide detections" : "Show detections"}
              className={`text-muted-foreground hover:text-foreground transition-colors ${showDetections ? "text-primary" : ""}`}
              onClick={() => setShowDetections((v) => !v)}
            >
              <Scan className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            title="Download image"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onDownload}
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Unpin"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onUnpin}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {/* Image */}
      <div className="h-48 bg-muted/10">
        <PlotImageViewer
          recordId={recordId}
          plotId={row.plotId}
          predictions={showDetections ? predictions : []}
          showDetections={showDetections}
        />
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function QueryTab({ geojson, metricColumns, runId }: QueryTabProps) {
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [viewPlotId, setViewPlotId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const comparisonExp = useExpandable()
  const [viewShowDetections, setViewShowDetections] = useState(false)

  // Fetch trait records for this run → get recordId for plot image API
  const { data: traitRecords } = useQuery({
    queryKey: ["trait-records-by-run", runId],
    queryFn: () => analyzeApi.listTraitRecordsByRun(runId),
    staleTime: 60_000,
  })
  const recordId = traitRecords?.[0]?.id ?? null

  // Fetch inference results to know which plots have detections
  const { data: inferenceData } = useQuery({
    queryKey: ["inference-results-analyze", runId],
    queryFn: async () => {
      const token = localStorage.getItem("access_token") || ""
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/inference-results`), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return null
      return res.json()
    },
    staleTime: 60_000,
  })

  const inferenceAvailable: boolean = inferenceData?.available ?? false

  // Map: plotId → predictions for that plot
  const predsByPlot: Record<string, Prediction[]> = useMemo(() => {
    if (!inferenceData?.available) return {}
    const images: InferenceImage[] = inferenceData.images ?? []
    const predictions: Prediction[] = inferenceData.predictions ?? []
    const map: Record<string, Prediction[]> = {}
    for (const img of images) {
      if (!img.plot) continue
      const preds = predictions.filter((p) => p.image === img.name)
      if (preds.length > 0) {
        map[img.plot] = preds
      }
    }
    return map
  }, [inferenceData])

  // Build plot rows from geojson
  const allRows: PlotRow[] = useMemo(() =>
    geojson.features
      .map((f) => ({
        plotId: String(f.properties?.plot_id ?? f.properties?.plot ?? ""),
        accession: String(f.properties?.accession ?? ""),
        properties: f.properties ?? {},
      }))
      .filter((r) => r.plotId),
    [geojson],
  )

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return allRows
    return allRows.filter((r) =>
      r.plotId.toLowerCase().includes(q) ||
      r.accession.toLowerCase().includes(q),
    )
  }, [allRows, search])

  const pinnedRows = useMemo(
    () => allRows.filter((r) => pinnedIds.has(r.plotId)),
    [allRows, pinnedIds],
  )

  const viewRow = allRows.find((r) => r.plotId === viewPlotId) ?? null
  const viewPredictions = viewPlotId ? (predsByPlot[viewPlotId] ?? []) : []
  const viewHasDetections = viewPlotId ? (viewPlotId in predsByPlot) : false

  function togglePin(plotId: string) {
    setPinnedIds((prev) => {
      const next = new Set(prev)
      if (next.has(plotId)) next.delete(plotId)
      else next.add(plotId)
      return next
    })
  }

  function handleDownload(plotId: string) {
    if (!recordId) return
    const token = localStorage.getItem("access_token") || ""
    fetch(apiUrl(`/api/v1/analyze/trait-records/${recordId}/plot-image/${plotId}`), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `plot_${plotId}.png`
        a.click()
        URL.revokeObjectURL(url)
      })
  }

  // Visible metric columns (up to 4 to keep table readable)
  const shownMetrics = metricColumns.slice(0, 4)

  // ── Comparison content (rendered both inline and in fullscreen) ────────────

  const comparisonContent = (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {pinnedRows.map((row) => (
        <PinnedCard
          key={row.plotId}
          row={row}
          recordId={recordId ?? ""}
          predictions={predsByPlot[row.plotId] ?? []}
          hasDetections={row.plotId in predsByPlot}
          onUnpin={() => togglePin(row.plotId)}
          onDownload={() => handleDownload(row.plotId)}
        />
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-6 p-4">

      {/* ── Plot browser ── */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-sm font-semibold">Plots</h2>
          <Input
            placeholder="Search by plot ID or accession…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs h-8 text-sm"
          />
          <span className="text-xs text-muted-foreground ml-auto">
            {filteredRows.length} / {allRows.length} plots
          </span>
        </div>

        <div className="rounded-md border overflow-auto max-h-72">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-20 text-xs">Actions</TableHead>
                <TableHead className="text-xs whitespace-nowrap">Plot ID</TableHead>
                <TableHead className="text-xs whitespace-nowrap">Accession</TableHead>
                {shownMetrics.map((col) => (
                  <TableHead key={col} className="text-xs whitespace-nowrap">
                    {col.replace(/_/g, " ")}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => {
                const isPinned = pinnedIds.has(row.plotId)
                const hasDetections = row.plotId in predsByPlot
                const isViewing = viewPlotId === row.plotId
                return (
                  <TableRow key={row.plotId} className={isViewing ? "bg-muted/30" : undefined}>
                    <TableCell className="py-1 px-2">
                      <div className="flex items-center gap-1">
                        {/* View image */}
                        <button
                          type="button"
                          title={isViewing ? "Close viewer" : "View plot image"}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => {
                            setViewPlotId(isViewing ? null : row.plotId)
                            setViewShowDetections(false)
                          }}
                        >
                          {isViewing ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        {/* Pin */}
                        <button
                          type="button"
                          title={isPinned ? "Unpin from comparison" : "Pin for comparison"}
                          className={`transition-colors ${isPinned ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                          onClick={() => togglePin(row.plotId)}
                        >
                          {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                        </button>
                        {/* Detections */}
                        {inferenceAvailable && hasDetections && (
                          <button
                            type="button"
                            title="View detections"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => {
                              setViewPlotId(row.plotId)
                              setViewShowDetections(true)
                            }}
                          >
                            <Scan className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {/* Download */}
                        {recordId && (
                          <button
                            type="button"
                            title="Download image"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => handleDownload(row.plotId)}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-1 px-3 text-xs font-mono">{row.plotId}</TableCell>
                    <TableCell className="py-1 px-3 text-xs">{row.accession}</TableCell>
                    {shownMetrics.map((col) => (
                      <TableCell key={col} className="py-1 px-3 text-xs font-mono whitespace-nowrap">
                        {fmt(row.properties[col])}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ── Plot image viewer (shown when eye icon clicked) ── */}
      {viewPlotId && recordId && viewRow && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-sm font-semibold">Plot {viewPlotId}</h2>
            {viewRow.accession && (
              <span className="text-xs text-muted-foreground">{viewRow.accession}</span>
            )}
            {viewHasDetections && (
              <button
                type="button"
                title={viewShowDetections ? "Hide detections" : "Show detections"}
                className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${viewShowDetections ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input hover:text-foreground"}`}
                onClick={() => setViewShowDetections((v) => !v)}
              >
                <Scan className="w-3 h-3" />
                {viewShowDetections ? "Hide detections" : "Show detections"}
              </button>
            )}
            <button
              type="button"
              title="Download"
              className="text-muted-foreground hover:text-foreground transition-colors ml-1"
              onClick={() => handleDownload(viewPlotId)}
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Close viewer"
              className="text-muted-foreground hover:text-foreground transition-colors ml-auto"
              onClick={() => setViewPlotId(null)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="rounded-lg border overflow-hidden" style={{ height: 420 }}>
            <PlotImageViewer
              key={viewPlotId}
              recordId={recordId}
              plotId={viewPlotId}
              predictions={viewShowDetections ? viewPredictions : []}
              showDetections={viewShowDetections}
            />
          </div>
        </section>
      )}

      {/* ── Pinned Plots / Comparison section ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold">Pinned Plots</h2>
          {pinnedIds.size > 0 && (
            <span className="text-xs text-muted-foreground">{pinnedIds.size} pinned</span>
          )}
          {pinnedIds.size > 0 && (
            <ExpandButton
              onClick={comparisonExp.open}
              title="Expand comparison to fullscreen"
              className="ml-auto"
            />
          )}
        </div>

        {pinnedIds.size === 0 ? (
          <p className="text-sm text-muted-foreground">
            Click the <Pin className="inline w-3.5 h-3.5" /> icon next to any plot to pin it for comparison.
          </p>
        ) : (
          comparisonContent
        )}

        {/* Fullscreen expand of comparison section */}
        <FullscreenModal
          open={comparisonExp.isExpanded}
          onClose={comparisonExp.close}
          title={`Pinned Plots (${pinnedIds.size})`}
        >
          <div className="p-4">
            {comparisonContent}
          </div>
        </FullscreenModal>
      </section>
    </div>
  )
}
