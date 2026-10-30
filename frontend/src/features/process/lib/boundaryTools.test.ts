/**
 * The boundary editor's tools: plots of a fixed size, moving a selection by
 * metres, rotating it without shearing, border positions of a field design.
 */
import { describe, expect, it } from "vitest"

import { designGrid } from "../components/FieldMapPanel"
import { nextPlotName } from "../components/PlotBoundaryPrep"
import { designPlotChecker, type FieldDesign } from "./fieldDesign"
import { generateGridFeatures } from "./grid"
import { rotateFeatures, translateFeaturesMeters } from "./groupTransform"

const LAT = 38.54 // Davis
const M_PER_DEG_LAT = 111_320
const mPerDegLng = M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180)

/** An outer boundary 40 m × 30 m (east × north) at Davis. */
const outer: GeoJSON.Polygon = (() => {
  const w = 40 / mPerDegLng
  const h = 30 / M_PER_DEG_LAT
  const x = -121.78
  return {
    type: "Polygon",
    coordinates: [
      [
        [x, LAT],
        [x + w, LAT],
        [x + w, LAT + h],
        [x, LAT + h],
        [x, LAT],
      ],
    ],
  }
})()

function sizeM(f: GeoJSON.Feature): { w: number; h: number } {
  const ring = (f.geometry as GeoJSON.Polygon).coordinates[0]
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  return {
    w: (Math.max(...xs) - Math.min(...xs)) * mPerDegLng,
    h: (Math.max(...ys) - Math.min(...ys)) * M_PER_DEG_LAT,
  }
}

function side(f: GeoJSON.Feature, i: number): number {
  const [a, b] = [
    (f.geometry as GeoJSON.Polygon).coordinates[0][i],
    (f.geometry as GeoJSON.Polygon).coordinates[0][i + 1],
  ]
  return Math.hypot((b[0] - a[0]) * mPerDegLng, (b[1] - a[1]) * M_PER_DEG_LAT)
}

describe("plots of a fixed size", () => {
  it("are that size, the grid centred in the outer boundary", () => {
    const cells = generateGridFeatures(outer, {
      rows: 2,
      cols: 4,
      angleDeg: 0,
      gapXMeters: 1,
      gapYMeters: 1,
      plotWidthMeters: 3,
      plotLengthMeters: 5,
    })
    expect(cells).toHaveLength(8)
    for (const c of cells) {
      expect(sizeM(c).w).toBeCloseTo(3, 1)
      expect(sizeM(c).h).toBeCloseTo(5, 1)
    }
    // 4 × 3 m + 3 × 1 m = 15 m wide, centred in 40 m: 12.5 m in from the west edge.
    const west = Math.min(
      ...cells.map((c) =>
        Math.min(
          ...(c.geometry as GeoJSON.Polygon).coordinates[0].map((p) => p[0]),
        ),
      ),
    )
    expect((west - outer.coordinates[0][0][0]) * mPerDegLng).toBeCloseTo(
      12.5,
      1,
    )
  })

  it("without a size, still fill the outer boundary", () => {
    const cells = generateGridFeatures(outer, { rows: 3, cols: 4, angleDeg: 0 })
    expect(sizeM(cells[0]).w).toBeCloseTo(10, 1)
    expect(sizeM(cells[0]).h).toBeCloseTo(10, 1)
  })
})

describe("moving and rotating selected plots", () => {
  const cells = generateGridFeatures(outer, {
    rows: 1,
    cols: 2,
    angleDeg: 0,
  }).map((f, i) => ({
    ...f,
    properties: { ...f.properties, cellId: `c${i}` },
  }))
  const sel = new Set(["c0"])

  it("moves by metres, the others stay", () => {
    const moved = translateFeaturesMeters(cells, sel, 2, -1)
    const before = (cells[0].geometry as GeoJSON.Polygon).coordinates[0][0]
    const after = (moved[0].geometry as GeoJSON.Polygon).coordinates[0][0]
    expect((after[0] - before[0]) * mPerDegLng).toBeCloseTo(2, 2)
    expect((after[1] - before[1]) * M_PER_DEG_LAT).toBeCloseTo(-1, 2)
    expect(moved[1]).toBe(cells[1])
  })

  it("rotates a plot without shearing it (its sides keep their lengths)", () => {
    const turned = rotateFeatures(cells, sel, 30)
    for (const i of [0, 1, 2, 3])
      expect(side(turned[0], i)).toBeCloseTo(side(cells[0], i), 1)
  })
})

describe("border positions of a field design", () => {
  // Rows 1–2, columns 1–3, with a gap at row 2, column 2.
  const fd: FieldDesign = {
    csv_text: "",
    mapping: { row: "r", col: "c", plot: "p", accession: "a" },
    rows: [
      { r: "1", c: "1", p: "101", a: "IT97K" },
      { r: "1", c: "2", p: "102", a: "MAGIC1" },
      { r: "1", c: "3", p: "103", a: "MAGIC2" },
      { r: "2", c: "1", p: "201", a: "MAGIC3" },
      { r: "2", c: "3", p: "203", a: "MAGIC4" },
    ],
    transform: { flipRows: false, flipCols: false, swapAxes: false },
  }

  it("a grid position with no plot in the design is a border", () => {
    const has = designPlotChecker(fd)
    const cell = (row: number, col: number) =>
      ({
        type: "Feature",
        geometry: null,
        properties: { row, col },
      }) as unknown as GeoJSON.Feature
    expect(has(cell(1, 2))).toBe(true)
    expect(has(cell(2, 2))).toBe(false)
  })

  it("the field map counts the plots and the gaps", () => {
    const g = designGrid(fd)
    expect(g.rows).toEqual([1, 2])
    expect(g.cols).toEqual([1, 2, 3])
    expect(g.plots).toBe(5)
    expect(g.gaps).toBe(1)
    expect(g.cell(1, 2)?.plot).toBe("102")
    expect(g.cell(2, 2)).toBeNull()
  })
})

describe("a plot added by hand", () => {
  it("is named one after the highest plot number (borders and outlines aside)", () => {
    const f = (props: Record<string, unknown>) =>
      ({
        type: "Feature",
        geometry: null,
        properties: props,
      }) as unknown as GeoJSON.Feature
    expect(
      nextPlotName([
        f({ plot: 104 }),
        f({ plot: "105" }),
        f({ role: "outer" }),
        f({ plot: 300, border: true }),
      ]),
    ).toBe("106")
    expect(nextPlotName([f({ plot: "A" }), f({ plot: "B" })])).toBe("added-3")
  })
})
