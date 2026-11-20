import { describe, expect, it } from "vitest"

import {
  dateFromFolder,
  dateFromName,
  dateOf,
  dateTokenIn,
  groupByDate,
} from "./fileDates"

describe("dates in file names", () => {
  it.each([
    ["Kearney_2023-06-15_RGB_ortho.tif", "2023-06-15"],
    ["2023_07_02_DEM.tif", "2023-07-02"],
    ["ortho.2023.08.21.tif", "2023-08-21"],
    ["20230615_rgb.tif", "2023-06-15"],
    ["DJI_20230615101530_0001_V.JPG", "2023-06-15"],
    ["field_06-15-2023.tif", "2023-06-15"],
    ["field_15-06-2023.tif", "2023-06-15"],
    ["IMG_1234.JPG", null],
    ["plot_20231345.tif", null], // month 13
    ["2023-02-30.tif", null],
    ["v2.3.12.tif", null],
  ])("%s → %s", (name, want) => {
    expect(dateFromName(name)).toBe(want)
  })

  it("reads the nearest folder with a date", () => {
    expect(dateFromFolder("Kearney/2023/2023-06-15/rgb")).toBe("2023-06-15")
    expect(dateFromFolder("rgb/flight1")).toBeNull()
  })

  it("prefers the name, then the folder, the photo, the file date", () => {
    expect(
      dateOf({
        name: "a_2023-06-15.tif",
        folder: "2023-07-01",
        modified: "2024-01-01T10:00:00",
      }),
    ).toEqual({ date: "2023-06-15", source: "name" })
    expect(
      dateOf({ name: "a.tif", folder: "x/2023-07-01", modified: 0 }),
    ).toEqual({ date: "2023-07-01", source: "folder" })
    expect(dateOf({ name: "a.jpg", photoDate: "2023-07-03" })).toEqual({
      date: "2023-07-03",
      source: "photo",
    })
    expect(
      dateOf({ name: "a.tif", modified: "2023-07-04T12:00:00" })?.source,
    ).toBe("file date")
  })
})

describe("one upload per date", () => {
  it("groups an orthomosaic and its DEM of each date together, oldest first", () => {
    const names = [
      "K_2023-07-02_RGB.tif",
      "K_2023-06-15_RGB.tif",
      "K_2023-06-15_DEM.tif",
      "K_2023-07-02_DEM.tif",
      "notes.txt",
    ]
    const groups = groupByDate(names, (n) => dateOf({ name: n }), "2023-01-01")
    expect(groups.map((g) => [g.date, g.items.length, g.source])).toEqual([
      ["2023-01-01", 1, "chosen"],
      ["2023-06-15", 2, "name"],
      ["2023-07-02", 2, "name"],
    ])
  })

  it("finds how a date is written in a group's names", () => {
    expect(
      dateTokenIn(["a_2023-06-15.tif", "b_2023-06-15.tif"], "2023-06-15"),
    ).toBe("2023-06-15")
    expect(dateTokenIn(["DJI_20230615_1.JPG"], "2023-06-15")).toBe("20230615")
    expect(dateTokenIn(["a.tif"], "2023-06-15")).toBeNull()
  })
})
