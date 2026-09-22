import { describe, expect, it } from "vitest"
import { crsLabel } from "./GeoTiffValidationCard"

describe("crsLabel", () => {
  it("shortens TiTiler's OGC URI to EPSG:n", () => {
    expect(crsLabel("http://www.opengis.net/def/crs/EPSG/0/32610")).toBe(
      "EPSG:32610",
    )
    expect(crsLabel("EPSG:4326")).toBe("EPSG:4326")
  })
  it("is null without a CRS", () => {
    expect(crsLabel(null)).toBeNull()
    expect(crsLabel("")).toBeNull()
  })
})
