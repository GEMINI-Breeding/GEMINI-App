/**
 * Join hand-measured reference data onto the Analyze table's plot rows.
 *
 * Reference datasets carry experiment / location / population as plain
 * strings and identify plots by `plot_id` or by (`row`, `col`), so the join
 * is by scope + plot identity, never by date (a hand measurement taken a
 * week after the flight still describes the same plot).
 *
 * Each reference trait becomes its own column, `<trait> (ref: <dataset>)`,
 * merged into `row.values` so sorting, filtering, CSV export and the plot
 * dialog treat it like any other trait.
 */
import type { MatrixRow } from "./multivariate"

export interface RefDataset {
  id: string
  name: string
  experiment?: string | null
  location?: string | null
  population?: string | null
  trait_columns: string[]
}

export interface RefPlot {
  plot_id?: string | null
  plot_row?: string | null
  plot_column?: string | null
  traits?: Record<string, unknown> | null
}

export function refColumnName(trait: string, datasetName: string): string {
  return `${trait} (ref: ${datasetName})`
}

export function isRefColumn(column: string): boolean {
  return / \(ref: .*\)$/.test(column)
}

/**
 * Datasets that describe this scope. A dataset with no population applies
 * to every population at its site; one with a population only to that one
 * (and to the unfiltered, all-populations view).
 */
export function datasetsForScope(
  datasets: RefDataset[],
  scope: { experiment: string; location: string; population?: string | null },
): RefDataset[] {
  const same = (a?: string | null, b?: string | null) =>
    (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase()
  return datasets.filter(
    (d) =>
      same(d.experiment, scope.experiment) &&
      same(d.location, scope.location) &&
      (!scope.population ||
        !d.population ||
        same(d.population, scope.population)),
  )
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function plotKey(p: RefPlot): string[] {
  const keys: string[] = []
  const id = num(p.plot_id)
  if (id !== null) keys.push(`p:${id}`)
  const r = num(p.plot_row)
  const c = num(p.plot_column)
  if (r !== null && c !== null) keys.push(`rc:${r},${c}`)
  return keys
}

/**
 * Returns the rows with reference values merged in, plus the reference
 * column names (only those that matched at least one row, so a dataset
 * that numbers plots differently doesn't add a column of blanks).
 * `plot_id` wins over (row, col) when both are present. Non-numeric
 * reference values are dropped: the table and its sort are numeric.
 */
export function attachReference(
  rows: MatrixRow[],
  sources: Array<{ dataset: RefDataset; plots: RefPlot[] }>,
): { rows: MatrixRow[]; columns: string[] } {
  const extra = rows.map(() => ({}) as Record<string, number | null>)
  const used = new Set<string>()
  for (const { dataset, plots } of sources) {
    const index = new Map<string, RefPlot>()
    for (const p of plots) {
      for (const k of plotKey(p)) if (!index.has(k)) index.set(k, p)
    }
    rows.forEach((r, i) => {
      const hit =
        (r.plot_number != null ? index.get(`p:${r.plot_number}`) : undefined) ??
        (r.plot_row_number != null && r.plot_column_number != null
          ? index.get(`rc:${r.plot_row_number},${r.plot_column_number}`)
          : undefined)
      if (!hit) return
      for (const t of dataset.trait_columns) {
        const v = num(hit.traits?.[t])
        if (v === null) continue
        const col = refColumnName(t, dataset.name)
        extra[i][col] = v
        used.add(col)
      }
    })
  }
  const columns: string[] = []
  for (const { dataset } of sources) {
    for (const t of dataset.trait_columns) {
      const col = refColumnName(t, dataset.name)
      if (used.has(col) && !columns.includes(col)) columns.push(col)
    }
  }
  return {
    rows: rows.map((r, i) =>
      Object.keys(extra[i]).length
        ? { ...r, values: { ...r.values, ...extra[i] } }
        : r,
    ),
    columns,
  }
}
