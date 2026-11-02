/**
 * Several orthomosaics in one date's folder — e.g. one flight per treatment
 * (well-watered and drought blocks flown separately). One set of plot
 * boundaries covers them all; where flights overlap, each point is taken
 * from the orthomosaic whose centre it is nearest (a mosaic's middle is
 * better than another's edge). The map shows each orthomosaic only inside
 * that region (nearestRegions). A plot is measured on the nearest one that
 * covers it (assignCovering): long, overlapping flights have centres so
 * alike that near a field's ends the other flight's centre can be nearer
 * though its image stops short of the plot. The agent uses the same rule
 * (multiortho.assign).
 */
import type { FileMetadata } from "@/client"

export interface FolderOrtho {
  /** Object name, no bucket. */
  path: string
  /** The ODM job that built it (from odm_orthophoto-{job}.tif), if any. */
  jobId: string | null
  /** A COG copy TiTiler should read, when present. */
  cogPath: string | null
  /** Its elevation model (odm_dsm-{job}.tif), when present. */
  dsmPath: string | null
}

const ORTHO = /odm_orthophoto(?:-([0-9a-f-]{36}))?\.tif$/

/** The orthomosaics directly in a Processed date folder. */
export function folderOrthos(
  files: FileMetadata[],
  folder: string,
): FolderOrtho[] {
  const names = new Set(files.map((f) => f.object_name ?? ""))
  const out: FolderOrtho[] = []
  for (const name of names) {
    if (!name.startsWith(folder)) continue
    const rest = name.slice(folder.length)
    if (rest.includes("/")) continue
    const m = ORTHO.exec(rest)
    if (!m) continue
    const cog = name.replace(/\.tif$/, "-Pyramid.tif")
    const dsm = name.replace("odm_orthophoto", "odm_dsm")
    out.push({
      path: name,
      jobId: m[1] ?? null,
      cogPath: names.has(cog) ? cog : null,
      dsmPath: names.has(dsm) ? dsm : null,
    })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export type LonLat = [number, number]

/** Clip a polygon to the half-plane of points nearer `a` than `b`. */
function clipNearer(
  poly: LonLat[],
  a: LonLat,
  b: LonLat,
  kx: number,
): LonLat[] {
  // In scaled coordinates (x*kx, y): keep p with |p-a|^2 <= |p-b|^2, i.e.
  // n·p <= c with n = b - a, c = (|b|^2 - |a|^2) / 2.
  const s = (p: LonLat): [number, number] => [p[0] * kx, p[1]]
  const [ax, ay] = s(a)
  const [bx, by] = s(b)
  const nx = bx - ax
  const ny = by - ay
  const c = (bx * bx + by * by - ax * ax - ay * ay) / 2
  const side = (p: LonLat) => {
    const [x, y] = s(p)
    return nx * x + ny * y - c
  }
  const out: LonLat[] = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const sp = side(p)
    const sq = side(q)
    if (sp <= 0) out.push(p)
    if (sp <= 0 !== sq <= 0) {
      const t = sp / (sp - sq)
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])])
    }
  }
  return out
}

/**
 * Each centre's region (Voronoi cell) within `bounds`
 * ([west, south, east, north]): the points nearer it than any other centre.
 */
export function nearestRegions(
  centres: LonLat[],
  bounds: [number, number, number, number],
): LonLat[][] {
  const [w, s, e, n] = bounds
  const box: LonLat[] = [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ]
  const lat0 = (s + n) / 2
  const kx = Math.cos((lat0 * Math.PI) / 180)
  return centres.map((c, i) => {
    let cell = box
    centres.forEach((o, j) => {
      if (j !== i && cell.length) cell = clipNearer(cell, c, o, kx)
    })
    return cell
  })
}

