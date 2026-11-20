/**
 * GPS corrections for stitched ground plots, set on the Plot Boundary map
 * when the rover's GPS is off: the whole track shifted, and per bed (one
 * pass of the rover; one lane of it when a frame shows several plots)
 * straightened onto a line, rotated, and shifted.
 *
 * The same rules as the stitch worker's associate step
 * (backend gemini/workers/stitch/corrections.py), so what the map shows is
 * where association puts each plot.
 */

export type Ring = [number, number][] // [lon, lat]

export interface BedCorrection {
  shift_m?: [number, number] // east, north
  rotate_deg?: number // clockwise, as on a compass
  straighten?: boolean
}

export interface GpsCorrections {
  shift_m?: [number, number]
  beds?: Record<string, BedCorrection>
  /** Which bed each stitched plot is in. */
  plot_bed?: Record<string, string>
}

const M_PER_DEG_LAT = 111_320

function centre(ring: Ring): [number, number] {
  const pts =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring
  const n = pts.length || 1
  return [
    pts.reduce((a, p) => a + p[0], 0) / n,
    pts.reduce((a, p) => a + p[1], 0) / n,
  ]
}

function lineFit(points: [number, number][]) {
  const n = points.length
  const cx = points.reduce((a, p) => a + p[0], 0) / n
  const cy = points.reduce((a, p) => a + p[1], 0) / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const [x, y] of points) {
    sxx += (x - cx) ** 2
    syy += (y - cy) ** 2
    sxy += (x - cx) * (y - cy)
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return {
    c: [cx, cy] as const,
    u: [Math.cos(angle), Math.sin(angle)] as const,
  }
}

/** Corrected footprints, {plot id: ring}. */
export function applyCorrections(
  footprints: Record<string, Ring>,
  corrections: GpsCorrections | null | undefined,
): Record<string, Ring> {
  const ids = Object.keys(footprints)
  if (!ids.length || !corrections) return footprints
  const [lon0, lat0] = centre(footprints[ids[0]])
  const kx = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)
  const toM = ([lon, lat]: [number, number]): [number, number] => [
    (lon - lon0) * kx,
    (lat - lat0) * M_PER_DEG_LAT,
  ]
  const rings: Record<string, [number, number][]> = {}
  for (const id of ids) rings[id] = footprints[id].map(toM)

  const beds: Record<string, string[]> = {}
  for (const id of ids) {
    const bed = corrections.plot_bed?.[id]
    if (bed == null) continue
    if (!beds[bed]) beds[bed] = []
    beds[bed].push(id)
  }
  for (const [bed, pids] of Object.entries(beds)) {
    const spec = corrections.beds?.[bed] ?? {}
    const centres: Record<string, [number, number]> = {}
    for (const id of pids) centres[id] = centre(rings[id])
    if (spec.straighten && pids.length >= 2) {
      const { c, u } = lineFit(Object.values(centres))
      for (const id of pids) {
        const [px, py] = centres[id]
        const along = (px - c[0]) * u[0] + (py - c[1]) * u[1]
        const tx = c[0] + along * u[0] - px
        const ty = c[1] + along * u[1] - py
        rings[id] = rings[id].map(([x, y]) => [x + tx, y + ty])
        centres[id] = [px + tx, py + ty]
      }
    }
    const rot = ((spec.rotate_deg ?? 0) * Math.PI) / 180
    if (rot) {
      const cs = Object.values(centres)
      const bx = cs.reduce((a, p) => a + p[0], 0) / cs.length
      const by = cs.reduce((a, p) => a + p[1], 0) / cs.length
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)
      for (const id of pids)
        rings[id] = rings[id].map(([x, y]) => [
          bx + (x - bx) * cos + (y - by) * sin,
          by - (x - bx) * sin + (y - by) * cos,
        ])
    }
    const [dx, dy] = spec.shift_m ?? [0, 0]
    if (dx || dy)
      for (const id of pids)
        rings[id] = rings[id].map(([x, y]) => [x + dx, y + dy])
  }
  const [gx, gy] = corrections.shift_m ?? [0, 0]
  const out: Record<string, Ring> = {}
  for (const id of ids)
    out[id] = rings[id].map(([x, y]) => [
      lon0 + (x + gx) / kx,
      lat0 + (y + gy) / M_PER_DEG_LAT,
    ])
  return out
}

export interface StitchedPlot {
  id: string
  footprint: Ring
  lane: number
  lanes: number
  direction: string
}

/**
 * Beds of a stitch: one per lane per rover pass. Plots are walked in marked
 * order (stretch by stretch). A new pass starts where the stitching
 * direction changes, or where the rover's travel turns by more than 60°
 * (its serpentine turn at the end of a bed; the camera's direction need not
 * change). Keys like "lane 1 · pass 2", or "pass 2" with one plot per frame.
 */
export function bedsOf(plots: StitchedPlot[]): Record<string, string> {
  const stretchOf = (p: StitchedPlot) => Math.ceil(Number(p.id) / p.lanes)
  const ordered = [...plots].sort(
    (a, b) => stretchOf(a) - stretchOf(b) || a.lane - b.lane,
  )
  // One point per stretch, in metres from the first plot (a shared origin and
  // scale: per-point scaling of absolute longitudes is off by metres).
  const first = ordered[0]?.footprint[0]
  const lon0 = first?.[0] ?? 0
  const lat0 = first?.[1] ?? 0
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const stretches: { stretch: number; dir: string; x: number; y: number }[] = []
  for (const p of ordered) {
    const st = stretchOf(p)
    if (stretches.at(-1)?.stretch === st) continue
    const pts = p.footprint.slice(0, -1)
    if (!pts.length) continue
    const lon = pts.reduce((a, q) => a + q[0], 0) / pts.length
    const lat = pts.reduce((a, q) => a + q[1], 0) / pts.length
    stretches.push({
      stretch: st,
      dir: p.direction,
      x: (lon - lon0) * kx,
      y: (lat - lat0) * 111_320,
    })
  }
  const passOf = new Map<number, number>()
  let pass = 1
  let heading: [number, number] | null = null
  stretches.forEach((s, i) => {
    if (i > 0) {
      const prev = stretches[i - 1]
      const dx = s.x - prev.x
      const dy = s.y - prev.y
      const len = Math.hypot(dx, dy)
      const step: [number, number] | null =
        len > 0 ? [dx / len, dy / len] : null
      const turned =
        heading && step
          ? heading[0] * step[0] + heading[1] * step[1] < Math.cos(Math.PI / 3)
          : false
      if (s.dir !== prev.dir || turned) {
        pass += 1
        heading = null // set by the next step inside the new pass
      } else if (!heading && step) heading = step
    }
    passOf.set(s.stretch, pass)
  })
  const out: Record<string, string> = {}
  for (const p of ordered) {
    const n = passOf.get(stretchOf(p)) ?? 1
    out[p.id] = p.lanes > 1 ? `lane ${p.lane} · pass ${n}` : `pass ${n}`
  }
  return out
}

/** The directory the corrections of one stitch version are versioned under. */
export function correctionsDirectory(stitchPrefix: string): string {
  return `${stitchPrefix.replace(/\/+$/, "")}/gps-corrections`
}
