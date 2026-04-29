import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the wsManager module before importing ProcessContext so the
// auto-subscribe effect under test is wired to our capture functions
// instead of real WebSockets.
const subscribeMock = vi.fn()
const closeJobMock = vi.fn()

vi.mock("@/lib/wsManager", () => ({
  subscribe: (...args: unknown[]) => subscribeMock(...args),
  closeJob: (...args: unknown[]) => closeJobMock(...args),
}))

// useAuth gates the rehydration query (`enabled: Boolean(user)`). We
// flip it per-test to drive the null-user vs logged-in branches.
const authMock = vi.fn<() => { user: { id: string } | null }>(() => ({
  user: null,
}))
vi.mock("@/hooks/useAuth", () => ({
  default: () => authMock(),
  isLoggedIn: () => false,
}))

// JobsService.apiJobsAllGetAllJobs is the rehydration data source.
const apiJobsAllMock = vi.fn()
vi.mock("@/client", () => ({
  JobsService: {
    apiJobsAllGetAllJobs: (...args: unknown[]) => apiJobsAllMock(...args),
  },
}))

// findRunByJobId is the reverse-lookup that lets rehydration build the
// `/process/{wsId}/run/{runId}` link. Stubbed so rehydration tests
// don't need to seed the real runStore.
const findRunByJobIdMock = vi.fn()
vi.mock("@/features/process/lib/runStore", () => ({
  findRunByJobId: (jobId: string) => findRunByJobIdMock(jobId),
}))

import { ProcessProvider, useProcess } from "./ProcessContext"
import type { JobProgressEvent } from "@/lib/wsManager"

type Listener = (evt: JobProgressEvent) => void

// ProcessProvider now uses TanStack Query for the crash-recovery
// rehydration (see ProcessContext.tsx ~line 118). The query is
// auth-gated and won't fire in tests (no token in localStorage),
// but `useQuery` still requires a QueryClient in context.
const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <ProcessProvider>{children}</ProcessProvider>
    </QueryClientProvider>
  )
}

function setupCapture() {
  const listeners = new Map<string, Listener>()
  const unsubs = new Map<string, ReturnType<typeof vi.fn>>()

  subscribeMock.mockImplementation((jobId: string, fn: Listener) => {
    listeners.set(jobId, fn)
    const unsub = vi.fn(() => listeners.delete(jobId))
    unsubs.set(jobId, unsub)
    return unsub
  })

  return { listeners, unsubs }
}

describe("useProcess (consumer hook)", () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    closeJobMock.mockReset()
    authMock.mockReset()
    authMock.mockReturnValue({ user: null })
    apiJobsAllMock.mockReset()
    findRunByJobIdMock.mockReset()
  })

  it("throws a helpful error when called outside the provider", () => {
    expect(() => renderHook(() => useProcess())).toThrow(
      "useProcess must be used within a ProcessProvider",
    )
  })

  it("exposes empty arrays and hasBeenActive=false initially", () => {
    setupCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    expect(result.current.processes).toEqual([])
    expect(result.current.history).toEqual([])
    expect(result.current.hasBeenActive).toBe(false)
  })
})

