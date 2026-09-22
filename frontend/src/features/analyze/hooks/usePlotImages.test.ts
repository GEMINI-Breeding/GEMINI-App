import { describe, expect, it } from "vitest"

import type { FileMetadata } from "@/client"

import {
  indexPlotImages,
  orthosFromListing,
  plotNumberFromImageName,
} from "./usePlotImages"

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

describe("orthosFromListing", () => {
  const POP = "Processed/2024/Exp/Davis/Cowpea/"
  const f = (object_name: string, last_modified = "2024-01-01T00:00:00Z") =>
    ({ object_name, last_modified }) as FileMetadata

  it("prefers the -Pyramid COG sibling when it exists", () => {
    const out = orthosFromListing([
      f(`${POP}2024-06-01/Drone/RGB/odm_orthophoto-abc.tif`),
      f(`${POP}2024-06-01/Drone/RGB/odm_orthophoto-abc-Pyramid.tif`),
    ])
    expect(out).toEqual([
      {
        label: "2024-06-01 · Drone/RGB",
        s3Url: `s3://gemini/${POP}2024-06-01/Drone/RGB/odm_orthophoto-abc-Pyramid.tif`,
        date: "2024-06-01",
      },
    ])
  })

  it("keeps the newest ortho per folder and lists flights newest first", () => {
    const out = orthosFromListing([
      f(
        `${POP}2024-06-01/Drone/RGB/odm_orthophoto-old.tif`,
        "2024-06-02T00:00:00Z",
      ),
      f(
        `${POP}2024-06-01/Drone/RGB/odm_orthophoto-new.tif`,
        "2024-06-09T00:00:00Z",
      ),
      f(`${POP}2024-07-15/Drone/RGB/odm_orthophoto-x.tif`),
    ])
    expect(out.map((o) => o.date)).toEqual(["2024-07-15", "2024-06-01"])
    expect(out[1].s3Url).toContain("odm_orthophoto-new.tif")
  })

  it("ignores plot images, DEMs and other files", () => {
    expect(
      orthosFromListing([
        f(`${POP}2024-06-01/Drone/RGB/PlotImages/plot_1_accession_A.png`),
        f(`${POP}2024-06-01/Drone/RGB/dem.tif`),
      ]),
    ).toEqual([])
  })
})

describe("orthosFromListing at site level", () => {
  it("names the population when listing a whole site", () => {
    const out = orthosFromListing(
      [
        {
          object_name:
            "Processed/2024/Exp/Davis/Cowpea/2024-06-01/Drone/RGB/odm_orthophoto-a.tif",
          last_modified: "2024-06-02T00:00:00Z",
        } as FileMetadata,
      ],
      true,
    )
    expect(out[0].label).toBe("2024-06-01 · Drone/RGB · Cowpea")
  })
})
