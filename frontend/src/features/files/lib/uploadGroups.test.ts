import { describe, expect, it } from "vitest"

import {
  batchInfo,
  batchLabelText,
  batchNameSuffix,
  distinctName,
  duplicateLabels,
  foldersOf,
  groupByFolder,
  runFromFolderName,
  setFolder,
} from "./uploadGroups"

function file(name: string, folder: string): File {
  const f = new File(["x"], name)
  setFolder(f, folder)
  return f
}

describe("uploadGroups", () => {
  const files = [
    file("a.jpg", "/0917/run1"),
    file("b.jpg", "/0917/run1"),
    file("c.jpg", "/0917/run2"),
    file("d.jpg", "/0917/run10"),
  ]

  it("finds the folders in natural order", () => {
    expect(foldersOf(files)).toEqual(["0917/run1", "0917/run2", "0917/run10"])
  })

  it("names folders by what differs under a shared parent", () => {
    const all = foldersOf(files)
    expect(distinctName("0917/run2", all)).toBe("run2")
    expect(distinctName("drought", ["drought", "irrigated"])).toBe("drought")
  })

  it("reads a run number from common folder names, else keeps the name", () => {
    expect(runFromFolderName("run2")).toBe("2")
    expect(runFromFolderName("Flight_03")).toBe("3")
    expect(runFromFolderName("morning")).toBe("morning")
  })

  it("makes one batch per folder as runs, keeping the form's treatment", () => {
    const g = groupByFolder(files, "runs", { run: "", treatment: "drought" })
    expect(g.map((x) => [x.run, x.treatment, x.files.length])).toEqual([
      ["1", "drought", 2],
      ["2", "drought", 1],
      ["10", "drought", 1],
    ])
  })

  it("makes one batch per folder as treatments, keeping the form's run", () => {
    const t = [file("a.bin", "irrigated"), file("b.bin", "drought")]
    const g = groupByFolder(t, "treatments", { run: "2", treatment: "" })
    expect(g.map((x) => [x.run, x.treatment])).toEqual([
      ["2", "drought"],
      ["2", "irrigated"],
    ])
  })

  it("keeps everything together when folders mean nothing", () => {
    const g = groupByFolder(files, "one", { run: "", treatment: "" })
    expect(g).toHaveLength(1)
    expect(g[0].files).toHaveLength(4)
  })

  it("reports folders that would get the same labels", () => {
    const g = groupByFolder(files, "treatments", { run: "", treatment: "" })
    expect(duplicateLabels(g)).toEqual([])
    g[1].treatment = g[0].treatment
    expect(duplicateLabels(g)).toHaveLength(1)
    g[1].include = false
    expect(duplicateLabels(g)).toEqual([])
  })

  it("stores only the labels that were given, with the scope", () => {
    const info = batchInfo(
      { run: " 2 ", treatment: "" },
      { location: "Davis", date: "2026-09-17" },
      "0917/run2",
    )
    expect(info).toEqual({
      run_of_day: "2",
      source_folder: "0917/run2",
      site: "Davis",
      collection_date: "2026-09-17",
    })
    expect(batchLabelText(info)).toBe("run 2")
    expect(batchLabelText({ run_of_day: "2", treatment: "drought" })).toBe(
      "run 2 · drought",
    )
    expect(batchLabelText({})).toBe("")
    expect(batchNameSuffix({ run: "2", treatment: "low N" })).toBe(
      "run-2__trt-low-N",
    )
  })
})
