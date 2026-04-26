/**
 * Grid-generation helpers for plot boundaries.
 *
 * Given an outer polygon and a desired (rows, cols, angle) the generator
 * lays out a grid of equally-sized rectangular plots. Used by
 * PlotBoundaries when the user prefers grid input over free-hand drawing.
 *
 * Coordinates everywhere are EPSG:4326 (lat/lng). Plot rectangles are
 * approximated by a local-tangent-plane projection at the polygon
 * centroid; for the field sizes this app handles (≤ a few hundred meters
 * per side) the resulting distortion is sub-pixel.
 */

const EARTH_RADIUS_M = 6_378_137

export type GridParams = {
  rows: number
  cols: number
  /** Rotation of the grid in degrees (counter-clockwise from east). */
  angleDeg: number
  /** Horizontal gap between plots, in meters. */
  gapXMeters?: number
  /** Vertical gap between plots, in meters. */
  gapYMeters?: number
}

type LngLat = [number, number]

function bboxOf(coords: LngLat[]): [number, number, number, number] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of coords) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

function metersToDeg(meters: number, atLatDeg: number): { dLat: number; dLng: number } {
  const dLat = (meters / EARTH_RADIUS_M) * (180 / Math.PI)
  const dLng =
    (meters / (EARTH_RADIUS_M * Math.cos((atLatDeg * Math.PI) / 180))) * (180 / Math.PI)
  return { dLat, dLng }
}

function rotate(point: LngLat, origin: LngLat, angleRad: number): LngLat {
  const [px, py] = point
  const [ox, oy] = origin
  const dx = px - ox
  const dy = py - oy
  return [ox + dx * Math.cos(angleRad) - dy * Math.sin(angleRad), oy + dx * Math.sin(angleRad) + dy * Math.cos(angleRad)]
}

/**
 * Generate a grid of plot rectangles inscribed in an outer polygon's bounding box.
 */
export function generateGridFeatures(
  outer: GeoJSON.Polygon,
  params: GridParams,
): GeoJSON.Feature[] {
  const ring = outer.coordinates[0] as LngLat[]
  if (!ring || ring.length < 4) return []

  const [minX, minY, maxX, maxY] = bboxOf(ring)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  const widthDeg = maxX - minX
  const heightDeg = maxY - minY

  const cols = Math.max(1, Math.floor(params.cols))
  const rows = Math.max(1, Math.floor(params.rows))

  const gapX = params.gapXMeters ?? 0
  const gapY = params.gapYMeters ?? 0
  const { dLng: gapXDeg } = metersToDeg(gapX, cy)
  const { dLat: gapYDeg } = metersToDeg(gapY, cy)

  const cellWDeg = (widthDeg - (cols - 1) * gapXDeg) / cols
  const cellHDeg = (heightDeg - (rows - 1) * gapYDeg) / rows

  const angleRad = (params.angleDeg * Math.PI) / 180
  const features: GeoJSON.Feature[] = []
  let plotNum = 1

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x0 = minX + c * (cellWDeg + gapXDeg)
      const x1 = x0 + cellWDeg
      const y1 = maxY - r * (cellHDeg + gapYDeg)
      const y0 = y1 - cellHDeg

      const corners: LngLat[] = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ]
      const rotated =
        params.angleDeg === 0 ? corners : corners.map((p) => rotate(p, [cx, cy], angleRad))

      features.push({
        type: "Feature",
        properties: {
          plot: plotNum,
          row: r + 1,
          col: c + 1,
        },
        geometry: { type: "Polygon", coordinates: [rotated] },
      })
      plotNum += 1
    }
  }
  return features
}

/** Centroid of a Polygon's outer ring (no holes). */
export function polygonCentroid(poly: GeoJSON.Polygon): LngLat {
  const ring = poly.coordinates[0] as LngLat[]
  if (!ring || ring.length === 0) return [0, 0]
  let sx = 0
  let sy = 0
  // Skip the duplicated closing vertex.
  const n = ring.length - 1
  for (let i = 0; i < n; i += 1) {
    sx += ring[i][0]
    sy += ring[i][1]
  }
  return [sx / n, sy / n]
}
