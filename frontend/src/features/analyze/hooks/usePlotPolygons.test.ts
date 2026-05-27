import { describe, expect, it } from "vitest"

import { projectSnapshotToFeatureCollection } from "./usePlotPolygons"

const polygon: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
}

describe("projectSnapshotToFeatureCollection", () => {
  it("returns an empty FeatureCollection for an undefined input", () => {
    expect(projectSnapshotToFeatureCollection(undefined)).toEqual({
      type: "FeatureCollection",
      features: [],
    })
  })

  it("reads state_snapshot.boundaries (newer snapshots)", () => {
    const loaded = {
      state_snapshot: {
        boundaries: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: polygon,
              properties: { plot: 1, row: 2, column: 3, accession: "ACC-A" },
            },
          ],
        },
      },
    }
    const out = projectSnapshotToFeatureCollection(loaded)
    expect(out.features).toHaveLength(1)
    expect(out.features[0].properties).toMatchObject({
      plot_number: 1,
      plot_row_number: 2,
      plot_column_number: 3,
      accession_name: "ACC-A",
    })
  })

  it("falls back to state_snapshot as the FC (older snapshots)", () => {
    const loaded = {
      state_snapshot: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: polygon,
            properties: {
              plot_number: 7,
              plot_row_number: 1,
              plot_column_number: 1,
            },
          },
        ],
      },
    }
    expect(projectSnapshotToFeatureCollection(loaded).features).toHaveLength(1)
  })

  it("preserves accession_name when already normalized", () => {
    const out = projectSnapshotToFeatureCollection({
      state_snapshot: {
        boundaries: {
          features: [
            {
              geometry: polygon,
              properties: { accession_name: "X", plot_number: 1 },
            },
          ],
        },
      },
    })
    expect(out.features[0].properties.accession_name).toBe("X")
  })

  it("normalizes string-typed numeric properties", () => {
    const out = projectSnapshotToFeatureCollection({
      state_snapshot: {
        boundaries: {
          features: [
            {
              geometry: polygon,
              properties: { plot: "5", row: "1", column: "2" },
            },
          ],
        },
      },
    })
    expect(out.features[0].properties).toMatchObject({
      plot_number: 5,
      plot_row_number: 1,
      plot_column_number: 2,
    })
  })

  it("accepts the legacy `col` short-hand for column", () => {
    const out = projectSnapshotToFeatureCollection({
      state_snapshot: {
        boundaries: {
          features: [
            {
              geometry: polygon,
              properties: { plot: 4, row: 2, col: 7 },
            },
          ],
        },
      },
    })
    expect(out.features[0].properties).toMatchObject({
      plot_number: 4,
      plot_row_number: 2,
      plot_column_number: 7,
    })
  })

  it("skips features without polygon geometry", () => {
    const out = projectSnapshotToFeatureCollection({
      state_snapshot: {
        boundaries: {
          features: [
            { type: "Feature", properties: {} },
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              properties: {},
            },
            { type: "Feature", geometry: polygon, properties: { plot: 1 } },
          ],
        },
      },
    })
    expect(out.features).toHaveLength(1)
  })
})
