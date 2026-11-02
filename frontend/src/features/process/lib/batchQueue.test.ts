import { describe, expect, it } from "vitest"
import { nextActions, type QueuedStep } from "./batchQueue"

const step = (id: string, over: Partial<QueuedStep> = {}): QueuedStep => ({
  id,
  batchId: "b",
  runId: "r",
  date: "2026-08-10",
  population: "Sorghum",
  step: "inference",
  options: { plotSource: "ortho", model: null, sources: ["ortho"] },
  after: [],
  status: "waiting",
  jobIds: [],
  createdAt: new Date().toISOString(),
  ...over,
})

describe("working through a batch", () => {
  const plots = step("p", {
    step: "plot_images",
    status: "started",
    jobIds: ["j1", "j2"],
  })
  it("starts a step once everything it waits on has finished", () => {
    const inf = step("i", { after: ["p"] })
    expect(nextActions([plots, inf], () => "RUNNING").start).toEqual([])
    const done = nextActions([plots, inf], () => "COMPLETED")
    expect(done.start.map((x) => x.id)).toEqual(["i"])
  })
  it("gives up when what it waits on failed", () => {
    const inf = step("i", { after: ["p"] })
    const r = nextActions([plots, inf], (j) =>
      j === "j2" ? "FAILED" : "COMPLETED",
    )
    expect(r.start).toEqual([])
    expect(r.fail[0].reason).toBe("plot images failed")
  })
  it("waits behind a step that hasn't started yet", () => {
    const quick = step("q", {
      step: "quick_ortho",
      status: "started",
      jobIds: ["a"],
    })
    const frames = step("f", { step: "plot_images", after: ["q"] })
    const inf = step("i", { after: ["f"] })
    const r = nextActions([quick, frames, inf], () => "COMPLETED")
    expect(r.start.map((x) => x.id)).toEqual(["f"])
  })
})
