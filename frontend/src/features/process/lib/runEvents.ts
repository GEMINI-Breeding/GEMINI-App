/**
 * runEvents — adapt GEMINIbase JobProgressEvent (WebSocket) to the
 * ProgressEvent shape RunDetail's `useStepProgress` hook expects.
 *
 * Main's RunDetail consumed an SSE stream keyed by pipeline_run_id with
 * named events (`start`, `progress`, `log`, `complete`, `error`,
 * `cancelled`) and a freeform `step` tag. GEMINIbase's WS stream is per-
 * Job UUID with a single envelope shape; the `step` association lives
 * client-side in runStore (which step submitted which job).
 *
 * This module subscribes to a *step's* current job and re-emits events in
 * the legacy shape. When a step has multiple jobs (e.g. inference fan-out),
 * the caller subscribes per-jobId and the adapter merges the streams.
 */
import {
  closeJob,
  type JobProgressEvent,
  subscribe as subscribeJob,
} from "@/lib/wsManager"

export interface RunProgressEvent {
  /** Legacy SSE event name: start | progress | log | complete | error | cancelled */
  event: string
  /** Step key (e.g. "orthomosaic"). Always set by the adapter. */
  step?: string
  message?: string
  index?: number
  total?: number
  progress?: number
  outputs?: Record<string, string>
  /** Wall-clock time (ms since epoch) when the event was received. */
  timestamp: number
  /** True when this event is the final frame for the underlying job. */
  terminal: boolean
}

function mapStatus(evt: JobProgressEvent): string {
  if (!evt.terminal) return "progress"
  if (evt.status === "COMPLETED") return "complete"
  if (evt.status === "FAILED") return "error"
  if (evt.status === "CANCELLED") return "cancelled"
  return "progress"
}

/**
 * Subscribe to a single Job and re-emit events in the legacy shape.
 * Returns an unsubscribe function. The underlying WebSocket is shared
 * across subscribers, so closing here does not tear it down.
 */
export function subscribeJobAsRunEvent(
  jobId: string,
  step: string,
  onEvent: (evt: RunProgressEvent) => void,
): () => void {
  let firstEvent = true
  const unsub = subscribeJob(jobId, (evt) => {
    const now = Date.now()
    if (firstEvent) {
      firstEvent = false
      // Synthesize the legacy "start" frame so RunDetail's progress log
      // shows a "Started" entry like the SSE backend used to.
      onEvent({ event: "start", step, timestamp: now, terminal: false })
    }
    const stage =
      (evt.progress_detail as { stage?: string } | null | undefined)?.stage ??
      undefined
    const isFailedTerminal = evt.terminal && evt.status === "FAILED"
    // On terminal-FAILED frames, the actual exception is in error_message;
    // the last-seen stage label ("downloading") is misleading. Prefer
    // error_message there. On all other frames, stage is the right hint.
    const message = isFailedTerminal
      ? (evt.error_message ?? stage ?? undefined)
      : (stage ?? evt.error_message ?? undefined)
    onEvent({
      event: mapStatus(evt),
      step,
      message,
      progress: typeof evt.progress === "number" ? evt.progress : undefined,
      timestamp: now,
      terminal: Boolean(evt.terminal),
    })
  })
  return unsub
}

/**
 * Force-close a job's WebSocket. Use sparingly — usually let subscribers
 * unmount and let the socket idle. Mirrors closeRun() from the legacy
 * sseManager.
 */
export function closeJobConnection(jobId: string): void {
  closeJob(jobId)
}
