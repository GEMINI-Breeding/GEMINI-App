import { describe, expect, it } from "vitest"

import {
  buildAnovaVerdict,
  buildManovaVerdict,
  effectSizeLevel,
  etaShadeClass,
  pChipClass,
  pChipClassFromLevel,
  prettyTerm,
  pSigLevel,
  pStars,
} from "./significance"

describe("pSigLevel", () => {
  it("classifies p-values into the standard breakpoints", () => {
    expect(pSigLevel(0.0001)).toBe("highly")
    expect(pSigLevel(0.001)).toBe("very") // boundary: 0.001 is *not* < 0.001
    expect(pSigLevel(0.005)).toBe("very")
    expect(pSigLevel(0.03)).toBe("sig")
    expect(pSigLevel(0.08)).toBe("marginal")
    expect(pSigLevel(0.5)).toBe("ns")
  })

  it("treats null / NaN / undefined as 'na'", () => {
    expect(pSigLevel(null)).toBe("na")
    expect(pSigLevel(undefined)).toBe("na")
    expect(pSigLevel(Number.NaN)).toBe("na")
  })
})

describe("pStars", () => {
  it("maps significance to the conventional star strings", () => {
    expect(pStars(0.0005)).toBe("***")
    expect(pStars(0.005)).toBe("**")
    expect(pStars(0.03)).toBe("*")
    expect(pStars(0.08)).toBe(".")
    expect(pStars(0.5)).toBe("")
    expect(pStars(null)).toBe("")
  })
})

describe("pChipClass / pChipClassFromLevel", () => {
  it("returns a non-empty Tailwind class for every level", () => {
    const cls = pChipClass(0.0001)
    expect(cls).toContain("emerald")
    expect(pChipClass(0.5)).toContain("slate")
    expect(pChipClass(null)).toContain("muted")
  })

  it("derives the same class from the level directly", () => {
    expect(pChipClassFromLevel("highly")).toBe(pChipClass(0.0001))
    expect(pChipClassFromLevel("ns")).toBe(pChipClass(0.5))
    expect(pChipClassFromLevel("na")).toBe(pChipClass(null))
  })
})

describe("effectSizeLevel (Cohen thresholds)", () => {
  it("classifies η² using 0.01 / 0.06 / 0.14 breakpoints", () => {
    expect(effectSizeLevel(0.005)).toBe("trivial")
    expect(effectSizeLevel(0.01)).toBe("small") // boundary
    expect(effectSizeLevel(0.05)).toBe("small")
    expect(effectSizeLevel(0.06)).toBe("medium") // boundary
    expect(effectSizeLevel(0.1)).toBe("medium")
    expect(effectSizeLevel(0.14)).toBe("large") // boundary
    expect(effectSizeLevel(0.5)).toBe("large")
  })

  it("treats null / NaN as 'na'", () => {
    expect(effectSizeLevel(null)).toBe("na")
    expect(effectSizeLevel(Number.NaN)).toBe("na")
  })
})

describe("etaShadeClass", () => {
  it("returns an empty string for trivial and na", () => {
    expect(etaShadeClass(0.001)).toBe("")
    expect(etaShadeClass(null)).toBe("")
  })

  it("scales sky-* intensity with effect size", () => {
    expect(etaShadeClass(0.03)).toContain("sky-50")
    expect(etaShadeClass(0.1)).toContain("sky-100")
    expect(etaShadeClass(0.3)).toContain("sky-200")
  })
})

describe("prettyTerm", () => {
  it("translates known statsmodels term names", () => {
    expect(prettyTerm("C(accession_name)")).toBe("Accession")
    expect(prettyTerm("C(_env)")).toBe("Env")
    expect(prettyTerm("C(accession_name):C(_env)")).toBe("Accession × Env")
    expect(prettyTerm("Residual")).toBe("Residual")
  })

  it("strips C(...) wrappers and colons from unknown terms", () => {
    expect(prettyTerm("C(foo):C(bar)")).toBe("foo × bar")
  })
})

describe("buildAnovaVerdict", () => {
  it("skips the residual row and builds a chip per remaining term", () => {
    const chips = buildAnovaVerdict([
      { term: "C(accession_name)", p: 0.0001, eta_sq: 0.42 },
      { term: "C(_env)", p: 0.03, eta_sq: 0.08 },
      { term: "C(accession_name):C(_env)", p: 0.6, eta_sq: 0.01 },
      { term: "Residual", p: null, eta_sq: 0.49 },
    ])
    expect(chips.map((c) => c.term)).toEqual([
      "C(accession_name)",
      "C(_env)",
      "C(accession_name):C(_env)",
    ])
    expect(chips[0]).toMatchObject({
      label: "Accession",
      stars: "***",
      sigLevel: "highly",
      effect: "large",
      effectKind: "eta",
    })
    expect(chips[1]).toMatchObject({
      label: "Env",
      stars: "*",
      effect: "medium",
    })
    expect(chips[2]).toMatchObject({ sigLevel: "ns", effect: "small" })
  })

  it("handles missing p and eta_sq gracefully", () => {
    const chips = buildAnovaVerdict([
      { term: "C(accession_name)", p: null, eta_sq: null },
    ])
    expect(chips[0]).toMatchObject({
      sigLevel: "na",
      effect: "na",
      stars: "",
      effectKind: null,
      effectValue: null,
    })
  })
})

describe("buildManovaVerdict", () => {
  it("uses Pillai's trace per term and labels with prettyTerm", () => {
    const chips = buildManovaVerdict({
      "C(accession_name)": [
        { name: "Wilks' lambda", value: 0.2, p: 0.0001 },
        { name: "Pillai's trace", value: 0.8, p: 0.0002 },
      ],
      "C(_env)": [{ name: "Pillai's trace", value: 0.05, p: 0.3 }],
    })
    expect(chips).toHaveLength(2)
    expect(chips[0]).toMatchObject({
      label: "Accession",
      effectKind: "pillai",
      effectValue: 0.8,
      sigLevel: "highly",
    })
    expect(chips[1]).toMatchObject({ label: "Env", sigLevel: "ns" })
  })

  it("falls back to the first listed stat when no Pillai row is present", () => {
    const chips = buildManovaVerdict({
      "C(accession_name)": [{ name: "Wilks' lambda", value: 0.2, p: 0.01 }],
    })
    expect(chips[0].effectValue).toBe(0.2)
  })

  it("skips terms with no stats", () => {
    const chips = buildManovaVerdict({ "C(accession_name)": [] })
    expect(chips).toHaveLength(0)
  })
})
