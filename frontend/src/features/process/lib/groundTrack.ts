/**
 * Ground (Amiga) pipeline data: where a run's rover track lives, what's in
 * it, and where plot markings and stitch versions are kept.
 *
 * A `.bin` upload is extracted by the amiga worker into its dataset folder
 * (a handheld pass is instead an Image Data upload plus a Synced Metadata
 * CSV — see findGroundTracks):
 *
 *   Raw/…/{sensor}/{shortId}/RGB/Images/top/rgb-<stamp>.jpg
 *   Raw/…/{sensor}/{shortId}/RGB/Metadata/msgs_synced.csv
 *
 * One dataset = one track: the frames in capture order with their GPS fix
 * and direction of travel (msgs_synced's `/top/rgb_file`, lat, lon,
 * direction). Plot Marking marks start/end frames on that track; the stitch
 * worker gets the same paths.
 */
import type { FileMetadata } from "@/client"
import { parseCSV } from "@/features/process/lib/csv"
import {
  type AerialScope,
  processedPopulationPrefix,
  processedPrefix,
} from "@/features/process/lib/paths"

export interface GroundTrack {
  /** Dataset folder under the run's raw scope (the upload's short id). */
  dataset: string
  imagesPrefix: string
  /** Frame file names, sorted (Amiga names sort in capture order). */
  images: string[]
  msgsSyncedPath: string | null
}

function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1)
}

/** Amiga's side cameras: extracted, but not what the ground pipeline stitches. */
const SIDE_CAMERA = /\/Images\/(left|right)\//

/**
 * Tracks at a run's raw scope: every folder of frames — an Amiga
 * extraction's `Images/top/`, or an Image Data upload's `Images/` from a
 * handheld/monopod pass — each paired with a msgs_synced.csv: its own
 * dataset's, else one uploaded separately as Synced Metadata at the same
 * scope that no other folder claimed.
 */
export function findGroundTracks(
  files: FileMetadata[],
  rawPrefix: string,
): GroundTrack[] {
  const imagesByDir = new Map<string, string[]>()
  const msgsByDataset = new Map<string, string>()
  for (const f of files) {
    const name = f.object_name ?? ""
    if (!name.startsWith(rawPrefix)) continue
    const rest = name.slice(rawPrefix.length)
    const dataset = rest.split("/")[0] ?? ""
    if (/(^|\/)msgs_synced\.csv$/.test(rest)) {
      // Prefer the extractor's own copy (…/RGB/Metadata/) if there are two.
      if (!msgsByDataset.has(dataset) || name.includes("/Metadata/"))
        msgsByDataset.set(dataset, name)
    } else if (
      /\.(jpe?g|png)$/i.test(rest) &&
      /\/Images\//.test(name) &&
      !SIDE_CAMERA.test(name)
    ) {
      const d = dirOf(name)
      const list = imagesByDir.get(d) ?? []
      list.push(name.slice(d.length))
      imagesByDir.set(d, list)
    }
  }
  const tracks = Array.from(imagesByDir.entries())
    .map(([imagesPrefix, images]) => {
      const dataset = imagesPrefix.slice(rawPrefix.length).split("/")[0] ?? ""
      return {
        dataset,
        imagesPrefix,
        images: images.sort(),
        msgsSyncedPath: msgsByDataset.get(dataset) ?? null,
      }
    })
    .sort((a, b) => a.dataset.localeCompare(b.dataset))
  const claimed = new Set(tracks.map((t) => t.msgsSyncedPath))
  const spare = Array.from(msgsByDataset.values()).filter(
    (m) => !claimed.has(m),
  )
  for (const t of tracks)
    if (!t.msgsSyncedPath && spare.length) t.msgsSyncedPath = spare[0]
  return tracks
}

export interface TrackPoint {
  image: string
  lat: number | null
  lon: number | null
  /** Smoothed compass direction of travel (North/East/South/West). */
  direction: string | null
}

const baseName = (v: string) => v.replace(/\\/g, "/").split("/").pop() ?? ""

/** msgs_synced.csv → one point per frame, in capture (file) order. */
export function parseTrack(csvText: string): TrackPoint[] {
  const { headers, rows } = parseCSV(csvText)
  const lower = (h: string) => h.toLowerCase()
  const imgCol =
    headers.find(
      (h) => lower(h).includes("top") && lower(h).includes("file"),
    ) ??
    headers.find((h) =>
      ["image_path", "image", "filename", "file", "path"].includes(lower(h)),
    )
  if (!imgCol) return []
  const latCol = headers.find((h) => ["lat", "latitude"].includes(lower(h)))
  const lonCol = headers.find((h) =>
    ["lon", "lng", "longitude"].includes(lower(h)),
  )
  const num = (v: string | undefined) => {
    const n = Number.parseFloat(v ?? "")
    return Number.isFinite(n) ? n : null
  }
  return rows
    .map((r) => ({
      image: baseName(r[imgCol] ?? ""),
      lat: latCol ? num(r[latCol]) : null,
      lon: lonCol ? num(r[lonCol]) : null,
      direction: r.direction || null,
    }))
    .filter((p) => p.image)
}

// ── Plot markings ──────────────────────────────────────────────────────────

export interface PlotSelection {
  plot_id: number
  start_image: string | null
  end_image: string | null
  /** Stitching direction: up / down / left / right ("" = not set). */
  direction: string
  start_lat?: number | null
  start_lon?: number | null
  end_lat?: number | null
  end_lon?: number | null
  /** Set when a marker was moved onto this track by GPS. */
  translated?: boolean
}

