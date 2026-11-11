/**
 * Plot marking from drone plot boundaries: the plots drawn on a drone
 * orthomosaic of the same field mark where each plot starts and ends on a
 * rover (Amiga) track, before stitching.
 *
 * 1. The track is split into passes (one drive down a bed; turns between
 *    beds belong to none).
 * 2. The drone plots are grouped into beds along the passes' direction.
 * 3. How well the rover's GPS sits on those beds is measured: each pass's
 *    distance across from the nearest bed's centre line. RTK on the rover
 *    and an orthomosaic without ground control often disagree by a metre or
 *    more, and an antenna mounted off the camera's centre puts every other
 *    pass on the wrong side.
 * 4. A correction of the raw GPS: the whole track shifted, an offset in the
 *    rover's own frame (antenna ahead of / beside the camera, so it flips
 *    with the direction of travel), and per pass straightened onto a line,
 *    rotated and shifted — "Snap to beds" sets these from the drone beds.
 * 5. Each frame of a pass inside a plot polygon belongs to that plot: the
 *    first and last such frame are the plot's start and end, and the plot
 *    keeps the drone plot's label, so association need not rely on the
 *    rover's GPS at all.
 *
 * All geometry is in metres on a local flat frame (equirectangular), which
 * is exact enough over a field.
 */
import type { PlotSelection, TrackPoint } from "./groundTrack"

const M_PER_DEG_LAT = 111_320

export type XY = [number, number]

export class LocalFrame {
  readonly kx: number
  constructor(
    readonly lon0: number,
    readonly lat0: number,
  ) {
    this.kx = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)
  }
  toM(lon: number, lat: number): XY {
    return [(lon - this.lon0) * this.kx, (lat - this.lat0) * M_PER_DEG_LAT]
  }
  toDeg([x, y]: XY): { lon: number; lat: number } {
    return { lon: this.lon0 + x / this.kx, lat: this.lat0 + y / M_PER_DEG_LAT }
  }
}

const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const norm = (a: XY): XY => {
  const l = Math.hypot(a[0], a[1]) || 1
  return [a[0] / l, a[1] / l]
}
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Centre and direction of the best line through some points (PCA). */
export function lineFit(points: XY[]): { c: XY; u: XY } {
  const n = points.length || 1
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
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return { c: [cx, cy], u: [Math.cos(a), Math.sin(a)] }
}

// ── Passes ───────────────────────────────────────────────────────────────

export interface Pass {
  /** 1, 2, … in driving order. */
  id: number
  /** Indices into the located points, in order. */
  idx: number[]
  /** Unit direction of travel. */
  u: XY
  centre: XY
  length_m: number
}

/** A frame farther than this from the previous one starts a new pass. */
const JUMP_M = 4
/** Shorter than this is a turn, not a pass down a bed. */
const MIN_PASS_M = 6

/**
 * Passes of a track: runs of frames heading the same way (within 45°).
 * Heading is taken over a few metres, so GPS jitter while the rover crawls
 * does not split a pass.
 */
