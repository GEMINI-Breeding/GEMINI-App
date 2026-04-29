import { describe, expect, it, vi } from "vitest"

import {
  applyLabelsToFeatures,
  dimensionsFromDesign,
  FD_TRANSFORM_IDENTITY,
  type FieldDesign,
  mergeLabelsIntoExisting,
} from "./fieldDesign"

function gridFeature(
  row: number,
  col: number,
  plot: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: "Feature",
    properties: { row, col, plot },
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
  }
}

const FD: FieldDesign = {
  csv_text: "",
  mapping: { row: "Tier", col: "Bed", plot: "PlotNum", accession: "Line" },
  transform: FD_TRANSFORM_IDENTITY,
  rows: [
    { Tier: "1", Bed: "1", PlotNum: "1", Line: "A1" },
    { Tier: "1", Bed: "2", PlotNum: "2", Line: "A2" },
    { Tier: "2", Bed: "1", PlotNum: "3", Line: "B1" },
    { Tier: "2", Bed: "2", PlotNum: "4", Line: "B2" },
    { Tier: "3", Bed: "1", PlotNum: "5", Line: "C1" },
  ],
}

describe("dimensionsFromDesign", () => {
  it("returns max(row) / max(col) across the design", () => {
    expect(dimensionsFromDesign(FD)).toEqual({ rows: 3, cols: 2 })
  })

  it("falls back to 1×1 for empty designs", () => {
    expect(dimensionsFromDesign({ ...FD, rows: [] })).toEqual({
      rows: 1,
      cols: 1,
    })
  })

  it("ignores rows where row/col are non-numeric", () => {
    const fd: FieldDesign = {
      ...FD,
      rows: [{ Tier: "x", Bed: "y", PlotNum: "1", Line: "?" }],
    }
    expect(dimensionsFromDesign(fd)).toEqual({ rows: 1, cols: 1 })
  })
})

describe("applyLabelsToFeatures", () => {
  it("merges CSV row into matching feature properties", () => {
    const features = [gridFeature(1, 1, 1), gridFeature(1, 2, 2)]
    const out = applyLabelsToFeatures(features, FD)
    expect(out[0].properties).toMatchObject({
      _grid_row: 1,
      _grid_col: 1,
      _grid_plot: 1,
      Tier: "1",
      Bed: "1",
      Line: "A1",
    })
    expect(out[1].properties?.Line).toBe("A2")
  })

  it("CSV columns win on collision (CSV PlotNum overrides grid plot)", () => {
    // Build a design where the CSV mapping renames PlotNum → "plot" via
    // remapAndSerialize beforehand. Here we simulate by giving a CSV row
    // a "plot" key directly.
    const fd: FieldDesign = {
      ...FD,
      rows: [{ Tier: "1", Bed: "1", plot: "RAW-001", Line: "A1" }],
    }
    const out = applyLabelsToFeatures([gridFeature(1, 1, 99)], fd)
    expect(out[0].properties?.plot).toBe("RAW-001")
    expect(out[0].properties?._grid_plot).toBe(99)
  })

  it("preserves geometry on every feature", () => {
    const features = [gridFeature(1, 1, 1)]
    const out = applyLabelsToFeatures(features, FD)
    expect(out[0].geometry).toEqual(features[0].geometry)
  })

  it("warns (not throws) when a polygon has no matching CSV row", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const out = applyLabelsToFeatures(
      [gridFeature(1, 1, 1), gridFeature(99, 99, 2)],
      FD,
    )
    expect(out).toHaveLength(2)
    expect(out[0].properties?.Line).toBe("A1")
    expect(out[1].properties?.Line).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it("flipRows transforms the lookup (row 1 ↔ row 3 in a 3-row design)", () => {
    const fd: FieldDesign = {
      ...FD,
      transform: { ...FD_TRANSFORM_IDENTITY, flipRows: true },
    }
    const out = applyLabelsToFeatures([gridFeature(1, 1, 1)], fd)
    // Geometric row 1 → CSV row 3 (max=3, so 3-1+1=3) → "C1".
    expect(out[0].properties?.Line).toBe("C1")
  })

  it("flipCols transforms the lookup", () => {
    const fd: FieldDesign = {
      ...FD,
      transform: { ...FD_TRANSFORM_IDENTITY, flipCols: true },
    }
    const out = applyLabelsToFeatures([gridFeature(1, 1, 1)], fd)
    // Geometric col 1 → CSV col 2 (max=2) → "A2".
    expect(out[0].properties?.Line).toBe("A2")
  })

  it("swapAxes swaps row/col in the lookup", () => {
    // Geometric (row=2, col=1) → CSV (row=1, col=2) → "A2".
    const fd: FieldDesign = {
      ...FD,
      transform: { ...FD_TRANSFORM_IDENTITY, swapAxes: true },
    }
    const out = applyLabelsToFeatures([gridFeature(2, 1, 1)], fd)
    expect(out[0].properties?.Line).toBe("A2")
  })

  it("returns the input unchanged for an empty feature list", () => {
    expect(applyLabelsToFeatures([], FD)).toEqual([])
  })
})

describe("mergeLabelsIntoExisting", () => {
  it("preserves geometry and only rewrites properties", () => {
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [gridFeature(1, 1, 1), gridFeature(2, 2, 4)],
    }
    const before = JSON.stringify(fc.features.map((f) => f.geometry))
    const out = mergeLabelsIntoExisting(fc, FD)
    const after = JSON.stringify(out.features.map((f) => f.geometry))
    expect(after).toBe(before)
    expect(out.features[0].properties?.Line).toBe("A1")
    expect(out.features[1].properties?.Line).toBe("B2")
  })

  it("bootstraps row/col when features lack them (ground-pipeline shape)", () => {
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { plot_id: "1" },
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
      ],
    }
    const out = mergeLabelsIntoExisting(fc, FD)
    // First CSV row is (Tier=1, Bed=1) → assigned to feature[0] sequentially.
    expect(out.features[0].properties?.row).toBe(1)
    expect(out.features[0].properties?.col).toBe(1)
    expect(out.features[0].properties?.Line).toBe("A1")
  })

  it("returns the input unchanged for an empty FeatureCollection", () => {
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    }
    expect(mergeLabelsIntoExisting(fc, FD)).toBe(fc)
  })
})
