/**
 * InferenceTool — configuration form + prediction viewer for the Inference step.
 *
 * Shows two sections:
 *  1. Config form  → read-only model list, version selectors, run/stop
 *  2. Results      → 2-column viewer: image+canvas overlay (left), controls (right)
 *
 * Controls panel sections are collapsible.
 * Results can be expanded to fullscreen via the ExpandButton in the nav bar.
 */

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Square,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
import {
  useExpandable,
  ExpandButton,
  FullscreenModal,
} from "@/components/Common/ExpandableSection"
import { cn } from "@/lib/utils"
import { openUrl } from "@/lib/platform"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { UtilsService } from "@/client"

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
  plot?: string
  row?: string
  col?: string
  accession?: string
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

// ── Client-side NMS ───────────────────────────────────────────────────────────

function calcIou(a: Prediction, b: Prediction): number {
  const ax0 = a.x - a.width / 2, ay0 = a.y - a.height / 2
  const ax1 = a.x + a.width / 2, ay1 = a.y + a.height / 2
  const bx0 = b.x - b.width / 2, by0 = b.y - b.height / 2
  const bx1 = b.x + b.width / 2, by1 = b.y + b.height / 2
  const ix0 = Math.max(ax0, bx0), iy0 = Math.max(ay0, by0)
  const ix1 = Math.min(ax1, bx1), iy1 = Math.min(ay1, by1)
  if (ix1 <= ix0 || iy1 <= iy0) return 0
  const inter = (ix1 - ix0) * (iy1 - iy0)
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}

