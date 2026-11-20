import { beforeEach, describe, expect, it, vi } from "vitest"

describe("copyTracker", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it("keeps copies across a reload and announces each ending once", async () => {
    const { copyTracker } = await import("./copyTracker")
    copyTracker.add([
      { id: "41234", date: "2023-08-03", source: "box:/K/2023" },
    ])
    expect(copyTracker.finish("41234", { state: "COMPLETED" })).toBe(true)
    expect(copyTracker.finish("41234", { state: "COMPLETED" })).toBe(false)

    vi.resetModules() // a reload: read back from storage
    const again = (await import("./copyTracker")).copyTracker
    expect(again.list()).toMatchObject([
      { id: "41234", date: "2023-08-03", final: { state: "COMPLETED" } },
    ])
    again.remove("41234")
    expect(again.list()).toEqual([])
  })

  it("forgets copies older than two days", async () => {
    localStorage.setItem(
      "gemini.copies.v1",
      JSON.stringify([
        { id: "1", date: "d", started: Date.now() - 3 * 86400_000 },
      ]),
    )
    const { copyTracker } = await import("./copyTracker")
    expect(copyTracker.list()).toEqual([])
  })
})
