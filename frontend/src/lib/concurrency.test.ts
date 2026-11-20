import { describe, expect, it, vi } from "vitest"

import { runWithConcurrency } from "./concurrency"

describe("runWithConcurrency", () => {
  it("returns [] for an empty task list", async () => {
    const out = await runWithConcurrency([], 4)
    expect(out).toEqual([])
  })

  it("preserves order across in-flight tasks", async () => {
    const tasks = [
      () =>
        new Promise<string>((res) => {
          setTimeout(() => res("a"), 30)
        }),
      () =>
        new Promise<string>((res) => {
          setTimeout(() => res("b"), 10)
        }),
      () => Promise.resolve("c"),
    ]
    const out = await runWithConcurrency(tasks, 4)
    // Even though "b" finishes first, results come back in input order.
    expect(out).toEqual(["a", "b", "c"])
  })

  it("respects the concurrency limit", async () => {
    let inFlight = 0
    let peak = 0
    const tasks: Array<() => Promise<number>> = []
    for (let i = 0; i < 12; i++) {
      tasks.push(async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((res) => {
          setTimeout(res, 5)
        })
        inFlight--
        return i
      })
    }
    await runWithConcurrency(tasks, 3)
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(0)
  })

  it("rejects with the first observed error", async () => {
    const ok = vi.fn(() => Promise.resolve(1))
    const fail = () => Promise.reject(new Error("boom"))
    await expect(runWithConcurrency([ok, fail, ok], 2)).rejects.toThrow("boom")
  })
})