export function passesOf(xy: XY[]): Pass[] {
  const n = xy.length
  if (n < 2) return []
  // Heading at each frame: towards the frame ~1.5 m on (or back).
  const heading: (XY | null)[] = xy.map((p, i) => {
    let j = i + 1
    while (j < n && Math.hypot(...sub(xy[j], p)) < 1.5) j++
    if (j < n && Math.hypot(...sub(xy[j], p)) < JUMP_M * 3)
      return norm(sub(xy[j], p))
    let k = i - 1
    while (k >= 0 && Math.hypot(...sub(p, xy[k])) < 1.5) k--
    return k >= 0 ? norm(sub(p, xy[k])) : null
  })
  const runs: number[][] = []
  let run: number[] = []
  let mean: XY | null = null
  for (let i = 0; i < n; i++) {
    const h = heading[i]
    const jump = i > 0 && Math.hypot(...sub(xy[i], xy[i - 1])) > JUMP_M
    const turned = mean && h ? dot(mean, h) < Math.SQRT1_2 : false
    if (run.length && (jump || turned)) {
      runs.push(run)
      run = []
      mean = null
    }
    run.push(i)
    if (h)
      mean = mean
        ? norm([mean[0] * 0.9 + h[0] * 0.1, mean[1] * 0.9 + h[1] * 0.1])
        : h
  }
  if (run.length) runs.push(run)
  const out: Pass[] = []
  for (const r of runs) {
    const pts = r.map((i) => xy[i])
    const { c, u } = lineFit(pts)
    const along = pts.map((p) => dot(sub(p, c), u))
    const length = Math.max(...along) - Math.min(...along)
    if (length < MIN_PASS_M) continue
    // Point u the way the rover drove.
    const fwd =
      dot(sub(pts[pts.length - 1], pts[0]), u) >= 0 ? u : ([-u[0], -u[1]] as XY)
    out.push({
      id: out.length + 1,
      idx: r,
      u: fwd,
      centre: c,
      length_m: length,
    })
  }
  return out
}

// ── Drone plots and beds ─────────────────────────────────────────────────

export interface DronePlot {
  key: string
  /** The plot's label as Analyze shows it. */
  label: string
  ring: XY[]
  centre: XY
  bbox: [number, number, number, number]
  properties: Record<string, unknown>
}

export function plotLabelOf(props: Record<string, unknown>, fallback: string) {
  for (const k of ["plot", "Plot", "plot_number", "plot_id"]) {
    const v = props[k]
    if (v != null && v !== "") return String(v)
  }
  return fallback
}

/** Plot polygons (not block outlines) of a boundary FeatureCollection. */
export function dronePlots(
  fc: GeoJSON.FeatureCollection,
  frame: LocalFrame,
): DronePlot[] {
  const out: DronePlot[] = []
  fc.features.forEach((f, i) => {
    const props = (f.properties ?? {}) as Record<string, unknown>
    if (props.role === "outer") return
    const g = f.geometry
    const coords =
      g?.type === "Polygon"
        ? g.coordinates[0]
        : g?.type === "MultiPolygon"
          ? g.coordinates[0]?.[0]
          : null
    if (!coords || coords.length < 3) return
    const ring = coords.map(([lon, lat]) => frame.toM(lon, lat))
    const pts = ring.length > 1 ? ring.slice(0, -1) : ring
    const centre: XY = [
      pts.reduce((a, p) => a + p[0], 0) / pts.length,
      pts.reduce((a, p) => a + p[1], 0) / pts.length,
    ]
    const xs = ring.map((p) => p[0])
    const ys = ring.map((p) => p[1])
    out.push({
      key: String(i),
      label: plotLabelOf(props, String(i + 1)),
      ring,
      centre,
      bbox: [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      ],
      properties: props,
    })
  })
  return out
}

