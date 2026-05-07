/**
 * Light integration tests for StepColumnMapping. The validation/seed
 * rules live in `lib/columnMapping.ts` (which has its own dedicated unit
 * tests); these focus on the wiring:
 *
 *  - A complete `initial` mapping renders the configured-sheet shell
 *    (skips the parser path) and offers Continue.
 *  - Continue forwards the same shape to onNext (no surprises in the
 *    payload).
 *  - The loading state renders before parse finishes when `initial` is
 *    null and the file isn't tabular.
 *
 * Radix `Select`'s portal interactions are awkward to drive in jsdom, so
 * the per-column-picker UX is left to the Playwright spec in 9e.5.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ExperimentsService,
  PopulationsService,
  SeasonsService,
  SensorPlatformsService,
  SensorsService,
  SitesService,
} from "@/client"
import type {
  ColumnMapping,
  FileWithPath,
  ParsedSheet,
  SheetMapping,
} from "@/features/import/lib/types"

import { StepColumnMapping } from "./StepColumnMapping"

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const sampleSheet: ParsedSheet = {
  name: "Sheet1",
  headers: ["plot", "ndvi"],
  rows: [
    { plot: "1", ndvi: "0.42" },
    { plot: "2", ndvi: "0.55" },
  ],
}

const validConfig: SheetMapping = {
  sheetName: "Sheet1",
  skipped: false,
  plotNumberColumn: "plot",
  plotRowColumn: null,
  plotColumnColumn: null,
  populationName: "",
  traitColumns: [
    { columnHeader: "ndvi", traitName: "NDVI", units: "", enabled: true },
  ],
  accessionNameColumn: null,
  lineNameColumn: null,
  aliasColumn: null,
  collectionDateMode: "fixed",
  collectionDate: "2026-05-01",
  collectionDateColumn: null,
  seasonMode: "fixed",
  seasonName: "Summer 2026",
  seasonColumn: null,
  siteMode: "fixed",
  siteName: "Davis Field A",
  siteColumn: null,
  timestampColumn: null,
  metadataColumns: [],
}

const validInitial: ColumnMapping = {
  recordType: "trait",
  sheets: [sampleSheet],
  sheetConfigs: [validConfig],
}

beforeEach(() => {
  localStorage.setItem("gemini.auth.token", "fake-token")
  vi.spyOn(
    ExperimentsService,
    "apiExperimentsAllGetAllExperiments",
  ).mockResolvedValue([] as never)
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
})

afterEach(() => {
  localStorage.removeItem("gemini.auth.token")
  vi.restoreAllMocks()
})

describe("StepColumnMapping", () => {
  it("renders the configured-sheet shell when `initial` is supplied", async () => {
    render(
      <StepColumnMapping
        files={[]}
        initial={validInitial}
        onNext={() => {}}
        onBack={() => {}}
      />,
      { wrapper },
    )
    expect(await screen.findByTestId("step-column-mapping")).toBeTruthy()
    // The Continue button should be present and enabled with a valid initial.
    const cont = screen.getByTestId<HTMLButtonElement>("mapping-continue")
    expect(cont.disabled).toBe(false)
  })

  it("forwards the seeded mapping to onNext when Continue is clicked", async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(
      <StepColumnMapping
        files={[]}
        initial={validInitial}
        onNext={onNext}
        onBack={() => {}}
      />,
      { wrapper },
    )
    await screen.findByTestId("mapping-continue")
    await user.click(screen.getByTestId("mapping-continue"))
    expect(onNext).toHaveBeenCalledTimes(1)
    const arg: ColumnMapping = onNext.mock.calls[0][0]
    expect(arg.recordType).toBe("trait")
    expect(arg.sheets).toEqual(validInitial.sheets)
    expect(arg.sheetConfigs).toEqual(validInitial.sheetConfigs)
  })

  it("renders the loading state on first mount when `initial` is null", () => {
    // Empty files array still triggers the parse effect, which immediately
    // hits the 'no tabular file' branch — but we just want to confirm the
    // step renders and doesn't try to call onNext.
    const onNext = vi.fn()
    const files: FileWithPath[] = []
    render(
      <StepColumnMapping
        files={files}
        initial={null}
        onNext={onNext}
        onBack={() => {}}
      />,
      { wrapper },
    )
    // Either the loading spinner or the parse-error box should appear —
    // neither path invokes onNext.
    const hasLoading = screen.queryByTestId("mapping-loading") !== null
    const hasError = screen.queryByTestId("mapping-error") !== null
    expect(hasLoading || hasError).toBe(true)
    expect(onNext).not.toHaveBeenCalled()
  })

  it("does not enable Continue when the seeded sheet is invalid", async () => {
    const broken: ColumnMapping = {
      recordType: "trait",
      sheets: [sampleSheet],
      sheetConfigs: [
        { ...validConfig, plotNumberColumn: null }, // invalid
      ],
    }
    render(
      <StepColumnMapping
        files={[]}
        initial={broken}
        onNext={() => {}}
        onBack={() => {}}
      />,
      { wrapper },
    )
    await screen.findByTestId("step-column-mapping")
    expect(
      screen.getByTestId<HTMLButtonElement>("mapping-continue").disabled,
    ).toBe(true)
  })
})
