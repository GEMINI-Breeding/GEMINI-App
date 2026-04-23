import { describe, expect, it } from "vitest"
import {
  COL_KEY_SET,
  POSITION_KEY_SET,
  PLOT_FILTER_FIELDS,
  ROW_KEY_SET,
  deduplicateKeys,
  lookupProperty,
  matchesTextFilter,
  orderColumns,
} from "./traitAliases"

describe("alias key sets", () => {
  it("COL_KEY_SET contains the known column aliases", () => {
    expect(COL_KEY_SET.has("col")).toBe(true)
    expect(COL_KEY_SET.has("column")).toBe(true)
    expect(COL_KEY_SET.has("bed")).toBe(true)
  })

  it("ROW_KEY_SET contains the known row aliases", () => {
    expect(ROW_KEY_SET.has("row")).toBe(true)
    expect(ROW_KEY_SET.has("tier")).toBe(true)
  })

  it("POSITION_KEY_SET is the union of column + row aliases", () => {
    for (const k of COL_KEY_SET) expect(POSITION_KEY_SET.has(k)).toBe(true)
    for (const k of ROW_KEY_SET) expect(POSITION_KEY_SET.has(k)).toBe(true)
    expect(POSITION_KEY_SET.size).toBe(COL_KEY_SET.size + ROW_KEY_SET.size)
  })

  it("PLOT_FILTER_FIELDS exposes the expected filter keys", () => {
    expect(PLOT_FILTER_FIELDS).toEqual([
      "col",
      "row",
      "plot",
      "accession",
      "location",
      "crop",
      "rep",
    ])
  })
})

describe("deduplicateKeys", () => {
  it("returns the input unchanged when there are no duplicates or aliases", () => {
    expect(deduplicateKeys(["plot", "accession", "yield"])).toEqual([
      "plot",
      "accession",
      "yield",
    ])
  })

  it("is case-insensitive: keeps the first occurrence and drops later variants", () => {
    expect(deduplicateKeys(["Plot", "PLOT", "plot"])).toEqual(["Plot"])
  })

  it("collapses COL aliases (col/COLUMN/bed) to a single entry, keeping first", () => {
    expect(deduplicateKeys(["col", "COLUMN", "bed"])).toEqual(["col"])
    expect(deduplicateKeys(["bed", "col"])).toEqual(["bed"])
  })

  it("collapses ROW aliases (row/tier) to a single entry, keeping first", () => {
    expect(deduplicateKeys(["tier", "Row"])).toEqual(["tier"])
  })

  it("treats COL and ROW groups independently", () => {
    expect(deduplicateKeys(["col", "row", "COLUMN", "tier"])).toEqual(["col", "row"])
  })

  it("preserves ordering of non-alias keys interleaved with aliases", () => {
    expect(
      deduplicateKeys(["plot", "col", "yield", "COLUMN", "row", "tier", "bed"]),
    ).toEqual(["plot", "col", "yield", "row"])
  })
})

describe("orderColumns", () => {
  it("puts col then row first, then metadata, then numeric traits", () => {
    const out = orderColumns(
      ["yield", "plot", "col", "row", "location"],
      ["plot", "location", "col", "row"],
      ["yield"],
    )
    expect(out).toEqual(["col", "row", "plot", "location", "yield"])
  })

  it("works when only col (no row) is present", () => {
    const out = orderColumns(["col", "plot", "yield"], ["plot", "col"], ["yield"])
    expect(out).toEqual(["col", "plot", "yield"])
  })

  it("works when neither col nor row is present", () => {
    const out = orderColumns(["plot", "yield"], ["plot"], ["yield"])
    expect(out).toEqual(["plot", "yield"])
  })

  it("excludes keys that are not members of the dedup'd allKeys list", () => {
    // metaCols / numCols may be stale — orderColumns should intersect with allKeys
    const out = orderColumns(["plot", "yield"], ["plot", "stale"], ["yield", "also_stale"])
    expect(out).toEqual(["plot", "yield"])
  })

  it("filters out empty-string entries from the final list", () => {
    const out = orderColumns(["", "plot", "yield"], ["", "plot"], ["yield"])
    expect(out).toEqual(["plot", "yield"])
  })

  it("keeps the first alias variant when multiple COL aliases are present", () => {
    const out = orderColumns(
      ["bed", "col", "COLUMN", "yield"],
      ["bed", "col", "COLUMN"],
      ["yield"],
    )
    // deduped has only "bed" as the column-alias representative
    expect(out[0]).toBe("bed")
    expect(out).toContain("yield")
    // Later alias variants are gone
    expect(out).not.toContain("col")
    expect(out).not.toContain("COLUMN")
  })
})