export function inRing([x, y]: XY, ring: XY[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

/** The plot containing a point, if any (bounding boxes first). */
export function plotAt(p: XY, plots: DronePlot[]): DronePlot | null {
  for (const q of plots) {
    const [x0, y0, x1, y1] = q.bbox
    if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue
    if (inRing(p, q.ring)) return q
  }
  return null
}

export interface Bed {
  /** Distance across the field (along the normal) of its centre line. */
  offset: number
  plots: DronePlot[]
  /** Unit direction along the bed. */
  u: XY
  centre: XY
}

/**
 * Drone plots grouped into beds running along `u` (the rover's direction):
 * plots whose centres are at about the same distance across. A new bed
 * starts where the next centre is more than a third of a plot's width away.
 */
export function bedsAlong(plots: DronePlot[], u: XY): Bed[] {
  if (!plots.length) return []
  const n: XY = [-u[1], u[0]]
  const widths = plots.map((p) => {
    const across = p.ring.map((q) => dot(q, n))
    return Math.max(...across) - Math.min(...across)
  })
  const gap = Math.max(0.3, median(widths) / 3)
  const sorted = [...plots].sort((a, b) => dot(a.centre, n) - dot(b.centre, n))
  const groups: DronePlot[][] = []
  let last = Number.NEGATIVE_INFINITY
  for (const p of sorted) {
    const o = dot(p.centre, n)
    if (o - last > gap) groups.push([])
    groups[groups.length - 1].push(p)
    last = o
  }
  return groups.map((g) => {
    const fit =
      g.length >= 2 ? lineFit(g.map((p) => p.centre)) : { c: g[0].centre, u }
    const along = dot(fit.u, u) >= 0 ? fit.u : ([-fit.u[0], -fit.u[1]] as XY)
    return {
      offset: median(g.map((p) => dot(p.centre, n))),
      plots: g,
      u: g.length >= 3 ? along : u,
      centre: fit.c,
    }
  })
}

/** Median distance between neighbouring bed centre lines. */
export function bedSpacing(beds: Bed[]): number {
  const d: number[] = []
  for (let i = 1; i < beds.length; i++)
    d.push(beds[i].offset - beds[i - 1].offset)
  return d.length ? median(d) : 0
}

// ── Correction of the raw track ──────────────────────────────────────────

export interface PassCorrection {
  shift_m?: XY
  rotate_deg?: number
  straighten?: boolean
}

export interface TrackCorrection {
  /** Everything, east and north. */
  shift_m?: XY
  /**
   * In the rover's own frame, so it flips with the direction of travel:
   * [forward, left] — the GPS antenna's offset from the camera's centre.
   */
  rover_m?: XY
  /** Per pass, by pass id (as passesOf numbers them on this track). */
  passes?: Record<string, PassCorrection>
}

export const isEmptyCorrection = (c: TrackCorrection | null | undefined) =>
  !c ||
  (!(c.shift_m && (c.shift_m[0] || c.shift_m[1])) &&
    !(c.rover_m && (c.rover_m[0] || c.rover_m[1])) &&
    !Object.values(c.passes ?? {}).some(
      (p) =>
        p.straighten ||
        p.rotate_deg ||
        (p.shift_m && (p.shift_m[0] || p.shift_m[1])),
    ))

/** The corrected position of every point (same order as `xy`). */
export function applyTrackCorrection(
  xy: XY[],
  passes: Pass[],
  c: TrackCorrection | null | undefined,
): XY[] {
  const out = xy.map((p) => [p[0], p[1]] as XY)
  if (!c) return out
  const [fx, lx] = c.rover_m ?? [0, 0]
  for (const pass of passes) {
    const spec = c.passes?.[String(pass.id)] ?? {}
    const pts = pass.idx.map((i) => out[i])
    // Antenna offset in the rover's frame: forward along travel, left of it.
    if (fx || lx) {
      const left: XY = [-pass.u[1], pass.u[0]]
      for (const p of pts) {
        p[0] += pass.u[0] * fx + left[0] * lx
        p[1] += pass.u[1] * fx + left[1] * lx
      }
    }
    const { c: centre, u } = lineFit(pts)
    if (spec.straighten) {
      for (const p of pts) {
        const along = dot(sub(p, centre), u)
        p[0] = centre[0] + along * u[0]
        p[1] = centre[1] + along * u[1]
      }
    }
    const rot = ((spec.rotate_deg ?? 0) * Math.PI) / 180
    if (rot) {
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)
      for (const p of pts) {
        const dx = p[0] - centre[0]
        const dy = p[1] - centre[1]
        // clockwise, as on a compass
        p[0] = centre[0] + dx * cos + dy * sin
        p[1] = centre[1] - dx * sin + dy * cos
      }
    }
    const [sx, sy] = spec.shift_m ?? [0, 0]
    for (const p of pts) {
      p[0] += sx
      p[1] += sy
    }
  }
  const [gx, gy] = c.shift_m ?? [0, 0]
  for (const p of out) {
    p[0] += gx
    p[1] += gy
  }
  return out
}

// ── How well the track sits on the beds ──────────────────────────────────

export interface PassFit {
  pass: number
  /** Signed distance across (along the field's normal) to the nearest bed's centre line. */
  across_m: number
  /** Angle between the pass and that bed, degrees. */
  angle_deg: number
  /** Share of the pass's frames inside a drone plot. */
  inside: number
  bed: number | null
}

export interface TrackFit {
  passes: PassFit[]
  /** Median |across| over the passes. */
  offset_m: number
  /** Share of all pass frames inside a drone plot. */
  inside: number
  spacing_m: number
  /** Worth correcting before marking. */
  shifted: boolean
  /** Why, in a few words, when shifted. */
  reason: string
}

/** Drone plots near the track (within a few beds): the beds it can be on. */
function nearTrack(plots: DronePlot[], xy: XY[], reach = 30): DronePlot[] {
  if (!xy.length) return []
  const xs = xy.map((p) => p[0])
  const ys = xy.map((p) => p[1])
  const [x0, x1, y0, y1] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ]
  return plots.filter(
    (p) =>
      p.centre[0] > x0 - reach &&
      p.centre[0] < x1 + reach &&
      p.centre[1] > y0 - reach &&
      p.centre[1] < y1 + reach,
  )
}

