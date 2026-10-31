import { describe, expect, it } from "vitest"

import { rankCandidates, sameTrial } from "./BoundaryImportPicker"

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

describe("sameTrial", () => {
  const here =
    "Processed/2023/Interspecific Kearney/Kearney/Interspecific/2023-08-03/Drone/RGB/"
  it("matches the experiment, site and population, whatever the date, season or sensor", () => {
    expect(
      sameTrial(
        "Processed/2022/Interspecific Kearney/Kearney/Interspecific/2022-07-05/Drone/RGB-SonyA7R/",
        here,
      ),
    ).toBe(true)
    expect(
      sameTrial(
        "Processed/2023/Interspecific Kearney/Kearney/Common bean/2023-08-03/Drone/RGB/",
        here,
      ),
    ).toBe(false)
    expect(
      sameTrial(
        "Processed/2023/GEMINI-26/Kearney/Interspecific/2023-08-03/Drone/RGB/",
        here,
      ),
    ).toBe(false)
  })
})
