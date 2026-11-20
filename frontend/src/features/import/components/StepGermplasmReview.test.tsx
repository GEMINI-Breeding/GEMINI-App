/**
 * StepGermplasmReview wiring tests.
 *
 * The pure helpers (`collectGermplasmNames`, `collectPopulationForGermplasm`)
 * have their own dedicated tests in `lib/germplasmCollect.test.ts`. This
 * file exercises the React wiring around the resolver call:
 *
 *  - Degenerate (no germplasm columns) renders the empty hint and
 *    forwards `{ allNames: [], resolved: {} }` on Continue.
 *  - When the resolver returns 100% resolved, the success banner shows,
 *    Continue is enabled, and clicking it forwards the right payload.
 *  - When the resolver throws, the error state renders and Continue is
 *    not present.
 */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AccessionsService, GermplasmService, LinesService } from "@/client"
import type {
  ColumnMapping,
  GermplasmReview,
  ImportMetadata,
  SheetMapping,
} from "@/features/import/lib/types"

import { StepGermplasmReview } from "./StepGermplasmReview"

const baseConfig = (overrides: Partial<SheetMapping> = {}): SheetMapping => ({
  sheetName: "S1",
  skipped: false,
  plotNumberColumn: "plot",
  plotRowColumn: null,
  plotColumnColumn: null,
  populationName: "",
  traitColumns: [],
  accessionNameColumn: null,
  lineNameColumn: null,
  aliasColumn: null,
  collectionDateMode: "fixed",
  collectionDate: "2026-05-01",
  collectionDateColumn: null,
  seasonMode: "fixed",
  seasonName: "Summer",
  seasonColumn: null,
  siteMode: "fixed",
  siteName: "Davis Field A",
  siteColumn: null,
  timestampColumn: null,
  metadataColumns: [],
  ...overrides,
})

const baseMetadata: ImportMetadata = {
  experimentId: "exp-1",
  experimentName: "GEMINI",
  sensorPlatformName: "",
  sensorName: "",
  datasetNames: ["GEMINI - 2026-05-01"],
  createNew: { experiment: false, sensorPlatform: false, sensor: false },
}

const mappingWithAcc: ColumnMapping = {
  recordType: "trait",
  sheets: [
    {
      name: "S1",
      headers: ["plot", "acc"],
      rows: [
        { plot: "1", acc: "B73" },
        { plot: "2", acc: "MAGIC110" },
      ],
    },
  ],
  sheetConfigs: [baseConfig({ accessionNameColumn: "acc" })],
}

const mappingNoGermplasm: ColumnMapping = {
  recordType: "trait",
  sheets: [
    {
      name: "S1",
      headers: ["plot", "ndvi"],
      rows: [{ plot: "1", ndvi: "0.42" }],
    },
  ],
  sheetConfigs: [baseConfig()],
}

beforeEach(() => {
  localStorage.setItem("gemini.auth.token", "fake-token")
  vi.spyOn(
    AccessionsService,
    "apiAccessionsAllGetAllAccessions",
  ).mockResolvedValue([] as never)
  vi.spyOn(LinesService, "apiLinesAllGetAllLines").mockResolvedValue(
    [] as never,
  )
})

afterEach(() => {
  localStorage.removeItem("gemini.auth.token")
  vi.restoreAllMocks()
})

describe("StepGermplasmReview", () => {
  it("renders the empty-hint path when no germplasm columns are mapped", async () => {
    const onNext = vi.fn()
    const user = userEvent.setup()
    render(
      <StepGermplasmReview
        mapping={mappingNoGermplasm}
        metadata={baseMetadata}
        initial={null}
        onNext={onNext}
        onBack={() => {}}
      />,
    )
    await screen.findByTestId("step-germplasm-review")
    await user.click(screen.getByTestId("germplasm-review-continue"))
    expect(onNext).toHaveBeenCalledWith({ allNames: [], resolved: {} })
  })

  it("renders the success banner when every name resolves cleanly", async () => {
    vi.spyOn(GermplasmService, "apiGermplasmResolveResolve").mockResolvedValue({
      results: [
        {
          input_name: "B73",
          match_kind: "accession_exact",
          accession_id: "acc-1",
          line_id: null,
          canonical_name: "B73",
        },
        {
          input_name: "MAGIC110",
          match_kind: "line_exact",
          accession_id: null,
          line_id: "line-1",
          canonical_name: "MAGIC110",
        },
      ],
    } as never)

    const onNext = vi.fn<(r: GermplasmReview) => void>()
    const user = userEvent.setup()
    render(
      <StepGermplasmReview
        mapping={mappingWithAcc}
        metadata={baseMetadata}
        initial={null}
        onNext={onNext}
        onBack={() => {}}
      />,
    )

    // Wait for the resolver to finish + the success banner to render.
    await waitFor(() => {
      expect(screen.getByText(/All 2 germplasm names resolved/)).toBeTruthy()
    })

    await user.click(screen.getByTestId("germplasm-review-continue"))
    expect(onNext).toHaveBeenCalledTimes(1)
    const review = onNext.mock.calls[0][0]
    expect(review.allNames).toEqual(expect.arrayContaining(["B73", "MAGIC110"]))
    expect(review.resolved.B73?.match_kind).toBe("accession_exact")
    expect(review.resolved.MAGIC110?.match_kind).toBe("line_exact")
  })

  it("renders the error state when the resolver throws", async () => {
    vi.spyOn(GermplasmService, "apiGermplasmResolveResolve").mockRejectedValue(
      new Error("network down"),
    )

    render(
      <StepGermplasmReview
        mapping={mappingWithAcc}
        metadata={baseMetadata}
        initial={null}
        onNext={() => {}}
        onBack={() => {}}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId("germplasm-review-error")).toBeTruthy()
    })
    expect(screen.queryByTestId("germplasm-review-continue")).toBeNull()
  })
})
