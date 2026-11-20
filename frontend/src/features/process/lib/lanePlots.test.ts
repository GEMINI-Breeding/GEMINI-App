import { describe, expect, it } from "vitest"

import { laneName, lanePlots } from "./groundTrack"

const sel = (plot_id: number) => ({
  plot_id,
  start_image: `s${plot_id}.jpg`,
  end_image: `e${plot_id}.jpg`,
  direction: "left",
})

describe("lanePlots", () => {
  it("one plot per stretch without lanes", () => {
    expect(lanePlots([sel(1), sel(2)]).map((p) => p.plot_id)).toEqual([1, 2])
  })
  it("two lanes: stretch n becomes plots 2n-1 (top) and 2n (bottom)", () => {
    const out = lanePlots([sel(1), sel(3)], { lanes: 2, split: "top_bottom" })
    expect(out.map((p) => [p.plot_id, p.stretch, p.lane])).toEqual([
      [1, 1, 1],
      [2, 1, 2],
      [5, 3, 1],
      [6, 3, 2],
    ])
    expect(out[0].start_image).toBe("s1.jpg")
  })
  it("names lanes by where they sit", () => {
    expect(laneName(2, { lanes: 2, split: "top_bottom" })).toBe("bottom")
    expect(laneName(1, { lanes: 2, split: "left_right" })).toBe("left")
    expect(laneName(3, { lanes: 3, split: "top_bottom" })).toBe("lane 3")
  })
})
