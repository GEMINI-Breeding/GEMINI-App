import { describe, expect, it } from "vitest"

import type { TraitRecordOutput } from "@/client"
import type { PlotPolygonFC } from "@/features/analyze/hooks/usePlotPolygons"

import {
  joinTraitToPolygons,
  plotKey,
  reduceTraitRecordsToMeanByPlot,
} from "./joinTraitToPolygons"

const polygon: GeoJSON.Polygon = {
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
}

function fc(
  features: Array<{
    plot_number?: number
    plot_row_number?: number
    plot_column_number?: number
  }>,
): PlotPolygonFC {
  return {
    type: "FeatureCollection",
    features: features.map((p) => ({
      type: "Feature",
      geometry: polygon,
      properties: p,
    })),
  } as PlotPolygonFC
}

function rec(
  plot_number: number,
  trait_value: number,
  row?: number,
  col?: number,
): TraitRecordOutput {
  return {
    plot_number,
    plot_row_number: row,
    plot_column_number: col,
    trait_value,
  } as unknown as TraitRecordOutput
}

describe("plotKey", () => {
  it("encodes plot+row+col when all present", () => {
    expect(plotKey(1, 2, 3)).toBe("1-2-3")
  })
  it("falls back to plot-only when row/col missing", () => {
    expect(plotKey(7, null, null)).toBe("7")
  })
  it("returns null when plot is missing", () => {
    expect(plotKey(null, 1, 1)).toBeNull()
  })
})

describe("reduceTraitRecordsToMeanByPlot", () => {
  it("computes mean per plot key", () => {
    const m = reduceTraitRecordsToMeanByPlot([
      rec(1, 0.4, 1, 1),
      rec(1, 0.6, 1, 1),
      rec(2, 0.2, 1, 2),
    ])
    expect(m.get("1-1-1")).toBeCloseTo(0.5)
    expect(m.get("2-1-2")).toBeCloseTo(0.2)
  })

  it("ignores non-numeric trait_values", () => {
    const m = reduceTraitRecordsToMeanByPlot([
      rec(1, 0.4, 1, 1),
      { ...rec(1, 0.6, 1, 1), trait_value: null as unknown as number },
    ])
    expect(m.get("1-1-1")).toBeCloseTo(0.4)
  })

  it("ignores records without plot_number", () => {
    const m = reduceTraitRecordsToMeanByPlot([
      { trait_value: 0.4 } as unknown as TraitRecordOutput,
      rec(2, 0.2, 1, 1),
    ])
    expect(m.size).toBe(1)
    expect(m.get("2-1-1")).toBeCloseTo(0.2)
  })
})

describe("joinTraitToPolygons", () => {
  it("writes the mean into each matched feature's properties", () => {
    const out = joinTraitToPolygons(
      fc([
        { plot_number: 1, plot_row_number: 1, plot_column_number: 1 },
        { plot_number: 2, plot_row_number: 1, plot_column_number: 2 },
      ]),
      new Map([
        ["1-1-1", 0.5],
        ["2-1-2", 0.2],
      ]),
      "Vegetation_Fraction",
    )
    expect(out.features[0].properties.Vegetation_Fraction).toBeCloseTo(0.5)
    expect(out.features[1].properties.Vegetation_Fraction).toBeCloseTo(0.2)
  })

  it("leaves the column undefined for features with no matching value", () => {
    const out = joinTraitToPolygons(
      fc([{ plot_number: 99, plot_row_number: 1, plot_column_number: 1 }]),
      new Map([["1-1-1", 0.5]]),
      "Vegetation_Fraction",
    )
    expect(
      (out.features[0].properties as Record<string, unknown>)
        .Vegetation_Fraction,
    ).toBeUndefined()
  })

  it("does not mutate the input FeatureCollection", () => {
    const input = fc([
      { plot_number: 1, plot_row_number: 1, plot_column_number: 1 },
    ])
    joinTraitToPolygons(input, new Map([["1-1-1", 0.5]]), "Vegetation_Fraction")
    expect(
      (input.features[0].properties as Record<string, unknown>)
        .Vegetation_Fraction,
    ).toBeUndefined()
  })
})
