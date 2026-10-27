import { describe, expect, it } from "vitest"

import { defaultName, humanSize, isFailure, isFinished } from "./CloudImport"
import { availableSources } from "./UploadSourceTabs"

describe("availableSources", () => {
  it("offers the cluster folder only with a cluster", () => {
    expect(availableSources("Orthomosaic", "my-cluster")).toEqual([
      "computer",
      "cluster",
      "online",
    ])
    expect(availableSources("Image Data", null)).toEqual(["computer", "online"])
  })
  it("keeps other data types to this computer", () => {
    expect(availableSources("Trait Data", "my-cluster")).toEqual(["computer"])
    expect(availableSources(null, "my-cluster")).toEqual(["computer"])
  })
})

describe("cloud import helpers", () => {
  it("sizes", () => {
    expect(humanSize(null)).toBe("")
    expect(humanSize(512)).toBe("512 B")
    expect(humanSize(270993)).toBe("265 KB")
    expect(humanSize(6764857385)).toBe("6.3 GB")
  })
  it("names a new connection after its type", () => {
    expect(defaultName("box", [])).toBe("box")
    expect(defaultName("box", ["box", "box2"])).toBe("box3")
  })
  it("knows when a copy is over, local or on the cluster", () => {
    expect(isFinished({ state: "copying" })).toBe(false)
    expect(isFinished({ state: "RUNNING" })).toBe(false)
    expect(isFinished({ state: "COMPLETED" })).toBe(true)
    expect(isFailure({ state: "COMPLETED" })).toBe(false)
    expect(isFailure({ state: "ENDED" })).toBe(true)
    expect(isFailure({ state: "failed" })).toBe(true)
  })
})
