/**
 * TraitMap — deck.gl + MapLibre map for the Analyze tab.
 *
 * Layers:
 *  1. ESRI World Imagery base tiles (MapLibre)
 *  2. BitmapLayer — orthomosaic / combined_mosaic image overlay
 *  3. GeoJsonLayer — plot polygons filled by selected metric via d3 color scale
 *
 * Works for both aerial and ground pipeline runs.
 */

import DeckGL from "@deck.gl/react"
import { WebMercatorViewport } from "@deck.gl/core"
import { BitmapLayer, GeoJsonLayer } from "@deck.gl/layers"
import { Map as MapLibre } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"
import { useState, useMemo, useEffect, useRef } from "react"
import { X, Download, Loader2, Scan, Tag, FlaskConical, ChevronLeft, ChevronRight } from "lucide-react"
import { PlotImage, type Prediction } from "@/components/Common/PlotImage"
import { useExpandable, ExpandButton, FullscreenModal } from "@/components/Common/ExpandableSection"
import { useQuery } from "@tanstack/react-query"
import { buildColorScale } from "../utils/colorScale"
import { POSITION_KEY_SET, lookupProperty } from "../utils/traitAliases"
import { ColorLegend } from "./ColorLegend"
import { ReferenceDataPanel, type ReferenceDataPanelProps } from "./ReferenceDataPanel"

// Satellite base → ortho image overlay → trait polygons
const MAP_STYLE = {
  version: 8 as const,
  sources: {
    "esri-satellite": {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Tiles © Esri",
      maxzoom: 19,
    },
  },
  layers: [{ id: "esri-satellite", type: "raster" as const, source: "esri-satellite" }],
}

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

interface OrthoInfo {
  available: boolean
  path?: string | null
  bounds: [[number, number], [number, number]] | null // [[s,w],[n,e]]
  /** Preferred: downscaled JPEG preview (much faster than the full TIF) */
  preview_url?: string | null
}

interface TraitMapProps {
  geojson: GeoJSON.FeatureCollection | null
  orthoInfo: OrthoInfo | null
  selectedMetric: string | null
  /** Feature ids to highlight (accession filter); null = show all */
  filteredIds: Set<string> | null
  /** TraitRecord id — used to fetch plot images on click */
  recordId?: string | null
  /** Pipeline run ID — used to fetch inference/detection results */
  runId?: string | null
  /** When false, polygon layer is hidden */
  showPolygons?: boolean
  /** Fill opacity for colored polygons, 0-100 (default 70) */
  plotOpacity?: number
  /** Reference data context — if provided, enables REF toggle in plot panel */
  refContext?: Omit<ReferenceDataPanelProps, "plotId" | "col" | "row">
}

interface TooltipState {
  x: number
  y: number
  properties: Record<string, unknown>
}

interface PlotImageState {
  plotId: string
  x: number
  y: number
  properties: Record<string, unknown>
}

function fitBoundsViewState(
  bounds: [[number, number], [number, number]],
  width: number,
  height: number,
) {
  const [[s, w], [n, e]] = bounds
  const vp = new WebMercatorViewport({ width: Math.max(width, 1), height: Math.max(height, 1) })
  const { longitude, latitude, zoom } = vp.fitBounds([[w, s], [e, n]], { padding: 40 })
  return { longitude, latitude, zoom, pitch: 0, bearing: 0 }
}

