import { describe, expect, it } from "vitest"

import { naturalSort, pairPhotos } from "./photoPairing"

describe("pairPhotos", () => {
  it("pairs by the design's photo column, by name or stem", () => {
    const r = pairPhotos(
      ["x/IMG_1.JPG", "x/IMG_2.JPG", "x/IMG_3.JPG"],
      [
        { plot: "101", photo: "IMG_2.jpg" },
        { plot: "102", photo: "img_1" },
      ],
    )
    expect(r.column).toBe("photo")
    expect(r.pairs.map((p) => [p.row.plot, p.photo])).toEqual([
      ["101", "x/IMG_2.JPG"],
      ["102", "x/IMG_1.JPG"],
    ])
    expect(r.problems).toEqual(["1 photo(s) are not named in the design"])
  })

  it("else pairs in natural file-name order with the rows", () => {
    const r = pairPhotos(
      ["IMG_10.jpg", "IMG_2.jpg", "IMG_1.jpg"],
      [{ plot: "1" }, { plot: "2" }, { plot: "3" }],
    )
    expect(r.column).toBeNull()
    expect(r.pairs.map((p) => p.photo)).toEqual([
      "IMG_1.jpg",
      "IMG_2.jpg",
      "IMG_10.jpg",
    ])
    expect(r.problems).toEqual([])
  })

  it("says when counts differ", () => {
    const r = pairPhotos(["a.jpg"], [{ plot: "1" }, { plot: "2" }])
    expect(r.pairs).toHaveLength(1)
    expect(r.problems[0]).toMatch(/1 photos but 2 plots/)
  })

  it("sorts naturally", () => {
    expect(naturalSort(["p10.jpg", "p9.jpg"])).toEqual(["p9.jpg", "p10.jpg"])
  })
})
