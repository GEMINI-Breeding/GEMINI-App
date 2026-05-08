import { describe, expect, it } from "vitest"

import { parseImageFilter, serializeImageFilter } from "./imageFilter"

describe("parseImageFilter", () => {
  it("parses a list of basenames, ignoring blank lines and # comments", () => {
    const text = [
      "# Excluded images",
      "DJI_0001.JPG",
      "",
      "# trailing comment",
      "DJI_0002.JPG",
      "DJI_0003.JPG",
    ].join("\n")
    expect(parseImageFilter(text)).toEqual(
      new Set(["DJI_0001.JPG", "DJI_0002.JPG", "DJI_0003.JPG"]),
    )
  })

  it("handles CRLF line endings", () => {
    expect(parseImageFilter("A.JPG\r\nB.JPG\r\n")).toEqual(
      new Set(["A.JPG", "B.JPG"]),
    )
  })

  it("returns an empty set for whitespace-only or comment-only input", () => {
    expect(parseImageFilter("")).toEqual(new Set())
    expect(parseImageFilter("# only a comment\n   \n")).toEqual(new Set())
  })

  it("dedupes repeats", () => {
    expect(parseImageFilter("X.JPG\nX.JPG\nY.JPG")).toEqual(
      new Set(["X.JPG", "Y.JPG"]),
    )
  })
})

describe("serializeImageFilter", () => {
  it("includes the contract header even with zero exclusions", () => {
    const out = serializeImageFilter([])
    expect(out.startsWith("# Excluded images for ODM.")).toBe(true)
  })

  it("emits sorted unique basenames after the header", () => {
    const out = serializeImageFilter(["B.JPG", "A.JPG", "B.JPG"])
    const lines = out.trim().split("\n")
    expect(lines[0]?.startsWith("#")).toBe(true)
    expect(lines.slice(1)).toEqual(["A.JPG", "B.JPG"])
  })

  it("round-trips through parseImageFilter", () => {
    const input = new Set(["A.JPG", "B.JPG", "C.JPG"])
    expect(parseImageFilter(serializeImageFilter(input))).toEqual(input)
  })
})
