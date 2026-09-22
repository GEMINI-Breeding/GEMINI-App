import { describe, expect, it } from "vitest"

import {
  isBatchInferenceResult,
  summaryCsv,
  summaryRows,
} from "./inferenceSummary"

describe("inferenceSummary", () => {
  it("recognises a batch result and rejects a single-image one", () => {
    expect(isBatchInferenceResult({ counts_by_plot: {} })).toBe(true)
    expect(isBatchInferenceResult({ total_detections: 3 })).toBe(false)
    expect(isBatchInferenceResult(null)).toBe(false)
  })

  it("orders plots numerically, so 10 follows 9", () => {
    const rows = summaryRows({ counts_by_plot: { "10": 1, "9": 2, "1": 3 } })
    expect(rows.map((r) => r.plot)).toEqual(["1", "9", "10"])
  })

  it("keeps an errored plot as null, never 0", () => {
    const rows = summaryRows({
      counts_by_plot: { "1": 0 },
      errors: { "2": "boom" },
    })
    expect(rows).toEqual([
      { plot: "1", count: 0, error: null },
      { plot: "2", count: null, error: "boom" },
    ])
  })

  it("writes CSV with an empty count for errored plots and quoted errors", () => {
    const csv = summaryCsv({
      counts_by_plot: { "1": 4 },
      errors: { "2": 'bad "key", retry' },
    })
    expect(csv).toBe('plot,detections,error\n1,4,\n2,,"bad ""key"", retry"\n')
  })
})
