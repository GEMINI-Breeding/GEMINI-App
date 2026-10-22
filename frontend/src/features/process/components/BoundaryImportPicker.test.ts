import { describe, expect, it } from "vitest"

import { rankCandidates } from "./BoundaryImportPicker"

const dir = (season: string, site: string, pop: string, date: string) =>
  `Processed/${season}/GEMINI/${site}/${pop}/${date}/Drone/RGB/`

describe("rankCandidates", () => {
  it("puts the same field and season first, nearest date first", () => {
    const current = dir("2023", "Davis", "Mixed", "2023-07-07")
    const rows = [
      { directory: dir("2026", "Davis", "Sorghum", "2026-08-21"), version: 1 },
      { directory: dir("2023", "Davis", "Mixed", "2023-06-13"), version: 1 },
      { directory: dir("2023", "Kearney", "Mixed", "2023-07-13"), version: 2 },
      { directory: dir("2023", "Davis", "Mixed", "2023-06-27"), version: 3 },
    ]
    expect(rankCandidates(rows, current).map((r) => r.directory)).toEqual([
      dir("2023", "Davis", "Mixed", "2023-06-27"),
      dir("2023", "Davis", "Mixed", "2023-06-13"),
      dir("2023", "Kearney", "Mixed", "2023-07-13"),
      dir("2026", "Davis", "Sorghum", "2026-08-21"),
    ])
  })
})
