/**
 * Unit tests for the records + ingest hooks.
 *
 * Pinned contracts:
 *   - useGenotypeRecords passes studyId + limit/offset + filters straight
 *     through to the SDK; query is disabled when studyId is undefined.
 *   - useIngestGenotypeMatrix posts the batch to the right SDK method
 *     and invalidates the genotyping_studies subtree so dependent
 *     queries (records list + future variants list) refetch.
 *   - mutate() rejects when called without studyId rather than silently
 *     no-op'ing (would otherwise mask a wiring bug in the dialog).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  useGenotypeRecords,
  useIngestGenotypeMatrix,
} from "./useGenotypeRecords"
import { genotypingStudiesQueryKey } from "./useGenotypingStudies"

vi.mock("@/client", async () => {
  const actual = await vi.importActual<typeof import("@/client")>("@/client")
  return {
    ...actual,
    GenotypingStudiesService: {
      apiGenotypingStudiesIdStudyIdRecordsGetRecords: vi.fn(async () => [
        {
          id: "r1",
          variant_name: "SNP_001",
          chromosome: 1,
          position: 100,
          accession_name: "LINE_A",
          call_value: "A/G",
        },
      ]),
      apiGenotypingStudiesIdStudyIdIngestMatrixIngestMatrix: vi.fn(
        async () => ({
          variants_inserted: 2,
          records_inserted: 6,
          errors: [],
        }),
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

describe("useGenotypeRecords", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("forwards studyId, limit, offset, and filters to the SDK", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () =>
        useGenotypeRecords({
          studyId: "uuid-9",
          limit: 25,
          offset: 50,
          variantName: "SNP_X",
          accessionName: "LINE_B",
          chromosome: 7,
        }),
      { wrapper: Wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const { GenotypingStudiesService } = await import("@/client")
    expect(
      GenotypingStudiesService.apiGenotypingStudiesIdStudyIdRecordsGetRecords,
    ).toHaveBeenCalledWith({
      studyId: "uuid-9",
      limit: 25,
      offset: 50,
      variantName: "SNP_X",
      accessionName: "LINE_B",
      chromosome: 7,
    })
  })

  it("does not fetch when studyId is undefined", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useGenotypeRecords({ studyId: undefined }),
      { wrapper: Wrapper },
    )
    expect(result.current.fetchStatus).toBe("idle")

    const { GenotypingStudiesService } = await import("@/client")
    expect(
      GenotypingStudiesService.apiGenotypingStudiesIdStudyIdRecordsGetRecords,
    ).not.toHaveBeenCalled()
  })
})

describe("useIngestGenotypeMatrix", () => {
  it("posts the batch and invalidates the genotyping_studies subtree", async () => {
    const { qc, Wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")

    const { result } = renderHook(() => useIngestGenotypeMatrix("uuid-1"), {
      wrapper: Wrapper,
    })

    await act(async () => {
      await result.current.mutateAsync({
        sample_headers: ["LINE_A", "LINE_B"],
        variant_rows: [
          {
            variant_name: "SNP_001",
            chromosome: 1,
            position: 100,
            alleles: "A/G",
            design_sequence: "ACGT",
            calls: ["A/A", "A/G"],
          },
        ],
      })
    })

    const { GenotypingStudiesService } = await import("@/client")
    expect(
      GenotypingStudiesService.apiGenotypingStudiesIdStudyIdIngestMatrixIngestMatrix,
    ).toHaveBeenCalledWith({
      studyId: "uuid-1",
      requestBody: expect.objectContaining({
        sample_headers: ["LINE_A", "LINE_B"],
        variant_rows: expect.any(Array),
      }),
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: genotypingStudiesQueryKey,
    })
  })

  it("rejects mutate when studyId is undefined", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useIngestGenotypeMatrix(undefined), {
      wrapper: Wrapper,
    })

    await expect(
      result.current.mutateAsync({
        sample_headers: ["X"],
        variant_rows: [
          {
            variant_name: "v",
            chromosome: null,
            position: null,
            alleles: null,
            design_sequence: null,
            calls: ["A"],
          },
        ],
      }),
    ).rejects.toThrow(/studyId/i)
  })
})
