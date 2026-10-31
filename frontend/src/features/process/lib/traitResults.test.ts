import { describe, expect, it } from "vitest"

import { summariseTraits } from "./traitResults"

describe("summariseTraits", () => {
  it("gives each measured trait's plots, mean and range", () => {
    const out = summariseTraits({
      features: [
        { properties: { Vegetation_Fraction: 0.2, Height_95p_meters: 1 } },
        { properties: { Vegetation_Fraction: 0.6, Height_95p_meters: null } },
      ],
    })
    expect(out.map((t) => t.key)).toEqual([
      "Vegetation_Fraction",
      "Height_95p_meters",
    ])
    expect(out[0]).toMatchObject({ plots: 2, min: 0.2, max: 0.6 })
    expect(out[0].mean).toBeCloseTo(0.4)
    expect(out[1].plots).toBe(1)
  })
  it("leaves out traits the run did not measure", () => {
    const geojson = {
      features: [
        { properties: { Vegetation_Fraction: 0.5, Temp_veg_avg_C: 0 } },
      ],
    }
    expect(
      summariseTraits(geojson, ["Vegetation_Fraction"]).map((t) => t.key),
    ).toEqual(["Vegetation_Fraction"])
  })
  it("is empty for no file", () => {
    expect(summariseTraits(null)).toEqual([])
  })
})
