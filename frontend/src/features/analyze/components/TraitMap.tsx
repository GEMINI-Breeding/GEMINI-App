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
import { X } from "lucide-react"
import { buildColorScale } from "../utils/colorScale"
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

interface TraitMapProps {
  geojson: GeoJSON.FeatureCollection | null
  orthoInfo: OrthoInfo | null
  selectedMetric: string | null
  /** Feature ids to highlight (accession filter); null = show all */
  filteredIds: Set<string> | null
  /** TraitRecord id — used to fetch plot images on click */
  recordId?: string | null
  /** When false, polygon layer is hidden */
  showPolygons?: boolean
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
  showPolygons = true,
}: TraitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewState, setViewState] = useState({ longitude: 0, latitude: 0, zoom: 2, pitch: 0, bearing: 0 })
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [plotImage, setPlotImage] = useState<PlotImageState | null>(null)

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
        if (filteredIds != null) {
          const pid = String(f.properties?.plot_id ?? f.properties?.accession ?? "")
          if (!filteredIds.has(pid)) return [128, 128, 128, 40]
        }
        if (!colorFn || !selectedMetric) return [128, 128, 128, 160]
        const v = f.properties?.[selectedMetric] as number | null | undefined
        return colorFn(v)
      },
      updateTriggers: {
        getFillColor: [selectedMetric, colorFn, filteredIds],
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
            setPlotImage({ plotId, x: info.x, y: info.y })
          }
        }
      },
    })
  }, [geojson, colorFn, selectedMetric, filteredIds, showPolygons, recordId])

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
          x={plotImage.x}
          y={plotImage.y}
          onClose={() => setPlotImage(null)}
        />
      )}
    </div>
  )
}

// ── Plot image panel ────────────────────────────────────────────────────────────

function PlotImagePanel({
  recordId,
  plotId,
  x,
  y,
  onClose,
}: {
  recordId: string
  plotId: string
  x: number
  y: number
  onClose: () => void
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setBlobUrl(null)
    setError(false)
    const endpoint = apiUrl(`/api/v1/analyze/trait-records/${recordId}/plot-image/${plotId}`)
    const token = localStorage.getItem("access_token") || ""
    fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.blob()
      })
      .then((blob) => setBlobUrl(URL.createObjectURL(blob)))
      .catch(() => setError(true))
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [recordId, plotId])

  const left = Math.min(x + 12, window.innerWidth - 280)
  const top = Math.max(y - 8, 8)

  return (
    <div
      className="absolute z-30 bg-background/95 backdrop-blur-sm border rounded-lg shadow-xl overflow-hidden"
      style={{ left, top, width: 240 }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-semibold">Plot {plotId}</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {error ? (
        <p className="text-xs text-muted-foreground text-center py-4 px-3">Image not available</p>
      ) : !blobUrl ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
        </div>
      ) : (
        <img src={blobUrl} alt={`Plot ${plotId}`} className="w-full object-contain max-h-48" />
      )}
    </div>
  )
}

// ── Tooltip ────────────────────────────────────────────────────────────────────

const NON_METRIC_KEYS = new Set(["plot_id", "plot", "accession"])

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
    ([k, v]) => !NON_METRIC_KEYS.has(k) && typeof v === "number",
  )

  return (
    <div
      className="absolute z-20 pointer-events-none bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-3 text-xs max-w-[240px]"
      style={{ left: x + 12, top: y - 8 }}
    >
      <p className="font-semibold mb-1">
        Plot {String(properties.plot ?? properties.plot_id ?? "—")}
      </p>
      {properties.accession != null && (
        <p className="text-muted-foreground mb-1.5">{String(properties.accession)}</p>
      )}
      {selectedMetric && properties[selectedMetric] != null && (
        <p className="font-medium text-primary mb-1.5">
          {formatLabel(selectedMetric)}: {Number(properties[selectedMetric]).toFixed(2)}
        </p>
      )}
      <div className="space-y-0.5 text-muted-foreground max-h-32 overflow-y-auto">
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
