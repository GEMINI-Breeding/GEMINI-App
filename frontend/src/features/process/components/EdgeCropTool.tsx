/**
 * EdgeCropTool — visual editor for one crop rule (ported from GEMINI-App
 * main, PR #152). Drag a handle on each edge of a sample frame to set how
 * many pixels AgRowStitch trims from that edge before stitching.
 *
 * Sample frames come from the pipeline's runs. A rule limited to some GPS
 * headings shows frames taken while travelling that way (msgs_synced's
 * direction); a rule limited to stitching directions shows frames inside
 * plots marked with them (the population's active Plot Marking version).
 * The rule is stored in the pipeline's settings; the stitch worker picks
 * the rule for each plot.
 */
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronLeft, ChevronRight, Shuffle, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { PlotGeometryService } from "@/client"
import { authHeaders } from "@/components/Common/PlotImage"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiUrl, DEFAULT_BUCKET } from "@/features/files/lib/download"
import { useGroundTrack } from "@/features/process/hooks/useGroundTrack"
import {
  type PlotMarkingSnapshot,
  plotMarkingsDirectory,
} from "@/features/process/lib/groundTrack"
import {
  type AerialScope,
  isAerialScopeComplete,
} from "@/features/process/lib/paths"
import type { Run } from "@/features/process/lib/runStore"
import { isLoggedIn } from "@/lib/auth"

export interface CropMask {
  mask_left: number
  mask_right: number
  mask_top: number
  mask_bottom: number
}

type Side = "left" | "right" | "top" | "bottom"

const ARROWS: Record<string, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
}

function clamp(v: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(max, v)))
}

function runScope(run: Run | undefined): AerialScope | null {
  const u = run?.uploadScope
  if (!u) return null
  const s: AerialScope = {
    year: u.year,
    experiment: u.experiment,
    location: u.location,
    population: u.population,
    date: u.date,
    platform: u.platform,
    sensor: u.sensor,
  }
  return isAerialScopeComplete(s) ? s : null
}

interface EdgeCropToolProps {
  /** The pipeline's runs — the sample frames come from one of them. */
  runs: Run[]
  initialMask: CropMask
  filterMode: "plot" | "heading"
  directions: string[]
  headings: string[]
  onApply: (mask: CropMask) => void
  onClose: () => void
}

