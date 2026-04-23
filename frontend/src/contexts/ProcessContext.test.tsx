import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const subscribeMock = vi.fn()
const closeRunMock = vi.fn()

vi.mock("@/lib/sseManager", () => ({
  subscribe: (...args: unknown[]) => subscribeMock(...args),
  closeRun: (...args: unknown[]) => closeRunMock(...args),
}))

import { ProcessProvider, useProcess } from "./ProcessContext"

type SseEvent =
  | { event: "progress"; progress?: number; message?: string }
  | { event: "complete" }
  | { event: "error"; message?: string }
  | { event: "cancelled" }

type Listener = (evt: SseEvent) => void

const wrapper = ({ children }: { children: ReactNode }) => (
  <ProcessProvider>{children}</ProcessProvider>
)

function setupSseCapture() {
  const listeners = new Map<string, Listener>()
  const unsubs = new Map<string, ReturnType<typeof vi.fn>>()

  subscribeMock.mockImplementation((runId: string, fn: Listener) => {
    listeners.set(runId, fn)
    const unsub = vi.fn(() => listeners.delete(runId))
    unsubs.set(runId, unsub)
    return unsub
  })

  return { listeners, unsubs }
}

describe("useProcess (consumer hook)", () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    closeRunMock.mockReset()
  })

  it("throws a helpful error when called outside the provider", () => {
    expect(() => renderHook(() => useProcess())).toThrow(
      "useProcess must be used within a ProcessProvider",
    )
  })

  it("exposes empty arrays and hasBeenActive=false initially", () => {
    setupSseCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    expect(result.current.processes).toEqual([])
    expect(result.current.history).toEqual([])
    expect(result.current.hasBeenActive).toBe(false)
  })
})

describe("ProcessContext mutation actions", () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    closeRunMock.mockReset()
    setupSseCapture()
  })

  it("addProcess assigns an id + createdAt and flips hasBeenActive", () => {
    const { result } = renderHook(() => useProcess(), { wrapper })

    let id = ""
    act(() => {
      id = result.current.addProcess({
        type: "file_upload",
        status: "running",
        title: "Uploading",
        items: [{ id: "0", name: "a.jpg", status: "pending" }],
      })
    })
    expect(id).toBeTruthy()
    expect(result.current.processes).toHaveLength(1)
    const p = result.current.processes[0]
    expect(p.id).toBe(id)
    expect(p.createdAt).toBeInstanceOf(Date)
    expect(result.current.hasBeenActive).toBe(true)
  })

  it("updateProcess merges patches by id", () => {
    const { result } = renderHook(() => useProcess(), { wrapper })
    let id = ""
    act(() => {
      id = result.current.addProcess({
        type: "file_upload",
        status: "running",
        title: "t",
        items: [],
      })
    })
    act(() => result.current.updateProcess(id, { progress: 42, message: "x" }))
    expect(result.current.processes[0].progress).toBe(42)
    expect(result.current.processes[0].message).toBe("x")
  })

  it("updateProcessItem patches only the matching item on the matching process", () => {
    const { result } = renderHook(() => useProcess(), { wrapper })
    let id = ""
    act(() => {
      id = result.current.addProcess({
        type: "file_upload",
        status: "running",
        title: "t",
        items: [
          { id: "0", name: "a", status: "pending" },
          { id: "1", name: "b", status: "pending" },
        ],
      })
    })
    act(() =>
      result.current.updateProcessItem(id, "1", {
        status: "completed",
        label: "done",
      }),
    )
    const items = result.current.processes[0].items
    expect(items[0]).toMatchObject({ id: "0", status: "pending" })
    expect(items[1]).toMatchObject({ id: "1", status: "completed", label: "done" })
  })

  it("removeProcess moves the process into history", () => {
    const { result } = renderHook(() => useProcess(), { wrapper })
    let id = ""
    act(() => {
      id = result.current.addProcess({
        type: "file_upload",
        status: "completed",
        title: "t",
        items: [],
      })
    })
    act(() => result.current.removeProcess(id))
    expect(result.current.processes).toHaveLength(0)
    expect(result.current.history).toHaveLength(1)
    expect(result.current.history[0].id).toBe(id)
  })

  it("removeProcess does not duplicate history when called twice", () => {
    const { result } = renderHook(() => useProcess(), { wrapper })
    let id = ""
    act(() => {
      id = result.current.addProcess({
        type: "file_upload",
        status: "completed",
        title: "t",
        items: [],
      })
    })
    act(() => result.current.removeProcess(id))
    // Second remove is a no-op on an already-removed id, still only one history entry
    act(() => result.current.removeProcess(id))
    expect(result.current.history).toHaveLength(1)
  })

  it("clearCompleted moves all finished processes to history; running ones stay", () => {
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "file_upload",
        status: "running",
        title: "still-going",
        items: [],
      })
      result.current.addProcess({
        type: "file_upload",
        status: "completed",
        title: "done",
        items: [],
      })
      result.current.addProcess({
        type: "file_upload",
        status: "error",
        title: "failed",
        items: [],
      })
    })
    act(() => result.current.clearCompleted())
    expect(result.current.processes.map((p) => p.title)).toEqual(["still-going"])
    expect(result.current.history.map((p) => p.title).sort()).toEqual([
      "done",
      "failed",
    ])
  })

  it("clearHistory empties the history array", () => {
    const { result } = renderHook(() => useProcess(), { wrapper })
    let id = ""
    act(() => {
      id = result.current.addProcess({
        type: "file_upload",
        status: "completed",
        title: "t",
        items: [],
      })
    })
    act(() => result.current.removeProcess(id))
    expect(result.current.history).toHaveLength(1)
    act(() => result.current.clearHistory())
    expect(result.current.history).toHaveLength(0)
  })
})