describe("lookupProperty", () => {
  it("returns the direct-hit value when the key is present verbatim", () => {
    expect(lookupProperty({ plot: "A", yield: 10 }, "plot")).toBe("A")
  })

  it("returns undefined for an unknown non-alias key", () => {
    expect(lookupProperty({ plot: "A" }, "missing")).toBeUndefined()
  })

  it("falls back to COL alias variants (uppercase, capitalized, other aliases)", () => {
    expect(lookupProperty({ COL: 3 }, "col")).toBe(3)
    expect(lookupProperty({ Col: 4 }, "col")).toBe(4)
    expect(lookupProperty({ Column: 5 }, "col")).toBe(5)
    expect(lookupProperty({ bed: 6 }, "col")).toBe(6)
    expect(lookupProperty({ BED: 7 }, "col")).toBe(7)
  })

  it("falls back to ROW alias variants", () => {
    expect(lookupProperty({ ROW: 1 }, "row")).toBe(1)
    expect(lookupProperty({ tier: 2 }, "row")).toBe(2)
    expect(lookupProperty({ Tier: 3 }, "row")).toBe(3)
  })

  it("does not walk alias chains for non-positional keys", () => {
    expect(lookupProperty({ plot_id: "P1" }, "plot")).toBeUndefined()
  })
})

describe("matchesTextFilter", () => {
  it("returns true for a blank filter value regardless of the property", () => {
    expect(matchesTextFilter({ plot: "A" }, "plot", "")).toBe(true)
    expect(matchesTextFilter({}, "plot", "   ")).toBe(true)
  })

  it("matches a substring, case-insensitively", () => {
    expect(matchesTextFilter({ plot: "Plot-42A" }, "plot", "42a")).toBe(true)
    expect(matchesTextFilter({ plot: "Plot-42A" }, "plot", "99")).toBe(false)
  })

  it("also checks the UPPER and Title variants of the key", () => {
    expect(matchesTextFilter({ PLOT: "X" }, "plot", "x")).toBe(true)
    expect(matchesTextFilter({ Plot: "X" }, "plot", "x")).toBe(true)
  })

  it("uses plot_id as a fallback when key is 'plot'", () => {
    expect(matchesTextFilter({ plot_id: "P-1" }, "plot", "p-1")).toBe(true)
  })

  it("walks COL aliases when filtering by 'col'", () => {
    expect(matchesTextFilter({ bed: "7" }, "col", "7")).toBe(true)
    expect(matchesTextFilter({ COLUMN: "8" }, "col", "8")).toBe(true)
  })

  it("walks ROW aliases when filtering by 'row'", () => {
    expect(matchesTextFilter({ tier: "3" }, "row", "3")).toBe(true)
  })

  it("ignores null/undefined candidate values and keeps scanning", () => {
    expect(
      matchesTextFilter({ plot: null, plot_id: "P1" }, "plot", "p1"),
    ).toBe(true)
  })

  it("returns false when nothing matches", () => {
    expect(matchesTextFilter({ plot: "A" }, "plot", "zzz")).toBe(false)
  })
})
