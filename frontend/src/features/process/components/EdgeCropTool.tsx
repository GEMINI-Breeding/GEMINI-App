import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, X, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { OpenAPI, PipelinesService } from "@/client"
import { useQuery } from "@tanstack/react-query"

interface CropMask {
  mask_left: number
  mask_right: number
  mask_top: number
  mask_bottom: number
}

interface EdgeCropToolProps {
  pipelineId: string | null
  initialMask: CropMask
  onApply: (mask: CropMask) => void
  onClose: () => void
}

function apiBase() {
  return (window as any).__GEMI_BACKEND_URL__ ?? OpenAPI.BASE ?? ""
}

async function authToken(): Promise<string> {
  const token =
    typeof OpenAPI.TOKEN === "function"
      ? await (OpenAPI.TOKEN as () => Promise<string>)()
      : OpenAPI.TOKEN ?? ""
  return token ? `Bearer ${token}` : ""
}

function clamp(v: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(max, v)))
}

export function EdgeCropTool({ pipelineId, initialMask, onApply, onClose }: EdgeCropToolProps) {
  // ── Fetch all runs for this pipeline ───────────────────────────────────────
  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ["edge-crop-runs", pipelineId],
    queryFn: () => PipelinesService.readRuns({ pipelineId: pipelineId! }),
    enabled: !!pipelineId,
  })

  const runs: { id: string; date: string; location: string; population: string }[] =
    (runsData as any)?.data ?? []

  // Selected run — defaults to first available
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const effectiveRunId = selectedRunId ?? runs[0]?.id ?? null

  // When runs load, clear any stale selection
  useEffect(() => { setSelectedRunId(null) }, [pipelineId])

  // ── Fetch image list from selected run ─────────────────────────────────────
  const { data: imagesData, isLoading: imagesLoading } = useQuery({
    queryKey: ["edge-crop-images", effectiveRunId],
    queryFn: async () => {
      const auth = await authToken()
      const res = await fetch(`${apiBase()}/api/v1/pipeline-runs/${effectiveRunId}/images`, {
        headers: auth ? { Authorization: auth } : {},
      })
      if (!res.ok) throw new Error("Failed to load images")
      return res.json() as Promise<{ images: string[]; raw_dir: string; count: number }>
    },
    enabled: !!effectiveRunId,
  })

  const images: string[] = imagesData?.images ?? []
  const rawDir: string = imagesData?.raw_dir ?? ""

  // ── Image navigation & blob loading ───────────────────────────────────────
  const [imageIndex, setImageIndex] = useState(0)
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [imgLoading, setImgLoading] = useState(false)
  const blobUrlRef = useRef<string | null>(null)

  const currentPath = images[imageIndex] ? `${rawDir}/${images[imageIndex]}` : null

  useEffect(() => {
    if (!currentPath) return
    let cancelled = false
    setImgLoading(true)
    setImgSrc(null)
    authToken().then((auth) => {
      fetch(`${apiBase()}/api/v1/files/serve?path=${encodeURIComponent(currentPath)}`, {
        headers: auth ? { Authorization: auth } : {},
      })
        .then((r) => r.blob())
        .then((blob) => {
          if (cancelled) return
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
          const url = URL.createObjectURL(blob)
          blobUrlRef.current = url
          setImgSrc(url)
          setImgLoading(false)
        })
        .catch(() => { if (!cancelled) setImgLoading(false) })
    })
    return () => { cancelled = true }
  }, [currentPath])

  useEffect(() => () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current) }, [])

  // ── Crop state ────────────────────────────────────────────────────────────
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  // Keep a ref so drag handlers always see the latest dims without re-creating closures
  const dimsRef = useRef(dims)
  useEffect(() => { dimsRef.current = dims }, [dims])

  const [cropLeft, setCropLeft] = useState(0)
  const [cropRight, setCropRight] = useState(0)
  const [cropTop, setCropTop] = useState(0)
  const [cropBottom, setCropBottom] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)

  function onImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget
    const scale = Math.min(640 / nw, 420 / nh, 1)
    const dw = Math.round(nw * scale)
    const dh = Math.round(nh * scale)
    setNaturalSize({ w: nw, h: nh })
    setDims({ w: dw, h: dh })
    // Convert existing pixel mask → display pixels
    setCropLeft(Math.round(initialMask.mask_left * dw / nw))
    setCropRight(Math.round(initialMask.mask_right * dw / nw))
    setCropTop(Math.round(initialMask.mask_top * dh / nh))
    setCropBottom(Math.round(initialMask.mask_bottom * dh / nh))
  }

  // Convert display-pixel crop → natural image pixels (what gets saved)
  const maskLeft   = naturalSize && dims ? Math.round(cropLeft   * naturalSize.w / dims.w) : 0
  const maskRight  = naturalSize && dims ? Math.round(cropRight  * naturalSize.w / dims.w) : 0
  const maskTop    = naturalSize && dims ? Math.round(cropTop    * naturalSize.h / dims.h) : 0
  const maskBottom = naturalSize && dims ? Math.round(cropBottom * naturalSize.h / dims.h) : 0

  // ── Drag handlers (pointer-capture based) ─────────────────────────────────
  // dragRef persists across re-renders so moveDrag always works
  const dragRef = useRef<{ side: 'left' | 'right' | 'top' | 'bottom'; rect: DOMRect } | null>(null)

  function startDrag(side: 'left' | 'right' | 'top' | 'bottom') {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      if (containerRef.current) {
        dragRef.current = { side, rect: containerRef.current.getBoundingClientRect() }
      }
    }
  }

  function moveDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || !dimsRef.current) return
    const { side, rect } = dragRef.current
    const d = dimsRef.current
    const MAX_PX = (axis: 'w' | 'h') => d[axis] * 0.45
    switch (side) {
      case 'left':   setCropLeft(clamp(e.clientX - rect.left,   0, MAX_PX('w'))); break
      case 'right':  setCropRight(clamp(rect.right - e.clientX, 0, MAX_PX('w'))); break
      case 'top':    setCropTop(clamp(e.clientY - rect.top,     0, MAX_PX('h'))); break
      case 'bottom': setCropBottom(clamp(rect.bottom - e.clientY, 0, MAX_PX('h'))); break
    }
  }

  function endDrag() { dragRef.current = null }

  // ── Notification state ────────────────────────────────────────────────────
  const loading = runsLoading || imagesLoading
  let notification: string | null = null
  if (!pipelineId) {
    notification = "Save this pipeline first, then upload a dataset to use the crop tool."
  } else if (!loading && runs.length === 0) {
    notification = "Upload a dataset to this pipeline first to use the crop tool."
  } else if (!loading && effectiveRunId && images.length === 0) {
    notification = "No images found in the selected dataset."
  }

  const showCropUI = !loading && !notification

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-background w-full max-w-3xl rounded-xl border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b px-5 py-3">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm">Edge Crop Tool</h2>
            <p className="text-muted-foreground text-xs mt-0.5 max-w-lg">
              Drag the handles to define how many pixels to crop from each image edge before stitching.
              This setting is shared across all datasets in this pipeline.
            </p>
            {runs.length > 1 && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-muted-foreground shrink-0">Reference dataset:</span>
                <Select
                  value={effectiveRunId ?? ""}
                  onValueChange={(val) => {
                    setSelectedRunId(val)
                    setImageIndex(0)
                  }}
                >
                  <SelectTrigger className="h-7 text-xs w-56">
                    <SelectValue placeholder="Select dataset…" />
                  </SelectTrigger>
                  <SelectContent>
                    {runs.map((r) => (
                      <SelectItem key={r.id} value={r.id} className="text-xs">
                        {r.date}{r.location ? ` · ${r.location}` : ""}{r.population ? ` · ${r.population}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <button className="text-muted-foreground hover:text-foreground ml-4 shrink-0 mt-0.5" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Loading */}
          {loading && (
            <div className="flex h-48 items-center justify-center">
              <p className="text-muted-foreground text-sm">Loading dataset…</p>
            </div>
          )}

          {/* Notification (no pipeline / no runs / no images) */}
          {!loading && notification && (
            <div className="flex h-32 items-center justify-center rounded-lg border border-dashed">
              <p className="text-muted-foreground text-sm text-center max-w-xs px-4">{notification}</p>
            </div>
          )}

          {/* Crop UI */}
          {showCropUI && (
            <>
              {/* Image + overlays + handles */}
              <div className="flex flex-col items-center gap-2">
                <div
                  ref={containerRef}
                  className="relative select-none overflow-hidden rounded bg-muted"
                  style={dims ? { width: dims.w, height: dims.h } : { width: 640, height: 420 }}
                >
                  {(imgLoading || !imgSrc) && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="text-muted-foreground text-sm">Loading image…</p>
                    </div>
                  )}
                  {imgSrc && (
                    <img
                      src={imgSrc}
                      alt="preview"
                      className="block"
                      style={dims ? { width: dims.w, height: dims.h } : {}}
                      onLoad={onImgLoad}
                      draggable={false}
                    />
                  )}

                  {dims && imgSrc && (
                    <>
                      {/* ── Crop overlays ── */}
                      {/* Top */}
                      <div
                        className="absolute inset-x-0 top-0 bg-black/55 pointer-events-none"
                        style={{ height: cropTop }}
                      />
                      {/* Bottom */}
                      <div
                        className="absolute inset-x-0 bottom-0 bg-black/55 pointer-events-none"
                        style={{ height: cropBottom }}
                      />
                      {/* Left */}
                      <div
                        className="absolute left-0 bg-black/55 pointer-events-none"
                        style={{ top: cropTop, bottom: cropBottom, width: cropLeft }}
                      />
                      {/* Right */}
                      <div
                        className="absolute right-0 bg-black/55 pointer-events-none"
                        style={{ top: cropTop, bottom: cropBottom, width: cropRight }}
                      />

                      {/* ── Pixel labels inside each masked strip ── */}
                      {cropTop >= 22 && (
                        <div
                          className="absolute inset-x-0 top-0 flex items-center justify-center pointer-events-none"
                          style={{ height: cropTop }}
                        >
                          <span className="text-white text-xs font-mono bg-black/60 rounded px-1.5 py-0.5">{maskTop}px</span>
                        </div>
                      )}
                      {cropBottom >= 22 && (
                        <div
                          className="absolute inset-x-0 bottom-0 flex items-center justify-center pointer-events-none"
                          style={{ height: cropBottom }}
                        >
                          <span className="text-white text-xs font-mono bg-black/60 rounded px-1.5 py-0.5">{maskBottom}px</span>
                        </div>
                      )}
                      {cropLeft >= 32 && (
                        <div
                          className="absolute left-0 flex items-center justify-center pointer-events-none"
                          style={{ top: cropTop, bottom: cropBottom, width: cropLeft }}
                        >
                          <span className="text-white text-xs font-mono bg-black/60 rounded px-1.5 py-0.5">{maskLeft}px</span>
                        </div>
                      )}
                      {cropRight >= 32 && (
                        <div
                          className="absolute right-0 flex items-center justify-center pointer-events-none"
                          style={{ top: cropTop, bottom: cropBottom, width: cropRight }}
                        >
                          <span className="text-white text-xs font-mono bg-black/60 rounded px-1.5 py-0.5">{maskRight}px</span>
                        </div>
                      )}

                      {/* ── Drag handles ── */}
                      {/* Left handle — vertical bar centred on left edge */}
                      <div
                        className="absolute z-10 cursor-ew-resize touch-none"
                        style={{
                          left: cropLeft - 5,
                          top: dims.h / 2 - 22,
                          width: 10,
                          height: 44,
                          borderRadius: 5,
                          background: "rgba(255,255,255,0.92)",
                          boxShadow: "0 1px 6px rgba(0,0,0,0.55)",
                        }}
                        onPointerDown={startDrag("left")}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                      />
                      {/* Right handle */}
                      <div
                        className="absolute z-10 cursor-ew-resize touch-none"
                        style={{
                          right: cropRight - 5,
                          top: dims.h / 2 - 22,
                          width: 10,
                          height: 44,
                          borderRadius: 5,
                          background: "rgba(255,255,255,0.92)",
                          boxShadow: "0 1px 6px rgba(0,0,0,0.55)",
                        }}
                        onPointerDown={startDrag("right")}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                      />
                      {/* Top handle — horizontal bar centred on top edge */}
                      <div
                        className="absolute z-10 cursor-ns-resize touch-none"
                        style={{
                          top: cropTop - 5,
                          left: dims.w / 2 - 22,
                          width: 44,
                          height: 10,
                          borderRadius: 5,
                          background: "rgba(255,255,255,0.92)",
                          boxShadow: "0 1px 6px rgba(0,0,0,0.55)",
                        }}
                        onPointerDown={startDrag("top")}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                      />
                      {/* Bottom handle */}
                      <div
                        className="absolute z-10 cursor-ns-resize touch-none"
                        style={{
                          bottom: cropBottom - 5,
                          left: dims.w / 2 - 22,
                          width: 44,
                          height: 10,
                          borderRadius: 5,
                          background: "rgba(255,255,255,0.92)",
                          boxShadow: "0 1px 6px rgba(0,0,0,0.55)",
                        }}
                        onPointerDown={startDrag("bottom")}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                      />
                    </>
                  )}
                </div>

                {/* Image navigation (only shown when multiple images) */}
                {images.length > 1 && (
                  <div className="flex items-center gap-3">
                    <button
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      disabled={imageIndex === 0}
                      onClick={() => setImageIndex((i) => Math.max(0, i - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {imageIndex + 1} / {images.length}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      disabled={imageIndex === images.length - 1}
                      onClick={() => setImageIndex((i) => Math.min(images.length - 1, i + 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Pixel readout */}
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { label: "Left",   value: maskLeft   },
                  { label: "Right",  value: maskRight  },
                  { label: "Top",    value: maskTop    },
                  { label: "Bottom", value: maskBottom },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-muted rounded-md p-2">
                    <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">{label}</p>
                    <p className="font-mono text-sm font-medium">{value}px</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            {showCropUI && dims && (
              <Button
                size="sm"
                onClick={() => {
                  onApply({ mask_left: maskLeft, mask_right: maskRight, mask_top: maskTop, mask_bottom: maskBottom })
                  onClose()
                }}
              >
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Apply crop
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
