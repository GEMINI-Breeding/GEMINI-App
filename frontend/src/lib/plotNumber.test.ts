import { describe, expect, it } from "vitest"
import { comparePlotNumbers, normalizePlotNumber } from "./plotNumber"

describe("plot numbers", () => {
  it("keeps numbers and named plots", () => {
    expect(normalizePlotNumber("101")).toBe(101)
    expect(normalizePlotNumber(" KW1 ")).toBe("KW1")
    expect(normalizePlotNumber("")).toBeUndefined()
    expect(normalizePlotNumber(Number.NaN)).toBeUndefined()
  })
  it("sorts naturally", () => {
    const got = ["KW10", 2, "KW2", "10", 1, undefined, "B1"].sort(
      comparePlotNumbers,
    )
    expect(got).toEqual([1, 2, "10", "B1", "KW2", "KW10", undefined])
  })
})