export function fieldDirection(passes: Pass[]): XY {
  // Longest-pass-weighted mean direction, folded so opposite passes agree.
  let sx = 0
  let sy = 0
  for (const p of passes) {
    const a = 2 * Math.atan2(p.u[1], p.u[0])
    sx += Math.cos(a) * p.length_m
    sy += Math.sin(a) * p.length_m
  }
  const a = Math.atan2(sy, sx) / 2
  return [Math.cos(a), Math.sin(a)]
}

export function trackFit(
  xy: XY[],
  passes: Pass[],
  plots: DronePlot[],
): TrackFit {
  const near = nearTrack(plots, xy)
  const u = fieldDirection(passes)
  const n: XY = [-u[1], u[0]]
  const beds = bedsAlong(near, u)
  const spacing = bedSpacing(beds)
  const fits: PassFit[] = []
  let insideAll = 0
  let total = 0
  for (const pass of passes) {
    const pts = pass.idx.map((i) => xy[i])
    const { c, u: pu } = lineFit(pts)
    const o = dot(c, n)
    let best: { k: number; d: number } | null = null
    beds.forEach((b, k) => {
      const d = b.offset - o
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { k, d }
    })
    const hit = pts.filter((p) => plotAt(p, near)).length
    insideAll += hit
    total += pts.length
    const bb = best as { k: number; d: number } | null
    const bedU = bb ? beds[bb.k].u : u
    const ang =
      (Math.acos(Math.min(1, Math.abs(dot(pu, bedU)))) * 180) / Math.PI
    fits.push({
      pass: pass.id,
      across_m: bb ? -bb.d : 0,
      angle_deg: ang,
      inside: pts.length ? hit / pts.length : 0,
      bed: bb ? bb.k : null,
    })
  }
  const offset = median(fits.map((f) => Math.abs(f.across_m)))
  const inside = total ? insideAll / total : 0
  const tol = Math.max(0.25, spacing * 0.2)
  const reasons: string[] = []
  if (!near.length) reasons.push("the track is not over these plots")
  else {
    if (offset > tol)
      reasons.push(`passes sit ${offset.toFixed(1)} m off the bed centres`)
    if (inside < 0.6)
      reasons.push(`only ${Math.round(inside * 100)}% of frames fall in a plot`)
    // Off to one side in the rover's frame (so to opposite sides on passes
    // driven opposite ways): the antenna is not over the camera's centre.
    if (fits.length >= 4) {
      const travel = fits.map(
        (f) => Math.sign(dot(passes[f.pass - 1].u, u)) || 1,
      )
      const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length
      const withTravel = mean(fits.map((f, i) => f.across_m * travel[i]))
      const overall = mean(fits.map((f) => f.across_m))
      if (
        Math.abs(withTravel) > tol &&
        Math.abs(withTravel) > 2 * Math.abs(overall)
      )
        reasons.push(
          `the offset flips with the direction of travel (${Math.abs(withTravel).toFixed(1)} m to one side of the rover: the GPS antenna is not over the camera)`,
        )
    }
  }
  return {
    passes: fits,
    offset_m: offset,
    inside,
    spacing_m: spacing,
    shifted: reasons.length > 0,
    reason: reasons.join("; "),
  }
}

