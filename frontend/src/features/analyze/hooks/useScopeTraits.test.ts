import { describe, expect, it } from "vitest"
import type { TraitRecord } from "@/features/analyze/api"
import { traitDatesInScope } from "./useScopeTraits"

const rec = (r: Partial<TraitRecord>) =>
  ({
    id: "",
    experiment: "GEMINI-26",
    location: "Davis",
    population: "Sorghum",
    date: "2026-08-10",
    trait_columns: [],
    ...r,
  }) as unknown as TraitRecord

describe("traitDatesInScope", () => {
  it("keeps only traits recorded at the picked site and crop", () => {
    const records = [
      rec({
        trait_columns: ["Sorghum panicle detection", "Height_95p_meters"],
      }),
      rec({
        location: "Riverside",
        population: "Cowpea",
        trait_columns: ["Vegetation_Fraction"],
      }),
      rec({
        location: "Riverside",
        population: "Cowpea",
        date: "2026-08-17",
        trait_columns: ["Vegetation_Fraction"],
      }),
    ]
    const here = traitDatesInScope(records, {
      experimentName: "GEMINI-26",
      siteName: "Riverside",
    })
    expect([...here.keys()]).toEqual(["Vegetation_Fraction"])
    expect(here.get("Vegetation_Fraction")?.size).toBe(2)
    const davis = traitDatesInScope(records, {
      siteName: "Davis",
      populationName: "Sorghum",
    })
    expect([...davis.keys()].sort()).toEqual([
      "Height_95p_meters",
      "Sorghum panicle detection",
    ])
  })
})
