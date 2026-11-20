/**
 * Master-table logic for the Analyze "Table" tab: one row per plot, one
 * column per trait, built from `/api/multivariate_analysis/matrix`.
 *
 * Replaces two surfaces main had — the Master Table and the Query tab —
 * and the CSV exports both offered. Kept pure so it can be tested without
 * rendering.
 */
import type { MatrixRow } from "./multivariate"

export type SortKey =
  | "date"
  | "plot"
  | "row"
  | "col"
  | "accession"
  | { trait: string }

export type SortDir = "asc" | "desc"

function identity(r: MatrixRow) {
  return {
    plot: r.plot_number ?? null,
    row: r.plot_row_number ?? null,
    col: r.plot_column_number ?? null,
    accession: r.accession_name ?? "",
    date: r.collection_date ?? "",
  }
}

/**
 * Filter rows by a small query language, all terms ANDed:
 *   `plot:5`  `row:2`  `col:3`  exact number match
 *   `acc:CB27`                  accession contains (case-insensitive)
 *   `date:2022-07`              flight date starts with
 *   anything else               free text over plot / row / col / accession
 *
 * Empty query returns every row. Unknown `key:` prefixes are treated as free
 * text rather than silently dropping the term, so a typo narrows nothing
 * instead of matching everything.
 */
export function filterRows(rows: MatrixRow[], query: string): MatrixRow[] {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return rows
  return rows.filter((r) => {
    const id = identity(r)
    return terms.every((t) => {
      const m = t.match(/^(plot|row|col|acc|date):(.*)$/i)
      if (m) {
        const key = m[1].toLowerCase()
        const val = m[2]
        if (key === "acc") {
          return id.accession.toLowerCase().includes(val.toLowerCase())
        }
        if (key === "date") return id.date.startsWith(val)
        const n = Number(val)
        if (!Number.isFinite(n)) return false
        const actual =
          key === "plot" ? id.plot : key === "row" ? id.row : id.col
        return actual === n
      }
      const needle = t.toLowerCase()
      return [id.plot, id.row, id.col, id.accession, id.date].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(needle),
      )
    })
  })
}

function sortValue(r: MatrixRow, key: SortKey): number | string | null {
  if (typeof key === "object") return r.values[key.trait] ?? null
  const id = identity(r)
  if (key === "accession") return id.accession || null
  if (key === "date") return id.date || null
  return id[key]
}

/**
 * Stable sort. Nulls always go last regardless of direction — a plot with
 * no value for a trait should never float to the top of a "highest first"
 * sort and look like the winner.
 */
export function sortRows(
  rows: MatrixRow[],
  key: SortKey,
  dir: SortDir,
): MatrixRow[] {
  const sign = dir === "asc" ? 1 : -1
  return rows
    .map((r, i) => ({ r, i, v: sortValue(r, key) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i
      if (a.v === null) return 1
      if (b.v === null) return -1
      const c =
        typeof a.v === "number" && typeof b.v === "number"
          ? a.v - b.v
          : String(a.v).localeCompare(String(b.v), undefined, { numeric: true })
      return c !== 0 ? sign * c : a.i - b.i
    })
    .map((x) => x.r)
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return ""
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV of exactly the rows given (i.e. what the user is looking at). */
export function tableCsv(rows: MatrixRow[], traitNames: string[]): string {
  const dated = rows.some((r) => r.collection_date)
  const header = [
    ...(dated ? ["collection_date"] : []),
    "plot_number",
    "plot_row_number",
    "plot_column_number",
    "accession_name",
    "experiment_name",
    "season_name",
    "site_name",
    "population",
    ...traitNames,
  ]
  const lines = [header.map(cell).join(",")]
  for (const r of rows) {
    lines.push(
      [
        ...(dated ? [r.collection_date] : []),
        r.plot_number,
        r.plot_row_number,
        r.plot_column_number,
        r.accession_name,
        r.experiment_name,
        r.season_name,
        r.site_name,
        r.population,
        ...traitNames.map((t) => r.values[t]),
      ]
        .map(cell)
        .join(","),
    )
  }
  return `${lines.join("\n")}\n`
}

/**
 * Each date's matrix (one plot row per date) as one table: a row per plot
 * per flight date, earliest first, with the traits of every date. Nothing
 * is averaged across dates.
 */
export function rowsByDate(
  perDate: { date: string; rows: MatrixRow[]; trait_names: string[] }[],
): { rows: MatrixRow[]; trait_names: string[] } {
  const traits = new Set<string>()
  const rows: MatrixRow[] = []
  for (const d of [...perDate].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const t of d.trait_names) traits.add(t)
    for (const r of d.rows) rows.push({ ...r, collection_date: d.date })
  }
  return { rows, trait_names: [...traits] }
}
