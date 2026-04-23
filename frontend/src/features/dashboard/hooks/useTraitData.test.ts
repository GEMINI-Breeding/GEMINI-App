import { describe, expect, it } from "vitest"
import {
  applyFilters,
  buildTemporalSeries,
  computeAggregate,
  formatDashboardValue,
  groupBy,
  groupByMulti,
} from "./useTraitData"
import type { TraitRecord, TraitsResponse } from "@/features/analyze/api"

function feat(props: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: props,
  }
}

function fc(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features }
}

describe("formatDashboardValue", () => {
  it("renders an em-dash for null/undefined", () => {
    expect(formatDashboardValue(null)).toBe("—")
    expect(formatDashboardValue(undefined)).toBe("—")
  })

  it("renders non-numeric values as String(...)", () => {
    expect(formatDashboardValue("hello")).toBe("hello")
    expect(formatDashboardValue(true)).toBe("true")
  })

  it("renders integers without decimals", () => {
    expect(formatDashboardValue(42)).toBe("42")
    expect(formatDashboardValue(-7)).toBe("-7")
  })

  it("strips trailing zeros and keeps up to 4 decimals by default", () => {
    expect(formatDashboardValue(1.23)).toBe("1.23")
    expect(formatDashboardValue(1.234567)).toBe("1.2346")
    expect(formatDashboardValue(1.2)).toBe("1.2")
  })

  it("renders count columns (model/class, n_ prefix, 'count' in name) with 1 decimal", () => {
    expect(formatDashboardValue(12.345, "yolo/plant")).toBe("12.3")
    expect(formatDashboardValue(12.345, "flower_count")).toBe("12.3")
    expect(formatDashboardValue(12.345, "n_plants")).toBe("12.3")
    expect(formatDashboardValue(12.345, "n_buds")).toBe("12.3")
  })

  it("does NOT treat ndvi as a count even though it starts with n", () => {
    expect(formatDashboardValue(0.51234, "ndvi")).toBe("0.5123")
  })

  it("renders height / vegetation / fraction columns with 3 decimals", () => {
    expect(formatDashboardValue(1.23456, "plant_height")).toBe("1.235")
    expect(formatDashboardValue(0.5, "veg_fraction")).toBe("0.500")
    expect(formatDashboardValue(0.5, "vegetation_index")).toBe("0.500")
  })
})

describe("applyFilters", () => {
  const features = [
    feat({ accession: "A", loc: "field1" }),
    feat({ accession: "B", loc: "field1" }),
    feat({ accession: "A", loc: "field2" }),
  ]

  it("returns the original array when filters is undefined", () => {
    expect(applyFilters(features, undefined)).toBe(features)
  })

  it("returns all features when every filter value array is empty", () => {
    expect(applyFilters(features, { accession: [], loc: [] })).toEqual(features)
  })

  it("filters on a single field", () => {
    const out = applyFilters(features, { accession: ["A"] })
    expect(out).toHaveLength(2)
  })

  it("ANDs multiple active filters together", () => {
    const out = applyFilters(features, { accession: ["A"], loc: ["field2"] })
    expect(out).toHaveLength(1)
  })

  it("coerces property values to string for comparison; missing field matches empty string", () => {
    const f = [feat({ n: 42 }), feat({ n: 43 })]
    expect(applyFilters(f, { n: ["42"] })).toHaveLength(1)
    expect(applyFilters([feat({})], { missing: [""] })).toHaveLength(1)
  })
})

describe("computeAggregate", () => {
  const collection = fc([
    feat({ y: 10 }),
    feat({ y: 20 }),
    feat({ y: 30 }),
    feat({ y: "not a number" }),
    feat({ y: Number.NaN }),
  ])

  it("returns null when no features have a numeric value for the metric", () => {
    expect(computeAggregate(fc([feat({ z: "x" })]), "y", "avg")).toBeNull()
  })

  it("computes the average across only numeric values", () => {
    expect(computeAggregate(collection, "y", "avg")).toBe(20)
  })

  it("computes the min / max / count ignoring non-numeric values", () => {
    expect(computeAggregate(collection, "y", "min")).toBe(10)
    expect(computeAggregate(collection, "y", "max")).toBe(30)
    expect(computeAggregate(collection, "y", "count")).toBe(3)
  })
})

