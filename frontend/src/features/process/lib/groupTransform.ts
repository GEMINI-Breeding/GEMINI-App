/**
 * Group geometry transforms for the plot boundary editor.
 *
 * `translate` and `rotate` operate on a subset of GeoJSON features
 * (those whose `properties.cellId` is in the selection set), returning
 * a new feature array. Non-selected features pass through with strict
 * identity so React renders skip them.
 *
 * Coordinates are EPSG:4326 (lng/lat). Rotations are conformal in the
 * local tangent plane — good enough for the field sizes this app
 * handles (≤ a few hundred meters per side). Matches the approach used
 * by `grid.ts:generateGridFeatures`.
 */

type LngLat = [number, number]

function selectedCellIdOf(f: GeoJSON.Feature): string | null {
  const props = (f.properties ?? {}) as Record<string, unknown>
  if (props.role === "outer") return null
  const id = props.cellId
  return typeof id === "string" ? id : null
}

function isPolygonFeature(
  f: GeoJSON.Feature,
): f is GeoJSON.Feature<GeoJSON.Polygon> {
  return f.geometry?.type === "Polygon"
}

/**
 * Translate every coordinate of selected polygons by (dLng, dLat) in
 * degrees. Non-selected features pass through unchanged.
 */
export function translateFeatures(
  features: GeoJSON.Feature[],
  selected: ReadonlySet<string>,
  dLng: number,
  dLat: number,
): GeoJSON.Feature[] {
  if (selected.size === 0 || (dLng === 0 && dLat === 0)) return features
  return features.map((f) => {
    const id = selectedCellIdOf(f)
    if (!id || !selected.has(id) || !isPolygonFeature(f)) return f
    const moved: LngLat[][] = (f.geometry.coordinates as LngLat[][]).map(
      (ring) => ring.map(([x, y]) => [x + dLng, y + dLat] as LngLat),
    )
    return {
      ...f,
      geometry: { ...f.geometry, coordinates: moved },
    }
  })
}

/**
 * Centroid of every vertex on the outer ring of every selected polygon.
 * Returns null when nothing is selected or no selected feature is a
 * polygon.
 */
export function selectionCentroid(
  features: GeoJSON.Feature[],
  selected: ReadonlySet<string>,
): LngLat | null {
  if (selected.size === 0) return null
  let sx = 0
  let sy = 0
  let n = 0
  for (const f of features) {
    const id = selectedCellIdOf(f)
    if (!id || !selected.has(id) || !isPolygonFeature(f)) continue
    const ring = f.geometry.coordinates[0] as LngLat[]
    // Drop the closing-duplicate vertex (rings start and end at the
    // same point in GeoJSON) so the centroid isn't skewed toward the
    // first corner.
    const last = ring.length - 1
    const closes =
      ring.length > 1 &&
      ring[0][0] === ring[last][0] &&
      ring[0][1] === ring[last][1]
    const end = closes ? last : ring.length
    for (let i = 0; i < end; i += 1) {
      sx += ring[i][0]
      sy += ring[i][1]
      n += 1
    }
  }
  if (n === 0) return null
  return [sx / n, sy / n]
}

/**
 * Rotate selected polygons by `angleDeg` (counter-clockwise) around
 * their combined centroid. Properties are preserved; only the geometry
 * coordinates change.
 */
export function rotateFeatures(
  features: GeoJSON.Feature[],
  selected: ReadonlySet<string>,
  angleDeg: number,
): GeoJSON.Feature[] {
  if (selected.size === 0 || angleDeg === 0) return features
  const origin = selectionCentroid(features, selected)
  if (!origin) return features
  const rad = (angleDeg * Math.PI) / 180
  const cosA = Math.cos(rad)
  const sinA = Math.sin(rad)
  const [ox, oy] = origin
  return features.map((f) => {
    const id = selectedCellIdOf(f)
    if (!id || !selected.has(id) || !isPolygonFeature(f)) return f
    const rotated: LngLat[][] = (f.geometry.coordinates as LngLat[][]).map(
      (ring) =>
        ring.map(([x, y]) => {
          const dx = x - ox
          const dy = y - oy
          return [
            ox + dx * cosA - dy * sinA,
            oy + dx * sinA + dy * cosA,
          ] as LngLat
        }),
    )
    return {
      ...f,
      geometry: { ...f.geometry, coordinates: rotated },
    }
  })
}

/**
 * Flip the selected cells' numbering across the grid's own axes.
 *
 * `"rows"` mirrors top↔bottom (row r takes row minRow+maxRow−r's place),
 * `"cols"` mirrors left↔right. Each selected cell takes the geometry of
 * its mirror partner while keeping its own properties (plot / row / col /
 * accession), so the same footprint ends up numbered from the opposite
 * corner. Swapping geometry — rather than reflecting coordinates across a
 * lat/lng axis, as main did — keeps a rotated grid exactly in place.
 *
 * Cells without numeric row/col, or whose partner isn't selected, stay
 * where they are.
 */
export function mirrorFeatures(
  features: GeoJSON.Feature[],
  selected: ReadonlySet<string>,
  axis: "rows" | "cols",
): GeoJSON.Feature[] {
  if (selected.size === 0) return features
  type Cell = { row: number; col: number; geometry: GeoJSON.Polygon }
  const cells = new Map<string, Cell>()
  const byPos = new Map<string, GeoJSON.Polygon>()
  let minR = Infinity
  let maxR = -Infinity
  let minC = Infinity
  let maxC = -Infinity
  for (const f of features) {
    const id = selectedCellIdOf(f)
    if (!id || !selected.has(id) || !isPolygonFeature(f)) continue
    const p = (f.properties ?? {}) as Record<string, unknown>
    const row = Number(p.row)
    const col = Number(p.col)
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue
    cells.set(id, { row, col, geometry: f.geometry })
    byPos.set(`${row},${col}`, f.geometry)
    minR = Math.min(minR, row)
    maxR = Math.max(maxR, row)
    minC = Math.min(minC, col)
    maxC = Math.max(maxC, col)
  }
  if (cells.size === 0) return features
  return features.map((f) => {
    const id = selectedCellIdOf(f)
    const cell = id ? cells.get(id) : undefined
    if (!cell) return f
    const pr = axis === "rows" ? minR + maxR - cell.row : cell.row
    const pc = axis === "cols" ? minC + maxC - cell.col : cell.col
    const partner = byPos.get(`${pr},${pc}`)
    return partner && partner !== cell.geometry
      ? { ...f, geometry: partner }
      : f
  })
}
