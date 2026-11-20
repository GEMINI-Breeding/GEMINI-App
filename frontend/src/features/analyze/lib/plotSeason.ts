/**
 * A field's plot images through the season, for the Analyze Query view:
 * which image each plot has on each flight date, by kind of image.
 *
 * Files sit under the population's Processed/ folder:
 *   {date}/{platform}/{sensor}/PlotImages/plot_{n}_accession_{a}.png
 *     — cut from the orthomosaic
 *   {date}/{platform}/{sensor}/PlotFrames/straightened/plot_….png
 *     — the best raw frame turned to a top-down view of the plot
 *   {date}/{platform}/{sensor}/PlotFrames/crops/plot_…_frame{k}_….jpg
 *     — the plot cut from the raw frames (frame 0 is the best)
 *   {date}/{platform}/{sensor}/PlotFrames/{Sensor}/straightened/plot_….png
 *     — the same from another camera of the flight (thermal)
 */
import type { FileMetadata } from "@/client"

export type ImageKind = string

export const KIND_LABELS: Record<string, string> = {
  ortho: "From the orthomosaic",
  straightened: "Raw frame, top-down",
  frame: "Raw frame (best crop)",
}

export function kindLabel(kind: ImageKind): string {
  if (KIND_LABELS[kind]) return KIND_LABELS[kind]
  const m = /^(.+):straightened$/.exec(kind)
  return m ? `${m[1]} camera, top-down` : kind
}

/** Kinds in the order to offer them. */
function kindRank(kind: ImageKind): number {
  return ["ortho", "straightened", "frame"].indexOf(kind) + 1 || 9
}

export interface SeasonImages {
  /** kind -> date -> plot -> object name */
  byKind: Map<ImageKind, Map<string, Map<string, string>>>
  /** Plot -> accession, as the image names give it. */
  accessions: Map<string, string>
  kinds: ImageKind[]
}

const NAME = /^plot_([^_]+)_accession_(.+?)(?:_frame(\d+)_.*)?\.(?:png|jpe?g)$/i

/** `plot_12_accession_CB27.png` → { plot: "12", accession: "CB27" }. */
export function parsePlotImageName(
  base: string,
): { plot: string; accession: string; frame: number | null } | null {
  const m = NAME.exec(base)
  if (!m) return null
  return {
    plot: m[1],
    accession: m[2],
    frame: m[3] != null ? Number(m[3]) : null,
  }
}

