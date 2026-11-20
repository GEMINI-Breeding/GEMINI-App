import { describe, expect, it } from "vitest"

import type { TraitRecordOutput } from "@/client"
import { byDate, recordDate, seasonCsv, seasonTable } from "./seasonTraits"

const rec = (
  plot: number,
  date: string,
  v: number,
  extra: Partial<TraitRecordOutput> & { accession_name?: string } = {},
): TraitRecordOutput =>
  ({
    trait_id: 1,
    trait_name: "Vegetation_Fraction",
    trait_value: v,
    timestamp: "2026-10-30T00:00:00",
    collection_date: `${date}T00:00:00`,
    plot_number: plot,
    plot_row_number: 1,
    plot_column_number: plot,
    ...extra,
  }) as TraitRecordOutput

describe("season views", () => {
  const records = [
    rec(1, "2023-07-27", 0.8, { accession_name: "IT84S-2246" }),
    rec(2, "2023-07-27", 0.6),
    rec(1, "2023-06-15", 0.2),
    rec(2, "2023-06-15", 0.4),
    rec(3, "2023-06-15", 0.3),
  ]

  it("dates a record by its flight, not when it was saved", () => {
    expect(recordDate(records[0])).toBe("2023-07-27")
  })

  it("spreads the plots per date, earliest first", () => {
    const pts = byDate(records)
    expect(pts.map((p) => [p.date, p.n])).toEqual([
      ["2023-06-15", 3],
      ["2023-07-27", 2],
    ])
    expect(pts[0].mean).toBeCloseTo(0.3)
    expect(pts[0].range).toEqual([0.2, 0.4])
    expect(pts[1].iqr[0]).toBeCloseTo(0.65)
  })

  it("tables plots × dates with each plot's accession", () => {
    const t = seasonTable(records)
    expect(t.dates).toEqual(["2023-06-15", "2023-07-27"])
    expect(t.rows.map((r) => r.plot)).toEqual(["1", "2", "3"])
    expect(t.rows[0]).toMatchObject({
      accession: "IT84S-2246",
      values: { "2023-06-15": 0.2, "2023-07-27": 0.8 },
    })
    expect(t.rows[2].values["2023-07-27"]).toBeUndefined()
    expect(seasonCsv(t).split("\n")[1]).toBe("1,IT84S-2246,0.2,0.8")
  })

  it("leaves outliers out of the spread when asked (Tukey's fences)", () => {
    const day = [0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.95].map((v, i) =>
      rec(i + 1, "2023-07-27", v),
    )
    const [kept] = byDate(day)
    expect(kept).toMatchObject({ n: 7, outliers: 0, max: 0.95 })
    const [clean] = byDate(day, { excludeOutliers: true })
    expect(clean).toMatchObject({ n: 6, outliers: 1, max: 0.35 })
    expect(clean.mean).toBeCloseTo(0.325)
  })
})
