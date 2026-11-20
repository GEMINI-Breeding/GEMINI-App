import { describe, expect, it } from "vitest"
import { narrowOptions, scopeChoices } from "./scopeCombos"

const combos = [
  { season: "2026", site: "Coachella", population: "Lima" },
  { season: "2026", site: "Riverside", population: "Cowpea" },
  { season: "2026", site: "Davis", population: "Sorghum" },
  { season: "2023", site: "Davis", population: "Mixed" },
]

describe("scopeChoices", () => {
  it("lists only populations grown at the picked site and season", () => {
    const c = scopeChoices(combos, { season: "2026", site: "Riverside" })
    expect([...(c.populations ?? [])]).toEqual(["Cowpea"])
    expect([...(c.sites ?? [])].sort()).toEqual([
      "Coachella",
      "Davis",
      "Riverside",
    ])
    expect([...(c.seasons ?? [])]).toEqual(["2026"])
  })

  it("lists everything when nothing is known", () => {
    expect(scopeChoices([], { site: "Riverside" }).populations).toBeNull()
  })
})

describe("narrowOptions", () => {
  const opts = [
    { id: "1", name: "Lima" },
    { id: "2", name: "Cowpea" },
  ]
  it("keeps the current pick and the allowed ones", () => {
    expect(narrowOptions(opts, new Set(["Cowpea"]), "1")).toEqual(opts)
    expect(narrowOptions(opts, new Set(["Cowpea"]), null)).toEqual([opts[1]])
  })
  it("falls back to all when none would be left", () => {
    expect(narrowOptions(opts, new Set(["Sorghum"]), null)).toEqual(opts)
  })
})
