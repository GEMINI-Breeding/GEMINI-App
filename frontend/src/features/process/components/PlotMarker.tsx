/**
 * PlotMarker — interactive tool for ground pipeline Step 1.
 *
 * The user navigates through raw images and marks start/end frames per plot.
 * An optional GPS trajectory panel shows the rover path on a satellite map
 * with the current image position highlighted.
 *
 * Keyboard shortcuts:
 *   ← / →       previous / next image
 *   S           mark current image as Start for active plot
 *   E           mark current image as End for active plot
 */

import {
  ChevronLeft,
  ChevronRight,
  Flag,
  FlagOff,
  Check,
  AlertCircle,
  Map,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import { useState, useEffect, useCallback, useRef } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Map as MapLibre, Source, Layer, Marker } from "react-map-gl/maplibre"
import type { MapRef } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ProcessingService } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    "osm": {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlotSelection {
  plot_id: number
  start_image: string | null
  end_image: string | null
  direction: string
}

interface ImageListResponse {
  images: string[]
  count: number
  raw_dir: string
  has_gps: boolean
  msgs_synced: string | null
}

interface GpsPoint {
  lat: number
  lon: number
  image: string | null
}

interface GpsDataResponse {
  points: GpsPoint[]
  count: number
}

interface PlotMarkerProps {
  runId: string
  onSaved: () => void
  onCancel: () => void
}

const DIRECTIONS = [
  { value: "down",  label: "Down" },
  { value: "up",    label: "Up" },
  { value: "left",  label: "Left" },
  { value: "right", label: "Right" },
]

function makePlots(count: number): PlotSelection[] {
  return Array.from({ length: count }, (_, i) => ({
    plot_id: i + 1,
    start_image: null,
    end_image: null,
    direction: "down",
  }))
}

// ── GPS Trajectory Panel ───────────────────────────────────────────────────────

function GpsTrajectoryPanel({
  runId,
  currentImage,
}: {
  runId: string
  currentImage: string | null
}) {
  const mapRef = useRef<MapRef>(null)

  const { data: gpsData, isLoading } = useQuery<GpsDataResponse>({
    queryKey: ["gps-data", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/gps-data`))
      if (!res.ok) throw new Error("Failed to load GPS data")
      return res.json()
    },
    staleTime: Infinity,
  })

  const points = gpsData?.points ?? []

  useEffect(() => {
    if (!mapRef.current || points.length < 2) return
    const lons = points.map((p) => p.lon)
    const lats = points.map((p) => p.lat)
    mapRef.current.fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 40, duration: 600 }
    )
  }, [points.length])

  const currentPoint = currentImage
    ? points.find((p) => p.image === currentImage) ?? null
    : null

  const pathGeoJson = {
    type: "FeatureCollection" as const,
    features: points.length >= 2
      ? [{
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: points.map((p) => [p.lon, p.lat]),
          },
          properties: {},
        }]
      : [],
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading GPS…
      </div>
    )
  }

  if (points.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm p-4 text-center">
        <Map className="w-8 h-8 opacity-40" />
        <p>No GPS data found.</p>
        <p className="text-xs">msgs_synced.csv not found or missing lat/lon columns.</p>
      </div>
    )
  }

  const mid = points[Math.floor(points.length / 2)]

  return (
    <MapLibre
      ref={mapRef}
      initialViewState={{ longitude: mid.lon, latitude: mid.lat, zoom: 16 }}
      mapStyle={MAP_STYLE}
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
    >
      <Source id="trajectory" type="geojson" data={pathGeoJson}>
        <Layer
          id="trajectory-line"
          type="line"
          paint={{ "line-color": "#94a3b8", "line-width": 2, "line-opacity": 0.8 }}
        />
      </Source>

      {currentPoint && (
        <Marker longitude={currentPoint.lon} latitude={currentPoint.lat} anchor="center">
          <div className="w-4 h-4 rounded-full bg-yellow-400 border-2 border-white shadow-lg" />
        </Marker>
      )}
    </MapLibre>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function PlotMarker({ runId, onSaved: _onSaved, onCancel }: PlotMarkerProps) {
  const { showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const { data: imageData, isLoading } = useQuery<ImageListResponse>({
    queryKey: ["run-images", runId],
    queryFn: () =>
      ProcessingService.listImages({ id: runId }) as unknown as Promise<ImageListResponse>,
  })

  const { data: existingData } = useQuery<{ selections: PlotSelection[] }>({
    queryKey: ["plot-marking", runId],
    queryFn: () =>
      ProcessingService.loadPlotMarking({ id: runId }) as unknown as Promise<{ selections: PlotSelection[] }>,
  })

  const images = imageData?.images ?? []
  const rawDir = imageData?.raw_dir ?? ""

  const [currentIdx, setCurrentIdx] = useState(0)
  const [showGps, setShowGps] = useState(false)

  // plots state: array of PlotSelection
  const [plots, setPlots] = useState<PlotSelection[]>(makePlots(1))
  // which plot page we're viewing (0-indexed into plots array)
  const [plotPage, setPlotPage] = useState(0)
  // editable nav input (shows current plot number, used to jump)
  const [plotNavInput, setPlotNavInput] = useState("1")

  // Load existing selections when data arrives
  useEffect(() => {
    if (existingData?.selections && existingData.selections.length > 0) {
      const loaded = existingData.selections.map((s) => ({
        plot_id: Number(s.plot_id),
        start_image: s.start_image ?? null,
        end_image: s.end_image ?? null,
        direction: s.direction ?? "down",
      }))
      setPlots(loaded)
      setPlotNavInput("1")
      setPlotPage(0)
    }
  }, [existingData])

  // Keep nav input in sync when plotPage changes externally (arrows, dot strip, etc.)
  useEffect(() => {
    setPlotNavInput(String(plotPage + 1))
  }, [plotPage])

  const activePlot = plots[plotPage] ?? null
  const currentImage = images[currentIdx] ?? null

  // Navigate to a specific plot by 1-based number
  const applyNav = (val: string) => {
    const n = parseInt(val)
    if (!n || n < 1 || n > plots.length) {
      setPlotNavInput(String(plotPage + 1))
      return
    }
    setPlotPage(n - 1)
  }

  const prev = useCallback(() => setCurrentIdx((i) => Math.max(0, i - 1)), [])
  const next = useCallback(
    () => setCurrentIdx((i) => Math.min(images.length - 1, i + 1)),
    [images.length]
  )

  const markStart = useCallback(() => {
    if (!currentImage) return
    setPlots((prev) =>
      prev.map((p, i) => i === plotPage ? { ...p, start_image: currentImage } : p)
    )
  }, [currentImage, plotPage])

  const markEnd = useCallback(() => {
    if (!currentImage) return
    setPlots((prev) =>
      prev.map((p, i) => i === plotPage ? { ...p, end_image: currentImage } : p)
    )
  }, [currentImage, plotPage])

  const setDirection = (direction: string) => {
    setPlots((prev) =>
      prev.map((p, i) => i === plotPage ? { ...p, direction } : p)
    )
  }

  const jumpTo = (imageName: string | null) => {
    if (!imageName) return
    const idx = images.indexOf(imageName)
    if (idx >= 0) setCurrentIdx(idx)
  }

  const addPlot = useCallback(() => {
    setPlots((prev) => {
      const newId = prev.length + 1
      const prevDirection = prev[prev.length - 1]?.direction ?? "down"
      const updated = [...prev, { plot_id: newId, start_image: null, end_image: null, direction: prevDirection }]
      setPlotPage(updated.length - 1)
      return updated
    })
  }, [])

  const deletePlot = useCallback(() => {
    setPlots((prev) => {
      if (prev.length <= 1) return prev
      const updated = prev
        .filter((_, i) => i !== plotPage)
        .map((p, i) => ({ ...p, plot_id: i + 1 }))
      setPlotPage((p) => Math.min(p, updated.length - 1))
      return updated
    })
  }, [plotPage])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "ArrowLeft")  { e.preventDefault(); prev() }
      if (e.key === "ArrowRight") { e.preventDefault(); next() }
      if (e.key === "s" || e.key === "S") { e.preventDefault(); markStart() }
      if (e.key === "e" || e.key === "E") { e.preventDefault(); markEnd() }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); addPlot() }
      if (e.key === "d" || e.key === "D") { e.preventDefault(); deletePlot() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [prev, next, markStart, markEnd, addPlot, deletePlot])

  const incomplete = plots.filter((p) => !p.start_image || !p.end_image)
  const canSave = incomplete.length === 0 && plots.length > 0

  const { showSuccessToast } = useCustomToast()

  const saveMutation = useMutation({
    mutationFn: () =>
      ProcessingService.savePlotMarking({
        id: runId,
        requestBody: { selections: plots as unknown as { [key: string]: unknown }[] },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
      queryClient.invalidateQueries({ queryKey: ["plot-marking", runId] })
      showSuccessToast("Plot markings saved")
    },
    onError: () => showErrorToast("Failed to save plot markings"),
  })

  const imgSrc = currentImage
    ? apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(rawDir + "/" + currentImage)}`)
    : null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading images…
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-muted-foreground">
        <AlertCircle className="w-8 h-8" />
        <p className="text-sm">No images found in the raw data directory for this run.</p>
        <p className="text-xs">{rawDir}</p>
      </div>
    )
  }

  const doneCount = plots.filter((p) => p.start_image && p.end_image).length

  return (
    <div className="space-y-3">
      {/* Keyboard hint bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 rounded px-3 py-1.5">
        <span>
          <kbd className="bg-background border rounded px-1">←</kbd>
          <kbd className="bg-background border rounded px-1 ml-1">→</kbd> navigate ·{" "}
          <kbd className="bg-background border rounded px-1">S</kbd> start ·{" "}
          <kbd className="bg-background border rounded px-1">E</kbd> end ·{" "}
          <kbd className="bg-background border rounded px-1">N</kbd> new plot ·{" "}
          <kbd className="bg-background border rounded px-1">D</kbd> delete plot
        </span>
        <button
          onClick={() => setShowGps((v) => !v)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
            showGps ? "bg-primary text-primary-foreground" : "hover:bg-muted"
          }`}
        >
          <Map className="w-3.5 h-3.5" />
          {showGps ? "Hide GPS map" : "GPS map"}
        </button>
      </div>

      {/* Main layout — [GPS map |] image viewer | plot panel */}
      <div className={`grid gap-4 ${showGps ? "grid-cols-[1fr_3fr_1fr]" : "grid-cols-[3fr_1fr]"}`}>

        {/* ── GPS map (left, only when shown) ── */}
        {showGps && (
          <div className="rounded-lg overflow-hidden border" style={{ minHeight: 400 }}>
            <GpsTrajectoryPanel runId={runId} currentImage={currentImage} />
          </div>
        )}

        {/* ── Image viewer ── */}
        <div className="space-y-2">
          {/* Image */}
          <div className="relative rounded-lg overflow-hidden bg-black aspect-video flex items-center justify-center">
            {imgSrc ? (
              <img
                src={imgSrc}
                alt={currentImage ?? ""}
                className="max-h-full max-w-full object-contain"
                draggable={false}
              />
            ) : (
              <span className="text-white/50 text-sm">{currentImage}</span>
            )}
            {/* Crosshair */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 border-l-2 border-dashed border-red-500/70" />
              <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 border-t-2 border-dashed border-red-500/70" />
            </div>
            {activePlot?.start_image === currentImage && (
              <div className="absolute top-2 left-2">
                <Badge className="bg-green-600 text-white">START</Badge>
              </div>
            )}
            {activePlot?.end_image === currentImage && (
              <div className="absolute top-2 right-2">
                <Badge className="bg-red-600 text-white">END</Badge>
              </div>
            )}
          </div>

          {/* Image navigation */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prev} disabled={currentIdx === 0}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1 text-center text-xs text-muted-foreground font-mono truncate px-2">
              {currentImage ?? "—"}
            </div>
            <Button variant="outline" size="icon" onClick={next} disabled={currentIdx === images.length - 1}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="text-center text-xs text-muted-foreground">
            {currentIdx + 1} / {images.length}
          </div>

          {/* Mark buttons */}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant={activePlot?.start_image === currentImage ? "default" : "outline"}
              onClick={markStart}
              disabled={!currentImage}
            >
              <Flag className="w-4 h-4 mr-2 text-green-600" />
              Mark Start
            </Button>
            <Button
              className="flex-1"
              variant={activePlot?.end_image === currentImage ? "default" : "outline"}
              onClick={markEnd}
              disabled={!currentImage}
            >
              <FlagOff className="w-4 h-4 mr-2 text-red-600" />
              Mark End
            </Button>
          </div>

        </div>

        {/* ── Right: plot pager ── */}
        <div className="space-y-3">

          {/* Plot navigation + add/delete */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Plot</Label>
            <Input
              type="number"
              min={1}
              max={plots.length}
              value={plotNavInput}
              className="h-7 text-xs w-14"
              onChange={(e) => setPlotNavInput(e.target.value)}
              onBlur={() => applyNav(plotNavInput)}
              onKeyDown={(e) => { if (e.key === "Enter") applyNav(plotNavInput) }}
            />
            <span className="text-xs text-muted-foreground">/ {plots.length}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              title="Add plot (N)"
              onClick={addPlot}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:border-destructive"
              title="Delete current plot (D)"
              onClick={deletePlot}
              disabled={plots.length <= 1}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              {doneCount}/{plots.length} done
            </span>
          </div>

          {/* Plot pager */}
          <Card className="border-primary/40">
            <CardContent className="px-3 py-3 space-y-3">
              {/* Page header: ← Plot X / N → */}
              <div className="flex items-center justify-between gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setPlotPage((p) => Math.max(0, p - 1))}
                  disabled={plotPage === 0}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>

                <div className="flex items-center gap-1 flex-1 justify-center">
                  {activePlot?.start_image && activePlot?.end_image ? (
                    <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground shrink-0" />
                  )}
                  <span className="text-sm font-medium">
                    Plot {activePlot?.plot_id ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    / {plots.length}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setPlotPage((p) => Math.min(plots.length - 1, p + 1))}
                  disabled={plotPage === plots.length - 1}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              {/* Start/End */}
              {activePlot && (
                <>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-muted-foreground w-8 shrink-0">Start</Label>
                      <span className="text-xs font-mono truncate flex-1 min-w-0 text-green-700 dark:text-green-400">
                        {activePlot.start_image ?? "—"}
                      </span>
                      {activePlot.start_image && (
                        <>
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" title="Jump to" onClick={() => jumpTo(activePlot.start_image)}>
                            <ChevronRight className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive" title="Clear start" onClick={() => setPlots((prev) => prev.map((p, i) => i === plotPage ? { ...p, start_image: null } : p))}>
                            <X className="w-3 h-3" />
                          </Button>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-muted-foreground w-8 shrink-0">End</Label>
                      <span className="text-xs font-mono truncate flex-1 min-w-0 text-red-700 dark:text-red-400">
                        {activePlot.end_image ?? "—"}
                      </span>
                      {activePlot.end_image && (
                        <>
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" title="Jump to" onClick={() => jumpTo(activePlot.end_image)}>
                            <ChevronRight className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive" title="Clear end" onClick={() => setPlots((prev) => prev.map((p, i) => i === plotPage ? { ...p, end_image: null } : p))}>
                            <X className="w-3 h-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Direction</Label>
                    <Select
                      value={activePlot.direction}
                      onValueChange={setDirection}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DIRECTIONS.map((d) => (
                          <SelectItem key={d.value} value={d.value} className="text-xs">
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {/* Dot progress strip */}
              <div className="flex flex-wrap gap-1 pt-1">
                {plots.map((p, i) => (
                  <button
                    key={p.plot_id}
                    onClick={() => setPlotPage(i)}
                    className={`w-2.5 h-2.5 rounded-full border transition-colors ${
                      i === plotPage
                        ? "bg-primary border-primary"
                        : p.start_image && p.end_image
                        ? "bg-green-500 border-green-500"
                        : "bg-muted border-muted-foreground/30 hover:border-primary/50"
                    }`}
                    title={`Plot ${p.plot_id}`}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          {incomplete.length > 0 && (
            <p className="text-xs text-amber-600">
              {incomplete.length} plot{incomplete.length !== 1 ? "s" : ""} still need{incomplete.length === 1 ? "s" : ""} start/end marked.
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              Back
            </Button>
            <Button
              className="flex-1"
              disabled={!canSave || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
