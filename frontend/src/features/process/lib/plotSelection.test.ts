import { describe, expect, it } from "vitest"

import { plotsFromGeojson } from "./geojsonImport"
import {
  choosePlots,
  parsePlotList,
  plotsWithOrthoImages,
} from "./plotSelection"

const fc = (plots: (string | number)[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: plots.map((plot) => ({
    type: "Feature",
    properties: { plot },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
  })),
})

describe("which plots a plot-images run does", () => {
  it("reads a list of plots, with ranges", () => {
    expect(parsePlotList("12, 15-17; A3 12")).toEqual([
      "12",
      "15",
      "16",
      "17",
      "A3",
    ])
  })

  it("knows the plots that have an orthomosaic image", () => {
    const have = plotsWithOrthoImages([
      "Processed/x/PlotImages/plot_12_accession_MAGIC1.png",
      "Processed/x/PlotImages/plot_A3.png",
      "Processed/x/PlotImages/notes.txt",
    ])
    expect([...have].sort()).toEqual(["12", "A3"])
  })

  it("all, those without images yet, or the ones listed", () => {
    const b = fc([1, 2, 3, 106])
    expect(choosePlots(b, { mode: "all" }, new Set()).some).toBe(false)
    const missing = choosePlots(
      b,
      { mode: "missing" },
      new Set(["1", "2", "3"]),
    )
    expect(missing.boundaries.features.map((f) => f.properties?.plot)).toEqual([
      106,
    ])
    expect(missing.some).toBe(true)
    expect(choosePlots(b, { mode: "list", text: "2-3" }, new Set()).count).toBe(
      2,
    )
    expect(
      choosePlots(b, { mode: "missing" }, new Set(["1", "2", "3", "106"]))
        .count,
    ).toBe(0)
  })
})

describe("GeoJSON from elsewhere", () => {
  it("polygons become plots; common names are mapped; multipolygons split", () => {
    const plots = plotsFromGeojson(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { Plot_ID: 7, Row: "2", Bed: 3, cellId: "x" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-121.7, 38.5],
                  [-121.69, 38.5],
                  [-121.69, 38.51],
                  [-121.7, 38.5],
                ],
              ],
            },
          },
          {
            type: "Feature",
            properties: { plot: "8" },
            geometry: {
              type: "MultiPolygon",
              coordinates: [
                [
                  [
                    [-121.7, 38.5],
                    [-121.69, 38.5],
                    [-121.69, 38.51],
                    [-121.7, 38.5],
                  ],
                ],
                [
                  [
                    [-121.6, 38.5],
                    [-121.59, 38.5],
                    [-121.59, 38.51],
                    [-121.6, 38.5],
                  ],
                ],
              ],
            },
          },
        ],
      }),
    )
    expect(plots).toHaveLength(3)
    expect(plots[0].properties).toMatchObject({
      plot: "7",
      row: 2,
      col: 3,
      Plot_ID: 7,
    })
    expect(plots[0].properties).not.toHaveProperty("cellId")
  })

  it("refuses coordinates that are not longitude/latitude", () => {
    const utm = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [609000, 4266000],
            [609010, 4266000],
            [609010, 4266010],
            [609000, 4266000],
          ],
        ],
      },
    }
    expect(() => plotsFromGeojson(JSON.stringify(utm))).toThrow(/WGS 84/)
    expect(() => plotsFromGeojson("not json")).toThrow(/not a GeoJSON/)
  })
})