describe("ProcessContext SSE bridge", () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    closeRunMock.mockReset()
  })

  it("subscribes to an SSE stream for each running process that has a runId", () => {
    const { listeners } = setupSseCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })

    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "run-1",
      })
    })
    expect(subscribeMock).toHaveBeenCalledWith("run-1", expect.any(Function))
    expect(listeners.has("run-1")).toBe(true)
  })

  it("progress events update the process's progress + message fields", () => {
    const { listeners } = setupSseCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "run-1",
      })
    })
    act(() =>
      listeners.get("run-1")!({
        event: "progress",
        progress: 37,
        message: "stage 2",
      }),
    )
    const p = result.current.processes[0]
    expect(p.progress).toBe(37)
    expect(p.message).toBe("stage 2")
  })

  it("complete event marks the process as completed at 100%", () => {
    const { listeners } = setupSseCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "run-1",
      })
    })
    act(() => listeners.get("run-1")!({ event: "complete" }))
    const p = result.current.processes[0]
    expect(p.status).toBe("completed")
    expect(p.progress).toBe(100)
    expect(p.message).toBe("Done")
  })

  it("error event flips status=error and surfaces the provided message", () => {
    const { listeners } = setupSseCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "run-1",
      })
    })
    act(() => listeners.get("run-1")!({ event: "error", message: "oom" }))
    expect(result.current.processes[0]).toMatchObject({
      status: "error",
      message: "oom",
    })
  })

  it("error event without a message falls back to 'Failed'", () => {
    const { listeners } = setupSseCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "run-1",
      })
    })
    act(() => listeners.get("run-1")!({ event: "error" }))
    expect(result.current.processes[0].message).toBe("Failed")
  })

  it("cancelled event flips status=error with message 'Cancelled'", () => {
    const { listeners } = setupSseCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "run-1",
      })
    })
    act(() => listeners.get("run-1")!({ event: "cancelled" }))
    expect(result.current.processes[0]).toMatchObject({
      status: "error",
      message: "Cancelled",
    })
  })

  it("terminal events cause the effect to unsubscribe and close the SSE connection", () => {
    const { listeners, unsubs } = setupSseCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "run-1",
      })
    })
    act(() => listeners.get("run-1")!({ event: "complete" }))
    // After the state update settles, the effect should have cleaned up:
    expect(unsubs.get("run-1")).toHaveBeenCalled()
    expect(closeRunMock).toHaveBeenCalledWith("run-1")
  })
})