/** Index of the centre nearest each point. */
export function nearestIndex(p: LonLat, centres: LonLat[]): number {
  const kx = Math.cos((p[1] * Math.PI) / 180)
  let best = 0
  let bestD = Number.POSITIVE_INFINITY
  centres.forEach((c, i) => {
    const d = ((c[0] - p[0]) * kx) ** 2 + (c[1] - p[1]) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** Plot features grouped by the orthomosaic (index) whose centre is nearest. */
export function assignNearest(
  features: GeoJSON.Feature[],
  centres: LonLat[],
): GeoJSON.Feature[][] {
  const out: GeoJSON.Feature[][] = centres.map(() => [])
  for (const f of features) {
    const g = f.geometry
    const ring =
      g?.type === "Polygon"
        ? (g.coordinates[0] as LonLat[])
        : g?.type === "MultiPolygon"
          ? (g.coordinates[0][0] as LonLat[])
          : null
    if (!ring?.length) continue
    const pts = ring.length > 1 ? ring.slice(0, -1) : ring
    const c: LonLat = [
      pts.reduce((a, p) => a + p[0], 0) / pts.length,
      pts.reduce((a, p) => a + p[1], 0) / pts.length,
    ]
    out[nearestIndex(c, centres)].push(f)
  }
  return out
}

/**
 * The orthomosaic job(s) a run currently uses: one per treatment when the
 * date was flown in parts, else its newest. A run with treatments may also
 * have newer jobs that aren't its orthomosaic (a quick one made only to
 * place the raw frames), which must not be drawn over the field.
 */
export function currentOrthoJobIds(run: {
  steps: Record<string, { jobIds?: string[] } | undefined>
  uploadScope?: { treatments?: { orthoJobId?: string }[] } | null
}): string[] {
  const parts = (run.uploadScope?.treatments ?? [])
    .map((t) => t.orthoJobId)
    .filter((j): j is string => Boolean(j))
  if (parts.length >= 2) return parts
  const last = run.steps.orthomosaic?.jobIds?.at(-1)
  return last ? [last] : []
}

/** WGS84 [west, south, east, north]. */
export type Bounds = [number, number, number, number]

/** Share of box `a` inside box `b` (0–1). */
export function boxShare(a: Bounds, b: Bounds): number {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const area = (a[2] - a[0]) * (a[3] - a[1])
  return area > 0 ? (w * h) / area : 0
}

/**
 * The orthomosaic (index into `bounds`) a plot is measured on: the nearest
 * by centre that covers ≥ 90 % of it, else the one covering the most.
 */
export function pickCovering(plot: Bounds, bounds: Bounds[]): number {
  const centres = bounds.map(
    (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] as LonLat,
  )
  const p: LonLat = [(plot[0] + plot[2]) / 2, (plot[1] + plot[3]) / 2]
  const kx = Math.cos((p[1] * Math.PI) / 180)
  const order = centres
    .map((c, i) => ({ i, d: ((c[0] - p[0]) * kx) ** 2 + (c[1] - p[1]) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.i)
  const shares = bounds.map((b) => boxShare(plot, b))
  const full = order.find((i) => shares[i] >= 0.9)
  if (full !== undefined) return full
  let best = order[0] ?? 0
  for (const i of order) if (shares[i] > shares[best]) best = i
  return best
}

function featureBounds(f: GeoJSON.Feature): Bounds | null {
  const g = f.geometry
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return null
  const rings = g.type === "Polygon" ? g.coordinates : g.coordinates.flat()
  let w = Number.POSITIVE_INFINITY
  let so = Number.POSITIVE_INFINITY
  let e = Number.NEGATIVE_INFINITY
  let n = Number.NEGATIVE_INFINITY
  for (const ring of rings)
    for (const [x, y] of ring) {
      w = Math.min(w, x)
      e = Math.max(e, x)
      so = Math.min(so, y)
      n = Math.max(n, y)
    }
  return Number.isFinite(w) ? [w, so, e, n] : null
}

/** Plot features grouped by the orthomosaic (index) each is measured on. */
export function assignCovering(
  features: GeoJSON.Feature[],
  bounds: Bounds[],
): GeoJSON.Feature[][] {
  const out: GeoJSON.Feature[][] = bounds.map(() => [])
  for (const f of features) {
    const b = featureBounds(f)
    if (b) out[pickCovering(b, bounds)].push(f)
  }
  return out
}
