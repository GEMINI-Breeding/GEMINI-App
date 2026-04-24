/**
 * Module-level WebSocket manager for job progress — replaces sseManager.ts.
 *
 * Protocol: GEMINIbase exposes `/api/jobs/{jobId}/progress` as a WebSocket
 * that yields JSON messages of shape:
 *     { status: "RUNNING", progress: 42.5, progress_detail: {...} }
 * and closes when the job reaches a terminal state (COMPLETED / FAILED /
 * CANCELLED). See backend/gemini/rest_api/controllers/jobs.py.
 *
 * Manager surface (mirrors sseManager for painless callsite migration):
 *   subscribe(jobId, listener) → unsubscribe()
 *   closeRun(jobId)             [alias: closeJob]
 *
 * A single WebSocket per job is shared across all listeners (ProcessContext,
 * RunDetail, etc.). Unsubscribing a listener does not close the connection —
 * another caller may still need it. closeJob() force-closes and drops the
 * entry. When the server closes (terminal state), the entry is kept alive
 * for late subscribers but the socket is not reopened.
 *
 * Reconnection: if the socket errors or closes unexpectedly while listeners
 * are still interested, we retry after 2s. The retry loop exits when there
 * are no more listeners.
 */

import { OpenAPI } from "@/client/core/OpenAPI"
import { getToken } from "@/lib/auth"

export type JobProgressEvent = {
  status?: string
  progress?: number
  progress_detail?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  error_message?: string | null
  error?: string
  // Convenience field the manager adds so listeners can tell the stream ended
  // without having to reason about status strings themselves.
  terminal?: boolean
}

export type JobProgressListener = (evt: JobProgressEvent) => void

type WsEntry = {
  ws: WebSocket | null
  listeners: Set<JobProgressListener>
  retryTimer: ReturnType<typeof setTimeout> | null
  lastEvent: JobProgressEvent | null
  closedByServer: boolean
}

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"])

const connections = new Map<string, WsEntry>()

function resolveWsUrl(jobId: string): string {
  // Prefer OpenAPI.BASE (set in main.tsx to __GEMI_BACKEND_URL__ or ""),
  // fall back to window.location so Tauri/prod sidecar builds still work.
  const base = (OpenAPI.BASE ?? "").replace(/\/$/, "")
  const httpBase = base || window.location.origin
  const wsBase = httpBase.replace(/^http/, "ws")
  // Bearer token lands as a query param — browser WebSocket cannot set
  // custom headers. The backend accepts the token on the URL, same as the
  // API-key middleware does.
  const token = getToken()
  const qs = token ? `?token=${encodeURIComponent(token)}` : ""
  return `${wsBase}/api/jobs/${encodeURIComponent(jobId)}/progress${qs}`
}

function open(jobId: string): void {
  const existing = connections.get(jobId)
  if (existing?.retryTimer) {
    clearTimeout(existing.retryTimer)
    existing.retryTimer = null
  }
  // Close any stale socket before replacing it.
  try {
    existing?.ws?.close()
  } catch {
    // ignore
  }

  const ws = new WebSocket(resolveWsUrl(jobId))
  const entry: WsEntry = {
    ws,
    listeners: existing?.listeners ?? new Set(),
    retryTimer: null,
    lastEvent: existing?.lastEvent ?? null,
    closedByServer: false,
  }
  connections.set(jobId, entry)

  ws.onmessage = (e) => {
    let data: JobProgressEvent
    try {
      data = JSON.parse(e.data) as JobProgressEvent
    } catch {
      return
    }
    const terminal = Boolean(
      data.status && TERMINAL_STATUSES.has(data.status),
    )
    const evt: JobProgressEvent = terminal ? { ...data, terminal: true } : data
    entry.lastEvent = evt
    entry.listeners.forEach((fn) => {
      try {
        fn(evt)
      } catch (err) {
        // Defensive: one bad listener should not break the stream for
        // the others.
        console.error(`[wsManager] listener for ${jobId} threw:`, err)
      }
    })
    if (terminal) {
      entry.closedByServer = true
      // The backend closes the socket itself; nothing else to do here.
    }
  }

  ws.onerror = () => {
    // Let onclose handle retry logic — onerror fires alongside onclose and
    // retrying from both would open two sockets.
  }

  ws.onclose = () => {
    entry.ws = null
    if (entry.closedByServer) {
      // Terminal state — keep the entry for late subscribers and stop.
      return
    }
    if (entry.listeners.size === 0) {
      connections.delete(jobId)
      return
    }
    // Transient close: reconnect after a short delay.
    entry.retryTimer = setTimeout(() => {
      if ((connections.get(jobId)?.listeners.size ?? 0) > 0) {
        open(jobId)
      }
    }, 2000)
  }
}

/**
 * Subscribe to a job's progress stream. Returns a disposer — call it on
 * component unmount. The underlying WebSocket stays open as long as at
 * least one listener remains.
 *
 * If a late subscriber joins after a terminal event has already fired,
 * they receive the last-seen event on the next microtask so they can
 * render the final state without having to re-fetch the job.
 */
export function subscribe(
  jobId: string,
  listener: JobProgressListener,
): () => void {
  let entry = connections.get(jobId)
  if (!entry || (entry.ws === null && !entry.closedByServer)) {
    open(jobId)
    entry = connections.get(jobId)!
  }
  entry.listeners.add(listener)

  if (entry.closedByServer && entry.lastEvent) {
    const last = entry.lastEvent
    queueMicrotask(() => {
      // Only replay if still subscribed at dispatch time.
      if (entry?.listeners.has(listener)) listener(last)
    })
  }

  return () => {
    const e = connections.get(jobId)
    if (!e) return
    e.listeners.delete(listener)
    // Don't close the socket — another subscriber may still need it.
    // closeJob() is the explicit force-close path.
  }
}

/** Force-close the connection and drop the entry. */
export function closeJob(jobId: string): void {
  const entry = connections.get(jobId)
  if (!entry) return
  if (entry.retryTimer) clearTimeout(entry.retryTimer)
  try {
    entry.ws?.close()
  } catch {
    // ignore
  }
  connections.delete(jobId)
}

// Back-compat alias for call sites that still say "runId" from the SSE era.
export const closeRun = closeJob
