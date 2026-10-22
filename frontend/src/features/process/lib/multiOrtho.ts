/**
 * Several orthomosaics in one date's folder — e.g. one flight per treatment
 * (well-watered and drought blocks flown separately). One set of plot
 * boundaries covers them all; where flights overlap, each point is taken
 * from the orthomosaic whose centre it is nearest (a mosaic's middle is
 * better than another's edge). The map shows each orthomosaic only inside
 * that region (nearestRegions), and plots are cut and measured from the
 * same one (assignNearest). The agent uses the same rule (multiortho.py).
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
