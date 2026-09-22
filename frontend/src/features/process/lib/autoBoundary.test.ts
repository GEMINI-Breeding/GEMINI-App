import { describe, expect, it } from "vitest"
import { outerFromOrthoBounds } from "./autoBoundary"

describe("outerFromOrthoBounds", () => {
  it("insets the ortho extent 2.5% per side, as a closed lng/lat ring", () => {
    const f = outerFromOrthoBounds([
      [38.0, -121.1],
      [38.1, -121.0],
    ])
    const ring = f.geometry.coordinates[0]
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
    const [w, s] = ring[0]
    const [e, n] = ring[2]
    expect(w).toBeCloseTo(-121.0975, 6)
    expect(e).toBeCloseTo(-121.0025, 6)
    expect(s).toBeCloseTo(38.0025, 6)
    expect(n).toBeCloseTo(38.0975, 6)
  })
})
