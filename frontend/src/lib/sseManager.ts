/**
 * Module-level SSE manager — completely outside React's lifecycle.
 *
 * A single EventSource per runId is shared between all listeners
 * (ProcessContext, RunDetail, etc.). Navigating away from a page
 * does not close the connection because this module is never garbage-collected.
 */

type SseListener = (evt: Record<string, any>) => void

interface SseEntry {
  es: EventSource
  listeners: Set<SseListener>
  offset: number
  retryTimer: ReturnType<typeof setTimeout> | null
}

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

const connections = new Map<string, SseEntry>()

function open(runId: string) {
  const existing = connections.get(runId)
  const offset = existing?.offset ?? 0

  // Close stale connection before reopening
  existing?.es.close()

  const es = new EventSource(apiUrl(`/api/v1/pipeline-runs/${runId}/progress?offset=${offset}`))
  const entry: SseEntry = { es, listeners: existing?.listeners ?? new Set(), offset, retryTimer: null }
  connections.set(runId, entry)

  es.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data) as Record<string, any>

      if (evt.event === "waiting") {
        console.log(`[sseManager] ${runId.slice(0,8)} waiting — retrying in 1s`)
        es.close()
        entry.retryTimer = setTimeout(() => {
          if (entry.listeners.size > 0) open(runId)
        }, 1000)
        return
      }

      entry.offset += 1
      console.log(`[sseManager] ${runId.slice(0,8)} event=${evt.event} progress=${evt.progress ?? '-'} listeners=${entry.listeners.size}`)
      entry.listeners.forEach((fn) => fn(evt))

      if (evt.event === "complete" || evt.event === "error" || evt.event === "cancelled") {
        es.close()
        // Keep entry alive so late subscribers can still see final state
      }
    } catch {
      // ignore parse errors
    }
  }

  es.onerror = () => {
    es.close()
    if (entry.listeners.size === 0) {
      console.log(`[sseManager] ${runId.slice(0,8)} connection error — no listeners, stopping`)
      connections.delete(runId)
      return
    }
    console.log(`[sseManager] ${runId.slice(0,8)} connection error — retrying in 2s`)
    entry.retryTimer = setTimeout(() => {
      if (entry.listeners.size > 0) open(runId)
    }, 2000)
  }
}

export function subscribe(runId: string, listener: SseListener): () => void {
  const existing = connections.get(runId)
  // Reopen if there's no connection or the previous one was closed (e.g. after
  // a step completed and the EventSource was closed but the entry kept alive).
  if (!existing || existing.es.readyState === EventSource.CLOSED) {
    open(runId)
  }
  connections.get(runId)!.listeners.add(listener)

  return () => {
    const entry = connections.get(runId)
    if (!entry) return
    entry.listeners.delete(listener)
    // Don't close the connection — another subscriber may still need it
  }
}

export function closeRun(runId: string) {
  const entry = connections.get(runId)
  if (!entry) return
  if (entry.retryTimer) clearTimeout(entry.retryTimer)
  entry.es.close()
  connections.delete(runId)
}
