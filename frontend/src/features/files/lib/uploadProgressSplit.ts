/**
 * Shared 0→100 progress split for file_upload processes that chain
 * into a backend worker job (currently only farm-ng .bin extraction).
 *
 * The bar advances monotonically across two phases:
 *   • Browser → MinIO chunked upload occupies [0, UPLOAD_PHASE_END]
 *   • Worker job (download → extract → upload → register) occupies
 *     [UPLOAD_PHASE_END, 100]
 *
 * Empirical split from log measurements on a typical 1.2 GB Amiga
 * .bin (Phase 9k):
 *   chunk upload ≈ 1m51s   ≈ 42% of total wall-clock
 *   worker total ≈ 2m32s   ≈ 58%
 *
 * The chunk-upload wall-clock is dominated by the user's network
 * upstream bandwidth and is highly variable; the worker phase is
 * more predictable. Allocating the worker slightly more bar
 * territory (30/70 vs the measured 42/58) means the bar continues
 * to advance during the longer-tail worker phase even when the
 * upload finishes quickly on fast networks. Slow-network users
 * still see the upload phase consume most of the bar's real time
 * because they spend more wall-clock in it.
 */
export const UPLOAD_PHASE_END = 30

/** Map a worker job's 0–100 progress to the [UPLOAD_PHASE_END, 100] band. */
export function mapWorkerProgress(workerPct: number): number {
  const clamped = Math.max(0, Math.min(100, workerPct))
  return UPLOAD_PHASE_END + ((100 - UPLOAD_PHASE_END) * clamped) / 100
}

/** Map an upload's 0–100 byte percent to the [0, UPLOAD_PHASE_END] band. */
export function mapUploadProgress(uploadPct: number): number {
  const clamped = Math.max(0, Math.min(100, uploadPct))
  return (UPLOAD_PHASE_END * clamped) / 100
}
