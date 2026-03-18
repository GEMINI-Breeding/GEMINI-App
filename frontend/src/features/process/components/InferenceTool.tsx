/**
 * InferenceTool — configuration form + prediction viewer for the Inference step.
 *
 * Shows two sections:
 *  1. Config form  → read-only model list, version selectors, run/stop
 *  2. Results      → 2-column viewer: image+canvas overlay (left), controls (right)
 */

import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Settings,
  Square,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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

interface ImageInfo {
  name: string
  path: string
}

export interface ModelConfig {
  label: string
  roboflow_api_key: string
  roboflow_model_id: string
  task_type: string
}

export interface InferenceRunConfig {
  models: ModelConfig[]
  stitch_version?: number
  association_version?: number
  trait_version?: number
  inference_mode?: string
  local_server_url?: string
}

export interface StitchVersionOption {
  version: number
  name: string | null
}

export interface AssociationVersionOption {
  version: number
  stitch_version: number | null
  boundary_version: number | null
}

export interface TraitVersionOption {
  version: number
  ortho_version: number | null
  ortho_name: string | null
  boundary_version: number | null
  boundary_name: string | null
  plot_count: number
}

interface InferenceToolProps {
  runId: string
  inferenceComplete: boolean
  isRunning: boolean
  isStopping: boolean
  onRunInference: (config: InferenceRunConfig) => void
  onStop?: () => void
  onCancel: () => void
  initialModels?: ModelConfig[]
  inferenceMode?: string
  localServerUrl?: string
  stitchVersions?: StitchVersionOption[]
  associationVersions?: AssociationVersionOption[]
  traitVersions?: TraitVersionOption[]
}

// ── Class colours ─────────────────────────────────────────────────────────────

const CLASS_COLOURS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#DDA0DD",
]

