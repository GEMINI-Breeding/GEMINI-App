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
    })
  })

  it("extracts the structured drone-upload layout", () => {
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
    })
  })

  it("returns empty positional values for the wizard supplemental layout", () => {
    const attrs = deriveImagePathAttrs(
      "Raw/2026-05-06/GEMINI/SupplementalData.xlsx",
      "GEMINI",
    )
    expect(attrs.location).toBe("")
    expect(attrs.sensor).toBe("")
  })

  it("drops the Images/ literal between sensor and filename", () => {
    const attrs = deriveImagePathAttrs(
      "Processed/2026/GEMINI/Davis/Pop/2026-03-04/Drone/iPhone/Orthos/odm.tif",
      "GEMINI",
    )
    // 'Orthos' is not 'Images' so it stays in position
    expect(attrs.sensor).toBe("iPhone")
  })

  it("fileBaseName returns the trailing segment", () => {
    expect(fileBaseName("Raw/a/b/c/foo.jpg")).toBe("foo.jpg")
    expect(fileBaseName("foo.jpg")).toBe("foo.jpg")
    expect(fileBaseName("")).toBe("")
  })
})
