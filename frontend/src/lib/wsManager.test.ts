/**
 * Unit tests for lib/wsManager.ts.
 *
 * Mocks the global WebSocket constructor so we can:
 *   - inspect the URL (including the ?token= query param wiring)
 *   - dispatch messages synchronously to subscribers
 *   - assert terminal events tagged with terminal:true and replayed to late
 *     subscribers on the next microtask
 *   - assert shared-connection semantics: one WebSocket per jobId regardless
 *     of how many listeners
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

class FakeWs {
  static instances: FakeWs[] = []
  readyState = 0
  url: string
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  onopen: (() => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    FakeWs.instances.push(this)
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
  // addEventListener/send stubs to satisfy the WebSocket contract.
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
}

describe("wsManager", () => {
  beforeEach(() => {
    FakeWs.instances = []
    ;(global as any).WebSocket = FakeWs
    localStorage.setItem("gemini.auth.token", "tok-ws")
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete (global as any).WebSocket
  })

  it("subscribe opens a single WebSocket per jobId and attaches the token as ?token=", async () => {
    const { subscribe, closeJob } = await import("./wsManager")
    const jobId = "job-1"
    const unsub = subscribe(jobId, () => {})
    expect(FakeWs.instances).toHaveLength(1)
    const ws = FakeWs.instances[0]
    expect(ws.url).toContain(`/api/jobs/${jobId}/progress`)
    expect(ws.url).toContain("token=tok-ws")
    // Second subscriber shares the same socket.
    const off2 = subscribe(jobId, () => {})
    expect(FakeWs.instances).toHaveLength(1)
    unsub()
    off2()
    closeJob(jobId)
  })

  it("dispatches messages to all listeners and tags terminal events", async () => {
    const { subscribe, closeJob } = await import("./wsManager")
    const a: any[] = []
    const b: any[] = []
    subscribe("job-2", (e) => a.push(e))
    subscribe("job-2", (e) => b.push(e))
    const ws = FakeWs.instances[0]
    ws.emit({ status: "RUNNING", progress: 50 })
    ws.emit({ status: "COMPLETED", progress: 100 })
    expect(a.map((e) => e.status)).toEqual(["RUNNING", "COMPLETED"])
    expect(b.map((e) => e.status)).toEqual(["RUNNING", "COMPLETED"])
    expect(a[1].terminal).toBe(true)
    expect(b[1].terminal).toBe(true)
    closeJob("job-2")
  })

  it("replays the last terminal event to late subscribers", async () => {
    vi.useFakeTimers({ toFake: ["queueMicrotask"] })
    const { subscribe, closeJob } = await import("./wsManager")
    subscribe("job-3", () => {})
    const ws = FakeWs.instances[0]
    ws.emit({ status: "FAILED", error_message: "boom" })
    ws.close()
    const late: any[] = []
    subscribe("job-3", (e) => late.push(e))
    // microtask queue flush
    await Promise.resolve()
    vi.runAllTicks()
    expect(late).toHaveLength(1)
    expect(late[0].status).toBe("FAILED")
    expect(late[0].terminal).toBe(true)
    vi.useRealTimers()
    closeJob("job-3")
  })

  it("reconnects after a transient close while listeners remain", async () => {
    vi.useFakeTimers()
    const { subscribe, closeJob } = await import("./wsManager")
    subscribe("job-4", () => {})
    expect(FakeWs.instances).toHaveLength(1)
    // Simulate a transient close (the server didn't send a terminal frame).
    FakeWs.instances[0].close()
    // The retry timer is set for 2000ms; before that, no new socket.
    expect(FakeWs.instances).toHaveLength(1)
    vi.advanceTimersByTime(2000)
    // After the timer fires, open() runs and a fresh socket is created.
    expect(FakeWs.instances).toHaveLength(2)
    expect(FakeWs.instances[1].url).toContain("/api/jobs/job-4/progress")
    vi.useRealTimers()
    closeJob("job-4")
  })

  it("closeJob clears the pending retry timer and drops the connection entry", async () => {
    vi.useFakeTimers()
    const { subscribe, closeJob } = await import("./wsManager")
    subscribe("job-5", () => {})
    FakeWs.instances[0].close()
    // A retry timer is now pending. closeJob must cancel it.
    closeJob("job-5")
    vi.advanceTimersByTime(5000)
    expect(FakeWs.instances).toHaveLength(1)
    // Re-subscribing should open a brand-new connection because the entry
    // for job-5 was deleted.
    subscribe("job-5", () => {})
    expect(FakeWs.instances).toHaveLength(2)
    vi.useRealTimers()
    closeJob("job-5")
  })
})
