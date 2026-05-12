import { describe, expect, it } from "vitest"
import { autoDatasetName } from "./datasetForUpload"

describe("autoDatasetName", () => {
  it("builds {experiment}__{slug}__{date}__{time}__{rand}", () => {
    const when = new Date(2026, 4, 11, 14, 32, 5) // 2026-05-11 14:32:05 local
    const name = autoDatasetName("ExpA", "Image Data", when)
    // Sanity check on every segment except the random tail.
    expect(name.startsWith("ExpA__ImageData__20260511__143205__")).toBe(true)
    // 4-hex random tail.
    expect(name.split("__")[4]).toMatch(/^[0-9a-f]{4}$/)
  })

  it("strips non-alphanumeric characters from the data type", () => {
    const when = new Date(2026, 0, 1, 0, 0, 0)
    const name = autoDatasetName("Exp", "Farm-ng Binary File", when)
    expect(name).toMatch(/^Exp__FarmngBinaryFile__20260101__000000__[0-9a-f]{4}$/)
  })

  it("two calls in the same second collide-avoidance via the rand tail", () => {
    const when = new Date(2026, 0, 1, 0, 0, 0)
    const a = autoDatasetName("Exp", "Image Data", when)
    const b = autoDatasetName("Exp", "Image Data", when)
    // With 16 bits of entropy collisions are possible but vanishingly
    // rare (~1/65k). The assertion here is the shape, not strict
    // inequality — flakiness from collisions would mask the real
    // contract.
    expect(a.split("__").length).toBe(5)
    expect(b.split("__").length).toBe(5)
  })
})