function kindOf(rest: string[]): ImageKind | null {
  // rest: the path below {date}/{platform}/{sensor}/, without the file name
  if (rest.length === 1 && rest[0] === "PlotImages") return "ortho"
  if (rest[0] !== "PlotFrames") return null
  if (rest.length === 2 && rest[1] === "straightened") return "straightened"
  if (rest.length === 2 && rest[1] === "crops") return "frame"
  if (rest.length === 3 && rest[2] === "straightened")
    return `${rest[1]}:straightened`
  return null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The populations (crops) with plot images in a site listing: the folder
 *  above each date. */
export function imagePopulations(files: FileMetadata[]): string[] {
  const out = new Set<string>()
  for (const f of files) {
    const name = f.object_name ?? ""
    if (!/\/(PlotImages|PlotFrames)\//.test(name)) continue
    const parts = name.split("/")
    const di = parts.findIndex((p) => DATE.test(p))
    if (di > 0) out.add(parts[di - 1])
  }
  return [...out].sort()
}

/** `population`: only that crop's folder (a site listing holds them all). */
export function indexSeasonImages(
  files: FileMetadata[],
  population?: string | null,
): SeasonImages {
  const byKind = new Map<ImageKind, Map<string, Map<string, string>>>()
  const bestFrame = new Map<string, number>()
  const accessions = new Map<string, string>()
  // Sorted, so when two flights of a date both have an image, the same one
  // wins every time.
  const names = files.map((f) => f.object_name ?? "").sort()
  for (const name of names) {
    const parts = name.split("/")
    const base = parts.pop() ?? ""
    const di = parts.findIndex((p) => DATE.test(p))
    if (di < 0) continue
    if (population && parts[di - 1] !== population) continue
    const date = parts[di]
    const kind = kindOf(parts.slice(di + 3))
    if (!kind) continue
    const parsed = parsePlotImageName(base)
    if (!parsed) continue
    if (kind === "frame") {
      const key = `${date}|${parsed.plot}`
      const f = parsed.frame ?? 0
      if (bestFrame.has(key) && (bestFrame.get(key) as number) <= f) continue
      bestFrame.set(key, f)
    }
    const dates = byKind.get(kind) ?? new Map<string, Map<string, string>>()
    byKind.set(kind, dates)
    const plots = dates.get(date) ?? new Map<string, string>()
    dates.set(date, plots)
    plots.set(parsed.plot, name)
    if (parsed.accession && parsed.accession !== "unknown")
      accessions.set(parsed.plot, parsed.accession)
  }
  const kinds = [...byKind.keys()].sort(
    (a, b) => kindRank(a) - kindRank(b) || a.localeCompare(b),
  )
  return { byKind, accessions, kinds }
}

export interface PlotChoice {
  plot: string
  accession: string | null
}

/** Natural order: 2 before 10, L2 after the numbers. */
export function comparePlots(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

/**
 * Plots matching what was typed: a plot number (exact first, then starts
 * with) or an accession (contains). Accessions with several plots also
 * offer "every plot of" it.
 */
export function suggestPlots(
  plots: PlotChoice[],
  typed: string,
  limit = 30,
): {
  plots: PlotChoice[]
  accessions: { accession: string; plots: string[] }[]
} {
  const q = typed.trim().toLowerCase()
  const groups = new Map<string, string[]>()
  for (const p of plots)
    if (p.accession && (!q || p.accession.toLowerCase().includes(q)))
      groups.set(p.accession, [...(groups.get(p.accession) ?? []), p.plot])
  // Every matching accession (all of it in one click), exact name first.
  const accessions = [...groups.entries()]
    .map(([accession, ps]) => ({ accession, plots: ps }))
    .sort(
      (a, b) =>
        Number(b.accession.toLowerCase() === q) -
          Number(a.accession.toLowerCase() === q) ||
        a.accession.localeCompare(b.accession, undefined, { numeric: true }),
    )
    .slice(0, q ? 12 : 200)
  if (!q) return { plots: plots.slice(0, limit), accessions }
  const exact = plots.filter((p) => p.plot.toLowerCase() === q)
  const starts = plots.filter(
    (p) => p.plot.toLowerCase() !== q && p.plot.toLowerCase().startsWith(q),
  )
  const byAcc = plots.filter(
    (p) =>
      !p.plot.toLowerCase().startsWith(q) &&
      (p.accession ?? "").toLowerCase().includes(q),
  )
  return {
    plots: [...exact, ...starts, ...byAcc].slice(0, limit),
    accessions,
  }
}

/** The names the Query view reads (plot images, top-down raw frames and
 *  the best raw-frame crop): the server keeps just these, a fraction of a
 *  folder that also holds every frame crop and TIFF. */
export const PLOT_IMAGE_MATCH =
  "/(PlotImages|straightened)/[^/]+\\.(png|jpe?g)$|/crops/[^/]+_frame[01]_[^/]+\\.(png|jpe?g)$"

/**
 * A plot's image on a date: from the orthomosaic first, then the raw frames
 * (top-down, then the best crop), then another camera. Without a date (or
 * none that day), its latest.
 */
export function imageFor(
  idx: SeasonImages,
  plot: string,
  date?: string | null,
): { path: string; kind: ImageKind; date: string } | null {
  const order = [...idx.kinds]
  const on = (d: string) => {
    for (const kind of order) {
      const path = idx.byKind.get(kind)?.get(d)?.get(plot)
      if (path) return { path, kind, date: d }
    }
    return null
  }
  if (date) {
    const hit = on(date)
    if (hit) return hit
  }
  const dates = new Set<string>()
  for (const m of idx.byKind.values())
    for (const [d, ps] of m) if (ps.has(plot)) dates.add(d)
  const latest = [...dates].sort().pop()
  return latest ? on(latest) : null
}
