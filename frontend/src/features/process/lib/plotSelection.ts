/**
 * Which plots a plot-images run does: all of them, those without images yet
 * (a plot just added to the boundaries), or the ones the person lists. A run
 * of some plots adds to the earlier images instead of replacing them.
 */

export type PlotChoice =
  | { mode: "all" }
  | { mode: "missing" }
  | { mode: "list"; text: string }

/** "12, 15-18, A3" → ["12", "15", "16", "17", "18", "A3"]. */
export function parsePlotList(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/[,;\s]+/)) {
    const t = part.trim()
    if (!t) continue
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/)
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y)
      for (let n = a; n <= Math.min(b, a + 5000); n += 1) out.push(String(n))
    } else out.push(t)
  }
  return [...new Set(out)]
}

/** The plots that have an image cut from the orthomosaic (…/plot_12_accession_X.png, …/plot_12.png). */
export function plotsWithOrthoImages(names: string[]): Set<string> {
  const have = new Set<string>()
  for (const n of names) {
    const file = n.split("/").pop() ?? ""
    const m = file.match(/^plot_(.+?)(?:_accession_.*)?\.(?:png|jpe?g|tif)$/i)
    if (m) have.add(m[1])
  }
  return have
}

function plotOf(f: GeoJSON.Feature): string {
  const p = (f.properties ?? {}) as Record<string, unknown>
  return String(p.plot ?? p.plot_id ?? "")
}

/**
 * The boundaries a run does, and whether it is a run of some plots only (then
 * its results are added to the earlier ones). Null plots: nothing to do.
 */
export function choosePlots(
  boundaries: GeoJSON.FeatureCollection,
  choice: PlotChoice | undefined,
  have: Set<string>,
): { boundaries: GeoJSON.FeatureCollection; some: boolean; count: number } {
  const all = boundaries.features ?? []
  if (!choice || choice.mode === "all")
    return { boundaries, some: false, count: all.length }
  const wanted =
    choice.mode === "missing"
      ? (f: GeoJSON.Feature) => !have.has(plotOf(f))
      : (() => {
          const listed = new Set(parsePlotList(choice.text))
          return (f: GeoJSON.Feature) => listed.has(plotOf(f))
        })()
  const features = all.filter(wanted)
  return {
    boundaries: { ...boundaries, features },
    some: features.length < all.length,
    count: features.length,
  }
}
