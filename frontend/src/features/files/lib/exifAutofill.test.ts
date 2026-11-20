import { beforeEach, describe, expect, it, vi } from "vitest"

import { readExifAutofill } from "./exifAutofill"

const parseMock = vi.fn()
vi.mock("exifr", () => ({
  default: {
    parse: (...args: unknown[]) => parseMock(...args),
  },
}))

const FILE = new File([new Uint8Array([1, 2, 3])], "DJI_0001.JPG", {
  type: "image/jpeg",
})

describe("readExifAutofill", () => {
  beforeEach(() => {
    parseMock.mockReset()
  })

  it("maps Make/Model to platform/sensor and DateTimeOriginal to yyyy-mm-dd", async () => {
    parseMock.mockResolvedValue({
      DateTimeOriginal: new Date(2022, 5, 27, 10, 30),
      Make: "DJI",
      Model: "FC6310S",
    })
    expect(await readExifAutofill(FILE)).toEqual({
      date: "2022-06-27",
      platform: "DJI",
      sensor: "FC6310S",
    })
  })

  it("uses local date parts, not UTC", async () => {
    // 00:30 local on the 27th is still the 26th in UTC for a western
    // offset. toISOString() would report the wrong calendar day.
    parseMock.mockResolvedValue({
      DateTimeOriginal: new Date(2022, 5, 27, 0, 30),
    })
    expect((await readExifAutofill(FILE)).date).toBe("2022-06-27")
  })

  it("parses the raw EXIF string form when exifr yields a string", async () => {
    parseMock.mockResolvedValue({ DateTimeOriginal: "2023:04:05 08:00:00" })
    expect((await readExifAutofill(FILE)).date).toBe("2023-04-05")
  })

  it("falls back CreateDate then ModifyDate", async () => {
    parseMock.mockResolvedValue({ CreateDate: "2021:01:02 00:00:00" })
    expect((await readExifAutofill(FILE)).date).toBe("2021-01-02")
    parseMock.mockResolvedValue({ ModifyDate: "2020:03:04 00:00:00" })
    expect((await readExifAutofill(FILE)).date).toBe("2020-03-04")
  })

  it("trims whitespace and NUL padding, and drops empty strings", async () => {
    parseMock.mockResolvedValue({ Make: "  DJI \u0000", Model: "   " })
    const out = await readExifAutofill(FILE)
    expect(out.platform).toBe("DJI")
    expect(out.sensor).toBeUndefined()
  })

  it("returns {} when there are no EXIF tags", async () => {
    parseMock.mockResolvedValue(undefined)
    expect(await readExifAutofill(FILE)).toEqual({})
  })

  it("returns {} rather than throwing when exifr rejects", async () => {
    // The old server-side call was wrapped in a bare catch precisely
    // because it always failed; the replacement must not reintroduce a
    // throw that blocks file selection.
    parseMock.mockRejectedValue(new Error("not a jpeg"))
    expect(await readExifAutofill(FILE)).toEqual({})
  })

  it("ignores an unparseable date but keeps the other fields", async () => {
    parseMock.mockResolvedValue({
      DateTimeOriginal: "garbage",
      Make: "Sony",
    })
    const out = await readExifAutofill(FILE)
    expect(out.date).toBeUndefined()
    expect(out.platform).toBe("Sony")
  })
})
