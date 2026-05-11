/**
 * Unit tests for the genotype-records hook.
 *
 * Pinned contracts:
 *   - useGenotypeRecords passes studyId + limit/offset + filters straight
 *     through to the SDK; query is disabled when studyId is undefined.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useGenotypeRecords } from "./useGenotypeRecords"

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
