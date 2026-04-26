import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { JobsService } from "@/client"

import { useCancelJob, useJobs, useSubmitJob } from "./useJobs"

const submitMock = vi.spyOn(JobsService, "apiJobsSubmitSubmitJob")
const cancelMock = vi.spyOn(JobsService, "apiJobsJobIdCancelCancelJob")
const allMock = vi.spyOn(JobsService, "apiJobsAllGetAllJobs")

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  localStorage.setItem("gemini.auth.token", "fake-token")
})
afterEach(() => {
  localStorage.removeItem("gemini.auth.token")
  vi.clearAllMocks()
})

describe("useSubmitJob", () => {
  it("forwards job_type / parameters / experiment_id", async () => {
    submitMock.mockResolvedValue({ id: "job-1", job_type: "RUN_ODM" })
    const { result } = renderHook(() => useSubmitJob(), { wrapper })
    const job = await result.current.mutateAsync({
      jobType: "RUN_ODM",
      parameters: { foo: "bar" },
      experimentId: "exp-1",
    })
    expect(submitMock).toHaveBeenCalledWith({
      requestBody: { job_type: "RUN_ODM", parameters: { foo: "bar" }, experiment_id: "exp-1" },
    })
    expect(job).toEqual({ id: "job-1", job_type: "RUN_ODM" })
  })
})

describe("useCancelJob", () => {
  it("calls apiJobsJobIdCancelCancelJob with the jobId", async () => {
    cancelMock.mockResolvedValue({ id: "j1", job_type: "RUN_ODM" })
    const { result } = renderHook(() => useCancelJob(), { wrapper })
    await result.current.mutateAsync("job-2")
    expect(cancelMock).toHaveBeenCalledWith({ jobId: "job-2" })
  })
})

describe("useJobs", () => {
  it("filters by experimentId client-side", async () => {
    allMock.mockResolvedValue([
      { id: "1", job_type: "RUN_ODM", experiment_id: "A" },
      { id: "2", job_type: "RUN_ODM", experiment_id: "B" },
      { id: "3", job_type: "RUN_ODM" },
    ] as never)
    const { result } = renderHook(() => useJobs({ experimentId: "A" }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0].id).toBe("1")
  })
  it("forwards jobType to the SDK call", async () => {
    allMock.mockResolvedValue([] as never)
    const { result } = renderHook(() => useJobs({ jobType: "EXTRACT_TRAITS" }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(allMock).toHaveBeenCalledWith({ jobType: "EXTRACT_TRAITS" })
  })
})
