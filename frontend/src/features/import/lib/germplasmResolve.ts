/**
 * Shared helper for the wizard's germplasm-resolution step.
 *
 * Used by:
 *   - 9d's StepSampleResolve (genomic flow — resolve sample column headers)
 *   - 9e's StepGermplasmReview (trait flow — resolve accession/line/alias values)
 *
 * Wraps `GermplasmService.apiGermplasmResolveResolve` with chunking so a
 * 5000-name resolve doesn't ship as one giant POST. Returns the same
 * `ResolveResultOutput[]` shape the SDK exposes; callers map results into
 * their own decision shape (`SampleResolution` for genomic, `GermplasmReview`
 * for trait).
 */
import { GermplasmService, type ResolveResultOutput } from "@/client"

const DEFAULT_CHUNK_SIZE = 500
const DEFAULT_CONCURRENCY = 4

/**
 * Resolve a flat list of germplasm names against the backend in chunks.
 * The order of results matches the order of `names`. Duplicates in the
 * input list are NOT deduplicated by this function — callers should
 * dedupe up front if they want to (every name in their list gets a
 * result).
 *
 * Issues up to `concurrency` POSTs in parallel; for a study with a few
 * thousand sample headers this drops resolve from sequential N×latency
 * to ~⌈N/(chunkSize·concurrency)⌉×latency.
 *
 * @param names Names to resolve. Empty list short-circuits to `[]`.
 * @param experimentId Optional experiment scope for the resolver.
 * @param chunkSize POST batch size (default 500).
 * @param concurrency Max in-flight POSTs (default 4).
 * @param onProgress Called after each chunk finishes with
 *   ``(resolvedSoFar, totalNames)``. Useful for driving a determinate
 *   progress bar in the UI.
 */
export async function resolveGermplasmNames(
  names: string[],
  options: {
    experimentId?: string | number | null
    chunkSize?: number
    concurrency?: number
    onProgress?: (resolved: number, total: number) => void
  } = {},
): Promise<ResolveResultOutput[]> {
  if (names.length === 0) return []
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const chunks: { idx: number; names: string[] }[] = []
  for (let i = 0; i < names.length; i += chunkSize) {
    chunks.push({ idx: chunks.length, names: names.slice(i, i + chunkSize) })
  }
  const results: ResolveResultOutput[][] = new Array(chunks.length)
  let resolvedCount = 0
  // Worker pool: each worker pulls the next chunk index and POSTs it.
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(concurrency, chunks.length) },
    async () => {
      while (true) {
        const i = cursor++
        if (i >= chunks.length) return
        const c = chunks[i]
        const res = await GermplasmService.apiGermplasmResolveResolve({
          requestBody: {
            names: c.names,
            experiment_id: options.experimentId ?? null,
          },
        })
        results[c.idx] = res.results ?? []
        resolvedCount += c.names.length
        options.onProgress?.(resolvedCount, names.length)
      }
    },
  )
  await Promise.all(workers)
  return results.flat()
}

/**
 * Classify a `ResolveResultOutput` row as resolved (we have a canonical
 * name and a non-`unresolved` match_kind) or not. Mirrors the gemini-ui
 * logic so the genomic and trait flows agree on what "auto-resolved"
 * means.
 */
export function isResolved(result: ResolveResultOutput): boolean {
  return (
    result.match_kind !== "unresolved" &&
    Boolean(result.canonical_name && result.canonical_name.length > 0)
  )
}

/**
 * Normalize a raw alias / name cell value before sending it to the
 * resolver. Currently just trims whitespace — the backend treats inputs
 * as already-canonical past that point. Mirrors gemini-ui's helper of
 * the same name.
 */
export function normalizeGermplasmName(raw: string | null | undefined): string {
  return (raw ?? "").toString().trim()
}
