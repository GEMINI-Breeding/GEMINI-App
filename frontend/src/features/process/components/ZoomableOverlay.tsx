/**
 * ZoomableOverlay — an image with its detections that zooms and pans.
 *
 * The image and its boxes sit in one layer that is scaled with a CSS
 * transform; the boxes are placed in percent of the image, so zooming or
 * panning moves them with the picture at once (nothing is measured or
 * re-laid out). The viewer fills the height it is given.
 *
 * Wheel zooms at the pointer, drag pans, double-click toggles fit / 2×; the
 * buttons do the same (−, +, Fit, 1:1 = one screen pixel per image pixel).
 */
import { Maximize, Minus, Plus } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { classColour, hasBox, type Prediction } from "./predictionView"

const MAX_ZOOM = 24

/** A height that runs from where the element starts to the window's bottom
 *  (less `bottomGap` px), at least `min`: a panel that fills the page without
 *  making it scroll. Measured from the top of its scrolling area, so scrolling
 *  does not shrink it. */
export function useFillHeight<T extends HTMLElement>(
  bottomGap = 16,
  min = 240,
) {
  // A callback ref: the element may appear after the first render (shown
  // once its data loads); measuring starts when it does. Measuring only on
  // mount left such an element unsized, so it grew to all of its content.
  const [el, ref] = useState<T | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    if (!el) return
    const measure = () => {
      let top = el.getBoundingClientRect().top
      let p = el.parentElement
      while (p) {
        top += p.scrollTop
        p = p.parentElement
      }
      const h = Math.max(min, Math.floor(window.innerHeight - top - bottomGap))
      setHeight(h)
      // Whatever sits below still overflowing the scrolling area: give that
      // much back, so the page itself does not scroll.
      setTimeout(() => {
        let sc: HTMLElement | null = el.parentElement
        while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY))
          sc = sc.parentElement
        const over = sc ? sc.scrollHeight - sc.clientHeight : 0
        if (over > 0) setHeight(Math.max(min, h - over))
      }, 60)
    }
    measure()
    window.addEventListener("resize", measure)
    const t = setTimeout(measure, 300) // after the content above settles
    const ro = new ResizeObserver(measure)
    if (el.parentElement) ro.observe(el.parentElement)
    return () => {
      window.removeEventListener("resize", measure)
      clearTimeout(t)
      ro.disconnect()
    }
  }, [el, bottomGap, min])
  return [ref, height] as const
}