describe("groupBy", () => {
  it("averages the metric per group and returns rows sorted by group name", () => {
    const out = groupBy(
      fc([
        feat({ g: "b", y: 10 }),
        feat({ g: "a", y: 1 }),
        feat({ g: "a", y: 3 }),
      ]),
      "g",
      "y",
    )
    expect(out).toEqual([
      { name: "a", value: 2 },
      { name: "b", value: 10 },
    ])
  })

  it("uses '(none)' for features where the group field is missing", () => {
    const out = groupBy(fc([feat({ y: 5 })]), "missing", "y")
    expect(out).toEqual([{ name: "(none)", value: 5 }])
  })

  it("skips features whose metric is non-numeric", () => {
    const out = groupBy(
      fc([feat({ g: "a", y: "x" }), feat({ g: "a", y: 2 })]),
      "g",
      "y",
    )
    expect(out).toEqual([{ name: "a", value: 2 }])
  })
})

describe("groupByMulti", () => {
  it("returns one row per group with one column per metric (empty metric → 0)", () => {
    const out = groupByMulti(
      fc([
        feat({ g: "a", y1: 10, y2: 2 }),
        feat({ g: "a", y1: 20 }), // missing y2
        feat({ g: "b", y1: 5, y2: 4 }),
      ]),
      "g",
      ["y1", "y2"],
    )
    expect(out).toEqual([
      { name: "a", y1: 15, y2: 2 },
      { name: "b", y1: 5, y2: 4 },
    ])
  })

  it("sorts rows alphabetically by group name", () => {
    const out = groupByMulti(
      fc([feat({ g: "z", y: 1 }), feat({ g: "a", y: 2 })]),
      "g",
      ["y"],
    )
    expect(out.map((r) => r.name)).toEqual(["a", "z"])
  })
})

