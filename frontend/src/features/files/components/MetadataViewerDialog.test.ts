import { describe, expect, it } from "vitest"
import { isViewableCsv, toCsvFile } from "./MetadataViewerDialog"

describe("toCsvFile", () => {
  it("types numbers, keeps text, and turns blanks into null", () => {
    const f = toCsvFile(
      "stamp,lat,lon,direction\n1.5,38.54,-121.75,North\n2,,-121.76,\n",
      "msgs_synced.csv",
    )
    expect(f.label).toBe("msgs_synced.csv")
    expect(f.columns).toEqual(["stamp", "lat", "lon", "direction"])
    expect(f.rows).toEqual([
      { stamp: 1.5, lat: 38.54, lon: -121.75, direction: "North" },
      { stamp: 2, lat: null, lon: -121.76, direction: null },
    ])
  })
})

describe("isViewableCsv", () => {
  it("offers the viewer for CSVs only", () => {
    expect(isViewableCsv("Raw/x/Metadata/msgs_synced.csv")).toBe(true)
    expect(isViewableCsv("Raw/x/Images/a.jpg")).toBe(false)
  })
})
