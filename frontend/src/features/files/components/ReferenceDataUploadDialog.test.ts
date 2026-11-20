import { describe, expect, it } from "vitest"

import {
  autoIdentify,
  initialMapping,
  toServerMapping,
} from "./ReferenceDataUploadDialog"

describe("autoIdentify", () => {
  it("recognises field-sheet header spellings", () => {
    expect(autoIdentify("Field.plot.number")).toBe("plot_id")
    expect(autoIdentify("Plot #")).toBe("plot_id")
    expect(autoIdentify("Line ID")).toBe("accession")
    expect(autoIdentify("Line.ID")).toBe("accession")
    expect(autoIdentify("Tier")).toBe("row")
    expect(autoIdentify("Bed")).toBe("col")
    expect(autoIdentify("Stand_count")).toBeNull()
  })
})

describe("initialMapping", () => {
  const headers = [
    "Line ID",
    "Plot",
    "Field.plot.number",
    "Stand_count",
    "Notes",
  ]
  const numeric = ["Plot", "Field.plot.number", "Stand_count"]

  it("maps identity columns once, numeric columns as traits, text as ignored", () => {
    const m = initialMapping(headers, numeric)
    expect(m["Line ID"].role).toBe("accession")
    expect(m.Plot.role).toBe("plot_id")
    // A second plot-like column isn't silently made a trait.
    expect(m["Field.plot.number"].role).toBe("ignore")
    expect(m.Stand_count).toEqual({ role: "trait", name: "Stand_count" })
    expect(m.Notes.role).toBe("ignore")
  })

  it("keeps the user's earlier choices for the same headers", () => {
    const prev = { Stand_count: { role: "trait" as const, name: "Stand" } }
    expect(initialMapping(headers, numeric, prev).Stand_count.name).toBe(
      "Stand",
    )
  })
})

describe("toServerMapping", () => {
  it("omits ignored columns and blank trait names", () => {
    expect(
      toServerMapping({
        Plot: { role: "plot_id", name: "Plot" },
        Block: { role: "ignore", name: "Block" },
        Notes: { role: "ignore", name: "Notes" },
        LAI: { role: "trait", name: " LAI_hand " },
        Empty: { role: "trait", name: "  " },
      }),
    ).toEqual({ Plot: "plot_id", LAI: "LAI_hand" })
  })
})
