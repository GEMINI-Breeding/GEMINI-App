/**
 * The collection date of each file, so one selection holding several dates
 * (a season of orthomosaics, each with its DEM) becomes one upload per date.
 *
 * Where a date comes from, first found wins:
 *   1. the file's name — 2023-06-15, 2023_06_15, 2023.06.15, 20230615,
 *      DJI_20230615101530_0001, 06-15-2023 (month first, as US field sheets
 *      write it; day first only when the day is over 12);
 *   2. the folders it came from, read the same way;
 *   3. the photo's own date (EXIF), for images — asked by the caller;
 *   4. the file's date on disk (or in online storage), which can be the day
 *      it was copied rather than flown: shown as such for the person to check.
 */

export type DateSource = "name" | "folder" | "photo" | "file date" | "chosen"

export interface DatedGroup<T> {
  /** YYYY-MM-DD. */
  date: string
  source: DateSource
  items: T[]
}

const pad = (n: number) => String(n).padStart(2, "0")

function valid(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCMonth() !== m - 1) return null // 2023-02-30
  return `${y}-${pad(m)}-${pad(d)}`
}

// Year first: 2023-06-15, 2023_06_15, 2023.06.15, 2023 06 15.
const YMD_SEP = /(?<!\d)((?:19|20)\d{2})[-_. ](\d{1,2})[-_. ](\d{1,2})(?!\d)/
// Year first, run together: 20230615 (also inside DJI_20230615101530_0001).
const YMD_RUN =
  /(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(?=\d{6}(?!\d)|(?!\d)|[_T-])/
// Year last: 06-15-2023 / 15-06-2023.
const XY_YEAR = /(?<!\d)(\d{1,2})[-_.](\d{1,2})[-_.]((?:19|20)\d{2})(?!\d)/

/** The date written in a name, if any. */
export function dateFromName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? name
  let m = YMD_SEP.exec(base)
  if (m) {
    const v = valid(+m[1], +m[2], +m[3])
    if (v) return v
  }
  m = YMD_RUN.exec(base)
  if (m) {
    const v = valid(+m[1], +m[2], +m[3])
    if (v) return v
  }
  m = XY_YEAR.exec(base)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    // Month first, unless the first number cannot be a month.
    const v = a > 12 ? valid(+m[3], b, a) : valid(+m[3], a, b)
    if (v) return v
  }
  return null
}

/** The date in the nearest folder name that has one ("2023/2023-06-15/rgb" → 2023-06-15). */
export function dateFromFolder(folder: string): string | null {
  const parts = folder.split(/[\\/]/).filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    const d = dateFromName(parts[i])
    if (d) return d
  }
  return null
}

/** A local calendar date from a timestamp (ms) or ISO string. */
export function localDate(
  t: number | string | null | undefined,
): string | null {
  if (t == null || t === "") return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** One file's date and where it came from. */
export function dateOf(input: {
  name: string
  folder?: string
  photoDate?: string | null
  modified?: number | string | null
}): { date: string; source: DateSource } | null {
  const n = dateFromName(input.name)
  if (n) return { date: n, source: "name" }
  const f = input.folder ? dateFromFolder(input.folder) : null
  if (f) return { date: f, source: "folder" }
  if (input.photoDate) return { date: input.photoDate, source: "photo" }
  const m = localDate(input.modified)
  return m ? { date: m, source: "file date" } : null
}

/** Group items by their date (oldest first); items with no date go under ``fallback``. */
export function groupByDate<T>(
  items: T[],
  dated: (item: T) => { date: string; source: DateSource } | null,
  fallback: string,
): DatedGroup<T>[] {
  const by = new Map<string, DatedGroup<T>>()
  const rank: Record<DateSource, number> = {
    name: 0,
    folder: 1,
    photo: 2,
    "file date": 3,
    chosen: 4,
  }
  for (const it of items) {
    const d = dated(it) ?? { date: fallback, source: "chosen" as DateSource }
    const g = by.get(d.date) ?? { date: d.date, source: d.source, items: [] }
    // A group is as sure as its least sure file.
    if (rank[d.source] > rank[g.source]) g.source = d.source
    g.items.push(it)
    by.set(d.date, g)
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** What to say about where a group's date came from. */
export const SOURCE_TEXT: Record<DateSource, string> = {
  name: "from the file names",
  folder: "from the folder names",
  photo: "from the photos' own dates",
  "file date":
    "from the files' dates — may be when they were copied, not collected",
  chosen: "no date found in the files: the date chosen on the form",
}

/** The token a date is written with in a group's names, to pick those files
 * out of a folder (online storage copies): "2023-06-15" or "20230615". */
export function dateTokenIn(names: string[], date: string): string | null {
  const compact = date.replaceAll("-", "")
  const forms = [
    date,
    date.replaceAll("-", "_"),
    date.replaceAll("-", "."),
    compact,
  ]
  return (
    forms.find((f) => names.length > 0 && names.every((n) => n.includes(f))) ??
    null
  )
}
