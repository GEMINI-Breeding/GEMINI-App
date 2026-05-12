// Shared SVG helpers used by custom charts in the analyze feature
// (CorrelationHeatmap today, SpatialHeatmap / PcaBiplot / GgeBiplot in later
// phases). The forest plot in TraitCharts.tsx still uses its own inline
// helpers; refactoring it into these primitives is a follow-up.

export interface Linear {
  domain: [number, number]
  range: [number, number]
}

export function linearScale({ domain, range }: Linear) {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  if (span === 0) {
    return () => (r0 + r1) / 2
  }
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0)
}

// Quantize a number in [-1, 1] (correlation) to a diverging color.
// Red for negative, white for 0, blue for positive.
export function divergingColor(v: number): string {
  const clamped = Math.max(-1, Math.min(1, v))
  if (clamped >= 0) {
    const t = clamped
    const r = Math.round(255 - t * (255 - 33))
    const g = Math.round(255 - t * (255 - 102))
    const b = Math.round(255 - t * (255 - 172))
    return `rgb(${r},${g},${b})`
  } else {
    const t = -clamped
    const r = Math.round(255 - t * (255 - 178))
    const g = Math.round(255 - t * (255 - 24))
    const b = Math.round(255 - t * (255 - 43))
    return `rgb(${r},${g},${b})`
  }
}

// Quantize a number in [0, 1] to a viridis-ish sequential color.
// Low = dark purple, mid = teal, high = yellow.
export function sequentialColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  // Three-stop interpolation: (68,1,84) → (33,144,140) → (253,231,37)
  const stops: [number, number, number][] = [
    [68, 1, 84],
    [33, 144, 140],
    [253, 231, 37],
  ]
  const seg = clamped < 0.5 ? 0 : 1
  const local = clamped < 0.5 ? clamped * 2 : (clamped - 0.5) * 2
  const a = stops[seg]
  const b = stops[seg + 1]
  const r = Math.round(a[0] + (b[0] - a[0]) * local)
  const g = Math.round(a[1] + (b[1] - a[1]) * local)
  const bl = Math.round(a[2] + (b[2] - a[2]) * local)
  return `rgb(${r},${g},${bl})`
}

// Pick text color (black or white) that has decent contrast on a given
// background color rgb string.
export function textOn(bg: string): string {
  const m = bg.match(/rgb\((\d+),(\d+),(\d+)\)/)
  if (!m) return "#000"
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luma > 0.6 ? "#000" : "#fff"
}
