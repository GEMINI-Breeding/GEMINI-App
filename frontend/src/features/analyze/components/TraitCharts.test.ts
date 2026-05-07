import { describe, expect, it } from "vitest"
import type { TraitRecordOutput } from "@/client"
import { buildGenotypeData, buildHistogram } from "./TraitCharts"

function record(
  trait_value: number,
  extras: Partial<TraitRecordOutput> = {},
): TraitRecordOutput {
  return {
    trait_id: 1,
    trait_name: "height",
    trait_value,
    timestamp: "2026-01-01T00:00:00",
    ...extras,
  } as TraitRecordOutput
}

describe("buildHistogram", () => {
  it("returns empty data when no records", () => {
    expect(buildHistogram([], "none")).toEqual({ data: [], seriesKeys: [] })
  })

  it("integer narrow range produces one bin per integer (binWidth=1)", () => {
    const records = [record(1), record(1), record(2), record(3)]
    const { data, seriesKeys } = buildHistogram(records, "none")
    expect(data).toHaveLength(3)
    expect(data[0].label).toBe("1")
    expect(data[2].label).toBe("3")
    expect(seriesKeys).toEqual(["Count"])
    expect(data[0].Count).toBe(2)
    expect(data[2].Count).toBe(1)
  })

  it("float values produce 20 bins", () => {
    const records = Array.from({ length: 100 }, (_, i) => record(0.1 * i + 0.5))
    const { data } = buildHistogram(records, "none")
    expect(data).toHaveLength(20)
  })

  it("group-by experiment splits counts into per-experiment series", () => {
    const records = [
      record(1, { experiment_name: "A" }),
      record(1, { experiment_name: "B" }),
      record(2, { experiment_name: "A" }),
    ]
    const { seriesKeys, data } = buildHistogram(records, "experiment")
    expect(seriesKeys).toEqual(["A", "B"])
    expect(data[0].A).toBe(1)
    expect(data[0].B).toBe(1)
    expect(data[1].A).toBe(2 - 1) // 1 record in bin index 1 (value=2)
  })
})

describe("buildGenotypeData", () => {
  it("returns no genotypes when record_info has none", () => {
    const result = buildGenotypeData([record(1), record(2)], "none")
    expect(result.genotypes).toEqual([])
    expect(result.points).toEqual([])
  })

  it("sorts genotypes by descending mean", () => {
    const records = [
      record(1, { record_info: { genotype: "A" } as Record<string, unknown> }),
      record(2, { record_info: { genotype: "A" } as Record<string, unknown> }),
      record(10, { record_info: { genotype: "B" } as Record<string, unknown> }),
    ]
    const { genotypes, minVal, maxVal } = buildGenotypeData(records, "none")
    expect(genotypes).toEqual(["B", "A"])
    expect(minVal).toBe(1)
    expect(maxVal).toBe(10)
  })

  it("uses experiment_name as series when grouped by experiment", () => {
    const records = [
      record(1, {
        experiment_name: "X",
        record_info: { genotype: "G" } as Record<string, unknown>,
      }),
      record(2, {
        experiment_name: "Y",
        record_info: { genotype: "G" } as Record<string, unknown>,
      }),
    ]
    const { seriesKeys } = buildGenotypeData(records, "experiment")
    expect(seriesKeys).toEqual(["X", "Y"])
  })
})
