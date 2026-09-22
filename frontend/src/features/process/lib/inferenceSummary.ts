/**
 * Shape and export the result of a batch LOCATE_PLANTS job (one job over
 * every plot image, see the worker's `images_prefix` mode).
 */

export interface BatchInferenceResult {
  images_found?: number
  plots_processed?: number
  total_detections?: number
  counts_by_plot?: Record<string, number>
  counts_by_class?: Record<string, number>
  errors?: Record<string, string>
  ingested?: Record<string, number>
}

export function isBatchInferenceResult(r: unknown): r is BatchInferenceResult {
  return (
    typeof r === "object" &&
    r !== null &&
    "counts_by_plot" in r &&
    typeof (r as { counts_by_plot?: unknown }).counts_by_plot === "object"
  )
}

export interface SummaryRow {
  plot: string
  count: number | null
  error: string | null
}

/**
 * One row per plot, numeric plots in numeric order (so plot 10 follows 9,
 * not 1). A plot that errored has `count: null` — not 0 — so a failure is
 * never mistaken for "inferred, found nothing".
 */
export function summaryRows(r: BatchInferenceResult): SummaryRow[] {
  const counts = r.counts_by_plot ?? {}
  const errors = r.errors ?? {}
  const keys = Array.from(
    new Set([...Object.keys(counts), ...Object.keys(errors)]),
  )
  keys.sort((a, b) => {
    const na = Number(a)
    const nb = Number(b)
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
    return a.localeCompare(b)
  })
  return keys.map((plot) => ({
    plot,
    count: plot in counts ? counts[plot] : null,
    error: errors[plot] ?? null,
  }))
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function summaryCsv(r: BatchInferenceResult): string {
  const lines = ["plot,detections,error"]
  for (const row of summaryRows(r)) {
    lines.push(
      [
        csvCell(row.plot),
        row.count === null ? "" : String(row.count),
        csvCell(row.error ?? ""),
      ].join(","),
    )
  }
  return `${lines.join("\n")}\n`
}
