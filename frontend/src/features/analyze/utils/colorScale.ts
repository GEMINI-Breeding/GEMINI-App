import { scaleLinear } from "d3-scale"

// Viridis — perceptually uniform, colorblind-friendly
const RAMP_STOPS = ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"] as const

/**
 * Build a color function using quantile normalization.
 *
 * Each value is mapped to its rank within the dataset (0–1) and that rank
 * is mapped through viridis. This ensures the full palette always spreads
 * evenly across all plots, regardless of skew or outliers.
 *
 * Returns: colorFn, and the actual min/max for the legend labels.
 */
export function buildColorScale(
  values: number[],
  _column: string,
): {
  colorFn: (value: number | null | undefined) => [number, number, number, number]
  min: number
  max: number
} {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length

  const ramp = scaleLinear<string>()
    .domain([0, 0.25, 0.5, 0.75, 1])
    .range([...RAMP_STOPS])
    .clamp(true)

  function quantileRank(v: number): number {
    if (n === 0) return 0.5
    // Binary search for lower bound
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < v) lo = mid + 1
      else hi = mid
    }
    return lo / (n > 1 ? n - 1 : 1)
  }

  return {
    colorFn: (value) => {
      if (value == null || isNaN(value as number)) return [128, 128, 128, 80]
      return hexToRgba(ramp(quantileRank(value as number)), 210)
    },
    min: sorted[0] ?? 0,
    max: sorted[n - 1] ?? 1,
  }
}

function hexToRgba(css: string, alpha: number): [number, number, number, number] {
  // d3 scaleLinear interpolates colors and returns "rgb(r, g, b)" strings
  const rgb = css.match(/\d+/g)
  if (rgb && rgb.length >= 3) {
    return [parseInt(rgb[0]), parseInt(rgb[1]), parseInt(rgb[2]), alpha]
  }
  // fallback for plain hex strings
  const h = css.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), alpha]
}

/** CSS gradient string for the legend. */
export function legendGradient(_column: string): string {
  return `linear-gradient(to right, ${RAMP_STOPS.join(", ")})`
}
