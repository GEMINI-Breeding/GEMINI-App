/**
 * Shared pieces for showing detection/classification predictions over an
 * image: the prediction shape, per-class colours, an authed blob-URL hook
 * and the overlay itself. Used by the inference tool and the per-job
 * results viewer.
 */
import { useEffect, useRef, useState } from "react"

import { apiUrl } from "@/features/files/lib/download"

export interface Prediction {
  image?: string
  class: string
  confidence: number
  /** Box geometry; absent for classification (whole-image) results. */
  x?: number
  y?: number
  width?: number
  height?: number
  points?: Array<{ x: number; y: number }>
}

export const hasBox = (
  p: Prediction,
): p is Prediction & { x: number; y: number; width: number; height: number } =>
  typeof p.x === "number" &&
  typeof p.y === "number" &&
  typeof p.width === "number" &&
  typeof p.height === "number"

const CLASS_COLOURS = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
  "#6366f1",
]

export function classColour(cls: string): string {
  let hash = 0
  for (let i = 0; i < cls.length; i += 1)
    hash = (hash * 31 + cls.charCodeAt(i)) | 0
  return CLASS_COLOURS[Math.abs(hash) % CLASS_COLOURS.length]
}

/** Authed fetch → blob URL for an arbitrary MinIO file. */
export function useAuthedBlobUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) {
      setUrl(null)
      return
    }
    let cancelled = false
    let urlRef: string | null = null
    const token = localStorage.getItem("gemini.auth.token") ?? ""
    fetch(apiUrl(`/api/files/download/${path}`), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (cancelled || !b) return
        urlRef = URL.createObjectURL(b)
        setUrl(urlRef)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
      if (urlRef) URL.revokeObjectURL(urlRef)
    }
  }, [path])
  return url
}

export function PredictionOverlay({
  src,
  alt,
  predictions,
  imgClassName = "block max-h-[60vh] w-full object-contain",
  onNaturalSize,
  showBoxes = true,
  showLabels = true,
  opacity = 1,
}: {
  src: string
  alt: string
  predictions: Prediction[]
  /** Sizing of the image; boxes follow whatever box the image ends up in. */
  imgClassName?: string
  onNaturalSize?: (width: number, height: number) => void
  /** Draw the boxes / their class names; how opaque the boxes are (0–1). */
  showBoxes?: boolean
  showLabels?: boolean
  opacity?: number
}) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    function onResize() {
      if (imgRef.current) setRect(imgRef.current.getBoundingClientRect())
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  return (
    <div className="relative w-fit min-w-full">
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={imgClassName}
        onLoad={() => {
          const img = imgRef.current
          if (!img) return
          setRect(img.getBoundingClientRect())
          onNaturalSize?.(img.naturalWidth, img.naturalHeight)
        }}
        draggable={false}
      />
      {predictions.length > 0 && !predictions.some(hasBox) && (
        // Classification: whole-image labels, best first — no boxes to draw.
        <div
          className="absolute left-2 top-2 space-y-1"
          data-testid="inference-classification"
        >
          {predictions.map((p, i) => (
            <span
              key={i}
              className="block w-fit rounded-sm px-1.5 py-0.5 text-xs font-medium text-white"
              style={{ background: classColour(p.class) }}
            >
              {p.class} {(p.confidence * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      )}
      {imgRef.current &&
        showBoxes &&
        predictions.filter(hasBox).map((p, i) => {
          const img = imgRef.current
          if (!img) return null
          const w = img.clientWidth
          const h = img.clientHeight
          let sx = w / img.naturalWidth
          let sy = h / img.naturalHeight
          // Fitted with object-contain, the picture is smaller than its box and
          // centred in it: scale and offset by the picture, not the box.
          let ox = img.offsetLeft
          let oy = img.offsetTop
          if (getComputedStyle(img).objectFit === "contain") {
            const k = Math.min(sx, sy)
            ox += (w - img.naturalWidth * k) / 2
            oy += (h - img.naturalHeight * k) / 2
            sx = k
            sy = k
          }
          const left = ox + (p.x - p.width / 2) * sx
          const top = oy + (p.y - p.height / 2) * sy
          const width = p.width * sx
          const height = p.height * sy
          const colour = classColour(p.class)
          return (
            <div
              key={i}
              className="pointer-events-none absolute border-2"
              style={{ left, top, width, height, borderColor: colour, opacity }}
              title={`${p.class} (${(p.confidence * 100).toFixed(0)}%)`}
            >
              {showLabels && (
                <span
                  className="absolute -top-4 left-0 rounded-sm px-1 text-[10px] font-medium text-white"
                  style={{ background: colour }}
                >
                  {p.class} {(p.confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>
          )
        })}
    </div>
  )
}

/** How results are drawn (boxes, names, opacity), kept per browser. */
export interface OverlayLook {
  showBoxes: boolean
  showLabels: boolean
  opacity: number
}

const LOOK_KEY = "gemini.inference.overlayLook"

export function readOverlayLook(): OverlayLook {
  try {
    const v = JSON.parse(localStorage.getItem(LOOK_KEY) ?? "null")
    if (v && typeof v === "object")
      return {
        showBoxes: v.showBoxes !== false,
        showLabels: v.showLabels !== false,
        opacity:
          typeof v.opacity === "number"
            ? Math.min(1, Math.max(0.1, v.opacity))
            : 1,
      }
  } catch {
    // no storage: defaults
  }
  return { showBoxes: true, showLabels: true, opacity: 1 }
}

export function saveOverlayLook(look: OverlayLook): void {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look))
  } catch {
    // no storage: this view only
  }
}

/** Boxes on/off, names on/off and box opacity, in one compact row. */
export function OverlayControls({
  look,
  onChange,
}: {
  look: OverlayLook
  onChange: (next: OverlayLook) => void
}) {
  const set = (patch: Partial<OverlayLook>) => {
    const next = { ...look, ...patch }
    saveOverlayLook(next)
    onChange(next)
  }
  return (
    <div
      className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs"
      data-testid="overlay-controls"
    >
      <label className="flex cursor-pointer items-center gap-1">
        <input
          type="checkbox"
          className="accent-primary"
          checked={look.showBoxes}
          onChange={(e) => set({ showBoxes: e.target.checked })}
        />
        Boxes
      </label>
      <label
        className={`flex items-center gap-1 ${look.showBoxes ? "cursor-pointer" : "opacity-50"}`}
      >
        <input
          type="checkbox"
          className="accent-primary"
          disabled={!look.showBoxes}
          checked={look.showLabels}
          onChange={(e) => set({ showLabels: e.target.checked })}
        />
        Names
      </label>
      <label
        className={`flex items-center gap-1 ${look.showBoxes ? "" : "opacity-50"}`}
      >
        Opacity
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          disabled={!look.showBoxes}
          value={look.opacity}
          onChange={(e) => set({ opacity: Number(e.target.value) })}
          className="accent-primary w-20"
          aria-label="Box opacity"
        />
      </label>
    </div>
  )
}
