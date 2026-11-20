/**
 * A plot's identifier as the field names it. Most plots are numbered
 * (101, 102, …); some fields name a few with letters (check plots KW1…KW20).
 * The backend keeps identifiers as text and answers a whole number as a
 * number, any other identifier as its text — this does the same for values
 * read from boundary files and CSVs.
 */
export type PlotNumber = number | string

/** 101 for 101 / "101" / " 101 ", "KW1" for "KW1", undefined for nothing. */
export function normalizePlotNumber(v: unknown): PlotNumber | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined
  if (typeof v !== "string") return undefined
  const s = v.trim()
  if (s === "") return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : s
}

/** Natural order: numbered plots by value, then named ones (KW2 before KW10). */
export function comparePlotNumbers(a: unknown, b: unknown): number {
  const x = normalizePlotNumber(a)
  const y = normalizePlotNumber(b)
  if (x === undefined || y === undefined)
    return x === y ? 0 : x === undefined ? 1 : -1
  if (typeof x === "number" && typeof y === "number") return x - y
  if (typeof x === "number") return -1
  if (typeof y === "number") return 1
  return x.localeCompare(y, undefined, { numeric: true })
}
