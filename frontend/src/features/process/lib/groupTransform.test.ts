import { describe, expect, it } from "vitest"

import {
  mirrorFeatures,
  rotateFeatures,
  selectionCentroid,
  translateFeatures,
} from "./groupTransform"

function poly(
  cellId: string,
  ring: Array<[number, number]>,
  extra: Record<string, unknown> = {},
): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { cellId, ...extra },
    geometry: { type: "Polygon", coordinates: [ring] },
  }
}

describe("translateFeatures", () => {
  it("moves every coordinate of selected polygons", () => {
    const feats = [
      poly("a", [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
      poly("b", [
        [10, 10],
        [11, 10],
        [11, 11],
        [10, 11],
        [10, 10],
      ]),
    ]
    const out = translateFeatures(feats, new Set(["a"]), 5, -3)
    expect((out[0].geometry as GeoJSON.Polygon).coordinates[0]).toEqual([
      [5, -3],
      [6, -3],
      [6, -2],
      [5, -2],
      [5, -3],
    ])
    // Non-selected feature passes through with identity.
    expect(out[1]).toBe(feats[1])
  })

  it("returns input unchanged when selection is empty", () => {
    const feats = [
      poly("a", [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
    ]
    expect(translateFeatures(feats, new Set(), 1, 1)).toBe(feats)
  })

  it("skips features whose role is outer", () => {
    const feats: GeoJSON.Feature[] = [
      {
        type: "Feature",
        properties: { role: "outer", cellId: "a" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      },
    ]
    const out = translateFeatures(feats, new Set(["a"]), 5, 5)
    expect(out[0]).toBe(feats[0])
  })
})

describe("selectionCentroid", () => {
  it("returns null when selection is empty", () => {
    expect(selectionCentroid([], new Set())).toBeNull()
  })

  it("computes vertex-averaged centroid of selected polygons", () => {
    const square = poly("a", [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ])
    // Closing duplicate is dropped — average of (0,0), (2,0), (2,2), (0,2) is (1,1).
    const c = selectionCentroid([square], new Set(["a"]))
    expect(c?.[0]).toBeCloseTo(1)
    expect(c?.[1]).toBeCloseTo(1)
  })
})

describe("rotateFeatures", () => {
  it("rotates a unit square 90° CCW about its centroid", () => {
    const square = poly("a", [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ])
    // Centroid is (0,0) by symmetry. 90° rotation: (x,y) -> (-y, x).
    const out = rotateFeatures([square], new Set(["a"]), 90)
    const ring = (out[0].geometry as GeoJSON.Polygon).coordinates[0]
    expect(ring[0][0]).toBeCloseTo(1)
    expect(ring[0][1]).toBeCloseTo(-1)
    expect(ring[1][0]).toBeCloseTo(1)
    expect(ring[1][1]).toBeCloseTo(1)
    expect(ring[2][0]).toBeCloseTo(-1)
    expect(ring[2][1]).toBeCloseTo(1)
  })

  it("returns input unchanged for 0° rotation", () => {
    const feats = [
      poly("a", [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
    ]
    expect(rotateFeatures(feats, new Set(["a"]), 0)).toBe(feats)
  })

  it("preserves non-geometry properties", () => {
    const feats = [
      poly(
        "a",
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
          [-1, -1],
        ],
        { row: 3, col: 7, plot: "P-42" },
      ),
    ]
    const out = rotateFeatures(feats, new Set(["a"]), 45)
    expect(out[0].properties).toEqual({
      cellId: "a",
      row: 3,
      col: 7,
      plot: "P-42",
    })
  })
})

describe("mirrorFeatures", () => {
  // 2 rows × 3 cols; each cell's geometry is a unit square at (col, row).
  const sq = (x: number, y: number): GeoJSON.Polygon => ({
    type: "Polygon",
    coordinates: [
      [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
        [x, y],
      ],
    ],
  })
  const grid = (): GeoJSON.Feature[] => {
    const out: GeoJSON.Feature[] = [
      {
        type: "Feature",
        properties: { role: "outer", blockId: "block-1" },
        geometry: sq(0, 0),
      },
    ]
    let plot = 1
    for (let row = 1; row <= 2; row++)
      for (let col = 1; col <= 3; col++)
        out.push({
          type: "Feature",
          properties: { cellId: `c${row}${col}`, plot: plot++, row, col },
          geometry: sq(col, row),
        })
    return out
  }
  const all = new Set(["c11", "c12", "c13", "c21", "c22", "c23"])
  const at = (fs: GeoJSON.Feature[], plot: number) =>
    (
      fs.find((f) => (f.properties as { plot?: number }).plot === plot)
        ?.geometry as GeoJSON.Polygon
    ).coordinates[0][0]

  it("rows: plot 1 takes the bottom-left footprint, plot 4 the top-left", () => {
    const out = mirrorFeatures(grid(), all, "rows")
    expect(at(out, 1)).toEqual([1, 2])
    expect(at(out, 4)).toEqual([1, 1])
    expect(at(out, 3)).toEqual([3, 2])
  })

  it("cols: plot 1 takes the top-right footprint", () => {
    const out = mirrorFeatures(grid(), all, "cols")
    expect(at(out, 1)).toEqual([3, 1])
    expect(at(out, 2)).toEqual([2, 1]) // middle column stays
  })

  it("keeps properties, the footprint set, and the outer untouched", () => {
    const before = grid()
    const out = mirrorFeatures(before, all, "rows")
    expect(out[0]).toBe(before[0])
    expect(out.map((f) => f.properties)).toEqual(
      before.map((f) => f.properties),
    )
    const footprints = (fs: GeoJSON.Feature[]) =>
      fs
        .slice(1)
        .map((f) => JSON.stringify((f.geometry as GeoJSON.Polygon).coordinates))
        .sort()
    expect(footprints(out)).toEqual(footprints(before))
  })

  it("twice is identity", () => {
    const before = grid()
    const twice = mirrorFeatures(
      mirrorFeatures(before, all, "cols"),
      all,
      "cols",
    )
    expect(twice.map((f) => f.geometry)).toEqual(before.map((f) => f.geometry))
  })

  it("only flips within the selection", () => {
    const out = mirrorFeatures(grid(), new Set(["c11", "c21"]), "rows")
    expect(at(out, 1)).toEqual([1, 2])
    expect(at(out, 4)).toEqual([1, 1])
    expect(at(out, 2)).toEqual([2, 1]) // unselected
  })
})
