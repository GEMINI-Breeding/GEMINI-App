import { describe, expect, it } from "vitest"

import { cellInfo, cellTooltipHtml } from "./cellTooltip"

describe("cell tooltip", () => {
  it("shows a design-labelled cell's plot, entry, tier/bed and crop", () => {
    const p = {
      plot: "501",
      accession: "NE-80-21-74",
      row: "2",
      col: "2",
      crop: "Common bean / tepary",
      rep: "1",
      Block: "1",
      _grid_row: 1,
      _grid_col: 1,
      block: "Block 1",
    }
    expect(cellInfo(p)).toMatchObject({
      plot: "501",
      row: "2",
      col: "2",
      block: "1",
      grid: "1, 1",
    })
    const html = cellTooltipHtml(p) ?? ""
    expect(html).toContain("<b>Plot 501</b> · NE-80-21-74")
    expect(html).toContain("tier 2, bed 2")
    expect(html).toContain("Common bean / tepary · rep 1 · block 1")
    expect(html).toContain("grid cell 1, 1")
  })
  it("takes the agent's labels and escapes values", () => {
    const html =
      cellTooltipHtml({
        plot_label: "12",
        accession: "<x>",
        row: 3,
        col: 4,
        block: "Block 2",
      }) ?? ""
    expect(html).toContain("Plot 12")
    expect(html).toContain("&lt;x&gt;")
    expect(html).not.toContain("block Block 2")
  })
  it("leaves the grid position out when it is the design's", () => {
    expect(
      cellInfo({
        plot: "1",
        row: "1",
        col: "1",
        _grid_row: "1",
        _grid_col: "1",
      }).grid,
    ).toBeNull()
  })
  it("has nothing to show for an unlabelled cell", () => {
    expect(cellTooltipHtml({ cellId: "c1" })).toBeNull()
  })
})