export interface PlotMarkingSnapshot {
  selections: PlotSelection[]
  /** The track the markings were made on. */
  track: { imagesPrefix: string; msgsSyncedPath: string | null }
}

/**
 * Plot markings are versioned per population, like main (which kept them
 * next to the population's other intermediates), so a later date's run can
 * start from them. Stored with the plot-geometry versions under the
 * experiment's Processed/ path, so deleting the experiment removes them.
 */
export function plotMarkingsDirectory(scope: {
  year: string
  experiment: string
  location: string
  population: string
}): string {
  return `${processedPopulationPrefix(scope)}PlotMarkings`
}

/** Record each marker's GPS so it can be re-found on another track. */
export function withGps(
  selections: PlotSelection[],
  track: TrackPoint[],
): PlotSelection[] {
  const byImage = new Map(track.map((p) => [p.image, p]))
  return selections.map((s) => {
    const a = s.start_image ? byImage.get(s.start_image) : undefined
    const b = s.end_image ? byImage.get(s.end_image) : undefined
    const { translated: _t, ...rest } = s
    return {
      ...rest,
      start_lat: a?.lat ?? s.start_lat ?? null,
      start_lon: a?.lon ?? s.start_lon ?? null,
      end_lat: b?.lat ?? s.end_lat ?? null,
      end_lon: b?.lon ?? s.end_lon ?? null,
    }
  })
}

/** Farther than this and a marker is left alone rather than snapped. */
const MAX_SNAP_M = 50

function metres(aLat: number, aLon: number, bLat: number, bLon: number) {
  const k = 111_320
  const dy = (aLat - bLat) * k
  const dx = (aLon - bLon) * k * Math.cos((aLat * Math.PI) / 180)
  return Math.hypot(dx, dy)
}

/**
 * Markings made on another track (another date's pass over the same
 * field): move each start/end frame that isn't on this track to this
 * track's nearest frame by GPS, within 50 m — main's
 * translate_markers_by_gps. Returns the markings and whether any moved.
 */
export function translateMarkings(
  selections: PlotSelection[],
  images: Set<string>,
  track: TrackPoint[],
): { selections: PlotSelection[]; translated: boolean } {
  const located = track.filter(
    (p): p is TrackPoint & { lat: number; lon: number } =>
      p.lat != null && p.lon != null && images.has(p.image),
  )
  const nearest = (lat: number, lon: number): string | null => {
    let best: string | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const p of located) {
      const d = metres(lat, lon, p.lat, p.lon)
      if (d < bestD) {
        bestD = d
        best = p.image
      }
    }
    return bestD <= MAX_SNAP_M ? best : null
  }
  let any = false
  const out = selections.map((s) => {
    const next = { ...s }
    let moved = false
    if (
      s.start_image &&
      !images.has(s.start_image) &&
      s.start_lat != null &&
      s.start_lon != null
    ) {
      const m = nearest(s.start_lat, s.start_lon)
      if (m) {
        next.start_image = m
        moved = true
      }
    }
    if (
      s.end_image &&
      !images.has(s.end_image) &&
      s.end_lat != null &&
      s.end_lon != null
    ) {
      const m = nearest(s.end_lat, s.end_lon)
      if (m) {
        next.end_image = m
        moved = true
      }
    }
    if (moved) {
      next.translated = true
      any = true
    }
    return next
  })
  return { selections: out, translated: any }
}

export function isComplete(s: PlotSelection): boolean {
  return Boolean(s.start_image && s.end_image)
}

// ── Stitch versions ───────────────────────────────────────────────────────

export interface StitchVersion {
  version: number
  prefix: string
  plotImages: { plotId: string; path: string }[]
  combinedMosaic: string | null
  manifest: string | null
}

const STITCH_DIR = /AgRowStitch_v(\d+)\/(.+)$/

/** AgRowStitch_v{N}/ folders in a run's Processed/ listing, newest first. */
export function stitchVersions(
  files: FileMetadata[],
  scope: AerialScope,
): StitchVersion[] {
  const base = processedPrefix(scope)
  const byVersion = new Map<number, StitchVersion>()
  for (const f of files) {
    const name = f.object_name ?? ""
    if (!name.startsWith(base)) continue
    const m = STITCH_DIR.exec(name.slice(base.length))
    if (!m) continue
    const version = Number(m[1])
    const v = byVersion.get(version) ?? {
      version,
      prefix: `${base}AgRowStitch_v${version}/`,
      plotImages: [],
      combinedMosaic: null,
      manifest: null,
    }
    const file = m[2]
    const plot = /^full_res_mosaic_temp_plot_(.+)\.png$/.exec(file)
    if (plot) v.plotImages.push({ plotId: plot[1], path: name })
    else if (file === "combined_mosaic.tif") v.combinedMosaic = name
    else if (file === "stitch_manifest.json") v.manifest = name
    byVersion.set(version, v)
  }
  for (const v of byVersion.values())
    v.plotImages.sort((a, b) =>
      a.plotId.localeCompare(b.plotId, undefined, { numeric: true }),
    )
  return Array.from(byVersion.values()).sort((a, b) => b.version - a.version)
}

export function nextStitchPrefix(
  scope: AerialScope,
  existing: StitchVersion[],
): string {
  const next = Math.max(0, ...existing.map((v) => v.version)) + 1
  return `${processedPrefix(scope)}AgRowStitch_v${next}/`
}
