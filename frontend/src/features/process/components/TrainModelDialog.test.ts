import { describe, expect, it } from "vitest"

import { mergeSets, siblingSets } from "./TrainModelDialog"

const dir = (date: string, name = "flowers") =>
  `Processed/2026/E/Davis/Cowpea/${date}/Drone/RGB/PlotFrames/labels/${name}`

describe("siblingSets", () => {
  it("finds the same set on the scope's other dates only", () => {
    const all = [
      dir("2026-08-31"),
      dir("2026-07-27"),
      dir("2026-07-27"),
      dir("2026-07-27", "pods"),
      "Processed/2026/E/Davis/Sorghum/2026-07-27/Drone/RGB/PlotFrames/labels/flowers",
    ]
    expect(siblingSets(dir("2026-08-31"), all)).toEqual([dir("2026-07-27")])
  })
  it("ignores directories that are not under Processed", () => {
    expect(siblingSets("labels/default", ["labels/default"])).toEqual([])
  })
})

describe("mergeSets", () => {
  it("keeps the done images and every class", () => {
    const img = (done: boolean) => ({
      width: 1,
      height: 1,
      annotations: [],
      done,
    })
    const m = mergeSets([
      { classes: ["flower"], images: { a: img(true), b: img(false) } },
      { classes: ["flower", "bud"], images: { c: img(true) } },
    ])
    expect(Object.keys(m.images).sort()).toEqual(["a", "c"])
    expect(m.classes.sort()).toEqual(["bud", "flower"])
  })
})