describe("ProcessContext mutation actions", () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    closeJobMock.mockReset()
    authMock.mockReset()
    authMock.mockReturnValue({ user: null })
    apiJobsAllMock.mockReset()
    findRunByJobIdMock.mockReset()
    setupCapture()
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

describe("ProcessContext wsManager bridge", () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    closeJobMock.mockReset()
    authMock.mockReset()
    authMock.mockReturnValue({ user: null })
    apiJobsAllMock.mockReset()
    findRunByJobIdMock.mockReset()
  })

  it("subscribes for each running process that has a runId", () => {
    const { listeners } = setupCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })

    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "job-1",
      })
    })
    expect(subscribeMock).toHaveBeenCalledWith("job-1", expect.any(Function))
    expect(listeners.has("job-1")).toBe(true)
  })

  it("progress events update the process's progress field and translate progress_detail.stage to message", () => {
    const { listeners } = setupCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "job-1",
      })
    })
    act(() =>
      listeners.get("job-1")!({
        status: "RUNNING",
        progress: 37,
        progress_detail: { stage: "stage 2" },
      }),
    )
    const p = result.current.processes[0]
    expect(p.progress).toBe(37)
    expect(p.message).toBe("stage 2")
  })

  it("terminal COMPLETED marks the process as completed at 100%", () => {
    const { listeners } = setupCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "job-1",
      })
    })
    act(() =>
      listeners.get("job-1")!({
        status: "COMPLETED",
        progress: 100,
        terminal: true,
      }),
    )
    const p = result.current.processes[0]
    expect(p.status).toBe("completed")
    expect(p.progress).toBe(100)
    expect(p.message).toBe("Done")
  })

  it("terminal FAILED flips status=error and surfaces the error_message", () => {
    const { listeners } = setupCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "job-1",
      })
    })
    act(() =>
      listeners.get("job-1")!({
        status: "FAILED",
        error_message: "oom",
        terminal: true,
      }),
    )
    expect(result.current.processes[0]).toMatchObject({
      status: "error",
      message: "oom",
    })
  })

  it("terminal FAILED without an error_message falls back to 'Failed'", () => {
    const { listeners } = setupCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "job-1",
      })
    })
    act(() =>
      listeners.get("job-1")!({
        status: "FAILED",
        terminal: true,
      }),
    )
    expect(result.current.processes[0].message).toBe("Failed")
  })

  it("terminal CANCELLED flips status=error with message 'Cancelled'", () => {
    const { listeners } = setupCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "job-1",
      })
    })
    act(() =>
      listeners.get("job-1")!({
        status: "CANCELLED",
        terminal: true,
      }),
    )
    expect(result.current.processes[0]).toMatchObject({
      status: "error",
      message: "Cancelled",
    })
  })

  it("terminal events cause the effect to unsubscribe and close the connection", () => {
    const { listeners, unsubs } = setupCapture()
    const { result } = renderHook(() => useProcess(), { wrapper })
    act(() => {
      result.current.addProcess({
        type: "processing",
        status: "running",
        title: "t",
        items: [],
        runId: "job-1",
      })
    })
    act(() =>
      listeners.get("job-1")!({
        status: "COMPLETED",
        progress: 100,
        terminal: true,
      }),
    )
    expect(unsubs.get("job-1")).toHaveBeenCalled()
    expect(closeJobMock).toHaveBeenCalledWith("job-1")
  })
})

describe("ProcessContext crash-recovery rehydration", () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    closeJobMock.mockReset()
    apiJobsAllMock.mockReset()
    findRunByJobIdMock.mockReset()
    authMock.mockReset()
    setupCapture()
  })

  it("does not query /api/jobs/all when useAuth().user is null", async () => {
    authMock.mockReturnValue({ user: null })
    const { result } = renderHook(() => useProcess(), { wrapper })
    // Give the query layer a tick to settle.
    await waitFor(() => {
      expect(result.current.processes).toEqual([])
    })
    expect(apiJobsAllMock).not.toHaveBeenCalled()
  })

  it("rehydrates running jobs into processes with a /process/{wsId}/run/{runId} link", async () => {
    authMock.mockReturnValue({ user: { id: "u-1" } })
    apiJobsAllMock.mockResolvedValue([
      {
        id: "job-rehydrate-1",
        job_type: "RUN_ODM",
        status: "RUNNING",
        progress: 47,
        progress_detail: { stage: "stitching" },
      },
    ])
    findRunByJobIdMock.mockReturnValue({
      id: "run-uuid-1",
      workspaceId: "ws-uuid-1",
    })

    const { result } = renderHook(() => useProcess(), { wrapper })
    await waitFor(() => {
      expect(result.current.processes).toHaveLength(1)
    })

    const p = result.current.processes[0]
    expect(p).toMatchObject({
      type: "processing",
      status: "running",
      runId: "job-rehydrate-1",
      progress: 47,
      message: "stitching",
      link: "/process/ws-uuid-1/run/run-uuid-1",
    })
    expect(result.current.hasBeenActive).toBe(true)
  })

  it("silently drops rehydrated jobs whose owning Run is unknown to runStore", async () => {
    authMock.mockReturnValue({ user: { id: "u-1" } })
    apiJobsAllMock.mockResolvedValue([
      {
        id: "orphan-job",
        job_type: "RUN_ODM",
        status: "RUNNING",
        progress: 10,
      },
    ])
    findRunByJobIdMock.mockReturnValue(undefined)

    const { result } = renderHook(() => useProcess(), { wrapper })
    // Wait directly on the post-query effect having run (i.e. the
    // findRunByJobId reverse-lookup was attempted). Waiting on
    // apiJobsAllMock alone races with React's commit phase on slow
    // CI runners — the query has resolved but the effect hasn't
    // dispatched yet, so the assertion fires too early.
    await waitFor(() => {
      expect(findRunByJobIdMock).toHaveBeenCalledWith("orphan-job")
    })
    expect(result.current.processes).toEqual([])
  })
})
