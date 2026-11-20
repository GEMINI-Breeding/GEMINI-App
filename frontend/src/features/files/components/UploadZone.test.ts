/**
 * Vitest unit coverage for `filesFromDataTransfer`.
 *
 * The original UploadZone read only `dataTransfer.files`, which surfaced a
 * dropped folder as a single 0-byte File and downstream code rejected it
 * as "wrong file type" — the failure mode the user hit on the
 * `Subset Drone Data/` directory. The new implementation walks
 * `dataTransfer.items[].webkitGetAsEntry()` and recurses into directories.
 *
 * These tests exercise the walk path with synthetic FileSystemEntry-shaped
 * objects (browsers' real DirectoryEntry isn't constructible from JS), and
 * the fallback to `.files` when items[] doesn't expose `webkitGetAsEntry`
 * (older browsers, some test environments).
 */
import { describe, expect, it } from "vitest"

import { filesFromDataTransfer } from "./UploadZone"

type FakeFileEntry = {
  isFile: true
  isDirectory: false
  name: string
  fullPath: string
  file: (cb: (f: File) => void) => void
}
type FakeDirEntry = {
  isFile: false
  isDirectory: true
  name: string
  createReader: () => {
    readEntries: (cb: (entries: unknown[]) => void) => void
  }
}

function fileEntry(name: string, content = "x"): FakeFileEntry {
  const f = new File([content], name)
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: `/${name}`,
    file: (cb) => cb(f),
  }
}

function dirEntry(
  name: string,
  children: Array<FakeFileEntry | FakeDirEntry>,
): FakeDirEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      // Simulate the browser API: readEntries is called repeatedly until
      // it returns []. We hand the whole batch on the first call.
      let drained = false
      return {
        readEntries: (cb) => {
          if (drained) return cb([])
          drained = true
          cb(children)
        },
      }
    },
  }
}

function makeDataTransfer(
  items: Array<{
    kind: "file"
    entry?: FakeFileEntry | FakeDirEntry
    getAsFile?: () => File | null
  }>,
  filesFallback: File[] = [],
): DataTransfer {
  // jsdom's DataTransfer doesn't support adding items via webkitGetAsEntry,
  // so build a duck-typed object the production code can introspect.
  const itemList = items.map((it) => ({
    kind: it.kind,
    webkitGetAsEntry: () => it.entry ?? null,
    getAsFile: it.getAsFile ?? (() => null),
  }))
  return {
    items: itemList as unknown as DataTransferItemList,
    files: filesFallback as unknown as FileList,
  } as DataTransfer
}

describe("filesFromDataTransfer", () => {
  it("returns the flat list of files from a single dropped File", async () => {
    const f = new File(["abc"], "a.jpg")
    const dt = makeDataTransfer([{ kind: "file", entry: fileEntry("a.jpg") }])
    const out = await filesFromDataTransfer(dt)
    expect(out.map((x) => x.name)).toEqual(["a.jpg"])
    // Doesn't matter what raw file we passed in fallback — the entry path wins.
    expect(out[0].size).toBe(1)
    void f
  })

  it("walks a single-level directory and yields its files", async () => {
    const dt = makeDataTransfer([
      {
        kind: "file",
        entry: dirEntry("subset", [fileEntry("a.JPG"), fileEntry("b.JPG")]),
      },
    ])
    const out = await filesFromDataTransfer(dt)
    expect(out.map((x) => x.name).sort()).toEqual(["a.JPG", "b.JPG"])
  })

  it("recurses into nested directories", async () => {
    const dt = makeDataTransfer([
      {
        kind: "file",
        entry: dirEntry("subset", [
          fileEntry("top.csv"),
          dirEntry("date1", [
            fileEntry("d1-img1.JPG"),
            fileEntry("d1-img2.JPG"),
          ]),
          dirEntry("date2", [fileEntry("d2-img1.JPG")]),
        ]),
      },
    ])
    const out = await filesFromDataTransfer(dt)
    expect(out.map((x) => x.name).sort()).toEqual([
      "d1-img1.JPG",
      "d1-img2.JPG",
      "d2-img1.JPG",
      "top.csv",
    ])
  })

  it("falls back to dataTransfer.files when items[] has no webkitGetAsEntry", async () => {
    // No webkitGetAsEntry on any item → fall back to .files.
    const fallback = [new File(["x"], "f1.jpg"), new File(["y"], "f2.jpg")]
    const dt = {
      items: [{ kind: "file" }] as unknown as DataTransferItemList,
      files: fallback as unknown as FileList,
    } as DataTransfer
    const out = await filesFromDataTransfer(dt)
    expect(out.map((x) => x.name)).toEqual(["f1.jpg", "f2.jpg"])
  })

  it("ignores non-file items (kind !== 'file')", async () => {
    const dt = {
      items: [
        {
          kind: "string",
          webkitGetAsEntry: () => null,
          getAsFile: () => null,
        },
        {
          kind: "file",
          webkitGetAsEntry: () => fileEntry("real.jpg"),
          getAsFile: () => null,
        },
      ] as unknown as DataTransferItemList,
      files: [] as unknown as FileList,
    } as DataTransfer
    const out = await filesFromDataTransfer(dt)
    expect(out.map((x) => x.name)).toEqual(["real.jpg"])
  })

  it("uses item.getAsFile() when webkitGetAsEntry returns null (e.g. DataTransfer constructed in tests)", async () => {
    const f = new File(["z"], "from-getAsFile.jpg")
    const dt = {
      items: [
        {
          kind: "file",
          webkitGetAsEntry: () => null,
          getAsFile: () => f,
        },
      ] as unknown as DataTransferItemList,
      files: [] as unknown as FileList,
    } as DataTransfer
    const out = await filesFromDataTransfer(dt)
    expect(out.map((x) => x.name)).toEqual(["from-getAsFile.jpg"])
  })
})
