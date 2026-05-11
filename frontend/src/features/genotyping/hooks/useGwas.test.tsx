/**
 * Hook tests for the GWAS surface. SDK is mocked; we verify request
 * payloads, query-key shapes, study-scoped filtering of recent jobs,
 * and that the submit mutation invalidates the jobs cache.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  GWAS_JOB_TYPE,
  useDatasetTraits,
  useExperimentDatasets,
  useStudyGwasJobs,
  useSubmitGwas,
} from "./useGwas"

vi.mock("@/client", async () => {
  const actual = await vi.importActual<typeof import("@/client")>("@/client")
  return {
    ...actual,
    GwasService: {
      apiGwasSubmitSubmitGwas: vi.fn(async () => [
        { id: "job-uuid-1", job_type: "RUN_GWAS", status: "PENDING" },
      ]),
    },
    DatasetsService: {
      apiDatasetsIdDatasetIdTraitsGetAssociatedTraits: vi.fn(async () => [
        { id: "trait-1", trait_name: "yield" },
      ]),
    },
    ExperimentsService: {
      apiExperimentsIdExperimentIdDatasetsGetExperimentDatasets: vi.fn(
        async () => [{ id: "ds-1", dataset_name: "Phenotype set" }],
      ),
    },
    JobsService: {
      apiJobsAllGetAllJobs: vi.fn(async () => [
        {
          id: "j1",
          job_type: "RUN_GWAS",
          status: "COMPLETED",
          parameters: { study_id: "study-A" },
        },
        {
          id: "j2",
          job_type: "RUN_GWAS",
          status: "RUNNING",
          parameters: { study_id: "study-B" },
        },
        {
          id: "j3",
          job_type: "RUN_GWAS",
          status: "PENDING",
          parameters: { study_id: "study-A" },
        },
      ]),
    },
  }
})

vi.mock("@/lib/auth", () => ({ isLoggedIn: () => true }))

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return { qc, Wrapper }
}

describe("useSubmitGwas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("forwards the GwasSubmitInput as requestBody and invalidates [\"jobs\"]", async () => {
    const { qc, Wrapper } = makeWrapper()
    const invalidate = vi.spyOn(qc, "invalidateQueries")

    const { result } = renderHook(() => useSubmitGwas(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        study_id: "study-A",
        experiment_id: "exp-1",
        dataset_id: "ds-1",
        trait_id: "trait-1",
        model: "lmm",
        lmm_test: "wald",
        n_pcs: 3,
        phenotype_agg: "mean",
        qc: { maf: 0.05, geno: 0.1, mind: 0.1, hwe: 1e-6 },
      })
    })

    const { GwasService } = await import("@/client")
    expect(GwasService.apiGwasSubmitSubmitGwas).toHaveBeenCalledWith({
      requestBody: expect.objectContaining({
        study_id: "study-A",
        experiment_id: "exp-1",
        dataset_id: "ds-1",
        trait_id: "trait-1",
        model: "lmm",
      }),
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["jobs"] })
  })
})

describe("useDatasetTraits", () => {
  it("does not fetch when datasetId is empty", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useDatasetTraits(null), {
      wrapper: Wrapper,
    })
    expect(result.current.fetchStatus).toBe("idle")
    const { DatasetsService } = await import("@/client")
    expect(
      DatasetsService.apiDatasetsIdDatasetIdTraitsGetAssociatedTraits,
    ).not.toHaveBeenCalled()
  })

  it("fetches via the dataset→traits endpoint when given an id", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useDatasetTraits("ds-7"), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const { DatasetsService } = await import("@/client")
    expect(
      DatasetsService.apiDatasetsIdDatasetIdTraitsGetAssociatedTraits,
    ).toHaveBeenCalledWith({ datasetId: "ds-7" })
    expect(result.current.data?.[0].trait_name).toBe("yield")
  })
})

describe("useExperimentDatasets", () => {
  it("fetches the experiment's datasets via the dedicated endpoint", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useExperimentDatasets("exp-1"), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const { ExperimentsService } = await import("@/client")
    expect(
      ExperimentsService.apiExperimentsIdExperimentIdDatasetsGetExperimentDatasets,
    ).toHaveBeenCalledWith({ experimentId: "exp-1" })
  })
})

describe("useStudyGwasJobs", () => {
  it("filters to jobs whose parameters.study_id matches", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useStudyGwasJobs("study-A"), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.map((j) => j.id)).toEqual(["j1", "j3"])

    const { JobsService } = await import("@/client")
    expect(JobsService.apiJobsAllGetAllJobs).toHaveBeenCalledWith({
      jobType: GWAS_JOB_TYPE,
    })
  })

  it("returns all RUN_GWAS jobs when no studyId is passed", async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useStudyGwasJobs(undefined), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.map((j) => j.id)).toEqual(["j1", "j2", "j3"])
  })
})
