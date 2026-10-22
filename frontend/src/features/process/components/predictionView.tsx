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
}: {
  src: string
  alt: string
  predictions: Prediction[]
  /** Sizing of the image; boxes follow whatever box the image ends up in. */
  imgClassName?: string
  onNaturalSize?: (width: number, height: number) => void
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
        predictions.filter(hasBox).map((p, i) => {
          const img = imgRef.current
          if (!img) return null
          const w = img.clientWidth
          const h = img.clientHeight
          const sx = w / img.naturalWidth
          const sy = h / img.naturalHeight
          const left = (p.x - p.width / 2) * sx
          const top = (p.y - p.height / 2) * sy
          const width = p.width * sx
          const height = p.height * sy
          const colour = classColour(p.class)
          return (
            <div
              key={i}
              className="pointer-events-none absolute border-2"
              style={{ left, top, width, height, borderColor: colour }}
              title={`${p.class} (${(p.confidence * 100).toFixed(0)}%)`}
            >
              <span
                className="absolute -top-4 left-0 rounded-sm px-1 text-[10px] font-medium text-white"
                style={{ background: colour }}
              >
                {p.class} {(p.confidence * 100).toFixed(0)}%
              </span>
            </div>
          )
        })}
    </div>
  )
}