describe("buildTemporalSeries", () => {
  function rec(id: string, date: string): TraitRecord {
    return {
      id,
      run_id: "r",
      pipeline_id: "p",
      pipeline_name: "P",
      pipeline_type: "aerial",
      workspace_id: "w",
      workspace_name: "W",
      date,
      experiment: "e",
      location: "l",
      population: "p",
      platform: "x",
      sensor: "x",
      version: 1,
      ortho_version: null,
      ortho_name: null,
      stitch_version: null,
      stitch_name: null,
      boundary_version: null,
      boundary_name: null,
      plot_count: 0,
      trait_columns: [],
      created_at: "",
    }
  }

  function resp(features: GeoJSON.Feature[]): TraitsResponse {
    return {
      geojson: fc(features),
      metric_columns: [],
      feature_count: features.length,
    }
  }

  it("aggregates per date with the default 'avg' aggregation (no groupBy)", () => {
    const out = buildTemporalSeries(
      [rec("1", "2024-01-01"), rec("2", "2024-02-01")],
      [resp([feat({ y: 10 }), feat({ y: 20 })]), resp([feat({ y: 5 })])],
      "y",
      null,
    )
    expect(out).toEqual([
      { date: "2024-01-01", y: 15 },
      { date: "2024-02-01", y: 5 },
    ])
  })

  it("skips records with no response (still emits the others)", () => {
    const out = buildTemporalSeries(
      [rec("1", "2024-01-01"), rec("2", "2024-02-01")],
      [null, resp([feat({ y: 5 })])],
      "y",
      null,
    )
    expect(out).toEqual([{ date: "2024-02-01", y: 5 }])
  })

  it("honours a non-default aggregation (min/max/sum/median)", () => {
    const vals = [resp([feat({ y: 1 }), feat({ y: 3 }), feat({ y: 5 })])]
    const records = [rec("1", "2024-01-01")]
    expect(buildTemporalSeries(records, vals, "y", null, undefined, { aggregation: "min" })).toEqual([
      { date: "2024-01-01", y: 1 },
    ])
    expect(buildTemporalSeries(records, vals, "y", null, undefined, { aggregation: "max" })).toEqual([
      { date: "2024-01-01", y: 5 },
    ])
    expect(buildTemporalSeries(records, vals, "y", null, undefined, { aggregation: "sum" })).toEqual([
      { date: "2024-01-01", y: 9 },
    ])
    expect(buildTemporalSeries(records, vals, "y", null, undefined, { aggregation: "median" })).toEqual([
      { date: "2024-01-01", y: 3 },
    ])
  })

  it("computes an even-length median as the mean of the two central values", () => {
    const out = buildTemporalSeries(
      [rec("1", "2024-01-01")],
      [resp([feat({ y: 1 }), feat({ y: 3 }), feat({ y: 5 }), feat({ y: 9 })])],
      "y",
      null,
      undefined,
      { aggregation: "median" },
    )
    expect(out[0].y).toBe(4) // (3 + 5) / 2
  })

  it("emits *_lo / *_range for a std-dev error band", () => {
    const out = buildTemporalSeries(
      [rec("1", "2024-01-01")],
      [resp([feat({ y: 2 }), feat({ y: 4 }), feat({ y: 6 })])],
      "y",
      null,
      undefined,
      { bandType: "std" },
    )
    // mean = 4, std = sqrt(((2-4)^2 + 0 + (6-4)^2)/3) = sqrt(8/3) ≈ 1.633
    const row = out[0]
    expect(row.y).toBe(4)
    expect(row.y_lo).toBeCloseTo(4 - Math.sqrt(8 / 3), 5)
    expect(row.y_range).toBeCloseTo(2 * Math.sqrt(8 / 3), 5)
  })

  it("emits *_lo / *_range for a minmax error band", () => {
    const out = buildTemporalSeries(
      [rec("1", "2024-01-01")],
      [resp([feat({ y: 1 }), feat({ y: 5 }), feat({ y: 10 })])],
      "y",
      null,
      undefined,
      { bandType: "minmax" },
    )
    expect(out[0].y_lo).toBe(1)
    expect(out[0].y_range).toBe(9)
  })

  it("splits into per-group sub-series when groupByField is set", () => {
    const out = buildTemporalSeries(
      [rec("1", "2024-01-01")],
      [resp([feat({ g: "x", y: 10 }), feat({ g: "y", y: 20 })])],
      "y",
      "g",
    )
    expect(out[0]).toMatchObject({ date: "2024-01-01", x: 10, y: 20 })
  })

  it("applies filters before aggregation", () => {
    const out = buildTemporalSeries(
      [rec("1", "2024-01-01")],
      [resp([feat({ accession: "A", y: 10 }), feat({ accession: "B", y: 90 })])],
      "y",
      null,
      { accession: ["A"] },
    )
    expect(out[0].y).toBe(10)
  })

  it("sorts by normalized date across both YYYY-MM-DD and MM-DD-YYYY inputs", () => {
    const out = buildTemporalSeries(
      [rec("1", "03-15-2024"), rec("2", "2024-01-10"), rec("3", "02-28-2024")],
      [resp([feat({ y: 1 })]), resp([feat({ y: 2 })]), resp([feat({ y: 3 })])],
      "y",
      null,
    )
    expect(out.map((r) => r.date)).toEqual(["2024-01-10", "02-28-2024", "03-15-2024"])
  })

  it("returns 0 for groups with no numeric samples in groupByMulti paths", () => {
    const out = buildTemporalSeries(
      [rec("1", "2024-01-01")],
      [resp([feat({ g: "a", y: "x" })])],
      "y",
      "g",
    )
    // No numeric samples → row exists with just date
    expect(out[0]).toEqual({ date: "2024-01-01" })
  })
})
