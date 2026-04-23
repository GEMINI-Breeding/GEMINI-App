import { describe, expect, it } from "vitest"
import { buildColorScale, legendGradient } from "./colorScale"

describe("buildColorScale", () => {
  it("returns min/max from the input values", () => {
    const { min, max } = buildColorScale([3, 1, 4, 1, 5, 9, 2, 6], "trait")
    expect(min).toBe(1)
    expect(max).toBe(9)
  })

  it("maps the minimum value to the low end of the ramp (#440154 → [68,1,84,210])", () => {
    const { colorFn } = buildColorScale([10, 20, 30], "trait")
    const [r, g, b, a] = colorFn(10)
    expect([r, g, b]).toEqual([68, 1, 84])
    expect(a).toBe(210)
  })

  it("maps the maximum value to the high end of the ramp (#fde725 → [253,231,37,210])", () => {
    const { colorFn } = buildColorScale([10, 20, 30], "trait")
    const [r, g, b, a] = colorFn(30)
    expect([r, g, b]).toEqual([253, 231, 37])
    expect(a).toBe(210)
  })

  it("returns a neutral grey [128,128,128,80] for null/undefined/NaN", () => {
    const { colorFn } = buildColorScale([1, 2, 3], "trait")
    expect(colorFn(null)).toEqual([128, 128, 128, 80])
    expect(colorFn(undefined)).toEqual([128, 128, 128, 80])
    expect(colorFn(Number.NaN)).toEqual([128, 128, 128, 80])
  })

  it("clamps values outside the dataset range to the endpoint colors", () => {
    const { colorFn } = buildColorScale([10, 20, 30], "trait")
    // below min → low end
    expect(colorFn(-999)).toEqual([68, 1, 84, 210])
    // above max → high end
    expect(colorFn(9999)).toEqual([253, 231, 37, 210])
  })

  it("handles the empty-input case without throwing and returns fallback min/max", () => {
    const { colorFn, min, max } = buildColorScale([], "trait")
    expect(min).toBe(0)
    expect(max).toBe(1)
    // any real value maps to a color (mid of the ramp since rank is 0.5)
    const [, , , a] = colorFn(0)
    expect(a).toBe(210)
  })

  it("handles a single-value dataset without division-by-zero", () => {
    const { colorFn } = buildColorScale([42], "trait")
    const [r, g, b, a] = colorFn(42)
    // With n=1 the denominator becomes 1, rank is 0 → low end
    expect([r, g, b]).toEqual([68, 1, 84])
    expect(a).toBe(210)
  })

  it("produces monotonically non-decreasing colors as the input value rises", () => {
    // Quantile ranks should be non-decreasing with value, so the first channel
    // (viridis starts dark, ends bright) should not *decrease* when we go up.
    const data = Array.from({ length: 50 }, (_, i) => i)
    const { colorFn } = buildColorScale(data, "trait")
    let prev = -Infinity
    for (let v = 0; v < 50; v += 5) {
      const [, g] = colorFn(v)
      // g climbs monotonically across the viridis ramp we use
      expect(g).toBeGreaterThanOrEqual(prev)
      prev = g
    }
  })
})

describe("legendGradient", () => {
  it("returns a CSS linear-gradient string with the viridis stops", () => {
    const css = legendGradient("trait")
    expect(css.startsWith("linear-gradient(to right, ")).toBe(true)
    expect(css).toContain("#440154")
    expect(css).toContain("#3b528b")
    expect(css).toContain("#21918c")
    expect(css).toContain("#5ec962")
    expect(css).toContain("#fde725")
  })

  it("ignores the column argument (stable gradient for any column)", () => {
    expect(legendGradient("a")).toBe(legendGradient("b"))
  })
})
