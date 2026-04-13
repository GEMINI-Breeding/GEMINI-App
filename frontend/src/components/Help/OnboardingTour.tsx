/**
 * OnboardingTour
 *
 * Renders a full-screen SVG spotlight overlay + positioned tooltip card.
 * When a step has a selector, the overlay cuts a rounded rect around that
 * element so it appears illuminated. Steps with selector=null show a centred
 * modal instead.
 *
 * Usage: mount once in _layout.tsx, pass tourStep / total / handlers down via
 * the OnboardingContext.
 */

import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
import type { TourStep } from "./tourSteps"

interface Rect { x: number; y: number; w: number; h: number }

interface Props {
  steps: TourStep[]
  step: number
  onNext: () => void
  onBack: () => void
  onClose: () => void
}

const PAD = 10 // padding around the highlighted element
const TOOLTIP_W = 320

export function OnboardingTour({ steps, step, onNext, onBack, onClose }: Props) {
  const navigate = useNavigate()
  const data = steps[step]
  const [rect, setRect] = useState<Rect | null>(null)
  const [vw, setVw] = useState(window.innerWidth)
  const [vh, setVh] = useState(window.innerHeight)
  const rafRef = useRef<number | null>(null)

  // Keep viewport size in sync
  useEffect(() => {
    const onResize = () => { setVw(window.innerWidth); setVh(window.innerHeight) }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // Navigate to the step's route (if any), then find & track the target element
  useEffect(() => {
    let cancelled = false

    async function run() {
      if (data.route) {
        await navigate({ to: data.route })
        // Brief delay so the new page renders its nav items
        await new Promise((r) => setTimeout(r, 120))
      }

      if (!data.selector || cancelled) {
        setRect(null)
        return
      }

      function track() {
        if (cancelled) return
        const el = document.querySelector(data.selector!)
        if (el) {
          const r = el.getBoundingClientRect()
          setRect({ x: r.left, y: r.top, w: r.width, h: r.height })
          el.scrollIntoView({ block: "nearest", behavior: "smooth" })
        }
        rafRef.current = requestAnimationFrame(track)
      }
      track()
    }

    run()
    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [step, data, navigate])

  const isFirst = step === 0
  const isLast = step === steps.length - 1

  // ── Spotlight rect (with padding) ────────────────────────────────────────
  const spotX = rect ? rect.x - PAD : 0
  const spotY = rect ? rect.y - PAD : 0
  const spotW = rect ? rect.w + PAD * 2 : 0
  const spotH = rect ? rect.h + PAD * 2 : 0

  // ── Tooltip position: prefer below the element, flip above if too close to bottom ──
  let tooltipX: number
  let tooltipY: number
  const tooltipH = 160 // estimated

  if (!rect) {
    // Centred modal
    tooltipX = (vw - TOOLTIP_W) / 2
    tooltipY = (vh - tooltipH) / 2
  } else {
    tooltipX = Math.min(Math.max(spotX, 12), vw - TOOLTIP_W - 12)
    const belowY = spotY + spotH + 12
    tooltipY =
      belowY + tooltipH > vh - 12
        ? Math.max(spotY - tooltipH - 12, 12)
        : belowY
  }

  return (
    <>
      {/* SVG overlay with spotlight cutout */}
      <svg
        style={{
          position: "fixed",
          inset: 0,
          width: vw,
          height: vh,
          zIndex: 9998,
          pointerEvents: "all",
        }}
        onClick={onClose}
      >
        <defs>
          <mask id="gemi-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={spotX}
                y={spotY}
                width={spotW}
                height={spotH}
                rx={8}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.65)"
          mask="url(#gemi-tour-mask)"
        />
      </svg>

      {/* Spotlight border ring */}
      {rect && (
        <div
          style={{
            position: "fixed",
            left: spotX,
            top: spotY,
            width: spotW,
            height: spotH,
            borderRadius: 8,
            border: "2px solid hsl(var(--primary))",
            zIndex: 9999,
            pointerEvents: "none",
            boxSizing: "border-box",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        style={{
          position: "fixed",
          left: tooltipX,
          top: tooltipY,
          width: TOOLTIP_W,
          zIndex: 10000,
          pointerEvents: "all",
        }}
        onClick={(e) => e.stopPropagation()}
        className="rounded-xl border bg-popover text-popover-foreground shadow-2xl p-4 flex flex-col gap-3"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-sm leading-snug">{data.title}</p>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          {data.description}
        </p>

        {/* Footer: step counter + navigation */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">
            {step + 1} / {steps.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onBack}
              disabled={isFirst}
              className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={isLast ? onClose : onNext}
              className="rounded px-3 py-1 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {isLast ? "Done" : "Next"}
            </button>
            {!isLast && (
              <button
                type="button"
                onClick={onNext}
                className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Next"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
