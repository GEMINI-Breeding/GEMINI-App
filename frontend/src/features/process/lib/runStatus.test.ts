import { describe, expect, it } from "vitest"

import { runState } from "./runStatus"
import type { Run } from "./runStore"

const run = (steps: Record<string, string>): Run =>
  ({
    id: "r",
    pipelineId: "p",
    workspaceId: "w",
    scope: {},
    status: "running", // what the store says once any work began
    steps: Object.fromEntries(
      Object.entries(steps).map(([k, status]) => [k, { status, jobIds: [] }]),
    ),
    createdAt: "",
    updatedAt: "",
  }) as unknown as Run

describe("runState", () => {
  it("says waiting, not running, when no job is working", () => {
    expect(
      runState(
        run({ data_sync: "completed", plot_marking: "completed" }),
        "ground",
      ),
    ).toEqual({ tag: "waiting", detail: "Next: Stitching" })
  })
  it("says running only while a step runs", () => {
    expect(
      runState(run({ data_sync: "completed", stitching: "running" }), "ground")
        .tag,
    ).toBe("running")
  })
  it("says failed, complete and new", () => {
    expect(runState(run({ orthomosaic: "failed" }), "aerial").detail).toBe(
      "Orthomosaic failed",
    )
    const all = Object.fromEntries(
      [
        "data_sync",
        "orthomosaic",
        "plot_boundary_prep",
        "split_orthomosaic",
        "trait_extraction",
      ].map((k) => [k, "completed"]),
    )
    expect(runState(run({ ...all, inference: "skipped" }), "aerial").tag).toBe(
      "complete",
    )
    expect(runState(run({}), "aerial").tag).toBe("new")
  })
})