export function EdgeCropTool({
  runs,
  initialMask,
  filterMode,
  directions,
  headings,
  onApply,
  onClose,
}: EdgeCropToolProps) {
  const usable = runs.filter((r) => runScope(r))
  const [runId, setRunId] = useState<string | null>(null)
  const run = usable.find((r) => r.id === runId) ?? usable[0]
  const scope = useMemo(() => runScope(run), [run])
  const { track, points, images, isReady, isLoading } = useGroundTrack(
    scope,
    run?.uploadScope?.datasetShortIds,
  )

  const filter = (filterMode === "heading" ? headings : directions).map((d) =>
    d.toLowerCase(),
  )

  // Plot mode needs the plots marked on this track.
  const markingDir = scope ? plotMarkingsDirectory(scope) : ""
  const marking = useQuery<PlotMarkingSnapshot | null>({
    queryKey: ["plot-marking-active", markingDir],
    queryFn: async () => {
      try {
        const res =
          (await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion({
            requestBody: { directory: markingDir },
          })) as { state_snapshot?: PlotMarkingSnapshot }
        return res.state_snapshot ?? null
      } catch {
        return null // no markings yet
      }
    },
    enabled:
      isLoggedIn() &&
      Boolean(markingDir) &&
      filterMode === "plot" &&
      filter.length > 0,
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: filter is derived from the props listed
  const { frames, filtered } = useMemo(() => {
    if (filter.length === 0) return { frames: images, filtered: false }
    if (filterMode === "heading") {
      const dir = new Map(points.map((p) => [p.image, p.direction]))
      const keep = images.filter((n) =>
        filter.includes((dir.get(n) ?? "").toLowerCase()),
      )
      return { frames: keep, filtered: points.length > 0 }
    }
    const plots = (marking.data?.selections ?? []).filter(
      (s) =>
        s.start_image &&
        s.end_image &&
        filter.includes((s.direction || "").toLowerCase()),
    )
    const index = new Map(images.map((n, i) => [n, i]))
    const keep = new Set<number>()
    for (const p of plots) {
      const a = index.get(p.start_image as string)
      const b = index.get(p.end_image as string)
      if (a == null || b == null) continue
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) keep.add(i)
    }
    return {
      frames: [...keep].sort((x, y) => x - y).map((i) => images[i]),
      filtered: Boolean(marking.data),
    }
  }, [images, points, filterMode, filter.join(","), marking.data])

  const [imageIndex, setImageIndex] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: back to the first frame when the run or the frame set changes
  useEffect(() => setImageIndex(0), [run?.id, frames.length])
  const current = frames[Math.min(imageIndex, frames.length - 1)]

  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const framePath = current && track ? `${track.imagesPrefix}${current}` : null
  useEffect(() => {
    if (!framePath) return
    let live = true
    let url: string | null = null
    setImgSrc(null)
    fetch(apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${framePath}`), {
      headers: authHeaders(),
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
      .then((blob) => {
        url = URL.createObjectURL(blob)
        if (live) setImgSrc(url)
      })
      .catch(() => {})
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [framePath])

  // ── Crop state: display px ↔ natural px ─────────────────────────────────
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [crop, setCrop] = useState({ left: 0, right: 0, top: 0, bottom: 0 })
  // The crop in natural pixels survives moving between frames.
  const naturalCrop = useRef({
    left: initialMask.mask_left,
    right: initialMask.mask_right,
    top: initialMask.mask_top,
    bottom: initialMask.mask_bottom,
  })
  const containerRef = useRef<HTMLDivElement>(null)

  function onImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget
    const scale = Math.min(640 / nw, 420 / nh, 1)
    const dw = Math.round(nw * scale)
    const dh = Math.round(nh * scale)
    setNatural({ w: nw, h: nh })
    setDims({ w: dw, h: dh })
    const n = naturalCrop.current
    setCrop({
      left: Math.round((n.left * dw) / nw),
      right: Math.round((n.right * dw) / nw),
      top: Math.round((n.top * dh) / nh),
      bottom: Math.round((n.bottom * dh) / nh),
    })
  }

  const toNatural = (px: number, axis: "w" | "h", fallback: number) =>
    natural && dims ? Math.round((px * natural[axis]) / dims[axis]) : fallback
  const mask: CropMask = {
    mask_left: toNatural(crop.left, "w", initialMask.mask_left),
    mask_right: toNatural(crop.right, "w", initialMask.mask_right),
    mask_top: toNatural(crop.top, "h", initialMask.mask_top),
    mask_bottom: toNatural(crop.bottom, "h", initialMask.mask_bottom),
  }
  useEffect(() => {
    if (!natural) return
    naturalCrop.current = {
      left: mask.mask_left,
      right: mask.mask_right,
      top: mask.mask_top,
      bottom: mask.mask_bottom,
    }
  }, [
    natural,
    mask.mask_left,
    mask.mask_right,
    mask.mask_top,
    mask.mask_bottom,
  ])

  const drag = useRef<{ side: Side; rect: DOMRect } | null>(null)
  const startDrag = (side: Side) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    if (containerRef.current)
      drag.current = {
        side,
        rect: containerRef.current.getBoundingClientRect(),
      }
  }
  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !dims) return
    const { side, rect } = drag.current
    const maxW = dims.w * 0.45
    const maxH = dims.h * 0.45
    setCrop((c) => {
      switch (side) {
        case "left":
          return { ...c, left: clamp(e.clientX - rect.left, 0, maxW) }
        case "right":
          return { ...c, right: clamp(rect.right - e.clientX, 0, maxW) }
        case "top":
          return { ...c, top: clamp(e.clientY - rect.top, 0, maxH) }
        default:
          return { ...c, bottom: clamp(rect.bottom - e.clientY, 0, maxH) }
      }
    })
  }
  const endDrag = () => {
    drag.current = null
  }

  const loading = isLoading || (Boolean(track) && !isReady) || marking.isLoading
  const notice = !usable.length
    ? "Create a run for this pipeline from a rover upload to preview crops on its frames."
    : !loading && images.length === 0
      ? "The selected run has no extracted frames yet."
      : !loading && frames.length === 0
        ? filterMode === "plot"
          ? "No frames in plots marked with this direction. Mark plots first, or clear the rule's directions."
          : "No frames were taken travelling this way on the selected run."
        : null

  const handle = (side: Side): React.CSSProperties => {
    const bar = {
      borderRadius: 5,
      background: "rgba(255,255,255,0.92)",
      boxShadow: "0 1px 6px rgba(0,0,0,0.55)",
    }
    if (!dims) return {}
    if (side === "left" || side === "right")
      return {
        ...bar,
        [side]: crop[side] - 5,
        top: dims.h / 2 - 22,
        width: 10,
        height: 44,
      }
    return {
      ...bar,
      [side]: crop[side] - 5,
      left: dims.w / 2 - 22,
      width: 44,
      height: 10,
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="edge-crop-tool">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            Edge Crop Tool
            {filter.length > 0 && (
              <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium text-[11px]">
                {filterMode === "heading"
                  ? filter.map((h) => h[0].toUpperCase()).join("/")
                  : filter.map((d) => ARROWS[d] ?? d).join(" ")}{" "}
                only
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Drag the handles to set how many pixels to crop from each frame edge
            before stitching.
            {filter.length === 0
              ? " This crop applies when no other rule matches."
              : filtered
                ? filterMode === "heading"
                  ? " Showing frames taken travelling this way."
                  : " Showing frames from plots marked with this direction."
                : filterMode === "plot"
                  ? " Mark plots first to see only the matching frames."
                  : ""}
          </DialogDescription>
        </DialogHeader>

        {usable.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground shrink-0 text-xs">
              Reference run:
            </span>
            <Select value={run?.id ?? ""} onValueChange={setRunId}>
              <SelectTrigger className="h-7 w-64 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {usable.map((r) => (
                  <SelectItem key={r.id} value={r.id} className="text-xs">
                    {r.uploadScope?.date} · {r.uploadScope?.location} ·{" "}
                    {r.uploadScope?.population}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {loading && !notice ? (
          <p className="text-muted-foreground flex h-48 items-center justify-center text-sm">
            Loading frames…
          </p>
        ) : notice ? (
          <p
            className="text-muted-foreground flex h-32 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm"
            data-testid="edge-crop-notice"
          >
            {notice}
          </p>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2">
              <div
                ref={containerRef}
                className="bg-muted relative select-none overflow-hidden rounded"
                style={
                  dims
                    ? { width: dims.w, height: dims.h }
                    : { width: 640, height: 420 }
                }
              >
                {!imgSrc && (
                  <p className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
                    Loading frame…
                  </p>
                )}
                {imgSrc && (
                  <img
                    src={imgSrc}
                    alt={current}
                    data-testid="edge-crop-frame"
                    className="block"
                    style={dims ? { width: dims.w, height: dims.h } : {}}
                    onLoad={onImgLoad}
                    draggable={false}
                  />
                )}
                {dims && imgSrc && (
                  <>
                    <div
                      className="pointer-events-none absolute inset-x-0 top-0 bg-black/55"
                      style={{ height: crop.top }}
                    />
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55"
                      style={{ height: crop.bottom }}
                    />
                    <div
                      className="pointer-events-none absolute left-0 bg-black/55"
                      style={{
                        top: crop.top,
                        bottom: crop.bottom,
                        width: crop.left,
                      }}
                    />
                    <div
                      className="pointer-events-none absolute right-0 bg-black/55"
                      style={{
                        top: crop.top,
                        bottom: crop.bottom,
                        width: crop.right,
                      }}
                    />
                    {(["left", "right", "top", "bottom"] as Side[]).map(
                      (side) => (
                        <div
                          key={side}
                          data-testid={`edge-crop-handle-${side}`}
                          className={`absolute z-10 touch-none ${
                            side === "left" || side === "right"
                              ? "cursor-ew-resize"
                              : "cursor-ns-resize"
                          }`}
                          style={handle(side)}
                          onPointerDown={startDrag(side)}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                        />
                      ),
                    )}
                  </>
                )}
              </div>

              {frames.length > 1 && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label="Previous frame"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={imageIndex === 0}
                    onClick={() => setImageIndex((i) => Math.max(0, i - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span
                    className="text-muted-foreground text-xs tabular-nums"
                    data-testid="edge-crop-count"
                  >
                    {Math.min(imageIndex, frames.length - 1) + 1} /{" "}
                    {frames.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Next frame"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={imageIndex >= frames.length - 1}
                    onClick={() =>
                      setImageIndex((i) => Math.min(frames.length - 1, i + 1))
                    }
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Random sample"
                    aria-label="Random frame"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setImageIndex(Math.floor(Math.random() * frames.length))
                    }
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-2 text-center">
              {(
                [
                  ["Left", mask.mask_left],
                  ["Right", mask.mask_right],
                  ["Top", mask.mask_top],
                  ["Bottom", mask.mask_bottom],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="bg-muted rounded-md p-2">
                  <p className="text-muted-foreground mb-0.5 text-[10px] uppercase tracking-wide">
                    {label}
                  </p>
                  <p
                    className="font-medium font-mono text-sm"
                    data-testid={`edge-crop-${label.toLowerCase()}`}
                  >
                    {value}px
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Cancel
          </Button>
          {!notice && dims && (
            <Button
              size="sm"
              data-testid="edge-crop-apply"
              onClick={() => {
                onApply(mask)
                onClose()
              }}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Apply crop
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