export function ZoomableOverlay({
  src,
  alt,
  predictions,
  showBoxes = true,
  showLabels = true,
  opacity = 1,
  className = "h-[60vh]",
  fillToBottom = false,
  bottomGap = 64,
  onNaturalSize,
}: {
  src: string
  alt: string
  predictions: Prediction[]
  showBoxes?: boolean
  showLabels?: boolean
  opacity?: number
  /** The viewer's size (its height above all). */
  className?: string
  /** Take the window's height from where the viewer starts, less
   *  `bottomGap` px (what sits below it), so the page needs no scroll. */
  fillToBottom?: boolean
  bottomGap?: number
  onNaturalSize?: (width: number, height: number) => void
}) {
  const viewRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState({ w: 0, h: 0 })
  const [fillH, setFillH] = useState<number | null>(null)
  useEffect(() => {
    if (!fillToBottom) return
    const measure = () => {
      const el = viewRef.current
      if (!el) return
      // From the top of its scrolling area, so a scrolled page does not shrink it.
      let top = el.getBoundingClientRect().top
      let p = el.parentElement
      while (p) {
        top += p.scrollTop
        p = p.parentElement
      }
      setFillH(Math.max(240, Math.floor(window.innerHeight - top - bottomGap)))
    }
    measure()
    window.addEventListener("resize", measure)
    const t = setTimeout(measure, 300) // after the content above settles
    return () => {
      window.removeEventListener("resize", measure)
      clearTimeout(t)
    }
  }, [fillToBottom, bottomGap])
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  // z: zoom relative to "fit"; tx, ty: where the image's corner sits.
  const [t, setT] = useState({ z: 1, x: 0, y: 0 })

  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setView({ w: e.contentRect.width, h: e.contentRect.height }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit =
    nat && view.w && view.h ? Math.min(view.w / nat.w, view.h / nat.h) : 0
  const baseW = nat ? nat.w * fit : 0
  const baseH = nat ? nat.h * fit : 0

  const fitView = useCallback(() => {
    setT({ z: 1, x: (view.w - baseW) / 2, y: (view.h - baseH) / 2 })
  }, [view.w, view.h, baseW, baseH])

  // Keep the image in view: smaller than the viewer it stays centred; larger,
  // its edges may come in by only a small margin (room for edge labels).
  const clamp = useCallback(
    (c: { z: number; x: number; y: number }) => {
      const M = 24
      const axis = (pos: number, size: number, viewSize: number) =>
        size <= viewSize
          ? (viewSize - size) / 2
          : Math.min(M, Math.max(viewSize - size - M, pos))
      return {
        z: c.z,
        x: axis(c.x, baseW * c.z, view.w),
        y: axis(c.y, baseH * c.z, view.h),
      }
    },
    [baseW, baseH, view.w, view.h],
  )

  // A new image, or a resized viewer: fit it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refit on a new image or size only
  useEffect(() => {
    fitView()
  }, [src, view.w, view.h, nat?.w, nat?.h])

  const zoomAt = useCallback(
    (factor: number, px?: number, py?: number) => {
      setT((cur) => {
        const z = Math.min(
          MAX_ZOOM / Math.max(fit, 1e-6),
          Math.max(0.5, cur.z * factor),
        )
        const cx = px ?? view.w / 2
        const cy = py ?? view.h / 2
        const k = z / cur.z
        return clamp({
          z,
          x: cx - (cx - cur.x) * k,
          y: cy - (cy - cur.y) * k,
        })
      })
    },
    [fit, view.w, view.h, clamp],
  )

  // Wheel zoom (a non-passive listener, so the page does not scroll).
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(
        Math.exp(-e.deltaY * 0.0015),
        e.clientX - r.left,
        e.clientY - r.top,
      )
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomAt])

  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null,
  )

  const pct = fit ? Math.round(fit * t.z * 100) : 0
  const boxes = showBoxes && nat ? predictions.filter(hasBox) : []
  const labels = predictions.length > 0 && !predictions.some(hasBox)

  return (
    <div
      ref={viewRef}
      role="application"
      aria-label={`${alt}: wheel or the buttons zoom, drag to move`}
      className={`relative select-none overflow-hidden bg-black ${className} ${drag.current ? "cursor-grabbing" : "cursor-grab"}`}
      style={fillH ? { height: fillH } : undefined}
      onPointerDown={(e) => {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        setT((cur) =>
          clamp({
            ...cur,
            x: d.tx + e.clientX - d.x,
            y: d.ty + e.clientY - d.y,
          }),
        )
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onDoubleClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        if (t.z > 1.01) fitView()
        else zoomAt(2, e.clientX - r.left, e.clientY - r.top)
      }}
      data-testid="zoomable-overlay"
    >
      <div
        className="absolute top-0 left-0 origin-top-left will-change-transform"
        style={{
          width: baseW || "100%",
          height: baseH || "100%",
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.z})`,
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="block h-full w-full"
          onLoad={(e) => {
            const img = e.currentTarget
            setNat({ w: img.naturalWidth, h: img.naturalHeight })
            onNaturalSize?.(img.naturalWidth, img.naturalHeight)
          }}
        />
        {nat &&
          boxes.map((p, i) => {
            const colour = classColour(p.class)
            return (
              <div
                key={i}
                className="pointer-events-none absolute"
                style={{
                  left: `${((p.x - p.width / 2) / nat.w) * 100}%`,
                  top: `${((p.y - p.height / 2) / nat.h) * 100}%`,
                  width: `${(p.width / nat.w) * 100}%`,
                  height: `${(p.height / nat.h) * 100}%`,
                  // The same on-screen line width at any zoom.
                  border: `${2 / t.z}px solid ${colour}`,
                  opacity,
                }}
              >
                {showLabels && (
                  <span
                    className="absolute bottom-full left-0 origin-bottom-left whitespace-nowrap rounded-sm px-1 text-[10px] font-medium text-white"
                    style={{
                      background: colour,
                      transform: `scale(${1 / t.z})`,
                    }}
                  >
                    {p.class} {(p.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            )
          })}
      </div>

      {labels && (
        // Classification: whole-image labels, best first.
        <div
          className="absolute top-2 left-2 space-y-1"
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

      <div
        role="toolbar"
        aria-label="Zoom"
        className="bg-background/85 absolute top-2 right-2 flex items-center gap-0.5 rounded-md border p-0.5 text-xs shadow-sm"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        data-testid="zoom-controls"
      >
        <button
          type="button"
          className="hover:bg-muted rounded p-1"
          onClick={() => zoomAt(1 / 1.5)}
          aria-label="Zoom out"
          title="Zoom out (wheel)"
        >
          <Minus className="size-3.5" />
        </button>
        <span className="w-11 text-center tabular-nums">{pct}%</span>
        <button
          type="button"
          className="hover:bg-muted rounded p-1"
          onClick={() => zoomAt(1.5)}
          aria-label="Zoom in"
          title="Zoom in (wheel; double-click a spot)"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          className="hover:bg-muted flex items-center gap-1 rounded px-1.5 py-1"
          onClick={fitView}
          title="The whole image in view"
        >
          <Maximize className="size-3.5" /> Fit
        </button>
        <button
          type="button"
          className="hover:bg-muted rounded px-1.5 py-1"
          onClick={() => fit && zoomAt(1 / (fit * t.z))}
          title="One screen pixel per image pixel"
        >
          1:1
        </button>
      </div>
    </div>
  )
}
