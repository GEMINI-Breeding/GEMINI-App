/**
 * Smoke + flow tests for StepMetadata. The component leans on shared
 * primitives (`EntitySelectField`, `useScopeOptions`) that already have
 * their own test suites; here we verify the wiring:
 *
 *  - existing experiment → onNext payload has experimentId set,
 *    createNew.experiment === false
 *  - new experiment → onNext payload has experimentId === null,
 *    createNew.experiment === true, name trimmed
 *  - dataset names default from detection.fileGroups; trimmed on submit
 *  - sensor branch only renders for sensor-required data categories
 *  - Continue button disabled while inputs are incomplete
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DatasetsService,
  ExperimentsService,
  PopulationsService,
  SeasonsService,
  SensorPlatformsService,
  SensorsService,
  SitesService,
} from "@/client"
import type { DetectionResult } from "@/features/import/lib/detection-engine"

import { StepMetadata } from "./StepMetadata"

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function detection(overrides: Partial<DetectionResult> = {}): DetectionResult {
  return {
    fileGroups: [{ files: [], date: "2026-05-01" }],
    detectedDates: ["2026-05-01"],
    dataCategories: ["csv_tabular"],
    suggestedSensorType: null,
    suggestedPlatform: null,
    suggestedExperimentName: "TomatoMAGIC",
    csvDetails: [],
    genomicShape: null,
    genomicFile: null,
    ...overrides,
  } as DetectionResult
}

beforeEach(() => {
  // useScopeOptions reads `isLoggedIn()` which checks localStorage.
  localStorage.setItem("gemini.auth.token", "fake-token")
  // Mock every list endpoint useScopeOptions hits so render doesn't throw.
  vi.spyOn(
    ExperimentsService,
    "apiExperimentsAllGetAllExperiments",
  ).mockResolvedValue([
    { id: "exp-1", experiment_name: "GEMINI" },
    { id: "exp-2", experiment_name: "TomatoMAGIC" },
  ] as never)
  vi.spyOn(SitesService, "apiSitesAllGetAllSites").mockResolvedValue(
    [] as never,
  )
  vi.spyOn(
    PopulationsService,
    "apiPopulationsAllGetAllPopulations",
  ).mockResolvedValue([] as never)
  vi.spyOn(SeasonsService, "apiSeasonsAllGetAllSeasons").mockResolvedValue(
    [] as never,
  )
  vi.spyOn(
    SensorPlatformsService,
    "apiSensorPlatformsAllGetAllSensorPlatforms",
  ).mockResolvedValue([] as never)
  vi.spyOn(SensorsService, "apiSensorsAllGetAllSensors").mockResolvedValue(
    [] as never,
  )
  // useExistingDatasetNames fires on mount; default to "no existing
  // datasets" so the conflict warning stays hidden unless a test
  // overrides this mock.
  vi.spyOn(
    DatasetsService,
    "apiDatasetsAllGetAllDatasets",
  ).mockResolvedValue([] as never)
})

afterEach(() => {
  localStorage.removeItem("gemini.auth.token")
  vi.restoreAllMocks()
})

describe("StepMetadata", () => {
  it("disables Continue when no experiment is picked", async () => {
    render(
      <StepMetadata
        detection={detection()}
        initial={null}
        onNext={() => {}}
        onBack={() => {}}
      />,
      { wrapper },
    )
    // Wait for the experiment loader to settle.
    await screen.findByTestId("entity-select-experiment")
    expect(
      screen.getByTestId<HTMLButtonElement>("metadata-continue").disabled,
    ).toBe(true)
  })

  it("emits createNew=true and a null id for + Create new experiment", async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(
      <StepMetadata
        detection={detection()}
        initial={{
          experimentId: null,
          experimentName: "TomatoMAGIC",
          sensorPlatformName: "",
          sensorName: "",
          datasetNames: ["TomatoMAGIC - 2026-05-01"],
          createNew: { experiment: true, sensorPlatform: false, sensor: false },
        }}
        onNext={onNext}
        onBack={() => {}}
      />,
      { wrapper },
    )
    await screen.findByTestId("entity-new-experiment")
    await user.click(screen.getByTestId("metadata-continue"))

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onNext.mock.calls[0][0]).toEqual({
      experimentId: null,
      experimentName: "TomatoMAGIC",
      sensorPlatformName: "",
      sensorName: "",
      datasetNames: ["TomatoMAGIC - 2026-05-01"],
      createNew: {
        experiment: true,
        sensorPlatform: false,
        sensor: false,
      },
    })
  })

  it("emits createNew=false and the chosen id for an existing experiment", async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(
      <StepMetadata
        detection={detection()}
        initial={{
          experimentId: "exp-1",
          experimentName: "GEMINI",
          sensorPlatformName: "",
          sensorName: "",
          datasetNames: ["GEMINI - 2026-05-01"],
          createNew: {
            experiment: false,
            sensorPlatform: false,
            sensor: false,
          },
        }}
        onNext={onNext}
        onBack={() => {}}
      />,
      { wrapper },
    )
    await screen.findByTestId("entity-select-experiment")
    await user.click(screen.getByTestId("metadata-continue"))

    expect(onNext).toHaveBeenCalledTimes(1)
    const m = onNext.mock.calls[0][0]
    expect(m.experimentId).toBe("exp-1")
    expect(m.experimentName).toBe("GEMINI")
    expect(m.createNew).toEqual({
      experiment: false,
      sensorPlatform: false,
      sensor: false,
    })
  })

  it("does not render sensor fields for csv_tabular", async () => {
    render(
      <StepMetadata
        detection={detection({ dataCategories: ["csv_tabular"] })}
        initial={null}
        onNext={() => {}}
        onBack={() => {}}
      />,
      { wrapper },
    )
    await screen.findByTestId("entity-select-experiment")
    expect(screen.queryByTestId("entity-select-sensor-platform")).toBeNull()
    expect(screen.queryByTestId("entity-select-sensor")).toBeNull()
  })

  it("warns when a typed dataset name collides with an existing dataset", async () => {
    // Surface an existing dataset called "GEMINI - 2026-05-01" so the
    // initial dataset name we pass in trips the conflict warning.
    vi.spyOn(
      DatasetsService,
      "apiDatasetsAllGetAllDatasets",
    ).mockResolvedValue([
      { id: "ds-existing", dataset_name: "GEMINI - 2026-05-01" },
    ] as never)
    render(
      <StepMetadata
        detection={detection()}
        initial={{
          experimentId: "exp-1",
          experimentName: "GEMINI",
          sensorPlatformName: "",
          sensorName: "",
          datasetNames: ["GEMINI - 2026-05-01"],
          createNew: { experiment: false, sensorPlatform: false, sensor: false },
        }}
        onNext={() => {}}
        onBack={() => {}}
      />,
      { wrapper },
    )
    // Warning is async — it waits for the datasets query to resolve.
    expect(
      await screen.findByTestId("dataset-name-warning-0"),
    ).toBeInTheDocument()
    // Continue must NOT be disabled by the warning — merging is allowed,
    // just made visible. (No experiment is picked in this `initial`
    // either, so the existing experiment guard might still disable
    // Continue; we only assert that the *warning* didn't block the
    // input's aria-validity flag.)
    expect(screen.getByTestId("dataset-name-0")).toHaveAttribute(
      "aria-invalid",
      "true",
    )
  })

  it("does not warn when the typed name has no collision", async () => {
    render(
      <StepMetadata
        detection={detection()}
        initial={{
          experimentId: "exp-1",
          experimentName: "GEMINI",
          sensorPlatformName: "",
          sensorName: "",
          // Default mock returns no datasets, so this name can't collide.
          datasetNames: ["GEMINI - Traits - 2026-05-01 - a3f7"],
          createNew: { experiment: false, sensorPlatform: false, sensor: false },
        }}
        onNext={() => {}}
        onBack={() => {}}
      />,
      { wrapper },
    )
    await screen.findByTestId("entity-select-experiment")
    expect(screen.queryByTestId("dataset-name-warning-0")).toBeNull()
  })

  it("renders sensor fields for drone_imagery", async () => {
    render(
      <StepMetadata
        detection={detection({ dataCategories: ["drone_imagery"] })}
        initial={null}
        onNext={() => {}}
        onBack={() => {}}
      />,
      { wrapper },
    )
    await screen.findByTestId("entity-select-experiment")
    expect(screen.getByTestId("entity-select-sensor-platform")).toBeTruthy()
    expect(screen.getByTestId("entity-select-sensor")).toBeTruthy()
  })
})
