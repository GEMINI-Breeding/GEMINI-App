import { describe, expect, it } from "vitest"

import { generateGridFeatures, polygonCentroid } from "./grid"

const OUTER: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-121.7, 38.5],
      [-121.6, 38.5],
      [-121.6, 38.6],
      [-121.7, 38.6],
      [-121.7, 38.5],
    ],
  ],
}

describe("polygonCentroid", () => {
  it("returns the average of the outer ring vertices", () => {
    const [lng, lat] = polygonCentroid(OUTER)
    expect(lng).toBeCloseTo(-121.65, 4)
    expect(lat).toBeCloseTo(38.55, 4)
  })
  it("returns [0,0] for an empty ring", () => {
    expect(polygonCentroid({ type: "Polygon", coordinates: [[]] })).toEqual([0, 0])
  })
})

describe("generateGridFeatures", () => {
  it("emits rows × cols rectangles inscribed in the bbox", () => {
    const features = generateGridFeatures(OUTER, { rows: 2, cols: 3, angleDeg: 0 })
    expect(features).toHaveLength(6)
    expect(features[0].properties).toMatchObject({ plot: 1, row: 1, col: 1 })
    expect(features[5].properties).toMatchObject({ plot: 6, row: 2, col: 3 })
    // First cell anchors at the SW corner of the bbox in this 2x3 layout
    // (top-left of grid corresponds to maxY).
    const first = (features[0].geometry as GeoJSON.Polygon).coordinates[0]
    expect(first[0][0]).toBeCloseTo(-121.7, 5)
    expect(first[0][1]).toBeCloseTo(38.55, 5)
  })
  it("rotates the grid when angleDeg ≠ 0", () => {
    const flat = generateGridFeatures(OUTER, { rows: 1, cols: 1, angleDeg: 0 })
    const rotated = generateGridFeatures(OUTER, { rows: 1, cols: 1, angleDeg: 30 })
    const f0 = (flat[0].geometry as GeoJSON.Polygon).coordinates[0][0]
    const r0 = (rotated[0].geometry as GeoJSON.Polygon).coordinates[0][0]
    expect(r0[0]).not.toBeCloseTo(f0[0], 6)
  })
  it("returns [] for invalid input", () => {
    const empty = generateGridFeatures(
      { type: "Polygon", coordinates: [[]] },
      { rows: 2, cols: 2, angleDeg: 0 },
    )
    expect(empty).toEqual([])
  })
})
