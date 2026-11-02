import { describe, expect, it } from "vitest"
import { traitLabel } from "./traitName"

describe("traitLabel", () => {
  it("names canopy temperature readably and leaves others alone", () => {
    expect(traitLabel("Temp_veg_avg_C")).toBe("Canopy temperature")
    expect(traitLabel("Height_95p_meters")).toBe("Canopy height (95th pct)")
    expect(traitLabel("Vegetation_Fraction")).toBe("Vegetation_Fraction")
    expect(traitLabel(null)).toBe("")
  })
})
