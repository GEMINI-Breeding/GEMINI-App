import { describe, expect, it } from "vitest"

import { applyCorrections, bedsOf, type Ring } from "./gpsCorrections"

const LAT0 = 33.9674
const LON0 = -117.3385
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180)

function box(east: number, north: number, w = 2, h = 1): Ring {
  const lon = LON0 + east / KX
  const lat = LAT0 + north / 111_320
  const dx = w / 2 / KX
  const dy = h / 2 / 111_320
  return [
    [lon - dx, lat - dy],
    [lon + dx, lat - dy],
    [lon + dx, lat + dy],
    [lon - dx, lat + dy],
    [lon - dx, lat - dy],
  ]
}

const metres = (r: Ring) => {
  const pts = r.slice(0, -1)
  const lon = pts.reduce((a, p) => a + p[0], 0) / pts.length
  const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length
  return [(lon - LON0) * KX, (lat - LAT0) * 111_320]
}

describe("applyCorrections (same rules as the stitch worker)", () => {
  it("adds the whole-track and bed shifts", () => {
    const out = applyCorrections(
      { "1": box(0, 0), "3": box(0, 3) },
      {
        shift_m: [1, 0],
        beds: { a: { shift_m: [0, 2] } },
        plot_bed: { "1": "a", "3": "b" },
      },
    )
    expect(metres(out["1"])[0]).toBeCloseTo(1, 3)
    expect(metres(out["1"])[1]).toBeCloseTo(2, 3)
    expect(metres(out["3"])[1]).toBeCloseTo(3, 3)
  })
  it("rotates a bed clockwise about its middle", () => {
    const out = applyCorrections(
      { "1": box(-5, 0), "2": box(5, 0) },
      { beds: { a: { rotate_deg: 90 } }, plot_bed: { "1": "a", "2": "a" } },
    )
    expect(metres(out["1"])[1]).toBeCloseTo(5, 3)
    expect(metres(out["2"])[1]).toBeCloseTo(-5, 3)
  })
})

describe("bedsOf", () => {
  it("a serpentine turn starts a new pass even with one direction", () => {
    // Pass 1 goes north along x=0, pass 2 comes back south along x=1.5.
    const at = (id: number, e: number, n: number) => ({
      id: String(id),
      footprint: box(e, n),
      lane: 1,
      lanes: 1,
      direction: "DOWN",
    })
    const beds = bedsOf([
      at(1, 0, 0),
      at(2, 0, 4),
      at(3, 0, 8),
      at(4, 1.5, 8),
      at(5, 1.5, 4),
      at(6, 1.5, 0),
    ])
    expect(Object.values(beds)).toEqual([
      "pass 1",
      "pass 1",
      "pass 1",
      "pass 2",
      "pass 2",
      "pass 2",
    ])
  })
  it("one bed per lane per pass; a new pass where the direction turns", () => {
    const p = (id: number, lane: number, direction: string) => ({
      id: String(id),
      footprint: box(Math.ceil(id / 2) * 4, lane),
      lane,
      lanes: 2,
      direction,
    })
    const beds = bedsOf([
      p(1, 1, "LEFT"),
      p(2, 2, "LEFT"),
      p(3, 1, "LEFT"),
      p(4, 2, "LEFT"),
      p(5, 1, "RIGHT"),
      p(6, 2, "RIGHT"),
    ])
    expect(beds).toEqual({
      "1": "lane 1 · pass 1",
      "2": "lane 2 · pass 1",
      "3": "lane 1 · pass 1",
      "4": "lane 2 · pass 1",
      "5": "lane 1 · pass 2",
      "6": "lane 2 · pass 2",
    })
  })
})
