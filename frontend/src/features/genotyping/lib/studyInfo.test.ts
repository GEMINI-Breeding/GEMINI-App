import { describe, expect, it } from "vitest"

import { sizeLine, studyFacts } from "./studyInfo"

describe("study facts", () => {
  it("reads markers, samples, file and source; keeps the rest as notes", () => {
    const f = studyFacts({
      by: "agent",
      source_file: "magic.hmp",
      n_variants: 32130,
      n_samples: 313,
      panel: "MAGIC",
      nested: { a: 1 },
    })
    expect(f).toMatchObject({
      markers: 32130,
      samples: 313,
      sourceFile: "magic.hmp",
      byAgent: true,
      mock: false,
    })
    expect(f.notes).toEqual([["Panel", "MAGIC"]])
    expect(sizeLine(f)).toBe("32,130 markers · 313 samples")
  })

  it("copes with nothing, a plain string, and a mock flag", () => {
    expect(sizeLine(studyFacts(null))).toBe("")
    expect(studyFacts("from the 2023 panel").notes).toEqual([
      ["Note", "from the 2023 panel"],
    ])
    expect(studyFacts({ mock: true }).mock).toBe(true)
  })
})
