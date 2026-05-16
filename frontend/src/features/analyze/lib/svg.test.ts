import { describe, expect, it } from "vitest"

import { divergingColor, linearScale, sequentialColor, textOn } from "./svg"

describe("linearScale", () => {
  it("maps domain endpoints to range endpoints", () => {
    const s = linearScale({ domain: [0, 10], range: [100, 200] })
    expect(s(0)).toBe(100)
    expect(s(10)).toBe(200)
    expect(s(5)).toBe(150)
  })

  it("extrapolates past the domain", () => {
    const s = linearScale({ domain: [0, 10], range: [0, 100] })
    expect(s(-5)).toBe(-50)
    expect(s(15)).toBe(150)
  })

  it("inverts when range is reversed (SVG y-axis convention)", () => {
    const s = linearScale({ domain: [0, 10], range: [200, 100] })
    expect(s(0)).toBe(200)
    expect(s(10)).toBe(100)
  })

  it("returns the midpoint of the range for a zero-span domain", () => {
    const s = linearScale({ domain: [5, 5], range: [0, 100] })
    expect(s(5)).toBe(50)
    // Any input collapses to the midpoint because the domain is degenerate.
    expect(s(999)).toBe(50)
  })
})

describe("divergingColor", () => {
  it("returns white at zero", () => {
    expect(divergingColor(0)).toBe("rgb(255,255,255)")
  })

  it("returns the positive endpoint color at +1", () => {
    expect(divergingColor(1)).toBe("rgb(33,102,172)")
  })

  it("returns the negative endpoint color at -1", () => {
    expect(divergingColor(-1)).toBe("rgb(178,24,43)")
  })

  it("clamps values outside [-1, 1]", () => {
    expect(divergingColor(5)).toBe(divergingColor(1))
    expect(divergingColor(-5)).toBe(divergingColor(-1))
  })

  it("interpolates linearly between endpoints", () => {
    const half = divergingColor(0.5)
    const match = half.match(/rgb\((\d+),(\d+),(\d+)\)/)!
    const [r, , b] = [Number(match[1]), Number(match[2]), Number(match[3])]
    // Halfway between (255,255,255) and (33,102,172) is roughly (144, 178, 213).
    expect(r).toBeGreaterThan(120)
    expect(r).toBeLessThan(170)
    expect(b).toBeGreaterThan(190)
    expect(b).toBeLessThan(240)
  })
})

describe("sequentialColor", () => {
  it("returns the low stop at 0", () => {
    expect(sequentialColor(0)).toBe("rgb(68,1,84)")
  })

  it("returns the mid stop at 0.5", () => {
    // 0.5 is exactly at the segment boundary — should pick the mid stop.
    expect(sequentialColor(0.5)).toBe("rgb(33,144,140)")
  })

  it("returns the high stop at 1", () => {
    expect(sequentialColor(1)).toBe("rgb(253,231,37)")
  })

  it("clamps below 0 and above 1", () => {
    expect(sequentialColor(-1)).toBe(sequentialColor(0))
    expect(sequentialColor(2)).toBe(sequentialColor(1))
  })

  it("interpolates inside each segment", () => {
    // Quarter-way through the first segment is between low stop and mid stop.
    const q = sequentialColor(0.25)
    const m = q.match(/rgb\((\d+),(\d+),(\d+)\)/)!
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
    expect(r).toBeGreaterThan(40)
    expect(r).toBeLessThan(70)
    expect(g).toBeGreaterThan(60)
    expect(b).toBeGreaterThan(100)
  })
})

describe("textOn", () => {
  it("returns black on a light background", () => {
    expect(textOn("rgb(255,255,255)")).toBe("#000")
    expect(textOn("rgb(253,231,37)")).toBe("#000") // bright yellow
  })

  it("returns white on a dark background", () => {
    expect(textOn("rgb(0,0,0)")).toBe("#fff")
    expect(textOn("rgb(68,1,84)")).toBe("#fff") // viridis purple
  })

  it("returns black for malformed input (fail-safe default)", () => {
    expect(textOn("not a color")).toBe("#000")
    expect(textOn("")).toBe("#000")
  })
})
