/**
 * LabelingTool — review, edit, and hand-draw labels for one model's
 * predictions within a pipeline run.
 *
 * Opened from InferenceTool's "Label & Review" button, scoped to a single
 * model label + task_type. Reuses the same predictions CSV inference writes
 * (via the row-level add/update/delete routes) — there is no separate label
 * storage. Detection/segmentation get a canvas box/polygon editor;
 * classification gets a whole-image class-picker instead.
 *
 * Auto-labeling (running a foundation model to bootstrap a first pass) goes
 * through the same `onRunInference` callback InferenceTool's own "Run
 * Inference" button uses — not a separate execute-step call — so run state
 * (isRunning/logs) stays centrally owned by the parent instead of forking a
 * second, out-of-sync SSE subscription.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { ProcessingService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import type { InferenceRunConfig } from "./InferenceTool"

// ── Types ─────────────────────────────────────────────────────────────────

interface LabelRow {
  row_index: number
  image: string
  class: string
  confidence: number
  verified: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  points?: Array<{ x: number; y: number }>
}

interface ImageInfo {
  name: string
  path: string
}

export interface LabelingToolProps {
  runId: string
  label: string
  taskType: string
  onClose: () => void
  onRunInference: (config: InferenceRunConfig) => void
  isRunning: boolean
  logLines: string[]
  inferenceMode?: string
  localServerUrl?: string
}

const apiUrl = (path: string) => {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

// ── Letterbox / coordinate helpers (ported from GcpPicker.tsx) ──────────────

function getLetterbox(naturalW: number, naturalH: number, cw: number, ch: number) {
  const imgAspect = naturalW / naturalH
  const containerAspect = cw / ch
  if (imgAspect > containerAspect) {
    const h = cw / imgAspect
    return { x: 0, y: (ch - h) / 2, w: cw, h }
  }
  const w = ch * imgAspect
  return { x: (cw - w) / 2, y: 0, w, h: ch }
}

function clampOffset(ox: number, oy: number, z: number, cw: number, ch: number) {
  return {
    x: Math.min(0, Math.max(ox, cw * (1 - z))),
    y: Math.min(0, Math.max(oy, ch * (1 - z))),
  }
}

const CLASS_COLOURS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
]
function classColour(cls: string): string {
  if (!cls) return "#9ca3af"
  let hash = 0
  for (let i = 0; i < cls.length; i++) hash = (hash * 31 + cls.charCodeAt(i)) | 0
  return CLASS_COLOURS[Math.abs(hash) % CLASS_COLOURS.length]
}

// ── Main component ───────────────────────────────────────────────────────

export function LabelingTool({
  runId,
  label,
  taskType,
  onClose,
  onRunInference,
  isRunning,
  logLines,
  inferenceMode,
  localServerUrl,
}: LabelingToolProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const isClassification = taskType === "classification"

  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [imageIdx, setImageIdx] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  zoomRef.current = zoom
  offsetRef.current = offset

  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [drawMode, setDrawMode] = useState<"idle" | "polygon">("idle")
  const [draftBox, setDraftBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [draftPolygon, setDraftPolygon] = useState<{ x: number; y: number }[]>([])
  const [pendingNew, setPendingNew] = useState<
    | { kind: "box"; x: number; y: number; width: number; height: number }
    | { kind: "polygon"; points: { x: number; y: number }[] }
    | null
  >(null)
  const [lastDeleted, setLastDeleted] = useState<LabelRow | null>(null)
  const [autoLabelOpen, setAutoLabelOpen] = useState(false)
  const [autoLabelPrompt, setAutoLabelPrompt] = useState("")

  const { data, isLoading } = useQuery({
    queryKey: ["inference-results", runId, label],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/inference-results?model=${encodeURIComponent(label)}`),
      )
      if (!res.ok) return { available: false, predictions: [], images: [] }
      return res.json()
    },
  })

  const available: boolean = data?.available ?? false
  const images: ImageInfo[] = data?.images ?? []
  const allRows: LabelRow[] = data?.predictions ?? []
  const currentImage = images[imageIdx]
  const rows = allRows.filter((r) => r.image === currentImage?.name)
  const knownClasses = [...new Set(allRows.map((r) => r.class).filter(Boolean))].sort()

  const reviewedCount = new Set(
    allRows.filter((r) => r.verified).map((r) => r.image),
  ).size

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["inference-results", runId, label] })
  }

  const addMutation = useMutation({
    mutationFn: (body: {
      image: string
      class: string
      x?: number
      y?: number
      width?: number
      height?: number
      points?: { x: number; y: number }[]
    }) => ProcessingService.addInferenceRow({ id: runId, label, requestBody: body as any }),
    onSuccess: () => invalidate(),
    onError: () => showErrorToast("Failed to save the new label"),
  })

  const updateMutation = useMutation({
    mutationFn: ({ rowIndex, body }: { rowIndex: number; body: Record<string, unknown> }) =>
      ProcessingService.updateInferenceRow({ id: runId, label, rowIndex, requestBody: body as any }),
    onSuccess: () => invalidate(),
    onError: () => showErrorToast("Failed to update the label"),
  })

  const deleteMutation = useMutation({
    mutationFn: (rowIndex: number) =>
      ProcessingService.deleteInferenceRow({ id: runId, label, rowIndex }),
    onSuccess: () => invalidate(),
    onError: () => showErrorToast("Failed to remove the label"),
  })

  function acceptRow(row: LabelRow) {
    updateMutation.mutate({ rowIndex: row.row_index, body: { verified: true } })
  }

  function rejectRow(row: LabelRow) {
    setLastDeleted(row)
    deleteMutation.mutate(row.row_index)
    if (selectedRow === row.row_index) setSelectedRow(null)
  }

  function undoLastReject() {
    if (!lastDeleted) return
    const { image, class: cls, x, y, width, height, points } = lastDeleted
    addMutation.mutate({ image, class: cls, x, y, width, height, points })
    setLastDeleted(null)
    showSuccessToast("Restored the removed label")
  }

  // ── Zoom / pan (ported from GcpPicker.tsx) ────────────────────────────────

  function applyZoomAt(dz: number, cx: number, cy: number) {
    const el = containerRef.current
    if (!el) return
    const prevZoom = zoomRef.current
    const newZoom = Math.min(Math.max(prevZoom * dz, 1), 10)
    if (newZoom <= 1) {
      setZoom(1)
      setOffset({ x: 0, y: 0 })
      return
    }
    const ratio = newZoom / prevZoom
    const prev = offsetRef.current
    const raw = { x: cx * (1 - ratio) + prev.x * ratio, y: cy * (1 - ratio) + prev.y * ratio }
    setZoom(newZoom)
    setOffset(clampOffset(raw.x, raw.y, newZoom, el.clientWidth, el.clientHeight))
  }
  const applyZoomAtRef = useRef(applyZoomAt)
  applyZoomAtRef.current = applyZoomAt

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      applyZoomAtRef.current(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  function resetView() {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  // Reset draw/selection state on image change
  useEffect(() => {
    setSelectedRow(null)
    setDraftBox(null)
    setDraftPolygon([])
    setPendingNew(null)
    setDrawMode("idle")
  }, [imageIdx])

  // ── Screen → image-pixel coordinate transform ─────────────────────────────

  const clientToImagePx = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!containerRef.current || !imgRef.current) return null
    const naturalW = imgRef.current.naturalWidth
    const naturalH = imgRef.current.naturalHeight
    if (!naturalW || !naturalH) return null
    const rect = containerRef.current.getBoundingClientRect()
    const cw = containerRef.current.clientWidth
    const ch = containerRef.current.clientHeight
    const cx = clientX - rect.left
    const cy = clientY - rect.top
    const dx = (cx - offsetRef.current.x) / zoomRef.current
    const dy = (cy - offsetRef.current.y) / zoomRef.current
    const lb = getLetterbox(naturalW, naturalH, cw, ch)
    const imgX = dx - lb.x
    const imgY = dy - lb.y
    if (imgX < 0 || imgX > lb.w || imgY < 0 || imgY > lb.h) return null
    return { x: (imgX / lb.w) * naturalW, y: (imgY / lb.h) * naturalH }
  }, [])

  const imageToScreen = useCallback((imgX: number, imgY: number) => {
    if (!containerRef.current || !imgRef.current) return { x: 0, y: 0 }
    const naturalW = imgRef.current.naturalWidth
    const naturalH = imgRef.current.naturalHeight
    const cw = containerRef.current.clientWidth
    const ch = containerRef.current.clientHeight
    const lb = getLetterbox(naturalW || 1, naturalH || 1, cw, ch)
    const dx = lb.x + (imgX / naturalW) * lb.w
    const dy = lb.y + (imgY / naturalH) * lb.h
    return { x: dx * zoomRef.current + offsetRef.current.x, y: dy * zoomRef.current + offsetRef.current.y }
  }, [])

  // ── Mouse handling: pan, draw box, place polygon vertex ───────────────────

  const dragStateRef = useRef<{ mode: "pan" | "box"; startClientX: number; startClientY: number; startOffset: { x: number; y: number }; startImgPt?: { x: number; y: number } } | null>(null)

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0 || isClassification) return
    const target = e.target as HTMLElement
    if (target.dataset.handle) return // corner-handle drags are handled separately

    if (drawMode === "polygon") {
      const pt = clientToImagePx(e.clientX, e.clientY)
      if (pt) setDraftPolygon((prev) => [...prev, pt])
      return
    }

    const imgPt = clientToImagePx(e.clientX, e.clientY)
    dragStateRef.current = {
      mode: imgPt ? "box" : "pan",
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffset: offsetRef.current,
      startImgPt: imgPt ?? undefined,
    }
    let moved = false

    const onMove = (me: MouseEvent) => {
      const st = dragStateRef.current
      if (!st) return
      const dx = me.clientX - st.startClientX
      const dy = me.clientY - st.startClientY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true
      if (!moved) return
      if (st.mode === "pan" || !st.startImgPt) {
        const el = containerRef.current
        if (!el) return
        setOffset(clampOffset(st.startOffset.x + dx, st.startOffset.y + dy, zoomRef.current, el.clientWidth, el.clientHeight))
      } else {
        const curPt = clientToImagePx(me.clientX, me.clientY)
        if (curPt) {
          setDraftBox({ x0: st.startImgPt.x, y0: st.startImgPt.y, x1: curPt.x, y1: curPt.y })
        }
      }
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      const st = dragStateRef.current
      dragStateRef.current = null
      if (moved && st?.mode === "box") {
        setDraftBox((box) => {
          if (box) {
            const x = Math.min(box.x0, box.x1)
            const y = Math.min(box.y0, box.y1)
            const width = Math.abs(box.x1 - box.x0)
            const height = Math.abs(box.y1 - box.y0)
            if (width > 4 && height > 4) {
              setPendingNew({ kind: "box", x: x + width / 2, y: y + height / 2, width, height })
            }
          }
          return null
        })
      } else if (!moved) {
        setSelectedRow(null)
      }
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  function closePolygon() {
    if (draftPolygon.length < 3) return
    setPendingNew({ kind: "polygon", points: draftPolygon })
    setDraftPolygon([])
    setDrawMode("idle")
  }

  function commitPendingNew(cls: string) {
    if (!pendingNew || !currentImage) return
    if (pendingNew.kind === "box") {
      addMutation.mutate({
        image: currentImage.name, class: cls,
        x: pendingNew.x, y: pendingNew.y, width: pendingNew.width, height: pendingNew.height,
      })
    } else {
      addMutation.mutate({ image: currentImage.name, class: cls, points: pendingNew.points })
    }
    setPendingNew(null)
  }

  // ── Classification: one row per image ─────────────────────────────────────

  function setClassification(cls: string) {
    if (!currentImage) return
    const existing = rows[0]
    if (existing) {
      updateMutation.mutate({ rowIndex: existing.row_index, body: { class: cls, verified: true } })
    } else {
      addMutation.mutate({ image: currentImage.name, class: cls })
    }
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  const stateRef = useRef({ imageIdx, images, rows, selectedRow, lastDeleted })
  stateRef.current = { imageIdx, images, rows, selectedRow, lastDeleted }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const s = stateRef.current
      if (e.key === "ArrowLeft") { e.preventDefault(); setImageIdx((i) => Math.max(0, i - 1)) }
      if (e.key === "ArrowRight") { e.preventDefault(); setImageIdx((i) => Math.min(s.images.length - 1, i + 1)) }
      if (e.key === "Enter" && drawMode === "polygon") { e.preventDefault(); closePolygon() }
      if (e.key === "Escape") { setDraftPolygon([]); setDrawMode("idle"); setPendingNew(null) }
      if (s.selectedRow != null) {
        const row = s.rows.find((r) => r.row_index === s.selectedRow)
        if (row) {
          if (e.key === "a" || e.key === "A") { e.preventDefault(); acceptRow(row) }
          if (e.key === "Delete" || e.key === "Backspace" || e.key === "r" || e.key === "R") {
            e.preventDefault()
            rejectRow(row)
          }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault()
        if (s.lastDeleted) undoLastReject()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawMode])

  // ── Auto-label trigger ──────────────────────────────────────────────────────

  function runAutoLabel() {
    if (taskType === "segmentation") {
      onRunInference({
        models: [{
          label, source: "sam_auto", roboflow_api_key: "", roboflow_model_id: "",
          task_type: taskType,
        }],
        inference_mode: inferenceMode ?? "cloud",
        local_server_url: inferenceMode === "local" ? localServerUrl : undefined,
      })
    } else {
      onRunInference({
        models: [{
          label, source: "huggingface", roboflow_api_key: "", roboflow_model_id: "",
          hf_zero_shot: true, hf_prompt: autoLabelPrompt, task_type: taskType,
        }],
        inference_mode: inferenceMode ?? "cloud",
        local_server_url: inferenceMode === "local" ? localServerUrl : undefined,
      })
    }
    setAutoLabelOpen(false)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b pb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Label & Review — {label}</h3>
          <Badge variant="outline" className="text-xs">{taskType}</Badge>
          <span className="text-xs text-muted-foreground">
            {reviewedCount}/{images.length} images reviewed
          </span>
        </div>
        <div className="flex items-center gap-2">
          {lastDeleted && (
            <Button size="sm" variant="outline" onClick={undoLastReject}>
              <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo remove
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setAutoLabelOpen((v) => !v)} disabled={isRunning}>
            {isRunning ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            Run Auto-Label
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>

      {autoLabelOpen && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Runs a local foundation model over every image in this label to
            propose a first pass of labels — review and correct them below.
            This overwrites "{label}"'s existing results.
          </p>
          {taskType !== "segmentation" && (
            <div className="space-y-1">
              <Label className="text-xs">Candidate classes (comma-separated)</Label>
              <Input
                className="h-8 text-sm"
                placeholder="weed, crop, soil"
                value={autoLabelPrompt}
                onChange={(e) => setAutoLabelPrompt(e.target.value)}
              />
            </div>
          )}
          <Button size="sm" onClick={runAutoLabel} disabled={taskType !== "segmentation" && !autoLabelPrompt.trim()}>
            Run
          </Button>
        </div>
      )}

      {isRunning && (
        <div className="max-h-24 overflow-y-auto rounded border bg-black/90 p-2 font-mono text-[11px] text-green-400">
          {logLines.slice(-20).map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Loading…</p>
      ) : !available ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          No results yet for "{label}" — run auto-label above, or configure
          and run this model from the pipeline's inference step first.
        </p>
      ) : (
        <div className="flex flex-1 gap-3 min-h-0">
          {/* Image viewer */}
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <div
              ref={containerRef}
              onMouseDown={handleMouseDown}
              className="relative flex-1 min-h-0 overflow-hidden rounded border bg-black/5 cursor-crosshair"
            >
              {currentImage && (
                <img
                  ref={imgRef}
                  src={apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(currentImage.path)}`)}
                  alt={currentImage.name}
                  className="pointer-events-none absolute left-0 top-0 h-full w-full object-contain"
                  style={{
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                    transformOrigin: "0 0",
                  }}
                />
              )}

              {/* Existing boxes/polygons for this image */}
              {!isClassification && rows.map((row) => {
                const isSelected = selectedRow === row.row_index
                const colour = row.class ? classColour(row.class) : "#9ca3af"
                if (row.points && row.points.length >= 3) {
                  const screenPts = row.points.map((p) => imageToScreen(p.x, p.y))
                  const pathD = `M ${screenPts.map((p) => `${p.x},${p.y}`).join(" L ")} Z`
                  return (
                    <svg key={row.row_index} className="pointer-events-none absolute left-0 top-0 h-full w-full">
                      <path
                        d={pathD}
                        fill={colour}
                        fillOpacity={isSelected ? 0.35 : 0.2}
                        stroke={colour}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                        strokeDasharray={row.verified ? undefined : "4 3"}
                        className="pointer-events-auto cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); setSelectedRow(row.row_index) }}
                      />
                    </svg>
                  )
                }
                if (row.x == null || row.width == null) return null
                const topLeft = imageToScreen(row.x - row.width / 2, row.y! - row.height! / 2)
                const bottomRight = imageToScreen(row.x + row.width / 2, row.y! + row.height! / 2)
                return (
                  <div
                    key={row.row_index}
                    onClick={(e) => { e.stopPropagation(); setSelectedRow(row.row_index) }}
                    className="absolute cursor-pointer"
                    style={{
                      left: topLeft.x, top: topLeft.y,
                      width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y,
                      border: `${isSelected ? 2.5 : 1.5}px ${row.verified ? "solid" : "dashed"} ${colour}`,
                      background: isSelected ? `${colour}22` : "transparent",
                    }}
                  >
                    <span
                      className="absolute -top-5 left-0 whitespace-nowrap rounded px-1 text-[10px] font-medium text-white"
                      style={{ background: colour }}
                    >
                      {row.class || "unlabeled"} {row.verified ? "✓" : ""}
                    </span>
                  </div>
                )
              })}

              {/* Live draft box while dragging */}
              {draftBox && (() => {
                const tl = imageToScreen(Math.min(draftBox.x0, draftBox.x1), Math.min(draftBox.y0, draftBox.y1))
                const br = imageToScreen(Math.max(draftBox.x0, draftBox.x1), Math.max(draftBox.y0, draftBox.y1))
                return (
                  <div
                    className="pointer-events-none absolute border-2 border-primary border-dashed"
                    style={{ left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y }}
                  />
                )
              })()}

              {/* Draft polygon vertices */}
              {draftPolygon.map((pt, i) => {
                const s = imageToScreen(pt.x, pt.y)
                return (
                  <div
                    key={i}
                    className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-white"
                    style={{ left: s.x, top: s.y }}
                  />
                )
              })}
            </div>

            {/* Nav bar */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" onClick={() => applyZoomAtRef.current(1 / 1.25, 0, 0)}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="outline" onClick={() => applyZoomAtRef.current(1.25, 0, 0)}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={resetView}>Reset</Button>
                {!isClassification && (
                  <Button
                    size="sm"
                    variant={drawMode === "polygon" ? "default" : "outline"}
                    onClick={() => { setDrawMode((m) => (m === "polygon" ? "idle" : "polygon")); setDraftPolygon([]) }}
                  >
                    {drawMode === "polygon" ? "Drawing polygon… (Enter to close)" : "Draw Polygon"}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" onClick={() => setImageIdx((i) => Math.max(0, i - 1))} disabled={imageIdx === 0}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  {imageIdx + 1} / {images.length} — {currentImage?.name}
                </span>
                <Button size="icon" variant="outline" onClick={() => setImageIdx((i) => Math.min(images.length - 1, i + 1))} disabled={imageIdx >= images.length - 1}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Progress dot strip */}
            <div className="flex flex-wrap gap-1">
              {images.map((img, i) => {
                const imgRows = allRows.filter((r) => r.image === img.name)
                const hasUnverified = imgRows.some((r) => !r.verified)
                const hasAny = imgRows.length > 0
                return (
                  <button
                    key={img.name}
                    onClick={() => setImageIdx(i)}
                    title={img.name}
                    className={cn(
                      "h-2.5 w-2.5 rounded-full border transition-colors",
                      i === imageIdx
                        ? "bg-primary border-primary"
                        : hasUnverified
                          ? "bg-amber-400 border-amber-400"
                          : hasAny
                            ? "bg-green-500 border-green-500"
                            : "bg-muted border-muted-foreground/30 hover:border-primary/50",
                    )}
                  />
                )
              })}
            </div>
          </div>

          {/* Side panel: class picker / selected-row actions */}
          <div className="w-64 shrink-0 space-y-3 overflow-y-auto border-l pl-3">
            {isClassification ? (
              <ClassPicker
                title="Classify this image"
                classes={knownClasses}
                current={rows[0]?.class}
                onPick={setClassification}
              />
            ) : (
              <>
                {pendingNew && (
                  <ClassPicker
                    title="Assign a class"
                    classes={knownClasses}
                    onPick={commitPendingNew}
                    onCancel={() => setPendingNew(null)}
                  />
                )}
                {selectedRow != null && (() => {
                  const row = rows.find((r) => r.row_index === selectedRow)
                  if (!row) return null
                  return (
                    <div className="space-y-2 rounded-md border p-2">
                      <p className="text-xs font-medium">{row.class || "unlabeled"}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {(row.confidence * 100).toFixed(0)}% confidence
                        {row.verified ? " · verified" : " · unverified"}
                      </p>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => acceptRow(row)}>
                          <Check className="mr-1 h-3.5 w-3.5" /> Accept
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => rejectRow(row)}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    </div>
                  )
                })()}
                <div className="space-y-1 text-[11px] text-muted-foreground">
                  <p><kbd className="rounded border px-1">←/→</kbd> navigate images</p>
                  <p><kbd className="rounded border px-1">click+drag</kbd> draw a box</p>
                  <p><kbd className="rounded border px-1">A</kbd> accept selected</p>
                  <p><kbd className="rounded border px-1">R</kbd> / <kbd className="rounded border px-1">Del</kbd> reject selected</p>
                  <p><kbd className="rounded border px-1">Ctrl+Z</kbd> undo last reject</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Class picker ─────────────────────────────────────────────────────────

function ClassPicker({
  title,
  classes,
  current,
  onPick,
  onCancel,
}: {
  title: string
  classes: string[]
  current?: string
  onPick: (cls: string) => void
  onCancel?: () => void
}) {
  const [newClass, setNewClass] = useState("")
  return (
    <div className="space-y-2 rounded-md border p-2">
      <p className="text-xs font-medium">{title}</p>
      <div className="flex flex-wrap gap-1">
        {classes.map((cls) => (
          <Button
            key={cls}
            size="sm"
            variant={cls === current ? "default" : "outline"}
            className="h-7 text-xs"
            style={cls !== current ? { borderColor: classColour(cls) } : undefined}
            onClick={() => onPick(cls)}
          >
            {cls}
          </Button>
        ))}
      </div>
      <div className="flex gap-1">
        <Input
          className="h-7 text-xs"
          placeholder="New class…"
          value={newClass}
          onChange={(e) => setNewClass(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newClass.trim()) {
              onPick(newClass.trim())
              setNewClass("")
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!newClass.trim()}
          onClick={() => { onPick(newClass.trim()); setNewClass("") }}
        >
          Add
        </Button>
      </div>
      {onCancel && (
        <Button size="sm" variant="ghost" className="w-full" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  )
}
