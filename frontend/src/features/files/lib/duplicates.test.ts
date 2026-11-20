import { describe, expect, it } from "vitest"
import { existingUploadNames } from "./duplicates"

describe("existingUploadNames — single folder", () => {
  const dir = "Raw/S1/E/Davis/Cowpea/2024-06-01/DJI/RGB/Orthomosaic"
  it("finds same-named files in the destination folder only", () => {
    expect(
      existingUploadNames(
        ["a.tif", "b.tif", "c.tif"],
        [`${dir}/a.tif`, `${dir}/c.tif`, `${dir}/sub/b.tif`],
        dir,
      ),
    ).toEqual(["a.tif", "c.tif"])
  })
  it("tolerates a trailing slash and a fresh folder", () => {
    expect(existingUploadNames(["a.tif"], [`${dir}/a.tif`], `${dir}/`)).toEqual(
      ["a.tif"],
    )
    expect(existingUploadNames(["a.tif"], [], dir)).toEqual([])
  })
})

describe("existingUploadNames — per-batch image folders", () => {
  const root = "Raw/S1/E/Davis/Cowpea/2024-06-01/DJI/RGB"
  const listed = [
    `${root}/aaaa1111/Images/a.jpg`,
    `${root}/bbbb2222/Images/b.jpg`,
    `${root}/bbbb2222/Metadata/c.jpg`,
    `${root}/Orthomosaic/d.jpg`,
  ]
  it("matches images from any earlier batch at this scope", () => {
    expect(
      existingUploadNames(
        ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"],
        listed,
        `${root}/cccc3333/Images`,
        root,
      ),
    ).toEqual(["a.jpg", "b.jpg"])
  })
})
