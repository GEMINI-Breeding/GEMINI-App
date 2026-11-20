/**
 * Smoke tests for StepUpload's wiring. The heavy data-walking logic
 * lives in `lib/recordBuilder.ts` (covered by `recordBuilder.test.ts`);
 * here we just verify:
 *
 *  - With `metadata.createNew.experiment === false` (existing experiment)
 *    and an empty file list + null columnMapping, the orchestration
 *    short-circuits to phase=done and Continue forwards the right
 *    UploadResults shape.
 *  - The Creating Entities list renders one "Experiment (existing)"
 *    skipped row plus one row per dataset.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AccessionsService,
  DatasetsService,
  ExperimentsService,
  LinesService,
  PlotsService,
  PopulationsService,
  SeasonsService,
  SensorPlatformsService,
  SensorsService,
  SitesService,
  TraitsService,
} from "@/client"
import { ProcessProvider } from "@/contexts/ProcessContext"
import type { ImportMetadata } from "@/features/import/lib/types"

import { StepUpload } from "./StepUpload"

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <ProcessProvider>{children}</ProcessProvider>
    </QueryClientProvider>
  )
}

const baseMetadata: ImportMetadata = {
  experimentId: "exp-1",
  experimentName: "GEMINI",
  sensorPlatformName: "",
  sensorName: "",
  datasetNames: ["GEMINI - 2026-05-01"],
  createNew: { experiment: false, sensorPlatform: false, sensor: false },
}

beforeEach(() => {
  localStorage.setItem("gemini.auth.token", "fake-token")
  vi.spyOn(DatasetsService, "apiDatasetsCreateDataset").mockResolvedValue({
    id: "ds-1",
    dataset_name: "GEMINI - 2026-05-01",
  } as never)
  // None of these should fire for the smoke path; mock them as no-ops in
  // case the component reaches a code path that calls them.
  vi.spyOn(
    ExperimentsService,
    "apiExperimentsCreateExperiment",
  ).mockResolvedValue({ id: "exp-1", experiment_name: "GEMINI" } as never)
  vi.spyOn(
    SensorPlatformsService,
    "apiSensorPlatformsCreateSensorPlatform",
  ).mockResolvedValue({} as never)
  vi.spyOn(SensorsService, "apiSensorsCreateSensor").mockResolvedValue(
    {} as never,
  )
  vi.spyOn(TraitsService, "apiTraitsCreateTrait").mockResolvedValue({} as never)
  vi.spyOn(
    PopulationsService,
    "apiPopulationsCreatePopulation",
  ).mockResolvedValue({} as never)
  vi.spyOn(SeasonsService, "apiSeasonsCreateSeason").mockResolvedValue(
    {} as never,
  )
  vi.spyOn(SitesService, "apiSitesCreateSite").mockResolvedValue({} as never)
  vi.spyOn(PlotsService, "apiPlotsBulkCreatePlotsBulk").mockResolvedValue(
    {} as never,
  )
  vi.spyOn(AccessionsService, "apiAccessionsCreateAccession").mockResolvedValue(
    {} as never,
  )
  vi.spyOn(LinesService, "apiLinesCreateLine").mockResolvedValue({} as never)
  vi.spyOn(
    TraitsService,
    "apiTraitsIdTraitIdRecordsBulkBulkAddTraitRecords",
  ).mockResolvedValue({} as never)
})

afterEach(() => {
  localStorage.removeItem("gemini.auth.token")
  vi.restoreAllMocks()
})

describe("StepUpload", () => {
  it("short-circuits to done with no files + null mapping, and Continue forwards the right shape", async () => {
    const onNext = vi.fn()
    const user = userEvent.setup()
    render(
      <StepUpload
        files={[]}
        metadata={baseMetadata}
        columnMapping={null}
        germplasmReview={null}
        onNext={onNext}
        onBack={() => {}}
      />,
      { wrapper },
    )
    // The dataset POST is the only required network call; wait for the
    // Continue button to enable.
    await waitFor(
      () => {
        expect(
          screen.getByTestId<HTMLButtonElement>("upload-continue").disabled,
        ).toBe(false)
      },
      { timeout: 4000 },
    )
    await user.click(screen.getByTestId("upload-continue"))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onNext.mock.calls[0][0]).toEqual({
      createdEntities: [
        { type: "Dataset", name: "GEMINI - 2026-05-01", id: "ds-1" },
      ],
      uploadedFiles: 0,
      failedFiles: 0,
      experimentId: "exp-1",
    })
  })

  it("renders one creation row per planned entity", async () => {
    render(
      <StepUpload
        files={[]}
        metadata={{
          ...baseMetadata,
          datasetNames: ["A", "B"],
        }}
        columnMapping={null}
        germplasmReview={null}
        onNext={() => {}}
        onBack={() => {}}
      />,
      { wrapper },
    )
    await screen.findByText("Creating Entities")
    // The "Creating Entities" card lists Experiment + each dataset by
    // its `font-medium` name — count names here.
    const names = Array.from(document.querySelectorAll(".font-medium")).map(
      (el) => el.textContent,
    )
    expect(names).toContain("GEMINI") // existing experiment row
    expect(names).toContain("A")
    expect(names).toContain("B")
  })
})
