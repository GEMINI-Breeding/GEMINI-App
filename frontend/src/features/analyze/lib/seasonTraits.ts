/**
 * One trait through a season: its readings by flight date (a chart of the
 * plots' spread per date) and as a table of plots × dates. Records come
 * from every run of the trait in the scope picked (experiment, year, site,
 * crop), one dataset per date.
 */
import type { TraitRecordOutput } from "@/client"

/** The flight date a record is for (YYYY-MM-DD). */
export function recordDate(r: TraitRecordOutput): string {
  return String(r.collection_date || r.timestamp || "").slice(0, 10)
}

/** The accession / genotype of a record's plot, when known. */
export function recordAccession(r: TraitRecordOutput): string | null {
  const direct = (r as { accession_name?: unknown }).accession_name
  if (typeof direct === "string" && direct.trim()) return direct.trim()
  const info =
    r.record_info && typeof r.record_info === "object"
      ? (r.record_info as Record<string, unknown>)
      : {}
  for (const key of [
    "accession_name",
    "accession_label",
    "line_name",
    "germplasm_alias",
    "genotype",
  ]) {
    const v = info[key]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return null
}

export interface DatePoint {
  date: string
  n: number
  mean: number
  min: number
  max: number
  /** Quartiles: the middle half of the plots. */
  q1: number
  q3: number
  /** [min, max] and [q1, q3], for recharts' range areas. */
  range: [number, number]
  iqr: [number, number]
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** The plots' spread per flight date, earliest first. */
export function byDate(records: TraitRecordOutput[]): DatePoint[] {
  const values = new Map<string, number[]>()
  for (const r of records) {
    const d = recordDate(r)
    if (!d || r.trait_value == null || !Number.isFinite(r.trait_value)) continue
    const list = values.get(d) ?? []
    list.push(r.trait_value)
    values.set(d, list)
  }
  return [...values.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vs]) => {
      const s = [...vs].sort((a, b) => a - b)
      const mean = s.reduce((a, b) => a + b, 0) / s.length
      const q1 = quantile(s, 0.25)
      const q3 = quantile(s, 0.75)
      return {
        date,
        n: s.length,
        mean,
        min: s[0],
        max: s[s.length - 1],
        q1,
        q3,
        range: [s[0], s[s.length - 1]] as [number, number],
        iqr: [q1, q3] as [number, number],
      }
    })
}

export interface SeasonRow {
  /** "12" or "12 (r3 c4)" when plot numbers repeat across rows/cols. */
  plot: string
  plotNumber: number | null
  accession: string | null
  /** Value per date (the mean when a date has several readings). */
  values: Record<string, number>
}

/** Plots × dates: one row per plot, one column per flight date.
 *  `accessionOfPlot` (plot id → accession) fills in what records lack. */
export function seasonTable(
  records: TraitRecordOutput[],
  accessionOfPlot?: ReadonlyMap<string, string>,
): {
  dates: string[]
  rows: SeasonRow[]
} {
  const dates = new Set<string>()
  const cells = new Map<
    string,
    { row: Omit<SeasonRow, "values">; sums: Map<string, [number, number]> }
  >()
  for (const r of records) {
    const d = recordDate(r)
    if (!d || r.trait_value == null || !Number.isFinite(r.trait_value)) continue
    dates.add(d)
    const key = `${r.plot_number ?? "?"}|${r.plot_row_number ?? ""}|${r.plot_column_number ?? ""}`
    let cell = cells.get(key)
    if (!cell) {
      cell = {
        row: {
          plot: String(r.plot_number ?? "?"),
          plotNumber: r.plot_number ?? null,
          accession:
            recordAccession(r) ??
            (r.plot_id != null
              ? (accessionOfPlot?.get(String(r.plot_id)) ?? null)
              : null),
        },
        sums: new Map(),
      }
      cells.set(key, cell)
    }
    if (!cell.row.accession) cell.row.accession = recordAccession(r)
    const [sum, n] = cell.sums.get(d) ?? [0, 0]
    cell.sums.set(d, [sum + r.trait_value, n + 1])
  }
  // Plot numbers that repeat (one per population, say) show their row/col.
  const seen = new Map<string, number>()
  for (const c of cells.values())
    seen.set(c.row.plot, (seen.get(c.row.plot) ?? 0) + 1)
  const rows: SeasonRow[] = [...cells.entries()].map(([key, c]) => {
    const [, row, col] = key.split("|")
    const values: Record<string, number> = {}
    for (const [d, [sum, n]] of c.sums) values[d] = sum / n
    return {
      ...c.row,
      plot:
        (seen.get(c.row.plot) ?? 0) > 1 && (row || col)
          ? `${c.row.plot} (r${row} c${col})`
          : c.row.plot,
      values,
    }
  })
  rows.sort(
    (a, b) =>
      (a.plotNumber ?? Number.POSITIVE_INFINITY) -
        (b.plotNumber ?? Number.POSITIVE_INFINITY) ||
      a.plot.localeCompare(b.plot),
  )
  return { dates: [...dates].sort(), rows }
}

/** The table as CSV (plot, accession, one column per date). */
export function seasonCsv(table: ReturnType<typeof seasonTable>): string {
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  const lines = [["plot", "accession", ...table.dates].map(esc).join(",")]
  for (const r of table.rows)
    lines.push(
      [
        r.plot,
        r.accession ?? "",
        ...table.dates.map((d) =>
          r.values[d] == null ? "" : String(r.values[d]),
        ),
      ]
        .map(esc)
        .join(","),
    )
  return `${lines.join("\n")}\n`
}
