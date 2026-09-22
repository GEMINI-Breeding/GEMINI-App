import { describe, expect, it } from "vitest"

import type { MatrixRow } from "./multivariate"
import { filterRows, sortRows, tableCsv } from "./traitTable"

const row = (
  plot: number,
  r: number,
  c: number,
  acc: string | null,
  values: Record<string, number | null>,
): MatrixRow => ({
  plot_number: plot,
  plot_row_number: r,
  plot_column_number: c,
  accession_name: acc,
  experiment_name: "E",
  season_name: "S",
  site_name: "Davis",
  population: "Cowpea",
  values,
})

const ROWS = [
  row(1, 1, 1, "CB27", { height: 10, yield: 2 }),
  row(2, 1, 2, "IT93", { height: null, yield: 5 }),
  row(10, 2, 1, "cb46", { height: 30, yield: null }),
]

describe("filterRows", () => {
  it("returns everything for an empty query", () => {
    expect(filterRows(ROWS, "  ")).toHaveLength(3)
  })

  it("matches plot/row/col exactly, not as a substring", () => {
    // plot:1 must not also match plot 10.
    expect(filterRows(ROWS, "plot:1").map((r) => r.plot_number)).toEqual([1])
    expect(filterRows(ROWS, "row:1").map((r) => r.plot_number)).toEqual([1, 2])
  })

  it("matches accession case-insensitively and ANDs terms", () => {
    expect(filterRows(ROWS, "acc:cb").map((r) => r.plot_number)).toEqual([
      1, 10,
    ])
    expect(filterRows(ROWS, "acc:cb row:2").map((r) => r.plot_number)).toEqual([
      10,
    ])
  })

  it("free text searches identity columns", () => {
    expect(filterRows(ROWS, "it93").map((r) => r.plot_number)).toEqual([2])
  })

  it("a malformed number matches nothing rather than everything", () => {
    expect(filterRows(ROWS, "plot:abc")).toHaveLength(0)
  })
})

describe("sortRows", () => {
  it("sorts plots numerically", () => {
    const out = sortRows([ROWS[2], ROWS[0], ROWS[1]], "plot", "asc")
    expect(out.map((r) => r.plot_number)).toEqual([1, 2, 10])
  })

  it("puts nulls last in BOTH directions", () => {
    const desc = sortRows(ROWS, { trait: "height" }, "desc")
    expect(desc.map((r) => r.plot_number)).toEqual([10, 1, 2])
    const asc = sortRows(ROWS, { trait: "height" }, "asc")
    expect(asc.map((r) => r.plot_number)).toEqual([1, 10, 2])
  })
})

describe("tableCsv", () => {
  it("writes identity + trait columns, blanks for missing values", () => {
    const csv = tableCsv([ROWS[1]], ["height", "yield"])
    expect(csv).toBe(
      "plot_number,plot_row_number,plot_column_number,accession_name,experiment_name,season_name,site_name,population,height,yield\n" +
        "2,1,2,IT93,E,S,Davis,Cowpea,,5\n",
    )
  })

  it("escapes quotes and commas in accession names", () => {
    const csv = tableCsv([row(3, 1, 3, 'A, "b"', { t: 1 })], ["t"])
    expect(csv.split("\n")[1]).toContain('"A, ""b"""')
  })
})
