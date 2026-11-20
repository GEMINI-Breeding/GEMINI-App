/**
 * Photos with no GPS, one per plot, paired with the field design (the
 * agent's plots_from_images does the same). Two rules, best first:
 *  - the design names each plot's photo in a column (`image`, `photo`, …);
 *  - else the photos, in file-name order, follow the design's rows in order:
 *    right only if the photos were taken in that order.
 */
export const PHOTO_COLUMNS = [
  "image",
  "file",
  "filename",
  "file name",
  "photo",
  "picture",
  "image_file",
  "image name",
  "photo name",
]

export interface PhotoPair {
  photo: string
  row: Record<string, unknown>
}

export interface Pairing {
  pairs: PhotoPair[]
  rule: string
  problems: string[]
  /** The design's column naming the photos, when there is one. */
  column: string | null
}

const base = (n: string) => n.replace(/\\/g, "/").split("/").pop() ?? n
const stem = (n: string) =>
  base(n)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()

/** File names in natural order (IMG_2 before IMG_10). */
export function naturalSort(names: string[]): string[] {
  return [...names].sort((a, b) =>
    base(a).localeCompare(base(b), undefined, { numeric: true }),
  )
}

export function pairPhotos(
  photos: string[],
  rows: Record<string, unknown>[],
): Pairing {
  const columns = rows.length ? Object.keys(rows[0]) : []
  const column =
    columns.find((c) => PHOTO_COLUMNS.includes(c.trim().toLowerCase())) ?? null
  const problems: string[] = []
  if (column) {
    const byName = new Map(photos.map((p) => [base(p).toLowerCase(), p]))
    const byStem = new Map(photos.map((p) => [stem(p), p]))
    const pairs: PhotoPair[] = []
    const used = new Set<string>()
    for (const row of rows) {
      const want = String(row[column] ?? "").trim()
      if (!want) continue
      const hit = byName.get(base(want).toLowerCase()) ?? byStem.get(stem(want))
      if (!hit) {
        problems.push(`${want} is not among the photos`)
        continue
      }
      pairs.push({ photo: hit, row })
      used.add(hit)
    }
    const extra = photos.length - used.size
    if (extra > 0)
      problems.push(`${extra} photo(s) are not named in the design`)
    return {
      pairs,
      column,
      problems,
      rule: `each plot's photo named in the design's "${column}" column`,
    }
  }
  const sorted = naturalSort(photos)
  if (sorted.length !== rows.length)
    problems.push(
      `${sorted.length} photos but ${rows.length} plots: they cannot be paired one to one by order. Add a column naming each plot's photo.`,
    )
  const n = Math.min(sorted.length, rows.length)
  return {
    pairs: sorted.slice(0, n).map((photo, i) => ({ photo, row: rows[i] })),
    column: null,
    problems,
    rule: "the photos in file-name order, matched to the design's rows in order (right only if they were taken in that order)",
  }
}

/** A design row as plot properties: the row's own columns plus `plot` and
 *  `accession` (what plot images are named by) read from the columns
 *  breeders use for them, when the row has no column of that name. */
export function designProps(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const find = (...keys: string[]) => {
    const k = Object.keys(row).find((c) =>
      keys.includes(c.trim().toLowerCase()),
    )
    return k ? row[k] : undefined
  }
  const out: Record<string, unknown> = { ...row }
  const plot = find("plot", "plot_number", "plot number", "plot_id", "plotid")
  const acc = find("accession", "genotype", "entry", "line", "variety", "name")
  if (plot !== undefined && out.plot === undefined) out.plot = plot
  if (acc !== undefined && out.accession === undefined) out.accession = acc
  return out
}
