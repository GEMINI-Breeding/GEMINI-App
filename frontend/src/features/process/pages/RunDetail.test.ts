import { describe, expect, it } from "vitest"
import { AERIAL_STEPS, blockedByRunning } from "./RunDetail"

const state = (running: string[], done: string[] = []) =>
  Object.fromEntries([
    ...done.map((k) => [k, { status: "completed" }]),
    ...running.map((k) => [k, { status: "running" }]),
  ])

describe("which steps a running step holds back", () => {
  const done = [
    "data_sync",
    "orthomosaic",
    "plot_boundary_prep",
    "split_orthomosaic",
  ]
  it("lets trait extraction run while inference does (and the reverse)", () => {
    expect(
      blockedByRunning(
        "trait_extraction",
        state(["inference"], done),
        AERIAL_STEPS,
      ),
    ).toBe(false)
    expect(
      blockedByRunning(
        "inference",
        state(["trait_extraction"], done),
        AERIAL_STEPS,
      ),
    ).toBe(false)
  })
  it("holds back a step whose input is still being made", () => {
    expect(
      blockedByRunning(
        "inference",
        state(["split_orthomosaic"], done),
        AERIAL_STEPS,
      ),
    ).toBe(true)
    expect(
      blockedByRunning(
        "trait_extraction",
        state(["orthomosaic"], done),
        AERIAL_STEPS,
      ),
    ).toBe(true)
  })
  it("holds back re-making an input a running step reads", () => {
    expect(
      blockedByRunning(
        "orthomosaic",
        state(["trait_extraction"], done),
        AERIAL_STEPS,
      ),
    ).toBe(true)
    expect(
      blockedByRunning(
        "split_orthomosaic",
        state(["inference"], done),
        AERIAL_STEPS,
      ),
    ).toBe(true)
  })
})