export function TraitMap({
  geojson,
  orthoInfo,
  selectedMetric,
  filteredIds,
  recordId,
  runId,
  showPolygons = true,
  plotOpacity = 70,
  refContext,
}: TraitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewState, setViewState] = useState({ longitude: 0, latitude: 0, zoom: 2, pitch: 0, bearing: 0 })
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [plotImage, setPlotImage] = useState<PlotImageState | null>(null)

  // Model selector for the detection overlay (shared across all plot popups)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)

  // Fetch inference results for the selected model
  const { data: inferenceData } = useQuery({
    queryKey: ["inference-results-analyze", runId, selectedModel],
    queryFn: async () => {
      const token = localStorage.getItem("access_token") || ""
      const modelParam = selectedModel ? `?model=${encodeURIComponent(selectedModel)}` : ""
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/inference-results${modelParam}`), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return null
      return res.json()
    },
    enabled: !!runId,
    staleTime: 60_000,
  })

  const availableModels: string[] = inferenceData?.models ?? []

  // Build plotId → predictions map
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

  // Fit view to ortho bounds whenever orthoInfo changes
  useEffect(() => {
    if (!orthoInfo?.bounds) return
    const el = containerRef.current
    const width = el?.clientWidth ?? 800
    const height = el?.clientHeight ?? 600
    setViewState(fitBoundsViewState(orthoInfo.bounds, width, height))
  }, [orthoInfo])

  // Compute color scale from visible features using quantile normalization
  const { colorFn, minVal, maxVal } = useMemo(() => {
    if (!geojson || !selectedMetric) {
      return { colorFn: null, minVal: 0, maxVal: 1 }
    }
    const values: number[] = geojson.features
      .filter((f) => filteredIds == null || filteredIds.has(String(f.properties?.plot_id ?? f.properties?.accession ?? "")))
      .map((f) => f.properties?.[selectedMetric] as number)
      .filter((v) => typeof v === "number" && !isNaN(v))
    const { colorFn, min, max } = buildColorScale(values, selectedMetric)
    return { colorFn, minVal: min, maxVal: max }
  }, [geojson, selectedMetric, filteredIds])

  // Bitmap layer for the ortho/mosaic image
  const bitmapLayer = useMemo(() => {
    if (!orthoInfo?.available || !orthoInfo.bounds) return null
    const [[south, west], [north, east]] = orthoInfo.bounds
    const imgUrl = orthoInfo.preview_url
      ? apiUrl(orthoInfo.preview_url)
      : orthoInfo.path
        ? apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(orthoInfo.path)}`)
        : null
    if (!imgUrl) return null
    return new BitmapLayer({
      id: "ortho-bitmap",
      image: imgUrl,
      bounds: [west, south, east, north],
      opacity: 0.9,
    })
  }, [orthoInfo])

  // GeoJSON polygon layer
  const polygonLayer = useMemo(() => {
    if (!geojson || !showPolygons) return null
    return new GeoJsonLayer({
      id: "trait-polygons",
      data: geojson,
      stroked: true,
      filled: true,
      lineWidthMinPixels: 0.5,
      lineWidthMaxPixels: 1.5,
      getLineColor: [255, 255, 255, 60],
      getFillColor: (f: GeoJSON.Feature) => {
        const alpha = Math.round((plotOpacity / 100) * 255)
        if (filteredIds != null) {
          const pid = String(f.properties?.plot_id ?? f.properties?.accession ?? "")
          if (!filteredIds.has(pid)) return [128, 128, 128, Math.round(alpha * 0.25)]
        }
        if (!colorFn || !selectedMetric) return [128, 128, 128, alpha]
        const v = f.properties?.[selectedMetric] as number | null | undefined
        const color = colorFn(v)
        return [color[0], color[1], color[2], alpha] as [number, number, number, number]
      },
      updateTriggers: {
        getFillColor: [selectedMetric, colorFn, filteredIds, plotOpacity],
      },
      pickable: true,
      onHover: (info: any) => {
        if (info.object && info.coordinate) {
          setTooltip({ x: info.x, y: info.y, properties: info.object.properties ?? {} })
        } else {
          setTooltip(null)
        }
      },
      onClick: (info: any) => {
        if (info.object && recordId) {
          const plotId = String(
            info.object.properties?.plot_id ??
            info.object.properties?.plot ??
            info.object.properties?.accession ??
            "",
          )
          if (plotId) {
            setPlotImage({ plotId, x: info.x, y: info.y, properties: info.object.properties ?? {} })
          }
        }
      },
    })
  }, [geojson, colorFn, selectedMetric, filteredIds, showPolygons, plotOpacity, recordId])

  const layers = [bitmapLayer, polygonLayer].filter(Boolean)

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
        controller={{ maxZoom: 24 } as any}
        layers={layers}
        style={{ position: "absolute", inset: "0" }}
        getCursor={({ isDragging }) => (isDragging ? "grabbing" : recordId && showPolygons ? "pointer" : "grab")}
      >
        <MapLibre mapStyle={MAP_STYLE} />
      </DeckGL>

      {selectedMetric && colorFn && (
        <ColorLegend min={minVal} max={maxVal} column={selectedMetric} />
      )}

      {tooltip && !plotImage && (
        <MapTooltip x={tooltip.x} y={tooltip.y} properties={tooltip.properties} selectedMetric={selectedMetric} />
      )}

      {plotImage && recordId && (
        <PlotImagePanel
          recordId={recordId}
          plotId={plotImage.plotId}
          properties={plotImage.properties}
          selectedMetric={selectedMetric}
          predictions={predsByPlot[plotImage.plotId] ?? []}
          availableModels={availableModels}
          selectedModel={selectedModel ?? inferenceData?.active_model ?? null}
          onModelChange={setSelectedModel}
          onClose={() => setPlotImage(null)}
          refContext={refContext ? {
            ...refContext,
            plotId: plotImage.plotId,
            col: plotImage.properties.col ? String(plotImage.properties.col) : null,
            row: plotImage.properties.row ? String(plotImage.properties.row) : null,
          } : undefined}
        />
      )}
    </div>
  )
}

