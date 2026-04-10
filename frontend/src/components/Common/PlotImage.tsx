/**
 * PlotImage — shared authenticated plot image viewer with:
 *   - Auth'd image loading via blob URL
 *   - Rotation support (ground stitches appear rotated 90° CW)
 *     Uses ResizeObserver + swapped CSS dims + object-cover to fill container
 *   - Detection overlay canvas with correct coordinate math
 *     Non-rotated: object-contain letterboxing compensation
 *     Rotated: CSS-box-to-screen coordinate transform
 *   - Class filter (activeClass=null shows all)
 *   - Label toggle
 *   - Per-image rotation toggle button
 *
 * Parent is responsible for:
 *   showDetections / showLabels / activeClass state + UI toggles
 *   predictions array (per-plot)
 *   sizing this component (it fills w-full h-full of its container)
 */

import { useState, useEffect, useRef } from "react"
import { Loader2, ImageOff } from "lucide-react"

// ── Public types ───────────────────────────────────────────────────────────────

export interface Prediction {
  image: string
  class: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
  points?: Array<{ x: number; y: number }>
}

// ── Colour helpers ────────────────────────────────────────────────────────────

const CLASS_COLOURS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
]

export function classColour(cls: string): string {
  let h = 0
  for (let i = 0; i < cls.length; i++) h = (h * 31 + cls.charCodeAt(i)) | 0
  return CLASS_COLOURS[Math.abs(h) % CLASS_COLOURS.length]
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

export function plotImageUrl(recordId: string, plotId: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  const path = `/api/v1/analyze/trait-records/${recordId}/plot-image/${encodeURIComponent(plotId)}`
  return base ? `${base}${path}` : path
}

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("access_token") || ""
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface PlotImageProps {
  recordId: string
  plotId: string
  /** When true, image is displayed rotated 90° CW (for ground/stitch plots). */
  rotate?: boolean
  predictions?: Prediction[]
  showDetections?: boolean
  showLabels?: boolean
  /** null = all classes; string = only that class */
  activeClass?: string | null
  className?: string
}

export function PlotImage({
  recordId,
  plotId,
  rotate = false,
  predictions = [],
  showDetections = false,
  showLabels = true,
  activeClass = null,
  className,
}: PlotImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null)
  const [rotateOverride, setRotateOverride] = useState<boolean | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const shouldRotate = rotateOverride !== null ? rotateOverride : rotate

  // Reset per-image override whenever the rotate prop changes
  useEffect(() => { setRotateOverride(null) }, [rotate])

  // Track container dimensions for both rotation math and canvas sizing
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const e = entries[0]
      if (e) setContainerSize({ w: e.contentRect.width, h: e.contentRect.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Fetch image (authenticated)
  useEffect(() => {
    setBlobUrl(null); setErrored(false); setDims(null)
    let revoked = false; let objectUrl: string | null = null
    fetch(plotImageUrl(recordId, plotId), { headers: authHeaders() })
      .then((res) => { if (!res.ok) throw new Error(); return res.blob() })
      .then((blob) => {
        if (!revoked) { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl) }
      })
      .catch(() => { if (!revoked) setErrored(true) })
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [recordId, plotId])

  // Draw detection overlay — correct coordinate math for both orientations
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !containerSize) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const { w: cw, h: ch } = containerSize
    canvas.width = cw
    canvas.height = ch
    ctx.clearRect(0, 0, cw, ch)

    const activePreds = activeClass
      ? predictions.filter((p) => p.class === activeClass)
      : predictions

    if (!dims || !showDetections || activePreds.length === 0) return

    const { w: W, h: H } = dims

    if (shouldRotate) {
      // ── Rotated: CSS box is (ch × cw), rotate(90deg) = 90° CW ────────────
      // CSS rotate(90deg) matrix: (dx,dy) → (-dy, dx)
      // Full mapping (element at top:50%,left:50% + translate(-50%,-50%)):
      //   screen_x = cw - css_y
      //   screen_y = css_x
      const cssBoxW = ch  // CSS box width  = container height
      const cssBoxH = cw  // CSS box height = container width
      const scale = Math.min(cssBoxW / W, cssBoxH / H)
      const offX = (cssBoxW - W * scale) / 2  // horizontal offset in CSS box
      const offY = (cssBoxH - H * scale) / 2  // vertical offset in CSS box

      for (const p of activePreds) {
        const color = classColour(p.class)
        // Image pixel → CSS box: (px*scale+offX, py*scale+offY)
        // CSS box → screen: screen_x = cw - css_y,  screen_y = css_x
        // Bounding box:
        //   sx (left)   = cw - (py + ph/2)*scale - offY
        //   sy (top)    = (px - pw/2)*scale + offX
        //   sw (width)  = ph * scale
        //   sh (height) = pw * scale
        const sx = cw - (p.y + p.height / 2) * scale - offY
        const sy = (p.x - p.width / 2) * scale + offX
        const sw = p.height * scale
        const sh = p.width * scale
        // Skip if completely outside canvas
        if (sx + sw < 0 || sx > cw || sy + sh < 0 || sy > ch) continue
        ctx.strokeStyle = color; ctx.lineWidth = 2
        ctx.strokeRect(sx, sy, sw, sh)
        if (showLabels) {
          const label = `${p.class} ${(p.confidence * 100).toFixed(0)}%`
          ctx.font = "10px monospace"
          const tw = ctx.measureText(label).width
          const lx = Math.max(0, sx)
          const ly = Math.max(14, sy)
          ctx.fillStyle = color; ctx.fillRect(lx, ly - 14, tw + 6, 14)
          ctx.fillStyle = "#fff"; ctx.fillText(label, lx + 3, ly - 2)
        }
      }
    } else {
      // ── Non-rotated: object-contain with letterboxing compensation ─────────
      const scale = Math.min(cw / W, ch / H)
      const offX = (cw - W * scale) / 2
      const offY = (ch - H * scale) / 2
      for (const p of activePreds) {
        const color = classColour(p.class)
        const x = (p.x - p.width / 2) * scale + offX
        const y = (p.y - p.height / 2) * scale + offY
        const w = p.width * scale; const h = p.height * scale
        ctx.strokeStyle = color; ctx.lineWidth = 2
        ctx.strokeRect(x, y, w, h)
        if (showLabels) {
          const label = `${p.class} ${(p.confidence * 100).toFixed(0)}%`
          ctx.font = "10px monospace"
          const tw = ctx.measureText(label).width
          const lx = Math.max(offX, x)
          const ly = Math.max(offY + 14, y)
          ctx.fillStyle = color; ctx.fillRect(lx, ly - 14, tw + 6, 14)
          ctx.fillStyle = "#fff"; ctx.fillText(label, lx + 3, ly - 2)
        }
      }
    }
  }, [dims, predictions, showDetections, showLabels, activeClass, shouldRotate, containerSize])

  // Image CSS style — swapped dims + object-cover for ground, contain for aerial
  const imgStyle: React.CSSProperties = shouldRotate && containerSize
    ? {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%) rotate(90deg)",
        width: `${containerSize.h}px`,   // CSS box width  = container height
        height: `${containerSize.w}px`,  // CSS box height = container width
        objectFit: "contain",
      }
    : {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "contain",
      }

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden bg-muted/20 ${className ?? ""}`}
    >
      {errored ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
          <ImageOff className="w-6 h-6" />
          <span className="text-xs">No image</span>
        </div>
      ) : !blobUrl ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <img
            src={blobUrl}
            alt={`plot ${plotId}`}
            style={imgStyle}
            onLoad={(e) =>
              setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 pointer-events-none"
          />
          {/* Rotation toggle button */}
          <button
            onClick={() => setRotateOverride(!shouldRotate)}
            title={shouldRotate ? "Reset orientation" : "Rotate 90°"}
            className="absolute top-1 right-1 z-10 bg-black/40 hover:bg-black/60 text-white rounded p-1 transition-colors"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" strokeOpacity=".3" />
              <path d="M17 8l-5-5-5 5M12 3v9" />
            </svg>
          </button>
        </>
      )}
    </div>
  )
}
