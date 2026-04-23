import { describe, expect, it } from "vitest"
import { isExtensionAllowed } from "./extensions"

describe("isExtensionAllowed", () => {
  it("accepts any file when fileType is '*'", () => {
    expect(isExtensionAllowed("/foo/bar.anything", "*")).toBe(true)
    expect(isExtensionAllowed("/foo/bar", "*")).toBe(true)
  })

  it("accepts any IMAGE_EXTS member for fileType 'image/*' (case-insensitive)", () => {
    for (const ext of [".jpg", ".JPEG", ".png", ".TIFF", ".webp"]) {
      expect(isExtensionAllowed(`/x/y${ext}`, "image/*")).toBe(true)
    }
  })

  it("rejects non-image extensions for fileType 'image/*'", () => {
    expect(isExtensionAllowed("/x/y.csv", "image/*")).toBe(false)
    expect(isExtensionAllowed("/x/y.txt", "image/*")).toBe(false)
  })

  it("matches a single extension exactly", () => {
    expect(isExtensionAllowed("data.csv", ".csv")).toBe(true)
    expect(isExtensionAllowed("data.CSV", ".csv")).toBe(true)
    expect(isExtensionAllowed("data.xlsx", ".csv")).toBe(false)
  })

  it("matches any item in a comma-separated extension list", () => {
    const list = ".csv,.xlsx,.xls"
    expect(isExtensionAllowed("a.csv", list)).toBe(true)
    expect(isExtensionAllowed("a.xlsx", list)).toBe(true)
    expect(isExtensionAllowed("a.xls", list)).toBe(true)
    expect(isExtensionAllowed("a.json", list)).toBe(false)
  })

  it("treats .tif as also accepting .tiff (backward compatibility)", () => {
    expect(isExtensionAllowed("ortho.tiff", ".tif")).toBe(true)
    expect(isExtensionAllowed("ortho.tif", ".tif")).toBe(true)
  })

  it("handles paths with backslashes and multiple dots", () => {
    expect(isExtensionAllowed("C:\\data\\my.file.csv", ".csv")).toBe(true)
    expect(isExtensionAllowed("my.backup.tar.gz", ".gz")).toBe(true)
  })
})