export interface OffsetEstimate {
  /** Whole-track shift across the beds, metres along the field's normal. */
  across_m: number
  /** GPS antenna to the left of the camera's centre, metres (rover frame). */
  left_m: number
  /** The same, as a correction to apply. */
  correction: TrackCorrection
  /** Beds the passes land on with it. */
  beds: number
  passes: number
}

/**
 * The shift across the beds and the antenna's sideways offset that put the
 * passes on beds best. Each pass alone would snap to its nearest bed, which
 * is the wrong one when the error is more than half a bed (common: an
 * antenna 0.4 m off centre plus a 0.5 m map offset puts every other pass
 * nearer the neighbouring bed). Together they are chosen so the passes
 * land on as many different beds as possible (a rover covers each bed
 * once), then closest to the bed centres, then the smallest correction. A
 * whole-bed shift cannot be told from the beds alone: the smallest is taken,
 * and the person can move it a bed over.
 */
export function estimateOffsets(
  xy: XY[],
  passes: Pass[],
  plots: DronePlot[],
): OffsetEstimate | null {
  const u = fieldDirection(passes)
  const n: XY = [-u[1], u[0]]
  const near = nearTrack(plots, xy, 40)
  const beds = bedsAlong(near, u)
  if (!beds.length || !passes.length) return null
  const spacing = bedSpacing(beds) || 2
  const offs = beds.map((b) => b.offset).sort((a, b) => a - b)
  const pass = passes.map((p) => {
    const { c } = lineFit(p.idx.map((i) => xy[i]))
    // +1 when "left" of travel is +n
    return { o: dot(c, n), t: dot([-p.u[1], p.u[0]], n) >= 0 ? 1 : -1 }
  })
  const nearestBed = (o: number) => {
    let lo = 0
    let hi = offs.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (offs[mid] < o) lo = mid
      else hi = mid
    }
    return Math.abs(offs[lo] - o) <= Math.abs(offs[hi] - o) ? lo : hi
  }
  const reach = Math.max(3, spacing * 1.5)
  const step = 0.02
  let best: { g: number; a: number; beds: number; cost: number } | null = null
  for (let g = -reach; g <= reach + 1e-9; g += step)
    for (let a = -1; a <= 1 + 1e-9; a += step) {
      const hit = new Set<number>()
      let cost = 0
      for (const p of pass) {
        // correcting by (g across, a left) moves the pass by g + t·a across
        const o = p.o + g + p.t * a
        const k = nearestBed(o)
        const r = Math.abs(offs[k] - o)
        if (r <= spacing / 2) hit.add(k)
        cost += Math.min(r, spacing / 2)
      }
      cost += 0.05 * (Math.abs(g) + Math.abs(a)) // smallest when otherwise equal
      if (
        !best ||
        hit.size > best.beds ||
        (hit.size === best.beds && cost < best.cost - 1e-9)
      )
        best = { g, a, beds: hit.size, cost }
    }
  if (!best) return null
  const g = Math.round(best.g * 100) / 100
  const a = Math.round(best.a * 100) / 100
  return {
    across_m: g,
    left_m: -a,
    correction: {
      shift_m: [
        Math.round(n[0] * g * 1000) / 1000,
        Math.round(n[1] * g * 1000) / 1000,
      ],
      rover_m: [0, a],
    },
    beds: best.beds,
    passes: passes.length,
  }
}

