import { describe, expect, it } from "vitest"

import { adviseRestitch } from "./stitchAdvice"

describe("adviseRestitch", () => {
  it("halves forward_limit for a plot that wrote no mosaic", () => {
    const a = adviseRestitch(["AgRowStitch finished but wrote no mosaic"], {
      forward_limit: 8,
    })
    expect(a.settings).toEqual({ forward_limit: 4 })
    expect(a.thenTry.length).toBeGreaterThan(0)
  })
  it("loosens matching once forward_limit is already 1", () => {
    const a = adviseRestitch(["no match"], {
      forward_limit: 1,
      min_inliers: 20,
      max_reprojection_error: 1,
    })
    expect(a.settings).toEqual({ min_inliers: 12, max_reprojection_error: 2 })
  })
  it("shrinks batches when memory ran out", () => {
    const a = adviseRestitch(["MemoryError"], { batch_size: 10 })
    expect(a.settings).toEqual({ batch_size: 5 })
  })
  it("uses the defaults when the manifest has no config", () => {
    expect(adviseRestitch(["failed"]).settings).toEqual({ forward_limit: 2 })
  })
})
