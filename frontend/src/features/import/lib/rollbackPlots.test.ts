import { describe, expect, it, vi } from "vitest"

import type { PlotSpec } from "./recordBuilder"
import { type PlotsApi, rollbackCreatedPlots } from "./rollbackPlots"

function spec(
  p: number,
  row = 0,
  col = 0,
  season = "S1",
  site = "Site1",
): PlotSpec {
  return {
    plotNumber: p,
    plotRow: row,
    plotCol: col,
    season,
    site,
  }
}

describe("rollbackCreatedPlots", () => {
  it("resolves each plot key and deletes the matching plot", async () => {
    const deleted: string[] = []
    const api: PlotsApi = {
      apiPlotsGetPlots: vi.fn(async (q) => [{ id: `id-${q.plotNumber}` }]),
      apiPlotsIdPlotIdDeletePlot: vi.fn(async ({ plotId }) => {
        deleted.push(plotId)
      }),
    }
    const res = await rollbackCreatedPlots(api, "Exp", [
      spec(1),
      spec(2),
      spec(3),
    ])
    expect(res).toEqual({ deleted: 3, failed: 0 })
    expect(deleted.sort()).toEqual(["id-1", "id-2", "id-3"])
  })

  it("dedupes repeated plot keys so each plot is deleted once", async () => {
    const api: PlotsApi = {
      apiPlotsGetPlots: vi.fn(async (q) => [{ id: `id-${q.plotNumber}` }]),
      apiPlotsIdPlotIdDeletePlot: vi.fn(async () => {}),
    }
    // Same plot key three times (one plot backing three trait records).
    const res = await rollbackCreatedPlots(api, "Exp", [
      spec(7),
      spec(7),
      spec(7),
    ])
    expect(res.deleted).toBe(1)
    expect(api.apiPlotsIdPlotIdDeletePlot).toHaveBeenCalledTimes(1)
  })

  it("counts a missing plot as neither deleted nor failed", async () => {
    const api: PlotsApi = {
      apiPlotsGetPlots: vi.fn(async () => []), // already gone
      apiPlotsIdPlotIdDeletePlot: vi.fn(async () => {}),
    }
    const res = await rollbackCreatedPlots(api, "Exp", [spec(1)])
    expect(res).toEqual({ deleted: 0, failed: 0 })
    expect(api.apiPlotsIdPlotIdDeletePlot).not.toHaveBeenCalled()
  })

  it("swallows delete errors and reports them as failures", async () => {
    const api: PlotsApi = {
      apiPlotsGetPlots: vi.fn(async (q) => [{ id: `id-${q.plotNumber}` }]),
      apiPlotsIdPlotIdDeletePlot: vi.fn(async () => {
        throw new Error("boom")
      }),
    }
    const res = await rollbackCreatedPlots(api, "Exp", [spec(1), spec(2)])
    expect(res).toEqual({ deleted: 0, failed: 2 })
  })

  it("stops issuing work once aborted", async () => {
    const signal = { aborted: false }
    let calls = 0
    const api: PlotsApi = {
      apiPlotsGetPlots: vi.fn(async (q) => {
        calls++
        signal.aborted = true // abort after the first lookup
        return [{ id: `id-${q.plotNumber}` }]
      }),
      apiPlotsIdPlotIdDeletePlot: vi.fn(async () => {}),
    }
    const res = await rollbackCreatedPlots(
      api,
      "Exp",
      [spec(1), spec(2), spec(3), spec(4)],
      { concurrency: 1, signal },
    )
    // First lookup ran; deletion of it is skipped because aborted flipped
    // mid-flight, and no further specs are processed.
    expect(calls).toBe(1)
    expect(res.deleted).toBe(0)
  })
})