/**
 * The correction that lays each pass on its nearest drone bed (after the
 * whole-track shift and antenna offset of estimateOffsets): straightened
 * onto a line, turned to the bed's direction and moved across onto its
 * centre line (not along it — the beds say nothing about that). Passes
 * farther than half a bed from any bed are left as they are (most likely
 * the rover off the plots: a headland, a road).
 */
export function snapToBeds(
  xy: XY[],
  passes: Pass[],
  plots: DronePlot[],
  /** The whole-track part to keep; estimated (estimateOffsets) when not given. */
  given?: TrackCorrection,
): TrackCorrection {
  const base = given ?? estimateOffsets(xy, passes, plots)?.correction ?? {}
  const keep: TrackCorrection = { ...base, passes: {} }
  const moved = applyTrackCorrection(xy, passes, keep)
  const near = nearTrack(plots, moved)
  const u = fieldDirection(passes)
  const n: XY = [-u[1], u[0]]
  const beds = bedsAlong(near, u)
  const spacing = bedSpacing(beds) || 2
  const out: Record<string, PassCorrection> = {}
  for (const pass of passes) {
    const pts = pass.idx.map((i) => moved[i])
    const { c, u: pu } = lineFit(pts)
    const o = dot(c, n)
    let best: Bed | null = null
    for (const b of beds)
      if (!best || Math.abs(b.offset - o) < Math.abs(best.offset - o)) best = b
    if (!best || Math.abs(best.offset - o) > spacing / 2) continue
    const bu = dot(best.u, pu) >= 0 ? best.u : ([-best.u[0], -best.u[1]] as XY)
    // Clockwise angle from the pass's direction to the bed's.
    const rotate =
      (-Math.atan2(pu[0] * bu[1] - pu[1] * bu[0], dot(pu, bu)) * 180) / Math.PI
    // Across onto the bed line through its centre (perpendicular to the bed).
    const bn: XY = [-bu[1], bu[0]]
    const d = dot(sub(best.centre, c), bn)
    out[String(pass.id)] = {
      straighten: true,
      rotate_deg: Math.round(rotate * 100) / 100,
      shift_m: [
        Math.round(bn[0] * d * 1000) / 1000,
        Math.round(bn[1] * d * 1000) / 1000,
      ],
    }
  }
  return { ...base, passes: out }
}

// ── Plots from the polygons ──────────────────────────────────────────────

export interface MarkedFromDrone {
  selections: PlotSelection[]
  /** Drone plots crossed by the track. */
  crossed: number
  /** Drone plots near the track. */
  near: number
  /** Drone plots crossed on more than one pass (the longest kept). */
  repeated: string[]
}

/** Fewer frames than this inside a plot is the rover clipping its corner. */
const MIN_FRAMES = 3
/** Frames outside a plot between two runs in it that still count as one. */
const BRIDGE = 2

export function markFromDrone(
  points: TrackPoint[],
  located: number[],
  xy: XY[],
  passes: Pass[],
  plots: DronePlot[],
  direction: string,
): MarkedFromDrone {
  const near = nearTrack(plots, xy)
  type Run = {
    plot: DronePlot
    a: number
    b: number
    frames: number
    pass: number
  }
  const runs: Run[] = []
  for (const pass of passes) {
    let cur: Run | null = null
    let miss = 0
    for (const k of pass.idx) {
      const hit = plotAt(xy[k], near)
      if (cur && hit === cur.plot) {
        cur.b = k
        cur.frames += 1
        miss = 0
        continue
      }
      if (cur && !hit && miss < BRIDGE) {
        miss++
        continue
      }
      if (cur) runs.push(cur)
      cur = hit ? { plot: hit, a: k, b: k, frames: 1, pass: pass.id } : null
      miss = 0
    }
    if (cur) runs.push(cur)
  }
  // One run per plot: a plot crossed twice in a pass (GPS wobble) is joined;
  // crossed on two passes, the one with more frames is kept.
  const byPlot = new Map<string, Run>()
  const repeated = new Set<string>()
  for (const r of runs) {
    if (r.frames < MIN_FRAMES) continue
    const had = byPlot.get(r.plot.key)
    if (!had) byPlot.set(r.plot.key, { ...r })
    else if (had.pass === r.pass) {
      had.a = Math.min(had.a, r.a)
      had.b = Math.max(had.b, r.b)
      had.frames += r.frames
    } else {
      repeated.add(r.plot.label)
      if (r.frames > had.frames) byPlot.set(r.plot.key, { ...r })
    }
  }
  const kept = [...byPlot.values()].sort((p, q) => p.a - q.a)
  const selections: PlotSelection[] = kept.map((r, i) => {
    const s = points[located[r.a]]
    const e = points[located[r.b]]
    return {
      plot_id: i + 1,
      start_image: s.image,
      end_image: e.image,
      direction,
      boundary: { label: r.plot.label, properties: r.plot.properties },
    }
  })
  return {
    selections,
    crossed: byPlot.size,
    near: near.length,
    repeated: [...repeated],
  }
}