// ── Plot image panel ────────────────────────────────────────────────────────────

function PlotImagePanel({
  recordId,
  plotId,
  properties,
  selectedMetric,
  predictions,
  availableModels,
  selectedModel,
  onModelChange,
  onClose,
  refContext,
}: {
  recordId: string
  plotId: string
  properties: Record<string, unknown>
  selectedMetric: string | null
  predictions: Prediction[]
  availableModels?: string[]
  selectedModel?: string | null
  onModelChange?: (model: string) => void
  onClose: () => void
  refContext?: ReferenceDataPanelProps
}) {
  const [downloading, setDownloading] = useState(false)
  const [showDetections, setShowDetections] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [showRef, setShowRef] = useState(false)
  const [activeClass, setActiveClass] = useState<string | null>(null)
  const hasDetections = predictions.length > 0
  const uniqueClasses = useMemo(() => [...new Set(predictions.map((p) => p.class))].sort(), [predictions])
  const exp = useExpandable()

  async function handleDownload() {
    setDownloading(true)
    try {
      const endpoint = apiUrl(`/api/v1/analyze/trait-records/${recordId}/plot-image/${plotId}`)
      const token = localStorage.getItem("access_token") || ""
      const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `plot_${plotId}.png`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  const numericEntries = Object.entries(properties).filter(
    ([k, v]) => !NON_METRIC_KEYS.has(k) && !POSITION_KEY_SET.has(k.toLowerCase()) && typeof v === "number",
  )

  const accession = lookupProperty(properties, "accession")

  function PanelInfo() {
    return (
      <div className="px-3 py-2 border-b">
        {accession != null && (
          <p className="text-xs text-muted-foreground mb-1.5">Accession: {String(accession)}</p>
        )}
        {selectedMetric && properties[selectedMetric] != null && (
          <p className="text-sm font-medium text-primary mb-1.5">
            {formatLabel(selectedMetric)}: {Number(properties[selectedMetric]).toFixed(2)}
          </p>
        )}
        {numericEntries.length > 0 && (
          <div className="space-y-0.5 text-xs text-muted-foreground max-h-28 overflow-y-auto">
            {numericEntries
              .filter(([k]) => k !== selectedMetric)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="truncate">{formatLabel(k)}</span>
                  <span className="font-mono flex-shrink-0">{Number(v).toFixed(2)}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
    <div
      className="absolute z-30 bg-background/95 backdrop-blur-sm border rounded-lg shadow-xl overflow-hidden"
      style={{ bottom: 16, right: 16, width: 480, maxHeight: "calc(100% - 32px)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-semibold">Plot {plotId}</span>
        <div className="flex items-center gap-1">
          {availableModels && availableModels.length > 1 && onModelChange && (
            <select
              className="border-input bg-background rounded border px-1.5 py-0.5 text-xs"
              value={selectedModel ?? ""}
              onChange={(e) => onModelChange(e.target.value)}
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
          {hasDetections && (
            <>
              <button type="button" onClick={() => setShowDetections((v) => !v)} title={showDetections ? "Hide detections" : "Show detections"} className={`transition-colors ${showDetections ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                <Scan className="w-4 h-4" />
              </button>
              {showDetections && (
                <>
                  <button type="button" onClick={() => setShowLabels((v) => !v)} title={showLabels ? "Hide labels" : "Show labels"} className={`transition-colors ${showLabels ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                    <Tag className={`w-4 h-4 ${showLabels ? "" : "opacity-40"}`} />
                  </button>
                  {uniqueClasses.length > 1 && (
                    <div className="flex items-center gap-0.5 border rounded text-xs">
                      <button onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i <= 0 ? null : uniqueClasses[i - 1] })} className="px-1 py-0.5 hover:bg-muted"><ChevronLeft className="w-3 h-3" /></button>
                      <span className="px-1 min-w-[44px] text-center truncate">{activeClass ?? "All"}</span>
                      <button onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i >= uniqueClasses.length - 1 ? null : uniqueClasses[i + 1] })} className="px-1 py-0.5 hover:bg-muted"><ChevronRight className="w-3 h-3" /></button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {refContext && (
            <button
              type="button"
              title={showRef ? "Hide reference data" : "Show reference data"}
              onClick={() => setShowRef((v) => !v)}
              className={`transition-colors ${showRef ? "text-orange-500" : "text-muted-foreground hover:text-orange-400"}`}
            >
              <FlaskConical className="w-4 h-4" />
            </button>
          )}
          <ExpandButton onClick={exp.open} title="Expand plot" className="h-7 w-7" />
          <button
            onClick={handleDownload}
            disabled={downloading}
            title="Download plot image"
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors ml-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <PanelInfo />
      {showRef && refContext && (
        <div className="border-t px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Reference Data
          </p>
          <ReferenceDataPanel {...refContext} />
        </div>
      )}
      <div className="w-full" style={{ height: 260 }}>
        <PlotImage
          recordId={recordId}
          plotId={plotId}
          predictions={predictions}
          showDetections={showDetections}
          showLabels={showLabels}
          activeClass={activeClass}
        />
      </div>
    </div>

    <FullscreenModal open={exp.isExpanded} onClose={exp.close} title={`Plot ${plotId}`}
      headerExtra={
        <div className="flex items-center gap-2">
          {availableModels && availableModels.length > 1 && onModelChange && (
            <select
              className="border-input bg-background rounded border px-1.5 py-0.5 text-xs"
              value={selectedModel ?? ""}
              onChange={(e) => onModelChange(e.target.value)}
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
          {hasDetections && (
            <>
              <button
                type="button"
                onClick={() => setShowDetections((v) => !v)}
                className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${showDetections ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
              >
                <Scan className="h-3 w-3" />
                {showDetections ? "Hide detections" : "Show detections"}
              </button>
              {showDetections && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowLabels((v) => !v)}
                    className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${showLabels ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
                  >
                    <Tag className={`h-3 w-3 ${showLabels ? "" : "opacity-40"}`} />
                    {showLabels ? "Hide labels" : "Show labels"}
                  </button>
                  {uniqueClasses.length > 1 && (
                    <div className="flex items-center gap-0.5 border rounded text-xs">
                      <button onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i <= 0 ? null : uniqueClasses[i - 1] })} className="px-1.5 py-0.5 hover:bg-muted"><ChevronLeft className="w-3 h-3" /></button>
                      <span className="px-1 min-w-[56px] text-center truncate">{activeClass ?? "All"}</span>
                      <button onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i >= uniqueClasses.length - 1 ? null : uniqueClasses[i + 1] })} className="px-1.5 py-0.5 hover:bg-muted"><ChevronRight className="w-3 h-3" /></button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      }
    >
      <div className="flex flex-col h-full">
        <PanelInfo />
        <div className="flex-1 min-h-0 mt-3">
          <PlotImage
            recordId={recordId}
            plotId={plotId}
            predictions={predictions}
            showDetections={showDetections}
            showLabels={showLabels}
            activeClass={activeClass}
          />
        </div>
      </div>
    </FullscreenModal>
    </>
  )
}

// ── Tooltip ────────────────────────────────────────────────────────────────────

const NON_METRIC_KEYS = new Set(["plot_id", "plot", "accession", ...POSITION_KEY_SET])

function MapTooltip({
  x,
  y,
  properties,
  selectedMetric,
}: {
  x: number
  y: number
  properties: Record<string, unknown>
  selectedMetric: string | null
}) {
  const numericEntries = Object.entries(properties).filter(
    ([k, v]) => !NON_METRIC_KEYS.has(k) && !POSITION_KEY_SET.has(k.toLowerCase()) && typeof v === "number",
  )

  const accession = lookupProperty(properties, "accession")
  return (
    <div
      className="absolute z-20 pointer-events-none bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-4 text-sm max-w-[480px]"
      style={{ left: x + 12, top: y - 8 }}
    >
      <p className="font-semibold mb-1.5">
        Plot {String(properties.plot ?? properties.plot_id ?? "—")}
      </p>
      {accession != null && (
        <p className="text-muted-foreground mb-2">Accession: {String(accession)}</p>
      )}
      {selectedMetric && properties[selectedMetric] != null && (
        <p className="font-medium text-primary mb-2">
          {formatLabel(selectedMetric)}: {Number(properties[selectedMetric]).toFixed(2)}
        </p>
      )}
      <div className="space-y-1 text-muted-foreground max-h-48 overflow-y-auto">
        {numericEntries
          .filter(([k]) => k !== selectedMetric)
          .map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <span className="truncate">{formatLabel(k)}</span>
              <span className="font-mono flex-shrink-0">{Number(v).toFixed(2)}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

function formatLabel(col: string): string {
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}
