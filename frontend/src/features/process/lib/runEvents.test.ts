/**
 * runEvents adapter tests. wsManager is mocked at the module level so we
 * can drive its captured listener with synthetic JobProgressEvents and
 * assert the emitted RunProgressEvent shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { JobProgressEvent } from "@/lib/wsManager"

import {
  closeJobConnection,
  type RunProgressEvent,
  subscribeJobAsRunEvent,
} from "./runEvents"

// Capture the listener wsManager.subscribe is called with so the test
// can fire it manually. Each `subscribe()` call creates a fresh slot.
type Listener = (evt: JobProgressEvent) => void
const captured: { jobId: string; listener: Listener; unsub: () => void }[] = []

vi.mock("@/lib/wsManager", () => ({
  subscribe: (jobId: string, listener: Listener) => {
    const unsub = vi.fn()
    captured.push({ jobId, listener, unsub })
    return unsub
  },
  closeJob: vi.fn(),
}))

beforeEach(() => {
  captured.length = 0
  vi.clearAllMocks()
})

describe("subscribeJobAsRunEvent", () => {
  it("synthesizes a 'start' frame on the very first event", () => {
    const events: RunProgressEvent[] = []
    subscribeJobAsRunEvent("job-1", "orthomosaic", (e) => events.push(e))
    expect(captured).toHaveLength(1)
    captured[0].listener({ progress: 5, status: "RUNNING" })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      event: "start",
      step: "orthomosaic",
      terminal: false,
    })
    expect(events[1]).toMatchObject({
      event: "progress",
      step: "orthomosaic",
      progress: 5,
      terminal: false,
    })
  })

  it("emits 'progress' for non-terminal events with stage as message", () => {
    const events: RunProgressEvent[] = []
    subscribeJobAsRunEvent("job-2", "stitching", (e) => events.push(e))
    captured[0].listener({
      progress: 42.7,
      status: "RUNNING",
      progress_detail: { stage: "downloading_images" },
    })
    // First event is the synthesized start; 2nd is the real progress.
    expect(events[1]).toMatchObject({
      event: "progress",
      progress: 42.7,
      message: "downloading_images",
      terminal: false,
    })
  })

  it("maps terminal COMPLETED → 'complete' with terminal=true", () => {
    const events: RunProgressEvent[] = []
    subscribeJobAsRunEvent("job-3", "orthomosaic", (e) => events.push(e))
    captured[0].listener({
      progress: 100,
      status: "COMPLETED",
      terminal: true,
    })
    const last = events[events.length - 1]
    expect(last.event).toBe("complete")
    expect(last.terminal).toBe(true)
    expect(last.progress).toBe(100)
  })

  it("maps terminal FAILED → 'error' and surfaces error_message", () => {
    const events: RunProgressEvent[] = []
    subscribeJobAsRunEvent("job-4", "orthomosaic", (e) => events.push(e))
    captured[0].listener({
      status: "FAILED",
      terminal: true,
      error_message: "AgRowStitch is not importable",
    })
    const last = events[events.length - 1]
    expect(last.event).toBe("error")
    expect(last.message).toBe("AgRowStitch is not importable")
    expect(last.terminal).toBe(true)
  })

  it("on terminal FAILED prefers error_message over the last-seen stage", () => {
    const events: RunProgressEvent[] = []
    subscribeJobAsRunEvent("job-4b", "trait_extraction", (e) => events.push(e))
    captured[0].listener({
      status: "FAILED",
      terminal: true,
      progress: 5,
      progress_detail: { stage: "downloading" },
      error_message: "S3 NoSuchKey: plot-boundaries/v1.geojson",
    })
    const last = events[events.length - 1]
    expect(last.event).toBe("error")
    expect(last.message).toBe("S3 NoSuchKey: plot-boundaries/v1.geojson")
  })

  it("maps terminal CANCELLED → 'cancelled'", () => {
    const events: RunProgressEvent[] = []
    subscribeJobAsRunEvent("job-5", "orthomosaic", (e) => events.push(e))
    captured[0].listener({ status: "CANCELLED", terminal: true })
    const last = events[events.length - 1]
    expect(last.event).toBe("cancelled")
    expect(last.terminal).toBe(true)
  })

  it("falls back to 'progress' for terminal events with an unrecognized status", () => {
    const events: RunProgressEvent[] = []
    subscribeJobAsRunEvent("job-6", "orthomosaic", (e) => events.push(e))
    captured[0].listener({
      status: "WHO_KNOWS" as unknown as string,
      terminal: true,
    })
    const last = events[events.length - 1]
    // mapStatus's terminal branch returns "progress" when no match.
    expect(last.event).toBe("progress")
    // But terminal flag still propagates because evt.terminal was true.
    expect(last.terminal).toBe(true)
  })

  it("returns the wsManager unsubscribe function", () => {
    const unsub = subscribeJobAsRunEvent("job-7", "any", () => {})
    expect(typeof unsub).toBe("function")
    expect(unsub).toBe(captured[0].unsub)
  })
})

describe("closeJobConnection", () => {
  it("delegates to wsManager.closeJob", async () => {
    const wsManager = await import("@/lib/wsManager")
    closeJobConnection("job-x")
    expect(wsManager.closeJob).toHaveBeenCalledWith("job-x")
  })
})
