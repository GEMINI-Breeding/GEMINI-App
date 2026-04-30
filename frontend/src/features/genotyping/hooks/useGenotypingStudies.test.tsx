/**
 * Unit tests for the GenotypingStudies hooks.
 *
 * The hooks are thin wrappers over the openapi-ts SDK; the contracts worth
 * pinning are:
 *   - list / getById / experiments queries forward arguments verbatim;
 *   - create / update / delete mutations call the right SDK method with
 *     the right id-coercion (idAsString — backend uses UUIDs);
 *   - all mutations invalidate the root cache key on success so the table
 *     re-renders without a manual refetch.
 *
 * We mock the SDK service module so no HTTP is involved.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  genotypingStudiesQueryKey,
  useCreateGenotypingStudy,
  useDeleteGenotypingStudy,
  useGenotypingStudies,
  useGenotypingStudy,
  useGenotypingStudyExperiments,
  useUpdateGenotypingStudy,
} from "./useGenotypingStudies"

vi.mock("@/client", async () => {
  const actual = await vi.importActual<typeof import("@/client")>("@/client")
  return {
    ...actual,
    GenotypingStudiesService: {
      apiGenotypingStudiesAllGetAllStudies: vi.fn(async () => [
        { id: "uuid-1", study_name: "Maize 2024" },
        { id: "uuid-2", study_name: "Wheat 2025" },
      ]),
      apiGenotypingStudiesIdStudyIdGetStudyById: vi.fn(
        async ({ studyId }: { studyId: string }) => ({
          id: studyId,
          study_name: "by-id",
        }),
      ),
      apiGenotypingStudiesCreateStudy: vi.fn(
        async ({ requestBody }: { requestBody: unknown }) => ({
          id: "uuid-new",
          ...(requestBody as object),
        }),
      ),
      apiGenotypingStudiesIdStudyIdUpdateStudy: vi.fn(
        async (args: unknown) => args,
      ),
      apiGenotypingStudiesIdStudyIdDeleteStudy: vi.fn(async () => undefined),
      apiGenotypingStudiesIdStudyIdExperimentsGetAssociatedExperiments: vi.fn(
        async () => [{ id: 1, experiment_name: "Exp-A" }],
      ),
    },
  }
})

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return { qc, Wrapper }
}

describe("useGenotypingStudies", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists studies via apiGenotypingStudiesAllGetAllStudies", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useGenotypingStudies(), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(2)
    expect(result.current.data?.[0].study_name).toBe("Maize 2024")

    const { GenotypingStudiesService } = await import("@/client")
    expect(
      GenotypingStudiesService.apiGenotypingStudiesAllGetAllStudies,
    ).toHaveBeenCalledWith({
      limit: 500,
      offset: 0,
    })
  })
})

describe("useGenotypingStudy", () => {
  it("does not fetch when id is undefined", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useGenotypingStudy(undefined), {
      wrapper: Wrapper,
    })
    // Disabled query stays in pending without ever resolving.
    expect(result.current.isFetching).toBe(false)
    expect(result.current.fetchStatus).toBe("idle")

    const { GenotypingStudiesService } = await import("@/client")
    expect(
      GenotypingStudiesService.apiGenotypingStudiesIdStudyIdGetStudyById,
    ).not.toHaveBeenCalled()
  })

  it("fetches by id when provided", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useGenotypingStudy("uuid-7"), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe("uuid-7")

    const { GenotypingStudiesService } = await import("@/client")
    expect(
      GenotypingStudiesService.apiGenotypingStudiesIdStudyIdGetStudyById,
    ).toHaveBeenCalledWith({
      studyId: "uuid-7",
    })
  })
})

describe("useGenotypingStudyExperiments", () => {
  it("loads associated experiments by study id", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useGenotypingStudyExperiments("uuid-1"),
      {
        wrapper: Wrapper,
      },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 1, experiment_name: "Exp-A" }])
  })
})

describe("useCreateGenotypingStudy", () => {
  it("forwards input as requestBody and invalidates the root cache key", async () => {
    const { qc, Wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")

    const { result } = renderHook(() => useCreateGenotypingStudy(), {
      wrapper: Wrapper,
    })
    await act(async () => {
      await result.current.mutateAsync({
        study_name: "Sorghum 2026",
        study_info: { ploidy: 2 },
      })
    })

    const { GenotypingStudiesService } = await import("@/client")
    expect(
      GenotypingStudiesService.apiGenotypingStudiesCreateStudy,
    ).toHaveBeenCalledWith({
      requestBody: { study_name: "Sorghum 2026", study_info: { ploidy: 2 } },
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: genotypingStudiesQueryKey,
    })
  })
})

describe("useUpdateGenotypingStudy", () => {
  it("calls the SDK with a string-coerced id and forwards the update body", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateGenotypingStudy(), {
      wrapper: Wrapper,
    })

    await act(async () => {
      await result.current.mutateAsync({
        row: { id: 42, study_name: "old" },
        input: { study_name: "new" },
      })
    })

    const { GenotypingStudiesService } = await import("@/client")
    expect(
      GenotypingStudiesService.apiGenotypingStudiesIdStudyIdUpdateStudy,
    ).toHaveBeenCalledWith({
      studyId: "42",
      requestBody: { study_name: "new" },
    })
  })
})

describe("useDeleteGenotypingStudy", () => {
  it("deletes by id and invalidates the cache", async () => {
    const { qc, Wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")
    const { result } = renderHook(() => useDeleteGenotypingStudy(), {
      wrapper: Wrapper,
    })

    await act(async () => {
      await result.current.mutateAsync({ id: "uuid-9", study_name: "doomed" })
    })

    const { GenotypingStudiesService } = await import("@/client")
    expect(
      GenotypingStudiesService.apiGenotypingStudiesIdStudyIdDeleteStudy,
    ).toHaveBeenCalledWith({
      studyId: "uuid-9",
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: genotypingStudiesQueryKey,
    })
  })
})
