/**
 * Best-effort rollback of plots created during a trait import that failed
 * partway. Plots are committed BEFORE the trait-record inserts that may
 * raise (e.g. the accession-mismatch trigger), so a failed import leaves
 * orphan plots behind. Worse, the backend's `create_plot_if_not_exists`
 * never updates an existing plot's accession — so those orphans poison a
 * corrected retry (the retry resolves to the stale plot and mismatches).
 *
 * This deletes the plots a run submitted, by resolving each (experiment,
 * season, site, plot_number, row, col) key back to a plot id and calling
 * the per-plot delete. It is intentionally only invoked when the import
 * created a BRAND-NEW experiment — every plot in a fresh experiment
 * belongs to this run, so deleting them can't touch anyone else's data.
 *
 * Resolution + deletes are throttled and failures are swallowed: rollback
 * is a cleanup convenience, never a hard gate on surfacing the original
 * error to the user.
 */
import type { PlotSpec } from "./recordBuilder"

export interface RollbackResult {
  deleted: number
  failed: number
}

/** Narrow the SDK surface we depend on so this stays unit-testable. */
export interface PlotsApi {
  apiPlotsGetPlots(data: {
    experimentName?: string | null
    seasonName?: string | null
    siteName?: string | null
    plotNumber?: number | null
    plotRowNumber?: number | null
    plotColumnNumber?: number | null
  }): Promise<Array<{ id?: string | number | null }>>
  apiPlotsIdPlotIdDeletePlot(data: { plotId: string }): Promise<unknown>
}

/**
 * Delete every plot in `specs` (deduped by key) from a freshly-created
 * experiment. Returns how many were deleted vs. failed. Never throws.
 *
 * `concurrency` bounds in-flight lookups+deletes; `signal` lets the caller
 * abort (e.g. the dialog closed).
 */
export async function rollbackCreatedPlots(
  api: PlotsApi,
  experimentName: string,
  specs: PlotSpec[],
  opts: { concurrency?: number; signal?: { aborted: boolean } } = {},
): Promise<RollbackResult> {
  const concurrency = opts.concurrency ?? 4
  const signal = opts.signal
  // Dedupe by the same key the import used so we don't issue N deletes for
  // one plot that backed N trait records.
  const seen = new Set<string>()
  const unique: PlotSpec[] = []
  for (const s of specs) {
    const key = `${s.season}::${s.site}::${s.plotNumber}::${s.plotRow}::${s.plotCol}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(s)
  }

  let deleted = 0
  let failed = 0

  const deleteOne = async (spec: PlotSpec): Promise<void> => {
    if (signal?.aborted) return
    try {
      const hits = await api.apiPlotsGetPlots({
        experimentName,
        seasonName: spec.season,
        siteName: spec.site,
        plotNumber: spec.plotNumber,
        plotRowNumber: spec.plotRow,
        plotColumnNumber: spec.plotCol,
      })
      const id = hits.find((p) => p.id != null)?.id
      if (id == null) {
        // Already gone / never created — nothing to roll back.
        return
      }
      if (signal?.aborted) return
      await api.apiPlotsIdPlotIdDeletePlot({ plotId: String(id) })
      deleted += 1
    } catch {
      failed += 1
    }
  }

  // Simple fixed-size worker pool over the unique specs.
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < unique.length) {
      if (signal?.aborted) return
      const idx = cursor++
      await deleteOne(unique[idx])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, unique.length) }, () =>
      worker(),
    ),
  )

  return { deleted, failed }
}
