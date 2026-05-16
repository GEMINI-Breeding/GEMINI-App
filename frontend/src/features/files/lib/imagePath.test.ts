import { describe, expect, it } from "vitest"
import { deriveImagePathAttrs, fileBaseName } from "./imagePath"

describe("deriveImagePathAttrs", () => {
  it("returns empty for unknown experiment", () => {
    const attrs = deriveImagePathAttrs(
      "Raw/2026/OTHER/Davis/Pop/2026-03-04/Drone/iPhone/Images/a.jpg",
      "GEMINI",
    )
    expect(attrs).toEqual({
      location: "",
      population: "",
      date: "",
      platform: "",
      sensor: "",
      datasetShortId: null,
    })
  })

  it("extracts the new layout (with dataset short-id)", () => {
    const attrs = deriveImagePathAttrs(
      "Raw/2026/GEMINI/Davis/Cowpea MAGIC/2026-03-04/Drone/iPhone/a2f31b04/Images/240715_IMG_00181.jpg",
      "GEMINI",
    )
    expect(attrs).toEqual({
      location: "Davis",
      population: "Cowpea MAGIC",
      date: "2026-03-04",
      platform: "Drone",
      sensor: "iPhone",
      datasetShortId: "a2f31b04",
    })
  })

  it("extracts the legacy layout (no dataset short-id) with datasetShortId=null", () => {
    const attrs = deriveImagePathAttrs(
      "Raw/2026/GEMINI/Davis/Cowpea MAGIC/2026-03-04/Drone/iPhone/Images/240715_IMG_00181.jpg",
      "GEMINI",
    )
    expect(attrs).toEqual({
      location: "Davis",
      population: "Cowpea MAGIC",
      date: "2026-03-04",
      platform: "Drone",
      sensor: "iPhone",
      datasetShortId: null,
    })
  })

  it("rejects a non-hex segment as a dataset short-id (legacy fallback)", () => {
    // The segment immediately before Images/ is sensor-like, not 8-hex.
    // Treat as legacy: positional fields shift down accordingly and
    // datasetShortId stays null.
    const attrs = deriveImagePathAttrs(
      "Raw/2026/GEMINI/Davis/Cowpea MAGIC/2026-03-04/Drone/iPhone/Images/240715_IMG_00181.jpg",
      "GEMINI",
    )
    expect(attrs.datasetShortId).toBeNull()
    expect(attrs.sensor).toBe("iPhone")
  })

  it("returns empty positional values for the wizard supplemental layout", () => {
    const attrs = deriveImagePathAttrs(
      "Raw/2026-05-06/GEMINI/SupplementalData.xlsx",
      "GEMINI",
    )
    expect(attrs.location).toBe("")
    expect(attrs.sensor).toBe("")
    expect(attrs.datasetShortId).toBeNull()
  })

  it("preserves non-Images bucket segments verbatim", () => {
    const attrs = deriveImagePathAttrs(
      "Processed/2026/GEMINI/Davis/Pop/2026-03-04/Drone/iPhone/Orthos/odm.tif",
      "GEMINI",
    )
    // 'Orthos' is not 'Images' so it stays in position; no short-id.
    expect(attrs.sensor).toBe("iPhone")
    expect(attrs.datasetShortId).toBeNull()
  })

  it("fileBaseName returns the trailing segment", () => {
    expect(fileBaseName("Raw/a/b/c/foo.jpg")).toBe("foo.jpg")
    expect(fileBaseName("foo.jpg")).toBe("foo.jpg")
    expect(fileBaseName("")).toBe("")
  })
})
