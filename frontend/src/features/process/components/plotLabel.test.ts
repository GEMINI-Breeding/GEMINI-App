import { describe, expect, it } from "vitest"

import { byPlotNumber, plotLabel } from "./InferenceJobView"

describe("plot labels in inference results", () => {
  it("names plots from older file-name keys", () => {
    expect(plotLabel("plot_KD18_accession_BTx623.png")).toBe("KD18")
    expect(plotLabel("plot_7.png")).toBe("7")
    expect(plotLabel("512")).toBe("512")
  })

  it("orders numbers within a prefix", () => {
    const keys = ["KW10", "KD2", "KW1", "KD10", "KD1", "10", "9"]
    expect([...keys].sort(byPlotNumber)).toEqual([
      "9",
      "10",
      "KD1",
      "KD2",
      "KD10",
      "KW1",
      "KW10",
    ])
  })
})
