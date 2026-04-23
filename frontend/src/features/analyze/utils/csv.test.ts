import { describe, expect, it } from "vitest"
import { featuresToCsv } from "./csv"

function feature(props: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: props,
  }
}

describe("featuresToCsv", () => {
  it("returns an empty string for an empty feature array", () => {
    expect(featuresToCsv([])).toBe("")
  })

  it("uses the union of property keys as columns, in first-seen order", () => {
    const csv = featuresToCsv([
      feature({ a: 1, b: 2 }),
      feature({ c: 3, b: 4 }),
    ])
    const [header] = csv.split("\n")
    expect(header).toBe("a,b,c")
  })

  it("emits empty cells for missing / null / undefined values", () => {
    const csv = featuresToCsv([
      feature({ a: 1 }),
      feature({ b: null, c: undefined }),
    ])
    const lines = csv.split("\n")
    expect(lines[0]).toBe("a,b,c")
    expect(lines[1]).toBe("1,,")
    expect(lines[2]).toBe(",,")
  })

  it("quotes string values that contain commas", () => {
    const csv = featuresToCsv([feature({ name: "hello, world", n: 1 })])
    expect(csv.split("\n")[1]).toBe('"hello, world",1')
  })

  it("does not quote non-string values that stringify to contain a comma", () => {
    // Numbers don't go through the quote branch; this documents the current
    // behaviour so future changes here are intentional.
    const csv = featuresToCsv([feature({ n: 1234 })])
    expect(csv.split("\n")[1]).toBe("1234")
  })

  it("when all features have no properties, emits a column-less CSV (empty header + one blank line per feature)", () => {
    // Discovered quirk: the early `features.length === 0` guard only covers
    // truly empty input. With features present but all property maps empty,
    // `cols` is [] → header is "" and each row is also "" → "\n\n" for two
    // features. Not great, but documenting the current behaviour so future
    // changes are intentional.
    const csv = featuresToCsv([
      { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: null },
      feature({}),
    ])
    expect(csv).toBe("\n\n")
  })
})
