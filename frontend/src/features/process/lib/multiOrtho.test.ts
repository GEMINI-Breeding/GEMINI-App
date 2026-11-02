import { describe, expect, it } from "vitest"

import {
  assignNearest,
  folderOrthos,
  nearestIndex,
  nearestRegions,
} from "./multiOrtho"

const F = "Processed/2026/E/Davis/Sorghum/2026-08-21/Drone/RGB/"
const J1 = "5fec6333-b04b-4da6-8e87-f6350014c565"
const J2 = "d0cca781-2e29-4fbe-b4a6-42ebce1dba0b"

describe("folderOrthos", () => {
  it("finds each orthomosaic with its COG and elevation model", () => {
    const files = [
      `${F}odm_orthophoto-${J1}.tif`,
      `${F}odm_orthophoto-${J1}-Pyramid.tif`,
      `${F}odm_dsm-${J1}.tif`,
      `${F}odm_orthophoto-${J2}.tif`,
      `${F}PlotImages/plot_1.png`,
    ].map((object_name) => ({ object_name }) as never)
    const o = folderOrthos(files, F)
    expect(o.map((x) => x.jobId)).toEqual([J1, J2])
    expect(o[0].cogPath).toBe(`${F}odm_orthophoto-${J1}-Pyramid.tif`)
    expect(o[0].dsmPath).toBe(`${F}odm_dsm-${J1}.tif`)
    expect(o[1].dsmPath).toBeNull()
  })
})

describe("nearest regions", () => {
  it("splits a box between two centres at their bisector", () => {
    const [west, east] = nearestRegions(
      [
        [-1, 0],
        [1, 0],
      ],
      [-2, -1, 2, 1],
    )
    expect(Math.max(...west.map((p) => p[0]))).toBeCloseTo(0, 6)
    expect(Math.min(...east.map((p) => p[0]))).toBeCloseTo(0, 6)
  })
  it("assigns plots to the nearest centre", () => {
    const sq = (x: number): GeoJSON.Feature => ({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [x, 0],
            [x + 0.1, 0],
            [x + 0.1, 0.1],
            [x, 0.1],
            [x, 0],
          ],
        ],
      },
    })
    const groups = assignNearest(
      [sq(-0.9), sq(0.2), sq(0.8)],
      [
        [-1, 0],
        [1, 0],
      ],
    )
    expect(groups.map((g) => g.length)).toEqual([1, 2])
    expect(
      nearestIndex(
        [-0.5, 0],
        [
          [-1, 0],
          [1, 0],
        ],
      ),
    ).toBe(0)
  })
})

describe("currentOrthoJobIds", () => {
  it("uses a run's treatment orthomosaics, not its newer quick one", async () => {
    const { currentOrthoJobIds } = await import("./multiOrtho")
    const run = {
      steps: { orthomosaic: { jobIds: ["full-ww", "full-dr", "quick-ww"] } },
      uploadScope: {
        treatments: [{ orthoJobId: "full-ww" }, { orthoJobId: "full-dr" }],
      },
    }
    expect(currentOrthoJobIds(run)).toEqual(["full-ww", "full-dr"])
    expect(
      currentOrthoJobIds({ steps: { orthomosaic: { jobIds: ["a", "b"] } } }),
    ).toEqual(["b"])
    expect(currentOrthoJobIds({ steps: {} })).toEqual([])
  })
})

describe("pickCovering", () => {
  it("takes a plot the nearest flight's image doesn't reach from the one that covers it", async () => {
    const { pickCovering } = await import("./multiOrtho")
    // 8/17 Sorghum: two long N-S flights overlapping in the middle.
    const ww = [-121.781795, 38.536577, -121.781484, 38.537794] as const
    const dr = [-121.781602, 38.536594, -121.781344, 38.53781] as const
    // A west-side plot near the north end: the drought centre is (barely)
    // nearer, but its image stops east of the plot.
    const plot = [
      -121.78164055, 38.53765787, -121.78162384, 38.53768402,
    ] as const
    expect(pickCovering([...plot], [[...ww], [...dr]])).toBe(0)
    // An east-side plot goes to drought.
    expect(
      pickCovering(
        [-121.78143, 38.537704, -121.781412, 38.537748],
        [[...ww], [...dr]],
      ),
    ).toBe(1)
  })
})
