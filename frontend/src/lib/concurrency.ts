/**
 * Bounded-concurrency task runner.
 *
 * Runs `tasks` with at most `limit` in flight at a time. Resolves when
 * every task has resolved, with results in the same order as input.
 * Rejections propagate as the first observed error (we don't continue
 * after a failure — callers that want best-effort behavior should
 * catch inside their task fn and turn errors into a value).
 *
 * Used by:
 *   - `useUploadQueue` (chunked-upload concurrency for /files)
 *   - `StepUpload` ingest orchestration (populations / seasons / sites
 *     / inline germplasm / per-(season, site) bulk record POSTs)
 */
export async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  if (tasks.length === 0) return []
  const results: T[] = new Array(tasks.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < tasks.length) {
      const idx = cursor++
      results[idx] = await tasks[idx]()
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    worker(),
  )
  await Promise.all(workers)
  return results
}