// ── The whole track ──────────────────────────────────────────────────────

export interface TrackGeometry {
  frame: LocalFrame
  /** Indices of the points that have GPS. */
  located: number[]
  xy: XY[]
  passes: Pass[]
}

export function trackGeometry(points: TrackPoint[]): TrackGeometry | null {
  const located: number[] = []
  points.forEach((p, i) => {
    if (p.lat != null && p.lon != null) located.push(i)
  })
  if (!located.length) return null
  const first = points[located[0]]
  const frame = new LocalFrame(first.lon as number, first.lat as number)
  const xy = located.map((i) =>
    frame.toM(points[i].lon as number, points[i].lat as number),
  )
  return { frame, located, xy, passes: passesOf(xy) }
}

/** Track points with the correction applied (frames without GPS unchanged). */
export function correctedPoints(
  points: TrackPoint[],
  geo: TrackGeometry,
  c: TrackCorrection | null | undefined,
): TrackPoint[] {
  if (isEmptyCorrection(c)) return points
  const moved = applyTrackCorrection(geo.xy, geo.passes, c)
  const out = points.map((p) => ({ ...p }))
  geo.located.forEach((i, k) => {
    const { lat, lon } = geo.frame.toDeg(moved[k])
    out[i].lat = lat
    out[i].lon = lon
  })
  return out
}

/**
 * msgs_synced.csv with corrected positions, for stitching: lat/lon replaced
 * by image, the rover's own kept as lat_raw / lon_raw. Other columns as they
 * were.
 */
export function correctedMsgsCsv(
  csvText: string,
  corrected: Map<string, { lat: number; lon: number }>,
): string {
  const lines = csvText.split(/\r?\n/)
  if (!lines.length) return csvText
  const head = lines[0].split(",")
  const low = head.map((h) => h.trim().toLowerCase())
  const iLat = low.findIndex((h) => h === "lat" || h === "latitude")
  const iLon = low.findIndex((h) => ["lon", "lng", "longitude"].includes(h))
  const iImg =
    low.findIndex((h) => h.includes("top") && h.includes("file")) >= 0
      ? low.findIndex((h) => h.includes("top") && h.includes("file"))
      : low.findIndex((h) =>
          ["image_path", "image", "filename", "file", "path"].includes(h),
        )
  if (iLat < 0 || iLon < 0 || iImg < 0) return csvText
  const hasRaw = low.includes("lat_raw")
  const out = [hasRaw ? lines[0] : `${lines[0]},lat_raw,lon_raw`]
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const cells = line.split(",")
    const name = (cells[iImg] ?? "").replace(/\\/g, "/").split("/").pop() ?? ""
    const hit = corrected.get(name)
    const raw = [cells[iLat], cells[iLon]]
    if (hit) {
      cells[iLat] = hit.lat.toFixed(9)
      cells[iLon] = hit.lon.toFixed(9)
    }
    out.push(hasRaw ? cells.join(",") : [...cells, ...raw].join(","))
  }
  return `${out.join("\n")}\n`
}
