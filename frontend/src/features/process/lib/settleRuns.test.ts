import { describe, expect, it } from "vitest"
import { settlePlan } from "./settleRuns"

const run = (steps: Record<string, { status: string; jobIds?: string[] }>) =>
  ({ steps }) as never

describe("settlePlan", () => {
  it("completes a running step whose jobs finished, and its boundaries", () => {
    const plan = settlePlan(
      run({ trait_extraction: { status: "running", jobIds: ["a"] } }),
      () => "COMPLETED",
    )
    expect(plan).toEqual([
      { step: "trait_extraction", status: "completed" },
      { step: "plot_boundary_prep", status: "completed" },
    ])
  })

  it("waits while a job runs, and leaves orthomosaics to the run page", () => {
    expect(
      settlePlan(
        run({
          split_orthomosaic: { status: "running", jobIds: ["a", "b"] },
          orthomosaic: { status: "running", jobIds: ["c"] },
        }),
        (id) => (id === "b" ? "RUNNING" : "COMPLETED"),
      ),
    ).toEqual([])
  })

  it("lets the latest attempt decide", () => {
    const plan = settlePlan(
      run({
        trait_extraction: { status: "running", jobIds: ["old", "new"] },
        plot_boundary_prep: { status: "completed" },
      }),
      (id) => (id === "old" ? "FAILED" : "COMPLETED"),
    )
    expect(plan).toEqual([{ step: "trait_extraction", status: "completed" }])
  })

  it("backfills boundaries for a run already extracted", () => {
    expect(
      settlePlan(
        run({ trait_extraction: { status: "completed" } }),
        () => undefined,
      ),
    ).toEqual([{ step: "plot_boundary_prep", status: "completed" }])
  })
})
