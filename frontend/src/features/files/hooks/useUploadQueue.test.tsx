/**
 * useUploadQueue unit tests.
 *
 * Mocks the SDK + upload primitive so we can verify the orchestration
 * concerns: concurrency, follow-up job submission, runId wiring, terminal
 * states. Progress state is validated in useChunkedUpload.test.
 */
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/chunkedUpload", () => ({
  uploadFileChunked: vi.fn(),
}))
vi.mock("@/lib/wsManager", () => ({
  subscribe: vi.fn(() => () => {}),
  closeJob: vi.fn(),
}))
vi.mock("@/client", () => ({
  JobsService: {
    apiJobsSubmitSubmitJob: vi.fn(),
  },
}))

import { uploadFileChunked } from "@/lib/chunkedUpload"
import { JobsService } from "@/client"
import { ProcessProvider, useProcess } from "@/contexts/ProcessContext"
import { useUploadQueue } from "./useUploadQueue"

const mockedUpload = uploadFileChunked as unknown as ReturnType<typeof vi.fn>
const mockedSubmit = JobsService.apiJobsSubmitSubmitJob as unknown as ReturnType<
  typeof vi.fn
>

const wrapper = ({ children }: { children: ReactNode }) => (
  <ProcessProvider>{children}</ProcessProvider>
)

function useHarness() {
  const queue = useUploadQueue()
  const { processes } = useProcess()
  return { queue, processes }
}

function stubUploadResolvingInOrder() {
  let i = 0
  mockedUpload.mockImplementation(async ({ objectName }: { objectName: string }) => {
    i++
    return { objectName, bytes: 1, chunkCount: 1 }
  })
  return () => i
}

describe("useUploadQueue", () => {
  beforeEach(() => {
    mockedUpload.mockReset()
    mockedSubmit.mockReset()
  })

  it("uploads every task and marks the process completed when there's no follow-up job", async () => {
    stubUploadResolvingInOrder()
    const { result } = renderHook(() => useHarness(), { wrapper })

    await act(async () => {
      await result.current.queue.run([
        {
          file: new File([], "a.jpg"),
          objectPath: "Raw/a.jpg",
          followUpJob: { kind: "none" },
        },
        {
          file: new File([], "b.jpg"),
          objectPath: "Raw/b.jpg",
          followUpJob: { kind: "none" },
        },
      ])
    })

    expect(mockedUpload).toHaveBeenCalledTimes(2)
    expect(mockedSubmit).not.toHaveBeenCalled()
    const p = result.current.processes[0]
    expect(p.status).toBe("completed")
    expect(p.progress).toBe(100)
  })

  it("submits one EXTRACT_BINARY job per .bin upload and wires the first job id as runId", async () => {
    stubUploadResolvingInOrder()
    mockedSubmit.mockResolvedValueOnce({ id: "job-1" })
    mockedSubmit.mockResolvedValueOnce({ id: "job-2" })
    const { result } = renderHook(() => useHarness(), { wrapper })

    let out:
      | Awaited<ReturnType<typeof result.current.queue.run>>
      | undefined
    await act(async () => {
      out = await result.current.queue.run([
        {
          file: new File([], "x.bin"),
          objectPath: "Raw/x.bin",
          followUpJob: { kind: "extract_binary" },
        },
        {
          file: new File([], "y.bin"),
          objectPath: "Raw/y.bin",
          followUpJob: { kind: "extract_binary" },
        },
      ])
    })

    expect(mockedSubmit).toHaveBeenCalledTimes(2)
    // Every submit goes through /api/jobs/submit with EXTRACT_BINARY +
    // the MinIO input path from the upload.
    expect(mockedSubmit.mock.calls[0][0]).toEqual({
      requestBody: {
        job_type: "EXTRACT_BINARY",
        parameters: { input_path: "Raw/x.bin" },
      },
    })
    expect(out?.jobIds).toEqual(["job-1", "job-2"])
    // ProcessContext auto-subscribes to runId, so the queue exposes the
    // first extraction-job id there to drive the progress bar.
    const p = result.current.processes[0]
    expect(p.runId).toBe("job-1")
    expect(p.status).toBe("running")
  })

  it("flips the process to error and rethrows when a chunk upload fails", async () => {
    mockedUpload.mockRejectedValue(new Error("network"))
    const { result } = renderHook(() => useHarness(), { wrapper })
    let caught: unknown
    await act(async () => {
      try {
        await result.current.queue.run([
          {
            file: new File([], "bad.jpg"),
            objectPath: "Raw/bad.jpg",
            followUpJob: { kind: "none" },
          },
        ])
      } catch (e) {
        // The hook rethrows after marking the process errored; catching here
        // lets React flush the state update before we assert on processes.
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toMatch(/network/)
    const p = result.current.processes[0]
    expect(p.status).toBe("error")
    expect(p.error).toMatch(/network/)
  })
})
