import { describe, expect, it } from "vitest"

import type { FileMetadata } from "@/client"

import { indexPlotImages, plotNumberFromImageName } from "./usePlotImages"

const f = (object_name: string): FileMetadata =>
  ({ object_name }) as FileMetadata

const P = "Processed/2024/Exp/Davis/Cowpea/2024-06-01/Drone/RGB/PlotImages/"

describe("plotNumberFromImageName", () => {
  it("reads the plot number from the worker's naming scheme", () => {
    expect(plotNumberFromImageName(`${P}plot_12_accession_CB27.png`)).toBe(12)
  })

  it("handles an accession the worker had to sanitise", () => {
    // The worker replaces "/" and " " with "_" before writing.
    expect(plotNumberFromImageName(`${P}plot_3_accession_CB_27_A.png`)).toBe(3)
  })

  it("handles the unknown-accession fallback", () => {
    expect(plotNumberFromImageName(`${P}plot_7_accession_unknown.png`)).toBe(7)
  })

  it("handles a bare plot_N.png with no accession segment", () => {
    expect(plotNumberFromImageName(`${P}plot_9.png`)).toBe(9)
  })

  it("returns null for anything else", () => {
    expect(plotNumberFromImageName(`${P}thumbnail.png`)).toBeNull()
    expect(plotNumberFromImageName(`${P}plot_abc_accession_X.png`)).toBeNull()
    expect(plotNumberFromImageName("")).toBeNull()
  })
})

describe("indexPlotImages", () => {
  it("indexes by plot number", () => {
    const m = indexPlotImages([
      f(`${P}plot_1_accession_A.png`),
      f(`${P}plot_2_accession_B.png`),
    ])
    expect(m.get(1)).toBe(`${P}plot_1_accession_A.png`)
    expect(m.get(2)).toBe(`${P}plot_2_accession_B.png`)
    expect(m.size).toBe(2)
  })

  it("ignores files outside PlotImages/ and non-images", () => {
    const m = indexPlotImages([
      f("Processed/2024/Exp/Davis/Cowpea/2024-06-01/Drone/RGB/ortho.tif"),
      f(`${P}notes.txt`),
      f(`${P}plot_5_accession_E.png`),
    ])
    expect([...m.keys()]).toEqual([5])
  })

  it("lets a later flight win for the same plot, deterministically", () => {
    // A season+site can hold several flights; the Analyze scope has no
    // date, so both are listed. Sorting makes "last wins" stable rather
    // than dependent on listing order.
    const older =
      "Processed/2024/Exp/Davis/Cowpea/2024-06-01/Drone/RGB/PlotImages/plot_4_accession_D.png"
    const newer =
      "Processed/2024/Exp/Davis/Cowpea/2024-07-15/Drone/RGB/PlotImages/plot_4_accession_D.png"
    expect(indexPlotImages([f(older), f(newer)]).get(4)).toBe(newer)
    // Same answer regardless of the order the listing arrived in.
    expect(indexPlotImages([f(newer), f(older)]).get(4)).toBe(newer)
  })

  it("returns an empty map for an empty listing", () => {
    expect(indexPlotImages([]).size).toBe(0)
  })
})
