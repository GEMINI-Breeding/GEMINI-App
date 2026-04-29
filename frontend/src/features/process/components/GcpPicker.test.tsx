import { describe, expect, it } from "vitest"

import {
  serializeGcpList,
  type GcpCatalogEntry,
  type GcpMark,
} from "./GcpPicker"

const catalog: GcpCatalogEntry[] = [
  {
    id: "gcp-a",
    label: "GCP1",
    lon: -121.7501,
    lat: 38.5402,
    alt: 24.5,
    color: "#ef4444",
  },
  {
    id: "gcp-b",
    label: "GCP2",
    lon: -121.7515,
    lat: 38.541,
    alt: 25.1,
    color: "#3b82f6",
  },
]

describe("serializeGcpList", () => {
  it("produces a header-only file when there are no marks", () => {
    const out = serializeGcpList(catalog, [])
    expect(out).toBe("EPSG:4326\n")
  })

  it("serializes one row per mark using the matching catalog entry", () => {
    const marks: GcpMark[] = [
      {
        gcpId: "gcp-a",
        image: "DJI_0001.JPG",
        pixelX: 1234.4,
        pixelY: 567.7,
      },
      {
        gcpId: "gcp-b",
        image: "DJI_0002.JPG",
        pixelX: 100.2,
        pixelY: 200.8,
      },
    ]
    const lines = serializeGcpList(catalog, marks).trim().split("\n")
    expect(lines[0]).toBe("EPSG:4326")
    // Row format: lon lat alt pixel_x pixel_y image label  (rounded pixels)
    expect(lines[1]).toBe("-121.7501 38.5402 24.5 1234 568 DJI_0001.JPG GCP1")
    expect(lines[2]).toBe("-121.7515 38.541 25.1 100 201 DJI_0002.JPG GCP2")
  })

  it("drops marks that don't reference a known catalog entry", () => {
    const marks: GcpMark[] = [
      {
        gcpId: "ghost",
        image: "x.JPG",
        pixelX: 0,
        pixelY: 0,
      },
      {
        gcpId: "gcp-a",
        image: "DJI_0001.JPG",
        pixelX: 10,
        pixelY: 20,
      },
    ]
    const lines = serializeGcpList(catalog, marks).trim().split("\n")
    expect(lines).toHaveLength(2) // header + 1 valid row
    expect(lines[1]).toContain("DJI_0001.JPG")
    expect(lines[1]).not.toContain("ghost")
  })
})
