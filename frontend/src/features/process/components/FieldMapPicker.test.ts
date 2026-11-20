import { describe, expect, it } from "vitest"

import { plotsFromMap } from "./FieldMapPicker"

describe("plotsFromMap", () => {
  // A map: title row, then tiers down the sheet, beds across (B = border).
  const grid = [
    ["Field map", "", "", ""],
    ["", "B", "B", "B"],
    ["", "501", "502", "B"],
    ["", "503", "", "504"],
  ]
  it("numbers tiers and beds from the first corner, skipping border and empty", () => {
    expect(
      plotsFromMap(grid, { r: 2, c: 1 }, { r: 3, c: 3 }, 2, 10, true),
    ).toEqual([
      { plot: "501", row: 2, col: 10 },
      { plot: "502", row: 2, col: 11 },
      { plot: "503", row: 3, col: 10 },
      { plot: "504", row: 3, col: 12 },
    ])
  })
  it("counts from whichever corner was clicked first, and can run tiers across", () => {
    const out = plotsFromMap(grid, { r: 3, c: 3 }, { r: 2, c: 1 }, 1, 1, false)
    expect(out[0]).toEqual({ plot: "504", row: 1, col: 1 })
    expect(out.find((p) => p.plot === "501")).toEqual({
      plot: "501",
      row: 3,
      col: 2,
    })
  })
})