function applyNms(preds: Prediction[], iouThresh: number): Prediction[] {
  if (iouThresh >= 1.0) return preds
  const byClass: Record<string, Prediction[]> = {}
  for (const p of preds) { (byClass[p.class] ??= []).push(p) }
  const kept: Prediction[] = []
  for (const classPreds of Object.values(byClass)) {
    let remaining = [...classPreds].sort((a, b) => b.confidence - a.confidence)
    while (remaining.length > 0) {
      const best = remaining.shift()!
      kept.push(best)
      remaining = remaining.filter((p) => calcIou(best, p) < iouThresh)
    }
  }
  return kept
}

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace("#", "")
  const num = parseInt(c.length === 3 ? c.split("").map((ch) => ch + ch).join("") : c, 16)
  return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`
}

// ── Collapsible section header ────────────────────────────────────────────────

function SectionHeader({
  label,
  open,
  onToggle,
}: {
  label: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between text-xs font-semibold py-0.5 hover:text-foreground/80 transition-colors"
      onClick={onToggle}
    >
      {label}
      <ChevronDown
        className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform duration-150", open && "rotate-180")}
      />
    </button>
  )
}

// ── Image viewer with canvas overlay, zoom/pan ────────────────────────────────

interface ImageViewerProps {
  image: ImageInfo
  predictions: Prediction[]
  hiddenClasses: Set<string>
  showMasks: boolean
  showLabels: boolean
  /** When true, uses a taller image area (fullscreen mode) */
  fullscreen?: boolean
}

function ImageViewer({ image, predictions, hiddenClasses, showMasks, showLabels, fullscreen }: ImageViewerProps) {
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
  }, [dims, predictions, hiddenClasses, showMasks, showLabels, zoom, panX, panY])

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
        if (showLabels) {
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
  function zoomIn() { setZoom((z) => Math.min(10, z * 1.25)) }
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

  const containerHeight = fullscreen ? "calc(100vh - 160px)" : 640

  return (
    <div className="space-y-1">
      {/* Zoom toolbar */}
      <div className="flex items-center gap-1 justify-end">
        <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={zoomOut} disabled={zoom <= 1}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground w-12 text-center font-mono">
          {Math.round(zoom * 100)}%
        </span>
        <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={zoomIn} disabled={zoom >= 10}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={fitScreen} disabled={zoom === 1} title="Fit to view">
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Image container */}
      <div
        ref={containerRef}
        className="relative w-full rounded border overflow-hidden bg-muted/20"
        style={{
          height: containerHeight,
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
  const queryClient = useQueryClient()
  const [imageIdx, setImageIdx] = useState(0)
  const [activeModel, setActiveModel] = useState<string | undefined>(undefined)
  // 0–100 integer threshold applied client-side; API always returns at confidence ≥ 0.1
  const [confThreshold, setConfThreshold] = useState(50)
  // Plot metadata filters
  const [filterCol, setFilterCol] = useState("")
  const [filterRow, setFilterRow] = useState("")
  const [filterAccession, setFilterAccession] = useState("")
  const [filterPlot, setFilterPlot] = useState("")
  const [hiddenClasses, setHiddenClasses] = useState<Set<string>>(new Set())
  const [showMasks, setShowMasks] = useState(true)
  // Traits output state
  const [selectedTraitsModel, setSelectedTraitsModel] = useState<string>("")
  const [traitsThreshold, setTraitsThreshold] = useState(50)
  const [iouThreshold, setIouThreshold] = useState(50)
  const thresholdInitialized = useRef(false)
  const [showLabels, setShowLabels] = useState(true)
  const [traitsStatus, setTraitsStatus] = useState<{ loading: boolean; message: string | null }>({ loading: false, message: null })
  const [logLines, setLogLines] = useState<string[]>([])
  const [logTotal, setLogTotal] = useState<number | null>(null)
  const [showDockerDialog, setShowDockerDialog] = useState(false)
  const [dockerDenied, setDockerDenied] = useState(false)
  const [logDone, setLogDone] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)

  // Collapsible section states
  const [showFilters, setShowFilters] = useState(true)
  const [showDetectionControls, setShowDetectionControls] = useState(true)
  const [showClasses, setShowClasses] = useState(true)
  const [showStats, setShowStats] = useState(true)
  const [showTraitsOutput, setShowTraitsOutput] = useState(false)

  const [selectedStitchVersion, setSelectedStitchVersion] = useState<number | undefined>(
    stitchVersions?.[0]?.version
  )
  const [selectedAssocVersion, setSelectedAssocVersion] = useState<number | undefined>(
    associationVersions?.[0]?.version
  )
  const [selectedTraitVersion, setSelectedTraitVersion] = useState<number | undefined>(
    traitVersions?.[0]?.version
  )

  // Expand / fullscreen
  const exp = useExpandable()
  const [showControls, setShowControls] = useState(true)

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
        setTraitsStatus({ loading: false, message: `Applied conf=${traitsThreshold}% iou=${iouThreshold}% → ${applied}` })
        queryClient.invalidateQueries({ queryKey: ["inference-summary", runId] })
      }
    } catch (e) {
      setTraitsStatus({ loading: false, message: `Error: ${String(e)}` })
    }
  }

  async function handleRun() {
    if (!configuredModels.length) return
    if (inferenceMode === "local") {
      try {
        const result = await UtilsService.dockerCheck()
        if (!result.available) {
          setDockerDenied((result as any).reason === "permission_denied")
          setShowDockerDialog(true)
          return
        }
      } catch {
        // If the check fails, proceed — the backend will surface Docker errors via SSE
      }
    }
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

  // Fetch inference summary to restore the previously applied threshold
  const { data: summaryData } = useQuery({
    queryKey: ["inference-summary", runId],
    queryFn: async () => {
      const token = localStorage.getItem("access_token") || ""
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/inference-summary`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) return []
      return res.json() as Promise<Array<{ confidence_threshold?: number | null }>>
    },
    enabled: inferenceComplete,
    staleTime: 30_000,
  })

  // Seed the traits threshold slider from the last applied threshold (runs once)
  useEffect(() => {
    if (thresholdInitialized.current) return
    const entries: Array<{ confidence_threshold?: number | null }> = summaryData ?? []
    const stored = entries.find((e) => e.confidence_threshold != null)?.confidence_threshold
    if (stored != null) {
      const pct = Math.round(stored * 100)
      setTraitsThreshold(pct)
      setConfThreshold(pct)
      thresholdInitialized.current = true
    }
  }, [summaryData])

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

  // Check if any plot metadata exists
  const hasPlotMeta = images.some((im) => im.row || im.col || im.accession || im.plot)

  // Apply metadata filters
  const filteredImages = hasPlotMeta ? images.filter((im) => {
    if (filterCol && !(im.col ?? "").toLowerCase().includes(filterCol.toLowerCase())) return false
    if (filterRow && !(im.row ?? "").toLowerCase().includes(filterRow.toLowerCase())) return false
    if (filterAccession && !(im.accession ?? "").toLowerCase().includes(filterAccession.toLowerCase())) return false
    if (filterPlot && !(im.plot ?? im.name).toLowerCase().includes(filterPlot.toLowerCase())) return false
    return true
  }) : images

  // Reset viewer & filters when model changes
  useEffect(() => { setImageIdx(0) }, [images.length, activeModel])
  useEffect(() => { setHiddenClasses(new Set()); setShowMasks(true) }, [currentModelLabel])
  // Reset index when filter narrows results
  useEffect(() => { setImageIdx(0) }, [filteredImages.length])

  const currentImage = filteredImages[imageIdx] ?? null

  // Predictions visible given current filters + client-side NMS (display-only, never modifies stored data)
  const visiblePreds = useMemo(() => {
    const confFiltered = predictions.filter(
      (p) => p.confidence >= confThreshold / 100 && !hiddenClasses.has(p.class)
    )
    if (iouThreshold >= 100) return confFiltered
    const byImage: Record<string, Prediction[]> = {}
    for (const p of confFiltered) { (byImage[p.image] ??= []).push(p) }
    return Object.values(byImage).flatMap((preds) => applyNms(preds, iouThreshold / 100))
  }, [predictions, confThreshold, hiddenClasses, iouThreshold])
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

  const filteredImagesLenRef = useRef(0)
  filteredImagesLenRef.current = filteredImages.length

  // Keyboard navigation
  useEffect(() => {
    if (!inferenceComplete || isRunning || images.length === 0) return
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (e.key === "ArrowLeft") setImageIdx((i) => Math.max(0, i - 1))
      if (e.key === "ArrowRight") setImageIdx((i) => Math.min(filteredImagesLenRef.current - 1, i + 1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [inferenceComplete, isRunning, images.length])

  // ── Navigation bar ────────────────────────────────────────────────────────

  const navBar = (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline" size="icon" className="h-7 w-7"
        onClick={() => setImageIdx((i) => Math.max(0, i - 1))}
        disabled={imageIdx <= 0}
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </Button>
      <span className="text-xs text-muted-foreground font-mono shrink-0">
        {imageIdx + 1} / {filteredImages.length}
        {filteredImages.length !== images.length && (
          <span className="text-muted-foreground/60"> (of {images.length})</span>
        )}
      </span>
      <Button
        type="button"
        variant="outline" size="icon" className="h-7 w-7"
        onClick={() => setImageIdx((i) => Math.min(filteredImages.length - 1, i + 1))}
        disabled={filteredImages.length === 0 || imageIdx >= filteredImages.length - 1}
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </Button>
      <select
        className="border-input bg-background rounded border px-2 py-1 text-xs flex-1 min-w-0"
        value={currentImage?.name ?? ""}
        onChange={(e) => {
          const idx = filteredImages.findIndex((im) => im.name === e.target.value)
          if (idx >= 0) setImageIdx(idx)
        }}
      >
        {filteredImages.map((im) => {
          const detCount = visiblePreds.filter((p) => p.image === im.name).length
          const parts: string[] = []
          if (im.plot) parts.push(`Plot ${im.plot}`)
          if (im.col) parts.push(`Col ${im.col}`)
          if (im.row) parts.push(`Row ${im.row}`)
          if (im.accession) parts.push(im.accession)
          const label = parts.length > 0 ? parts.join(" · ") : im.name
          return (
            <option key={im.name} value={im.name}>
              {label} ({detCount} det)
            </option>
          )
        })}
      </select>
      <span className="text-xs text-muted-foreground shrink-0">← → keys</span>
      {/* Expand button — opens results in fullscreen */}
      <ExpandButton onClick={exp.open} title="Expand viewer to fullscreen" />
      {/* Toggle controls panel */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title={showControls ? "Hide controls panel" : "Show controls panel"}
        onClick={() => setShowControls((v) => !v)}
      >
        {showControls
          ? <PanelRightClose className="h-4 w-4" />
          : <PanelRightOpen className="h-4 w-4" />}
      </Button>
    </div>
  )

  // ── Controls panel ────────────────────────────────────────────────────────

  const controlsPanel = (
    <div className="space-y-3 rounded-lg border p-4">

      {/* Filter plots */}
      {hasPlotMeta && (
        <div className="space-y-1.5">
          <SectionHeader label="Filter Plots" open={showFilters} onToggle={() => setShowFilters(v => !v)} />
          {showFilters && (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { label: "Column", value: filterCol, set: setFilterCol, placeholder: "e.g. 1" },
                  { label: "Row", value: filterRow, set: setFilterRow, placeholder: "e.g. 3" },
                  { label: "Accession", value: filterAccession, set: setFilterAccession, placeholder: "Search…" },
                  { label: "Plot", value: filterPlot, set: setFilterPlot, placeholder: "e.g. 101" },
                ] as const).map(({ label, value, set, placeholder }) => (
                  <div key={label}>
                    <label className="text-xs text-muted-foreground">{label}</label>
                    <input
                      type="text"
                      className="border-input bg-background w-full rounded border px-2 py-1 text-xs mt-0.5"
                      placeholder={placeholder}
                      value={value}
                      onChange={(e) => set(e.target.value)}
                    />
                  </div>
                ))}
              </div>
              {(filterCol || filterRow || filterAccession || filterPlot) && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => { setFilterCol(""); setFilterRow(""); setFilterAccession(""); setFilterPlot("") }}
                >
                  Clear filters
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Detection controls */}
      <div className="space-y-2">
        <SectionHeader label="Detection Controls" open={showDetectionControls} onToggle={() => setShowDetectionControls(v => !v)} />
        {showDetectionControls && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Confidence</Label>
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
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Overlap Threshold</Label>
                <span className="text-xs font-mono font-medium">{iouThreshold}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={iouThreshold}
                onChange={(e) => setIouThreshold(Number(e.target.value))}
                className="w-full h-1.5 accent-primary"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Show labels</Label>
              <button
                type="button"
                onClick={() => setShowLabels((v) => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showLabels ? "bg-primary" : "bg-muted"}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${showLabels ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </div>
            {hasSegmentation && (
              <div className="flex items-center justify-between">
                <Label className="text-xs">Show masks</Label>
                <button
                  type="button"
                  onClick={() => setShowMasks((v) => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showMasks ? "bg-primary" : "bg-muted"}`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${showMasks ? "translate-x-4" : "translate-x-0"}`} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Class legend */}
      {allClasses.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader label="Classes" open={showClasses} onToggle={() => setShowClasses(v => !v)} />
          {showClasses && (
            <>
              <div className="space-y-1">
                {allClasses.map((cls) => {
                  const isHidden = hiddenClasses.has(cls)
                  const count = currentClassCounts[cls] ?? 0
                  const color = classColour(cls)
                  return (
                    <button
                      type="button"
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
            </>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="space-y-1.5">
        <SectionHeader label="Stats" open={showStats} onToggle={() => setShowStats(v => !v)} />
        {showStats && (
          <div className="border-t pt-2 grid grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <p className="font-semibold">This plot</p>
              <div className="flex justify-between text-muted-foreground">
                <span>Detections</span>
                <span className="font-mono">{currentImage ? predictions.filter((p) => p.image === currentImage.name).length : 0}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Above threshold</span>
                <span className="font-mono">{currentPreds.length}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Classes</span>
                <span className="font-mono">{allClasses.length - hiddenClasses.size}/{allClasses.length}</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="font-semibold">All plots</p>
              <div className="flex justify-between text-muted-foreground">
                <span>Detections</span>
                <span className="font-mono">
                  {visiblePreds.filter((p) => filteredImages.some((im) => im.name === p.image)).length}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Shown</span>
                <span className="font-mono">
                  {filteredImages.length}
                  {filteredImages.length !== images.length && (
                    <span className="text-muted-foreground/60">/{images.length}</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Traits output */}
      <div className="space-y-2 border-t pt-2">
        <SectionHeader label="Traits Output" open={showTraitsOutput} onToggle={() => setShowTraitsOutput(v => !v)} />
        {showTraitsOutput && (
          <>
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
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Confidence</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={traitsThreshold}
                  onChange={(e) => { const v = Number(e.target.value); setTraitsThreshold(v); setConfThreshold(v); setTraitsStatus({ loading: false, message: null }) }}
                  className="flex-1 h-1.5 accent-primary"
                />
                <span className="text-xs font-mono w-8 text-right shrink-0">{traitsThreshold}%</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Overlap Threshold</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={iouThreshold}
                  onChange={(e) => { setIouThreshold(Number(e.target.value)); setTraitsStatus({ loading: false, message: null }) }}
                  className="flex-1 h-1.5 accent-primary"
                />
                <span className="text-xs font-mono w-8 text-right shrink-0">{iouThreshold}%</span>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs"
              disabled={traitsStatus.loading}
              onClick={handleApplyThreshold}
            >
              {traitsStatus.loading
                ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Applying…</>
                : `Apply`}
            </Button>
            {traitsStatus.message && (
              <p className={`text-xs ${traitsStatus.message.startsWith("Error") ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                {traitsStatus.message}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )

  // ── Results grid (shared between inline and fullscreen) ────────────────────

  function ResultsGrid({ fullscreen }: { fullscreen?: boolean }) {
    return (
      <div className={cn(
        "grid gap-4 items-start",
        showControls
          ? fullscreen
            ? "grid-cols-[1fr_320px] p-4 h-full"
            : "grid-cols-[1fr_300px]"
          : "grid-cols-[1fr]"
      )}>
        {/* Left: image + navigation */}
        <div className="space-y-2">
          {navBar}
          {currentImage && (
            <ImageViewer
              key={currentImage.name}
              image={currentImage}
              predictions={currentPreds}
              hiddenClasses={hiddenClasses}
              showMasks={showMasks}
              showLabels={showLabels}
              fullscreen={fullscreen}
            />
          )}
        </div>
        {/* Right: controls (collapsible) */}
        {showControls && controlsPanel}
      </div>
    )
  }

  return (
    <>
    <div className="space-y-4">

      {/* ── Config row: two cards + actions ── */}
      <div className="flex items-stretch gap-4">

        {/* Models card */}
        <div className="flex-1 rounded-lg border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Models</p>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Settings className="w-3 h-3" />Configure in pipeline settings
            </span>
          </div>
          {configuredModels.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded border border-dashed p-2">
              No models configured. Open pipeline settings to add Roboflow models.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {configuredModels.map((m, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1.5">
                  <span className="text-xs font-medium">{m.label || m.roboflow_model_id}</span>
                  <Badge variant="outline" className="text-xs h-4">{m.task_type}</Badge>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Mode:{" "}
            <span className="font-medium">
              {inferenceMode === "local"
                ? `Local (${localServerUrl ?? "http://localhost:9002"})`
                : "Cloud (Roboflow)"}
            </span>
          </p>
        </div>

        {/* Input Versions card */}
        {(isGround || isAerial) && (
          <div className="flex-1 rounded-lg border bg-card p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Input Versions</p>
            {isGround && (
              <div className="space-y-1.5">
                {(stitchVersions?.length ?? 0) > 0 && (
                  <div className="space-y-0.5">
                    <Label className="text-xs text-muted-foreground">Stitch</Label>
                    <select
                      className="border-input bg-background w-full rounded border px-2 py-1 text-xs"
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
                  <div className="space-y-0.5">
                    <Label className="text-xs text-muted-foreground">Association</Label>
                    <select
                      className="border-input bg-background w-full rounded border px-2 py-1 text-xs"
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
            )}
            {isAerial && (
              <div className="space-y-0.5">
                <Label className="text-xs text-muted-foreground">Trait Extraction</Label>
                <select
                  className="border-input bg-background w-full rounded border px-2 py-1 text-xs"
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
          </div>
        )}

        {/* Run / Stop + Close */}
        <div className="shrink-0 flex flex-col items-end gap-2">
          {isRunning ? (
            <Button type="button" variant="destructive" disabled={isStopping} onClick={onStop}>
              {isStopping
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Stopping…</>
                : <><Square className="w-4 h-4 mr-2" />Stop</>}
            </Button>
          ) : (
            <Button type="button" disabled={!configuredModels.length} onClick={handleRun}>
              {inferenceComplete ? "Re-run Inference" : "Run Inference"}
            </Button>
          )}
          <div className="flex items-center gap-2">
            {!inferenceComplete && !isRunning && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/mark-step-complete`), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ step: "inference" }),
                  })
                  queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
                  onCancel()
                }}
              >
                Skip
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Close</Button>
          </div>
        </div>
      </div>

      {/* ── Log panel ── */}
      {(isRunning || logLines.length > 0) && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              {isRunning ? "Running…" : "Last run"}
              {logTotal != null && logTotal > 0 && (
                <span className="ml-2 font-mono">{logDone}/{logTotal}</span>
              )}
            </p>
            {isRunning && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
          </div>
          {logTotal != null && logTotal > 0 && (
            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${Math.round((logDone / logTotal) * 100)}%` }}
              />
            </div>
          )}
          <div
            ref={logRef}
            className="rounded border bg-muted/40 p-2 h-32 overflow-y-auto font-mono text-xs space-y-0.5"
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

      {/* ── Results ── */}
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
            <div className="space-y-3">
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
                <h3 className="text-sm font-semibold">{currentModelLabel}</h3>
              )}

              {/* Inline results grid (hidden when expanded) */}
              {!exp.isExpanded && <ResultsGrid />}

              {/* Fullscreen modal */}
              <FullscreenModal
                open={exp.isExpanded}
                onClose={exp.close}
                title={`Inference Results — ${currentModelLabel}`}
              >
                <ResultsGrid fullscreen />
              </FullscreenModal>
            </div>
          )}
        </>
      )}
    </div>

      {/* Docker required dialog for local inference mode */}
      <Dialog open={showDockerDialog} onOpenChange={setShowDockerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Docker Required for Local Inference</DialogTitle>
            <DialogDescription asChild>
              <div className="text-muted-foreground space-y-3 text-sm">
                <p>
                  Local inference runs the{" "}
                  <strong className="text-foreground">Roboflow Inference Server</strong>{" "}
                  as a Docker container on your machine — no data leaves your network.
                </p>
                {dockerDenied ? (
                  <p>
                    Docker is installed but your user does not have permission to access it.
                    On Linux, add your user to the{" "}
                    <code className="text-foreground">docker</code> group:{" "}
                    <code className="text-foreground text-xs">sudo usermod -aG docker $USER</code>{" "}
                    then log out and back in.
                  </p>
                ) : (
                  <p>
                    Docker was not found or is not running. Install Docker Desktop and make
                    sure it is running before retrying. The inference server image will
                    download automatically on first use.
                  </p>
                )}
                <p>
                  Alternatively, switch to <strong className="text-foreground">Cloud</strong>{" "}
                  inference mode in the pipeline settings — no Docker needed.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setShowDockerDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => openUrl("https://www.docker.com/products/docker-desktop/")}>
              Download Docker Desktop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
