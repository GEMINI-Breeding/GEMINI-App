import { describe, expect, it } from "vitest"

import { autoDetect, parseCSV, remapAndSerialize } from "./csv"

describe("parseCSV", () => {
  it("parses a basic header + rows", () => {
    const { headers, rows } = parseCSV("a,b,c\n1,2,3\n4,5,6")
    expect(headers).toEqual(["a", "b", "c"])
    expect(rows).toEqual([
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "6" },
    ])
  })

  it("strips a leading UTF-8 BOM so the first header lookup works", () => {
    // Real-world: spreadsheet exports often start with EF BB BF.
    const { headers, rows } = parseCSV("﻿Location,Tier,Bed\nDavis,2,2")
    expect(headers).toEqual(["Location", "Tier", "Bed"])
    expect(rows[0]?.Location).toBe("Davis")
  })

  it("drops trailing empty header columns", () => {
    // The user's field-design CSV ends each line with `,,` after the last
    // real column. Without trimming, headers would include "" twice.
    const { headers, rows } = parseCSV("a,b,c,,\n1,2,3,,")
    expect(headers).toEqual(["a", "b", "c"])
    expect(rows[0]).toEqual({ a: "1", b: "2", c: "3" })
  })

  it("handles quoted fields with embedded commas and escaped quotes", () => {
    const { rows } = parseCSV('a,b\n"x,y","he said ""hi"""')
    expect(rows[0]).toEqual({ a: "x,y", b: 'he said "hi"' })
  })

  it("handles CRLF line endings", () => {
    const { headers, rows } = parseCSV("a,b\r\n1,2\r\n3,4")
    expect(headers).toEqual(["a", "b"])
    expect(rows).toHaveLength(2)
  })

  it("returns empty results for empty input", () => {
    expect(parseCSV("")).toEqual({ headers: [], rows: [] })
  })

  it("trims whitespace from headers and values", () => {
    const { headers, rows } = parseCSV(" a , b \n  1 ,  2 ")
    expect(headers).toEqual(["a", "b"])
    expect(rows[0]).toEqual({ a: "1", b: "2" })
  })
})

describe("autoDetect", () => {
  it("matches case-insensitively", () => {
    expect(autoDetect(["Tier", "Bed"], ["tier"])).toBe("Tier")
  })

  it("returns the first alias that matches", () => {
    // "row" should win over "range" because it comes first.
    expect(autoDetect(["range", "row"], ["row", "range"])).toBe("row")
  })

  it("matches prefixes (e.g. 'plot' against 'plot_id')", () => {
    expect(autoDetect(["plot_id"], ["plot"])).toBe("plot_id")
  })

  it("returns empty string when nothing matches", () => {
    expect(autoDetect(["foo", "bar"], ["row", "col"])).toBe("")
  })
})

describe("remapAndSerialize", () => {
  it("renames mapped columns and preserves passthroughs", () => {
    const rows = [{ Tier: "1", Bed: "2", Crop: "Cowpea" }]
    const csv = remapAndSerialize(rows, { row: "Tier", col: "Bed" })
    expect(csv).toBe("row,col,Crop\n1,2,Cowpea")
  })

  it("quotes values containing commas, quotes, or newlines", () => {
    const rows = [{ a: "x,y", b: 'he said "hi"', c: "line\nbreak" }]
    const csv = remapAndSerialize(rows, {})
    // No mapping → all columns are passthroughs.
    expect(csv).toBe('a,b,c\n"x,y","he said ""hi""","line\nbreak"')
  })

  it("returns empty string for empty input", () => {
    expect(remapAndSerialize([], { row: "Tier" })).toBe("")
  })
})
