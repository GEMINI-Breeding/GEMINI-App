import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Capture every EventSource instance the module under test opens so the
// individual tests can drive `onmessage` / `onerror` / assert `readyState`.
type Captured = {
  url: string
  readyState: number
  onmessage: ((e: MessageEvent) => void) | null
  onerror: ((e: Event) => void) | null
  onopen: ((e: Event) => void) | null
  close: () => void
  closedCount: number
}
const instances: Captured[] = []

class FakeEventSource {
  static readonly CLOSED = 2
  static readonly OPEN = 1
  static readonly CONNECTING = 0

  url: string
  readyState = 1
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onopen: ((e: Event) => void) | null = null
  closedCount = 0

  constructor(url: string) {
    this.url = url
    instances.push(this as unknown as Captured)
  }

  close() {
    this.readyState = FakeEventSource.CLOSED
    this.closedCount += 1
  }
  addEventListener() {}
  removeEventListener() {}
}

// The module under test reads `EventSource` off the global at call time.
;(globalThis as unknown as { EventSource: unknown }).EventSource =
  FakeEventSource as unknown

type SseModule = typeof import("./sseManager")

async function loadFresh(): Promise<SseModule> {
  vi.resetModules()
  instances.length = 0
  return await import("./sseManager")
}

function latest(): Captured {
  const es = instances.at(-1)
  if (!es) throw new Error("No EventSource created yet")
  return es
}

function emit(data: unknown): void {
  const es = latest()
  es.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("sseManager", () => {
  it("opens a single EventSource per run id and dispatches events to listeners", async () => {
    const { subscribe } = await loadFresh()
    const fn = vi.fn()
    const unsub = subscribe("run-1", fn)

    expect(instances).toHaveLength(1)
    expect(latest().url).toContain("/api/v1/pipeline-runs/run-1/progress?offset=0")

    emit({ event: "progress", progress: 10 })
    emit({ event: "progress", progress: 20 })

    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(1, { event: "progress", progress: 10 })
    expect(fn).toHaveBeenNthCalledWith(2, { event: "progress", progress: 20 })
    unsub()
  })

  it("shares the same connection across multiple subscribers", async () => {
    const { subscribe } = await loadFresh()
    const a = vi.fn()
    const b = vi.fn()
    subscribe("run-1", a)
    subscribe("run-1", b)

    expect(instances).toHaveLength(1) // second subscribe did not open a new ES
    emit({ event: "progress", progress: 50 })
    expect(a).toHaveBeenCalledWith({ event: "progress", progress: 50 })
    expect(b).toHaveBeenCalledWith({ event: "progress", progress: 50 })
  })

  it("on 'waiting' event: closes the ES and reopens after 1s if listeners remain", async () => {
    const { subscribe } = await loadFresh()
    const fn = vi.fn()
    subscribe("run-1", fn)

    emit({ event: "waiting" })
    expect(latest().readyState).toBe(FakeEventSource.CLOSED)
    expect(fn).not.toHaveBeenCalled() // waiting isn't forwarded

    vi.advanceTimersByTime(1000)
    expect(instances).toHaveLength(2) // reopened
    expect(instances[1].readyState).toBe(FakeEventSource.OPEN)
  })

  it("on 'complete' event: closes the ES but keeps the entry (late subscribe reopens)", async () => {
    const { subscribe } = await loadFresh()
    const fn = vi.fn()
    const unsub = subscribe("run-1", fn)

    emit({ event: "complete" })
    expect(fn).toHaveBeenCalledWith({ event: "complete" })
    expect(latest().readyState).toBe(FakeEventSource.CLOSED)
    unsub()

    // A late subscribe should reopen rather than fail silently
    subscribe("run-1", vi.fn())
    expect(instances).toHaveLength(2)
  })

  it("on 'error' event: closes the ES", async () => {
    const { subscribe } = await loadFresh()
    subscribe("run-1", vi.fn())
    emit({ event: "error", message: "boom" })
    expect(latest().readyState).toBe(FakeEventSource.CLOSED)
  })

  it("onerror with active listeners retries after 2s and bumps diagnostics", async () => {
    const { subscribe } = await loadFresh()
    subscribe("run-1", vi.fn())
    const diag = (window as unknown as {
      __gemiSseDiagnostics?: { errorCount: number; lastErrorTs: number | null }
    }).__gemiSseDiagnostics
    expect(diag?.errorCount).toBe(0)

    latest().onerror?.(new Event("error"))
    expect(diag?.errorCount).toBe(1)
    expect(latest().readyState).toBe(FakeEventSource.CLOSED)

    vi.advanceTimersByTime(2000)
    expect(instances).toHaveLength(2) // retried
  })

  it("onerror with no listeners stops and deletes the entry", async () => {
    const { subscribe } = await loadFresh()
    const unsub = subscribe("run-1", vi.fn())
    unsub() // drain listeners

    latest().onerror?.(new Event("error"))
    vi.advanceTimersByTime(5000)
    expect(instances).toHaveLength(1) // never retried
  })

  it("unsubscribing the last listener does NOT close the connection", async () => {
    const { subscribe } = await loadFresh()
    const fn = vi.fn()
    const unsub = subscribe("run-1", fn)
    const closedBefore = latest().closedCount
    unsub()
    expect(latest().closedCount).toBe(closedBefore)
    expect(latest().readyState).toBe(FakeEventSource.OPEN)
  })

  it("closeRun explicitly closes and forgets the entry", async () => {
    const { subscribe, closeRun } = await loadFresh()
    subscribe("run-1", vi.fn())
    closeRun("run-1")
    expect(latest().readyState).toBe(FakeEventSource.CLOSED)

    // After closeRun, a new subscribe should open a fresh ES
    subscribe("run-1", vi.fn())
    expect(instances).toHaveLength(2)
  })

  it("each successful event increments the offset (used as query param on re-open)", async () => {
    const { subscribe } = await loadFresh()
    subscribe("run-1", vi.fn())
    emit({ event: "progress", progress: 10 })
    emit({ event: "progress", progress: 20 })
    emit({ event: "progress", progress: 30 })

    latest().onerror?.(new Event("error"))
    vi.advanceTimersByTime(2000)
    expect(instances[1].url).toContain("offset=3")
  })
})
