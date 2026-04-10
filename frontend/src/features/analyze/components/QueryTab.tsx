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

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Eye, EyeOff, Pin, PinOff, Download, Scan, X, Tag, FlaskConical, ChevronLeft, ChevronRight } from "lucide-react"
import { PlotImage, type Prediction } from "@/components/Common/PlotImage"
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
import { ReferenceDataPanel } from "./ReferenceDataPanel"

// ── Types ─────────────────────────────────────────────────────────────────────

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

export interface RefContext {
  workspaceId: string
  experiment: string
  location: string
  population: string
}

interface QueryTabProps {
  geojson: GeoJSON.FeatureCollection
  metricColumns: string[]
  runId: string
  refContext?: RefContext
  isGroundPipeline?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

function fmt(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "number") return isNaN(v) ? "" : v.toFixed(3)
  return String(v)
}

// ── Pinned plot card ───────────────────────────────────────────────────────────

interface PinnedCardProps {
  row: PlotRow
  recordId: string
  predictions: Prediction[]
  hasDetections: boolean
  onUnpin: () => void
  onDownload: () => void
  refContext?: RefContext
}

function PinnedCard({ row, recordId, predictions, hasDetections, onUnpin, onDownload, refContext }: PinnedCardProps) {
  const [showDetections, setShowDetections] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [showRef, setShowRef] = useState(false)
  const [activeClass, setActiveClass] = useState<string | null>(null)
  const uniqueClasses = useMemo(() => [...new Set(predictions.map((p) => p.class))].sort(), [predictions])

  const refProps = refContext ? {
    workspaceId: refContext.workspaceId,
    experiment: refContext.experiment,
    location: refContext.location,
    population: refContext.population,
    plotId: row.plotId,
    col: row.properties.col ? String(row.properties.col) : null,
    row: row.properties.row ? String(row.properties.row) : null,
  } : null

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
            <>
              <button
                type="button"
                title={showDetections ? "Hide detections" : "Show detections"}
                className={`text-muted-foreground hover:text-foreground transition-colors ${showDetections ? "text-primary" : ""}`}
                onClick={() => setShowDetections((v) => !v)}
              >
                <Scan className="w-3.5 h-3.5" />
              </button>
              {showDetections && (
                <button
                  type="button"
                  title={showLabels ? "Hide labels" : "Show labels"}
                  className={`transition-colors ${showLabels ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setShowLabels((v) => !v)}
                >
                  <Tag className={`w-3.5 h-3.5 ${showLabels ? "" : "opacity-40"}`} />
                </button>
              )}
              {showDetections && uniqueClasses.length > 1 && (
                <div className="flex items-center gap-0.5 border rounded text-[10px]">
                  <button onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i <= 0 ? null : uniqueClasses[i - 1] })} className="px-0.5 py-0.5 hover:bg-muted"><ChevronLeft className="w-3 h-3" /></button>
                  <span className="px-0.5 min-w-[40px] text-center truncate">{activeClass ?? "All"}</span>
                  <button onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i >= uniqueClasses.length - 1 ? null : uniqueClasses[i + 1] })} className="px-0.5 py-0.5 hover:bg-muted"><ChevronRight className="w-3 h-3" /></button>
                </div>
              )}
            </>
          )}
          {refContext && (
            <button
              type="button"
              title={showRef ? "Hide reference data" : "Show reference data"}
              className={`transition-colors ${showRef ? "text-orange-500" : "text-muted-foreground hover:text-orange-400"}`}
              onClick={() => setShowRef((v) => !v)}
            >
              <FlaskConical className="w-3.5 h-3.5" />
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
      <div className="h-56 bg-muted/10">
        <PlotImage
          recordId={recordId}
          plotId={row.plotId}
          predictions={predictions}
          showDetections={showDetections}
          showLabels={showLabels}
          activeClass={activeClass}
        />
      </div>
      {/* Reference data panel */}
      {showRef && refProps && (
        <div className="border-t px-3 py-2 bg-muted/5">
          <ReferenceDataPanel {...refProps} />
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function QueryTab({ geojson, metricColumns, runId, refContext, isGroundPipeline = false }: QueryTabProps) {
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [viewPlotId, setViewPlotId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const comparisonExp = useExpandable()
  const [viewShowDetections, setViewShowDetections] = useState(false)
  const [viewShowLabels, setViewShowLabels] = useState(true)
  const [viewActiveClass, setViewActiveClass] = useState<string | null>(null)
  const [viewShowRef, setViewShowRef] = useState(false)
  /** plotId of the row whose inline REF sub-row is expanded */
  const [refExpandedId, setRefExpandedId] = useState<string | null>(null)

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
  const viewUniqueClasses = useMemo(() => [...new Set(viewPredictions.map((p) => p.class))].sort(), [viewPredictions])

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
          refContext={refContext}
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
                  <>
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
                        {/* Reference data chip */}
                        {refContext && (
                          <button
                            type="button"
                            title={refExpandedId === row.plotId ? "Hide reference data" : "Show reference data"}
                            className={`transition-colors ${refExpandedId === row.plotId ? "text-orange-500" : "text-muted-foreground hover:text-orange-400"}`}
                            onClick={() => setRefExpandedId(
                              refExpandedId === row.plotId ? null : row.plotId
                            )}
                          >
                            <FlaskConical className="w-3.5 h-3.5" />
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
                  {/* Inline reference data sub-row */}
                  {refContext && refExpandedId === row.plotId && (
                    <TableRow className="bg-orange-50/50 dark:bg-orange-950/20">
                      <TableCell
                        colSpan={4 + shownMetrics.length}
                        className="px-4 py-2"
                      >
                        <ReferenceDataPanel
                          workspaceId={refContext.workspaceId}
                          experiment={refContext.experiment}
                          location={refContext.location}
                          population={refContext.population}
                          plotId={row.plotId}
                          col={row.properties.col ? String(row.properties.col) : null}
                          row={row.properties.row ? String(row.properties.row) : null}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  </>
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
              <>
                <button
                  type="button"
                  title={viewShowDetections ? "Hide detections" : "Show detections"}
                  className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${viewShowDetections ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input hover:text-foreground"}`}
                  onClick={() => setViewShowDetections((v) => !v)}
                >
                  <Scan className="w-3 h-3" />
                  {viewShowDetections ? "Hide detections" : "Show detections"}
                </button>
                {viewShowDetections && (
                  <>
                    <button
                      type="button"
                      title={viewShowLabels ? "Hide labels" : "Show labels"}
                      className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${viewShowLabels ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input hover:text-foreground"}`}
                      onClick={() => setViewShowLabels((v) => !v)}
                    >
                      <Tag className={`w-3 h-3 ${viewShowLabels ? "" : "opacity-40"}`} />
                      {viewShowLabels ? "Hide labels" : "Show labels"}
                    </button>
                    {viewUniqueClasses.length > 1 && (
                      <div className="flex items-center gap-0.5 border rounded text-xs">
                        <button onClick={() => setViewActiveClass((c) => { const i = viewUniqueClasses.indexOf(c ?? ""); return i <= 0 ? null : viewUniqueClasses[i - 1] })} className="px-1.5 py-0.5 hover:bg-muted"><ChevronLeft className="w-3 h-3" /></button>
                        <span className="px-1 min-w-[56px] text-center truncate">{viewActiveClass ?? "All"}</span>
                        <button onClick={() => setViewActiveClass((c) => { const i = viewUniqueClasses.indexOf(c ?? ""); return i >= viewUniqueClasses.length - 1 ? null : viewUniqueClasses[i + 1] })} className="px-1.5 py-0.5 hover:bg-muted"><ChevronRight className="w-3 h-3" /></button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {refContext && (
              <button
                type="button"
                title={viewShowRef ? "Hide reference data" : "Show reference data"}
                className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${
                  viewShowRef
                    ? "bg-orange-500 text-white border-orange-500"
                    : "text-orange-500 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950"
                }`}
                onClick={() => setViewShowRef((v) => !v)}
              >
                <FlaskConical className="w-3 h-3" />
                REF
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
              onClick={() => { setViewPlotId(null); setViewShowRef(false) }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex rounded-lg border overflow-hidden" style={{ height: 420 }}>
            <div className={viewShowRef && refContext ? "flex-1 min-w-0" : "w-full"}>
              <PlotImage
                key={viewPlotId}
                recordId={recordId ?? ""}
                plotId={viewPlotId}
                rotate={isGroundPipeline}
                predictions={viewPredictions}
                showDetections={viewShowDetections}
                showLabels={viewShowLabels}
                activeClass={viewActiveClass}
              />
            </div>
            {viewShowRef && refContext && viewRow && (
              <div className="w-52 shrink-0 border-l px-3 py-3 overflow-y-auto">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Reference Data
                </p>
                <ReferenceDataPanel
                  workspaceId={refContext.workspaceId}
                  experiment={refContext.experiment}
                  location={refContext.location}
                  population={refContext.population}
                  plotId={viewPlotId}
                  col={viewRow.properties.col ? String(viewRow.properties.col) : null}
                  row={viewRow.properties.row ? String(viewRow.properties.row) : null}
                />
              </div>
            )}
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
