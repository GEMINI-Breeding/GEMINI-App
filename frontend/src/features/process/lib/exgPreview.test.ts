import { describe, expect, it } from "vitest"
import { exgMask, tintVegetation, vegetationFraction } from "./exgPreview"

function image(w: number, h: number, px: (x: number, y: number) => number[]) {
  const a = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) a.set(px(x, y), (y * w + x) * 4)
  return a
}

describe("exgMask", () => {
  it("green is vegetation, soil and red are not (as the worker)", () => {
    const green = image(10, 10, () => [20, 200, 20, 255])
    const soil = image(10, 10, () => [120, 110, 100, 255])
    const red = image(10, 10, () => [220, 20, 20, 255])
    expect(vegetationFraction(exgMask(green, 10, 10, 0.1))).toBe(1)
    expect(vegetationFraction(exgMask(soil, 10, 10, 0.1))).toBe(0)
    expect(vegetationFraction(exgMask(red, 10, 10, 0.1))).toBe(0)
  })

  it("the threshold decides borderline pixels", () => {
    // ExG = (2·120 − 100 − 90) / 310 ≈ 0.161
    const pale = image(10, 10, () => [100, 120, 90, 255])
    expect(vegetationFraction(exgMask(pale, 10, 10, 0.1))).toBe(1)
    expect(vegetationFraction(exgMask(pale, 10, 10, 0.2))).toBe(0)
  })

  it("closing fills a one-pixel gap inside a canopy", () => {
    const holed = image(20, 20, (x, y) =>
      x === 10 && y === 10 ? [120, 110, 100, 255] : [20, 200, 20, 255],
    )
    expect(exgMask(holed, 20, 20, 0.1)[10 * 20 + 10]).toBe(1)
  })

  it("transparent no-data pixels count against the fraction", () => {
    const half = image(10, 10, (x) =>
      x < 5 ? [20, 200, 20, 255] : [20, 200, 20, 0],
    )
    const vf = vegetationFraction(exgMask(half, 10, 10, 0.1))
    expect(vf).toBeGreaterThan(0.4)
    expect(vf).toBeLessThan(0.8)
  })
})

describe("tintVegetation", () => {
  it("tints only vegetation pixels green", () => {
    const px = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255])
    const out = tintVegetation(px, new Uint8Array([1, 0]))
    expect(Array.from(out.slice(0, 3))).toEqual([40, 190, 40])
    expect(Array.from(out.slice(4, 7))).toEqual([100, 100, 100])
  })
})
