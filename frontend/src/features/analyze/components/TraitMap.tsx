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
import { X, Download, Loader2, ZoomIn, Tag } from "lucide-react"
import { useExpandable, ExpandButton, FullscreenModal } from "@/components/Common/ExpandableSection"
import { useQuery } from "@tanstack/react-query"
import { buildColorScale } from "../utils/colorScale"
import { POSITION_KEY_SET, lookupProperty } from "../utils/traitAliases"
import { ColorLegend } from "./ColorLegend"

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

interface Prediction {
  image: string
  class: string
  confidence: number
  x: number; y: number; width: number; height: number
  points?: Array<{ x: number; y: number }>
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
        />
      )}
    </div>
  )
}

// ── Plot image panel ────────────────────────────────────────────────────────────

const CLASS_COLOURS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
]

function classColour(cls: string): string {
  let hash = 0
  for (let i = 0; i < cls.length; i++) hash = (hash * 31 + cls.charCodeAt(i)) | 0
  return CLASS_COLOURS[Math.abs(hash) % CLASS_COLOURS.length]
}

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
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [showDetections, setShowDetections] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const hasDetections = predictions.length > 0
  const exp = useExpandable()

  // Draw detection overlay — accounts for object-contain letterboxing
  function drawCanvas() {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !dims) {
      canvasRef.current?.getContext("2d")?.clearRect(0, 0, canvas?.width ?? 0, canvas?.height ?? 0)
      return
    }
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const rect = img.getBoundingClientRect()
    const elemW = rect.width, elemH = rect.height
    canvas.width = elemW; canvas.height = elemH
    ctx.clearRect(0, 0, elemW, elemH)
    if (!showDetections || predictions.length === 0) return
    const imgAspect = dims.w / dims.h
    const elemAspect = elemW / elemH
    let scale: number, offsetX: number, offsetY: number
    if (imgAspect > elemAspect) {
      scale = elemW / dims.w; offsetX = 0; offsetY = (elemH - dims.h * scale) / 2
    } else {
      scale = elemH / dims.h; offsetX = (elemW - dims.w * scale) / 2; offsetY = 0
    }
    for (const p of predictions) {
      const color = classColour(p.class)
      const x = (p.x - p.width / 2) * scale + offsetX
      const y = (p.y - p.height / 2) * scale + offsetY
      const w = p.width * scale, h = p.height * scale
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h)
      if (showLabels) {
        const label = `${p.class} ${(p.confidence * 100).toFixed(0)}%`
        ctx.font = "11px monospace"
        const tw = ctx.measureText(label).width
        ctx.fillStyle = color; ctx.fillRect(x, y - 16, tw + 6, 16)
        ctx.fillStyle = "#fff"; ctx.fillText(label, x + 3, y - 3)
      }
    }
  }

  useEffect(() => {
    const id = requestAnimationFrame(() => drawCanvas())
    return () => cancelAnimationFrame(id)
  }, [dims, predictions, showDetections, showLabels, exp.isExpanded]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setBlobUrl(null)
    setError(false)
    setDims(null)
    const endpoint = apiUrl(`/api/v1/analyze/trait-records/${recordId}/plot-image/${plotId}`)
    const token = localStorage.getItem("access_token") || ""
    let revoked = false
    let objectUrl: string | null = null
    fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } })
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

  function PanelImage({ maxH }: { maxH: string }) {
    return error ? (
      <p className="text-xs text-muted-foreground text-center py-4 px-3">Image not available</p>
    ) : !blobUrl ? (
      <div className="flex items-center justify-center py-6">
        <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
      </div>
    ) : (
      <div className="relative">
        <img
          ref={imgRef}
          src={blobUrl}
          alt={`Plot ${plotId}`}
          className={`w-full object-contain ${maxH}`}
          onLoad={(e) => {
            setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            drawCanvas()
          }}
        />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }} />
      </div>
    )
  }

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
              <button
                type="button"
                onClick={() => setShowDetections((v) => !v)}
                title={showDetections ? "Hide detections" : "Show detections"}
                className={`transition-colors ${showDetections ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              {showDetections && (
                <button
                  type="button"
                  onClick={() => setShowLabels((v) => !v)}
                  title={showLabels ? "Hide labels" : "Show labels"}
                  className={`transition-colors ${showLabels ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Tag className={`w-4 h-4 ${showLabels ? "" : "opacity-40"}`} />
                </button>
              )}
            </>
          )}
          <ExpandButton onClick={exp.open} title="Expand plot" className="h-7 w-7" />
          <button
            onClick={handleDownload}
            disabled={downloading || error || !blobUrl}
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
      <PanelImage maxH="max-h-64" />
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
            <button
              type="button"
              onClick={() => setShowDetections((v) => !v)}
              className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${showDetections ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}
            >
              <ZoomIn className="h-3 w-3" />
              {predictions.length} detection{predictions.length !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col items-center justify-center h-full p-4">
        <div className="max-w-3xl w-full space-y-3">
          <PanelInfo />
          <PanelImage maxH="max-h-[70vh]" />
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
