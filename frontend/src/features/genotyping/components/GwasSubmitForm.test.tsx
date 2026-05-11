/**
 * GwasSubmitForm component tests. Pin the exact GwasSubmitInput payload
 * for the three relevant submit shapes (single LMM, multi-trait LMM fan-out,
 * multi-trait mvLMM joint), and verify the LMM-test field disables
 * once the model switches to mvLMM.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  DatasetsService,
  ExperimentsService,
  GenotypingStudiesService,
  GwasService,
} from "@/client"

const navigateSpy = vi.fn()
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateSpy,
}))

import { ProcessProvider } from "@/contexts/ProcessContext"

import { GwasSubmitForm } from "./GwasSubmitForm"

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // GwasSubmitForm registers each spawned job with ProcessContext so
  // it shows up in the global ProcessPanel; the provider is required
  // even in tests that don't assert on the process tray.
  return (
    <QueryClientProvider client={client}>
      <ProcessProvider>{children}</ProcessProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem("gemini.auth.token", "fake-token")
  vi.spyOn(
    ExperimentsService,
    "apiExperimentsAllGetAllExperiments",
  ).mockResolvedValue([
    { id: "exp-1", experiment_name: "GEMINI" },
  ] as never)
  vi.spyOn(
    ExperimentsService,
    "apiExperimentsIdExperimentIdDatasetsGetExperimentDatasets",
  ).mockResolvedValue([
    { id: "ds-1", dataset_name: "Phenotype set" },
  ] as never)
  vi.spyOn(
    DatasetsService,
    "apiDatasetsIdDatasetIdTraitsGetAssociatedTraits",
  ).mockResolvedValue([
    { id: "trait-1", trait_name: "yield" },
    { id: "trait-2", trait_name: "height" },
  ] as never)
  vi.spyOn(
    GenotypingStudiesService,
    "apiGenotypingStudiesIdStudyIdGetStudyById",
  ).mockResolvedValue({
    id: "study-A",
    study_name: "Maize 2024",
  } as never)
  vi.spyOn(GwasService, "apiGwasSubmitSubmitGwas").mockResolvedValue([
    { id: "job-uuid-1", job_type: "RUN_GWAS", status: "PENDING" },
  ] as never)
})

async function pickExperimentAndDataset(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("option", { name: "GEMINI" })
  await user.selectOptions(screen.getByTestId("gwas-experiment-select"), "exp-1")
  await screen.findByRole("option", { name: "Phenotype set" })
  await user.selectOptions(screen.getByTestId("gwas-dataset-select"), "ds-1")
}

describe("GwasSubmitForm", () => {
  it("submits a single-trait LMM payload with trait_id (not trait_ids)", async () => {
    const user = userEvent.setup()
    render(<GwasSubmitForm studyId="study-A" />, { wrapper })

    await pickExperimentAndDataset(user)
    const trait1 = await screen.findByTestId("gwas-trait-checkbox-yield")
    await user.click(trait1)
    await user.click(screen.getByTestId("gwas-submit"))

    await waitFor(() => {
      expect(GwasService.apiGwasSubmitSubmitGwas).toHaveBeenCalledTimes(1)
    })
    expect(GwasService.apiGwasSubmitSubmitGwas).toHaveBeenCalledWith({
      requestBody: expect.objectContaining({
        study_id: "study-A",
        experiment_id: "exp-1",
        dataset_id: "ds-1",
        model: "lmm",
        lmm_test: "wald",
        n_pcs: 3,
        phenotype_agg: "mean",
        trait_id: "trait-1",
        // HWE defaults to 0 (disabled) — see the rationale in
        // GwasSubmitForm.tsx alongside the useState declaration.
        qc: { maf: 0.05, geno: 0.1, mind: 0.1, hwe: 0 },
      }),
    })
    // Single-trait → navigate to job detail
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "/genotyping/$studyId/gwas/$jobId",
          params: { studyId: "study-A", jobId: "job-uuid-1" },
        }),
      )
    })
  })

  it("fan-out LMM sends trait_ids", async () => {
    const user = userEvent.setup()
    render(<GwasSubmitForm studyId="study-A" />, { wrapper })

    await pickExperimentAndDataset(user)
    await user.click(await screen.findByTestId("gwas-trait-checkbox-yield"))
    await user.click(await screen.findByTestId("gwas-trait-checkbox-height"))
    await user.click(screen.getByTestId("gwas-submit"))

    await waitFor(() => {
      expect(GwasService.apiGwasSubmitSubmitGwas).toHaveBeenCalledTimes(1)
    })
    const call = (GwasService.apiGwasSubmitSubmitGwas as unknown as ReturnType<
      typeof vi.fn
    >).mock.calls[0][0]
    expect(call.requestBody).toMatchObject({
      model: "lmm",
      trait_ids: ["trait-1", "trait-2"],
    })
    expect(call.requestBody).not.toHaveProperty("trait_id")
  })

  it("mvLMM disables the LMM test selector and sends trait_ids", async () => {
    const user = userEvent.setup()
    render(<GwasSubmitForm studyId="study-A" />, { wrapper })

    await pickExperimentAndDataset(user)
    await user.click(await screen.findByTestId("gwas-trait-checkbox-yield"))
    await user.click(await screen.findByTestId("gwas-trait-checkbox-height"))
    await user.selectOptions(screen.getByTestId("gwas-model-select"), "mvlmm")

    expect(
      (screen.getByTestId("gwas-lmm-test-select") as HTMLSelectElement).disabled,
    ).toBe(true)

    await user.click(screen.getByTestId("gwas-submit"))
    await waitFor(() => {
      expect(GwasService.apiGwasSubmitSubmitGwas).toHaveBeenCalledTimes(1)
    })
    const call = (GwasService.apiGwasSubmitSubmitGwas as unknown as ReturnType<
      typeof vi.fn
    >).mock.calls[0][0]
    expect(call.requestBody).toMatchObject({
      model: "mvlmm",
      trait_ids: ["trait-1", "trait-2"],
    })
  })

  it("submit is disabled until experiment+dataset+≥1 trait are chosen", async () => {
    const user = userEvent.setup()
    render(<GwasSubmitForm studyId="study-A" />, { wrapper })

    expect(
      (screen.getByTestId("gwas-submit") as HTMLButtonElement).disabled,
    ).toBe(true)
    await pickExperimentAndDataset(user)
    // Still disabled — no traits yet
    expect(
      (screen.getByTestId("gwas-submit") as HTMLButtonElement).disabled,
    ).toBe(true)
    await user.click(await screen.findByTestId("gwas-trait-checkbox-yield"))
    expect(
      (screen.getByTestId("gwas-submit") as HTMLButtonElement).disabled,
    ).toBe(false)
  })
})