function classColour(cls: string): string {
  let hash = 0
  for (let i = 0; i < cls.length; i++) hash = (hash * 31 + cls.charCodeAt(i)) | 0
  return CLASS_COLOURS[Math.abs(hash) % CLASS_COLOURS.length]
}

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace("#", "")
  const num = parseInt(c.length === 3 ? c.split("").map((ch) => ch + ch).join("") : c, 16)
  return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`
}

// ── Image viewer with canvas overlay, zoom/pan ────────────────────────────────

interface ImageViewerProps {
  image: ImageInfo
  predictions: Prediction[]
  hiddenClasses: Set<string>
  showMasks: boolean
}

function ImageViewer({ image, predictions, hiddenClasses, showMasks }: ImageViewerProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  // Reset on image change
  useEffect(() => {
    setZoom(1)
    setPanX(0)
    setPanY(0)
    setDims(null)
  }, [image.name])

  // Redraw canvas whenever anything relevant changes
  useEffect(() => {
    drawDetections()
  }, [dims, predictions, hiddenClasses, showMasks, zoom, panX, panY])

  function drawDetections() {
    const canvas = canvasRef.current
    const img = imgRef.current
    const container = containerRef.current
    if (!canvas || !img || !container || !dims) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const containerRect = container.getBoundingClientRect()
    const containerW = containerRect.width
    const containerH = containerRect.height

    // Compute display size of image (object-fit: contain)
    const imgAspect = dims.w / dims.h
    const cAspect = containerW / containerH
    let displayW: number, displayH: number
    if (imgAspect > cAspect) {
      displayW = containerW
      displayH = containerW / imgAspect
    } else {
      displayH = containerH
      displayW = containerH * imgAspect
    }

    const zoomedW = displayW * zoom
    const zoomedH = displayH * zoom
    const imgLeft = (containerW - zoomedW) / 2 + panX
    const imgTop = (containerH - zoomedH) / 2 + panY

    canvas.width = containerW
    canvas.height = containerH
    canvas.style.width = `${containerW}px`
    canvas.style.height = `${containerH}px`

    ctx.clearRect(0, 0, containerW, containerH)

    const scaleX = zoomedW / dims.w
    const scaleY = zoomedH / dims.h

    const filtered = predictions.filter((p) => !hiddenClasses.has(p.class))

    for (const pred of filtered) {
      const color = classColour(pred.class)
      const hasPoints = (pred.points?.length ?? 0) >= 3

      // Segmentation polygon
      if (showMasks && hasPoints) {
        ctx.beginPath()
        pred.points!.forEach((pt, idx) => {
          const px = pt.x * scaleX + imgLeft
          const py = pt.y * scaleY + imgTop
          if (idx === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
        ctx.closePath()
        ctx.fillStyle = hexToRgba(color, 0.25)
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = color
        ctx.stroke()
      }

      // Bounding box
      if (!hasPoints || !showMasks) {
        const x = (pred.x - pred.width / 2) * scaleX + imgLeft
        const y = (pred.y - pred.height / 2) * scaleY + imgTop
        const w = pred.width * scaleX
        const h = pred.height * scaleY
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, w, h)

        // Label
        const label = `${pred.class} ${(pred.confidence * 100).toFixed(0)}%`
        ctx.font = "11px monospace"
        const tw = ctx.measureText(label).width
        ctx.fillStyle = color
        ctx.fillRect(x, y - 16, tw + 6, 16)
        ctx.fillStyle = "#fff"
        ctx.fillText(label, x + 3, y - 3)
      }
    }
  }

  function handleLoad() {
    const el = imgRef.current
    if (el) setDims({ w: el.naturalWidth, h: el.naturalHeight })
  }

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25
    setZoom((z) => {
      const newZ = Math.max(1, Math.min(10, z * factor))
      if (newZ === 1) { setPanX(0); setPanY(0) }
      else {
        const scale = newZ / z
        setPanX((px) => cx - (cx - px) * scale)
        setPanY((py) => cy - (cy - py) * scale)
      }
      return newZ
    })
  }, [])

  function handleMouseDown(e: React.MouseEvent) {
    if (zoom <= 1) return
    e.preventDefault()
    setIsDragging(true)
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: panX, startPanY: panY }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return
    e.preventDefault()
    setPanX(dragRef.current.startPanX + e.clientX - dragRef.current.startX)
    setPanY(dragRef.current.startPanY + e.clientY - dragRef.current.startY)
  }

  function handleMouseUp() {
    dragRef.current = null
    setIsDragging(false)
  }

  function fitScreen() { setZoom(1); setPanX(0); setPanY(0) }
  function zoomIn() {
    setZoom((z) => Math.min(10, z * 1.25))
  }
  function zoomOut() {
    setZoom((z) => {
      const nz = Math.max(1, z / 1.25)
      if (nz === 1) { setPanX(0); setPanY(0) }
      return nz
    })
  }

  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  const src = base
    ? `${base}/api/v1/files/serve?path=${encodeURIComponent(image.path)}`
    : `/api/v1/files/serve?path=${encodeURIComponent(image.path)}`

  return (
    <div className="space-y-1">
      {/* Zoom toolbar */}
      <div className="flex items-center gap-1 justify-end">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomOut} disabled={zoom <= 1}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground w-12 text-center font-mono">
          {Math.round(zoom * 100)}%
        </span>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomIn} disabled={zoom >= 10}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={fitScreen} disabled={zoom === 1} title="Fit to view">
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Image container */}
      <div
        ref={containerRef}
        className="relative w-full rounded border overflow-hidden bg-muted/20"
        style={{
          height: 480,
          cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default",
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          ref={imgRef}
          src={src}
          alt={image.name}
          draggable={false}
          onLoad={handleLoad}
          style={{
            position: "absolute",
            maxWidth: "100%",
            maxHeight: "100%",
            top: "50%",
            left: "50%",
            transform: `translate(-50%, -50%) scale(${zoom}) translate(${panX / zoom}px, ${panY / zoom}px)`,
            transformOrigin: "center",
            objectFit: "contain",
            userSelect: "none",
          }}
        />
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", zIndex: 10 }}
        />
      </div>
      {zoom > 1 && (
        <p className="text-xs text-muted-foreground">Scroll to zoom · drag to pan</p>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

const apiUrl = (path: string) => {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

export function InferenceTool({
  runId,
  inferenceComplete,
  isRunning,
  isStopping,
  onRunInference,
  onStop,
  onCancel,
  initialModels,
  inferenceMode,
  localServerUrl,
  stitchVersions,
  associationVersions,
  traitVersions,
}: InferenceToolProps) {
  const [imageIdx, setImageIdx] = useState(0)
  const [activeModel, setActiveModel] = useState<string | undefined>(undefined)
  // 0–100 integer threshold applied client-side; API always returns at confidence ≥ 0.1
  const [confThreshold, setConfThreshold] = useState(50)
  const [hiddenClasses, setHiddenClasses] = useState<Set<string>>(new Set())
  const [showMasks, setShowMasks] = useState(true)
  // Traits output state
  const [selectedTraitsModel, setSelectedTraitsModel] = useState<string>("")
  const [traitsThreshold, setTraitsThreshold] = useState(50)
  const [traitsStatus, setTraitsStatus] = useState<{ loading: boolean; message: string | null }>({ loading: false, message: null })
  const [logLines, setLogLines] = useState<string[]>([])
  const [logTotal, setLogTotal] = useState<number | null>(null)
  const [logDone, setLogDone] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)

  const [selectedStitchVersion, setSelectedStitchVersion] = useState<number | undefined>(
    stitchVersions?.[0]?.version
  )
  const [selectedAssocVersion, setSelectedAssocVersion] = useState<number | undefined>(
    associationVersions?.[0]?.version
  )
  const [selectedTraitVersion, setSelectedTraitVersion] = useState<number | undefined>(
    traitVersions?.[0]?.version
  )

  const configuredModels = (initialModels ?? []).filter((m) => m.roboflow_model_id.trim())
  const isGround = (stitchVersions?.length ?? 0) > 0 || (associationVersions?.length ?? 0) > 0
  const isAerial = (traitVersions?.length ?? 0) > 0

  async function handleApplyThreshold() {
    const label = selectedTraitsModel || availableModels[0] || null
    setTraitsStatus({ loading: true, message: null })
    try {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/apply-inference-threshold`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confidence_threshold: traitsThreshold / 100, label }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setTraitsStatus({ loading: false, message: `Error: ${(err as any).detail ?? res.statusText}` })
      } else {
        const data = await res.json()
        const applied = (data.applied as string[]).join(", ")
        setTraitsStatus({ loading: false, message: `Applied ${traitsThreshold}% → ${applied}` })
      }
    } catch (e) {
      setTraitsStatus({ loading: false, message: `Error: ${String(e)}` })
    }
  }

  function handleRun() {
    if (!configuredModels.length) return
    onRunInference({
      models: configuredModels,
      stitch_version: selectedStitchVersion,
      association_version: selectedAssocVersion,
      trait_version: selectedTraitVersion,
      inference_mode: inferenceMode ?? "cloud",
      local_server_url: inferenceMode === "local" ? localServerUrl : undefined,
    })
  }

  // SSE subscription for inline logs + process panel progress
  useEffect(() => {
    if (!isRunning) return
    setLogLines([])
    setLogTotal(null)
    setLogDone(0)
    const es = new EventSource(apiUrl(`/api/v1/pipeline-runs/${runId}/progress`))
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.event === "log" && data.message) {
          setLogLines((prev) => [...prev, data.message])
          if (data.total != null) setLogTotal(data.total)
          if (data.done != null) setLogDone(data.done)
        }
        // progress events keep the bar in sync even if log events arrive out of order
        if (data.event === "progress" && typeof data.progress === "number") {
          setLogDone((prev) => {
            if (logTotal != null) return Math.round(data.progress / 100 * logTotal)
            return prev
          })
        }
      } catch {}
    }
    return () => es.close()
  }, [isRunning, runId])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

  const { data, isLoading } = useQuery({
    queryKey: ["inference-results", runId, activeModel],
    queryFn: async () => {
      const modelParam = activeModel ? `?model=${encodeURIComponent(activeModel)}` : ""
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/inference-results${modelParam}`))
      if (!res.ok) return {}
      return res.json()
    },
    enabled: inferenceComplete && !isRunning,
  })

  const predictions: Prediction[] = (data as any)?.predictions ?? []
  const images: ImageInfo[] = (data as any)?.images ?? []
  const available: boolean = (data as any)?.available ?? false
  const availableModels: string[] = (data as any)?.models ?? []
  const currentModelLabel: string = (data as any)?.active_model ?? ""

  const hasSegmentation = predictions.some((p) => (p.points?.length ?? 0) >= 3)

  // All unique classes across loaded predictions
  const allClasses = [...new Set(predictions.map((p) => p.class))].sort()

  // Reset viewer & filters when model changes
  useEffect(() => { setImageIdx(0) }, [images.length, activeModel])
  useEffect(() => { setHiddenClasses(new Set()); setShowMasks(true) }, [currentModelLabel])

  const currentImage = images[imageIdx] ?? null

  // Predictions visible given current filters
  const visiblePreds = predictions.filter(
    (p) => p.confidence >= confThreshold / 100 && !hiddenClasses.has(p.class)
  )
  const currentPreds = currentImage
    ? visiblePreds.filter((p) => p.image === currentImage.name)
    : []

  // Per-class counts for the current image
  const currentClassCounts: Record<string, number> = {}
  if (currentImage) {
    for (const p of predictions.filter((p) => p.image === currentImage.name)) {
      currentClassCounts[p.class] = (currentClassCounts[p.class] ?? 0) + 1
    }
  }

  function toggleClass(cls: string) {
    setHiddenClasses((prev) => {
      const next = new Set(prev)
      if (next.has(cls)) next.delete(cls)
      else next.add(cls)
      return next
    })
  }

  // Keyboard navigation
  useEffect(() => {
    if (!inferenceComplete || isRunning || images.length === 0) return
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (e.key === "ArrowLeft") setImageIdx((i) => Math.max(0, i - 1))
      if (e.key === "ArrowRight") setImageIdx((i) => Math.min(images.length - 1, i + 1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [inferenceComplete, isRunning, images.length])

  return (
    <div className="space-y-6">
      {/* Configured models (read-only) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Models</p>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Settings className="w-3 h-3" />
            Configure in pipeline settings
          </span>
        </div>
        {configuredModels.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
            No models configured. Open pipeline settings to add Roboflow models.
          </p>
        ) : (
          <div className="rounded-md border divide-y">
            {configuredModels.map((m, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium">{m.label || m.roboflow_model_id}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">{m.roboflow_model_id}</span>
                  <Badge variant="outline" className="text-xs">{m.task_type}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Mode:{" "}
          <span className="font-medium">
            {inferenceMode === "local"
              ? `Local (${localServerUrl ?? "http://localhost:9001"})`
              : "Cloud (Roboflow)"}
          </span>
        </p>
      </div>

      {/* Version selectors */}
      {isGround && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Input Versions</p>
          <div className="grid grid-cols-2 gap-3">
            {(stitchVersions?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Stitch Version</Label>
                <select
                  className="border-input bg-background w-full rounded border px-2 py-1.5 text-sm"
                  value={selectedStitchVersion ?? ""}
                  onChange={(e) => setSelectedStitchVersion(Number(e.target.value))}
                >
                  {stitchVersions!.map((sv) => (
                    <option key={sv.version} value={sv.version}>
                      {sv.name ? `${sv.name} (v${sv.version})` : `v${sv.version}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(associationVersions?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Association Version</Label>
                <select
                  className="border-input bg-background w-full rounded border px-2 py-1.5 text-sm"
                  value={selectedAssocVersion ?? ""}
                  onChange={(e) => setSelectedAssocVersion(Number(e.target.value))}
                >
                  {associationVersions!.map((av) => (
                    <option key={av.version} value={av.version}>
                      v{av.version} (stitch v{av.stitch_version ?? "?"} · boundary v{av.boundary_version ?? "?"})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {isAerial && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground mb-2">Input Versions</p>
          <Label className="text-xs">Trait Extraction Version</Label>
          <select
            className="border-input bg-background w-full rounded border px-2 py-1.5 text-sm"
            value={selectedTraitVersion ?? ""}
            onChange={(e) => setSelectedTraitVersion(Number(e.target.value))}
          >
            {traitVersions!.map((tv) => {
              const ortho = tv.ortho_name ? `${tv.ortho_name} (v${tv.ortho_version ?? "?"})` : `ortho v${tv.ortho_version ?? "?"}`
              const boundary = tv.boundary_version != null
                ? (tv.boundary_name ? `${tv.boundary_name} (v${tv.boundary_version})` : `boundary v${tv.boundary_version}`)
                : "canonical boundary"
              return (
                <option key={tv.version} value={tv.version}>
                  v{tv.version} — {ortho} · {boundary} · {tv.plot_count} plots
                </option>
              )
            })}
          </select>
        </div>
      )}

      {/* Run / Stop */}
      <div>
        {isRunning ? (
          <Button variant="destructive" disabled={isStopping} onClick={onStop}>
            {isStopping
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Stopping…</>
              : <><Square className="w-4 h-4 mr-2" />Stop</>}
          </Button>
        ) : (
          <Button disabled={!configuredModels.length} onClick={handleRun}>
            {inferenceComplete ? "Re-run Inference" : "Run Inference"}
          </Button>
        )}
      </div>

      {/* Inline log panel */}
      {(isRunning || logLines.length > 0) && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              {isRunning ? "Running…" : "Last run log"}
              {logTotal != null && logTotal > 0 && (
                <span className="ml-2 font-mono">{logDone}/{logTotal}</span>
              )}
            </p>
            {isRunning && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
          </div>
          {logTotal != null && logTotal > 0 && (
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${Math.round((logDone / logTotal) * 100)}%` }}
              />
            </div>
          )}
          <div
            ref={logRef}
            className="rounded-md border bg-muted/40 p-2 h-40 overflow-y-auto font-mono text-xs space-y-0.5"
          >
            {logLines.length === 0 ? (
              <span className="text-muted-foreground">Waiting for output…</span>
            ) : (
              logLines.map((line, i) => (
                <div key={i} className="leading-relaxed text-foreground/80">{line}</div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {inferenceComplete && !isRunning && (
        <>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading results…
            </div>
          ) : !available ? (
            <p className="text-sm text-muted-foreground">No prediction results found.</p>
          ) : (
            <div className="space-y-4">
              {/* Model selector */}
              {availableModels.length > 1 ? (
                <Select value={currentModelLabel} onValueChange={setActiveModel}>
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                </SelectContent>
                </Select>
              ) : (
                <h3 className="font-medium">{currentModelLabel}</h3>
              )}

              {/* 2-column layout: image (left) + controls (right) */}
              <div className="grid grid-cols-[1fr_280px] gap-4 items-start">

                {/* ── Left: image + navigation ── */}
                <div className="space-y-2">
                  {/* Navigation row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline" size="icon" className="h-7 w-7"
                        onClick={() => setImageIdx((i) => Math.max(0, i - 1))}
                        disabled={imageIdx === 0}
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </Button>
                      <span className="text-xs text-muted-foreground font-mono">
                        {imageIdx + 1} / {images.length}
                      </span>
                      <Button
                        variant="outline" size="icon" className="h-7 w-7"
                        onClick={() => setImageIdx((i) => Math.min(images.length - 1, i + 1))}
                        disabled={imageIdx === images.length - 1}
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    {/* Plot dropdown */}
                    <select
                      className="border-input bg-background rounded border px-2 py-1 text-xs flex-1 min-w-0 max-w-xs"
                      value={currentImage?.name ?? ""}
                      onChange={(e) => {
                        const idx = images.findIndex((im) => im.name === e.target.value)
                        if (idx >= 0) setImageIdx(idx)
                      }}
                    >
                      {images.map((im) => (
                        <option key={im.name} value={im.name}>
                          {im.name} ({(predictions.filter((p) => p.image === im.name && p.confidence >= confThreshold / 100).length)} det)
                        </option>
                      ))}
                    </select>

                    <span className="text-xs text-muted-foreground shrink-0">← → to navigate</span>
                  </div>

                  {currentImage && (
                    <ImageViewer
                      image={currentImage}
                      predictions={currentPreds}
                      hiddenClasses={hiddenClasses}
                      showMasks={showMasks}
                    />
                  )}
                </div>

                {/* ── Right: controls panel ── */}
                <div className="space-y-5 rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-semibold mb-3">Detection Controls</p>

                    {/* Confidence threshold */}
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Confidence threshold</Label>
                        <span className="text-xs font-mono font-medium">{confThreshold}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={confThreshold}
                        onChange={(e) => setConfThreshold(Number(e.target.value))}
                        className="w-full h-1.5 accent-primary"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>0%</span>
                        <span>50%</span>
                        <span>100%</span>
                      </div>
                    </div>

                    {/* Mask/box toggle (only shown when segmentation exists) */}
                    {hasSegmentation && (
                      <div className="flex items-center justify-between mb-4">
                        <Label className="text-xs">Show masks</Label>
                        <button
                          onClick={() => setShowMasks((v) => !v)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showMasks ? "bg-primary" : "bg-muted"}`}
                        >
                          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${showMasks ? "translate-x-4" : "translate-x-0"}`} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Class legend */}
                  {allClasses.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold">Classes</p>
                      <div className="space-y-1.5">
                        {allClasses.map((cls) => {
                          const isHidden = hiddenClasses.has(cls)
                          const count = currentClassCounts[cls] ?? 0
                          const color = classColour(cls)
                          return (
                            <button
                              key={cls}
                              onClick={() => toggleClass(cls)}
                              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-opacity hover:bg-muted/50 ${isHidden ? "opacity-40" : "opacity-100"}`}
                            >
                              <span
                                className="inline-block h-3 w-3 shrink-0 rounded-sm border"
                                style={{ background: color, borderColor: color }}
                              />
                              <span className="flex-1 text-left font-medium">{cls}</span>
                              <span className="font-mono text-muted-foreground">{count}</span>
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">Click to toggle visibility</p>
                    </div>
                  )}

                  {/* Detection summary */}
                  <div className="space-y-1 border-t pt-4">
                    <p className="text-xs font-semibold mb-2">This plot</p>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total detections</span>
                        <span className="font-mono">{currentImage ? predictions.filter((p) => p.image === currentImage.name).length : 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Above threshold</span>
                        <span className="font-mono">{currentPreds.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Classes</span>
                        <span className="font-mono">{allClasses.length - hiddenClasses.size} / {allClasses.length}</span>
                      </div>
                    </div>
                    <div className="border-t mt-2 pt-2 space-y-1 text-xs">
                      <p className="text-xs font-semibold mb-1">All plots</p>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total detections</span>
                        <span className="font-mono">{visiblePreds.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Plots</span>
                        <span className="font-mono">{images.length}</span>
                      </div>
                    </div>
                  </div>

                  {/* Traits output */}
                  <div className="border-t pt-4 space-y-2">
                    <p className="text-xs font-semibold">Traits Output</p>
                    {availableModels.length > 1 && (
                      <select
                        className="border-input bg-background w-full rounded border px-2 py-1 text-xs"
                        value={selectedTraitsModel || availableModels[0]}
                        onChange={(e) => { setSelectedTraitsModel(e.target.value); setTraitsStatus({ loading: false, message: null }) }}
                      >
                        {availableModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={traitsThreshold}
                        onChange={(e) => { setTraitsThreshold(Number(e.target.value)); setTraitsStatus({ loading: false, message: null }) }}
                        className="flex-1 h-1.5 accent-primary"
                      />
                      <span className="text-xs font-mono w-8 text-right shrink-0">{traitsThreshold}%</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full h-7 text-xs"
                      disabled={traitsStatus.loading}
                      onClick={handleApplyThreshold}
                    >
                      {traitsStatus.loading
                        ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Applying…</>
                        : `Apply ${traitsThreshold}%`}
                    </Button>
                    {traitsStatus.message && (
                      <p className={`text-xs ${traitsStatus.message.startsWith("Error") ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                        {traitsStatus.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}


      {/* Close */}
      <div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Close
        </Button>
      </div>
    </div>
  )
}
