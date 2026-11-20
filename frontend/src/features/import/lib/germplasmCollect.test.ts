import { describe, expect, it } from "vitest"

import {
  collectGermplasmNames,
  collectPopulationForGermplasm,
} from "./germplasmCollect"
import type { ColumnMapping, SheetMapping } from "./types"

const baseConfig = (overrides: Partial<SheetMapping> = {}): SheetMapping => ({
  sheetName: "S1",
  skipped: false,
  plotNumberColumn: "plot",
  plotRowColumn: null,
  plotColumnColumn: null,
  populationName: "",
  traitColumns: [],
  accessionNameColumn: null,
  lineNameColumn: null,
  aliasColumn: null,
  collectionDateMode: "fixed",
  collectionDate: "2026-05-01",
  collectionDateColumn: null,
  seasonMode: "fixed",
  seasonName: "Summer",
  seasonColumn: null,
  siteMode: "fixed",
  siteName: "Field A",
  siteColumn: null,
  timestampColumn: null,
  metadataColumns: [],
  ...overrides,
})

describe("collectGermplasmNames", () => {
  it("collects accession + line + alias values across sheets, deduped", () => {
    const mapping: ColumnMapping = {
      recordType: "trait",
      sheets: [
        {
          name: "S1",
          headers: ["plot", "acc", "alias"],
          rows: [
            { plot: "1", acc: "B73", alias: "1" },
            { plot: "2", acc: "B73", alias: "  " }, // blank alias dropped
          ],
        },
        {
          name: "S2",
          headers: ["plot", "line"],
          rows: [
            { plot: "1", line: "MAGIC110" },
            { plot: "2", line: "B73" },
          ],
        },
      ],
      sheetConfigs: [
        baseConfig({ accessionNameColumn: "acc", aliasColumn: "alias" }),
        baseConfig({ sheetName: "S2", lineNameColumn: "line" }),
      ],
    }
    const names = collectGermplasmNames(mapping)
    expect(new Set(names)).toEqual(new Set(["B73", "1", "MAGIC110"]))
  })

  it("skips skipped sheets", () => {
    const mapping: ColumnMapping = {
      recordType: "trait",
      sheets: [
        { name: "S1", headers: ["acc"], rows: [{ acc: "A" }] },
        { name: "S2", headers: ["acc"], rows: [{ acc: "B" }] },
      ],
      sheetConfigs: [
        baseConfig({ accessionNameColumn: "acc" }),
        baseConfig({ skipped: true, accessionNameColumn: "acc" }),
      ],
    }
    expect(collectGermplasmNames(mapping)).toEqual(["A"])
  })

  it("returns [] when no germplasm columns are mapped", () => {
    const mapping: ColumnMapping = {
      recordType: "trait",
      sheets: [{ name: "S1", headers: ["acc"], rows: [{ acc: "A" }] }],
      sheetConfigs: [baseConfig()],
    }
    expect(collectGermplasmNames(mapping)).toEqual([])
  })
})

describe("collectPopulationForGermplasm", () => {
  it("maps each germplasm name to the population of its source row", () => {
    const mapping: ColumnMapping = {
      recordType: "trait",
      sheets: [
        {
          name: "S1",
          headers: ["acc"],
          rows: [{ acc: "B73" }, { acc: "MAGIC110" }],
        },
      ],
      sheetConfigs: [
        baseConfig({
          accessionNameColumn: "acc",
          populationName: "Diversity Panel",
        }),
      ],
    }
    const map = collectPopulationForGermplasm(mapping)
    expect(map.get("B73")).toBe("Diversity Panel")
    expect(map.get("MAGIC110")).toBe("Diversity Panel")
  })

  it("ignores sheets with no populationName", () => {
    const mapping: ColumnMapping = {
      recordType: "trait",
      sheets: [{ name: "S1", headers: ["acc"], rows: [{ acc: "B73" }] }],
      sheetConfigs: [baseConfig({ accessionNameColumn: "acc" })],
    }
    const map = collectPopulationForGermplasm(mapping)
    expect(map.size).toBe(0)
  })

  it("first population wins on conflict", () => {
    const mapping: ColumnMapping = {
      recordType: "trait",
      sheets: [
        { name: "S1", headers: ["acc"], rows: [{ acc: "B73" }] },
        { name: "S2", headers: ["acc"], rows: [{ acc: "B73" }] },
      ],
      sheetConfigs: [
        baseConfig({ accessionNameColumn: "acc", populationName: "First" }),
        baseConfig({
          sheetName: "S2",
          accessionNameColumn: "acc",
          populationName: "Second",
        }),
      ],
    }
    expect(collectPopulationForGermplasm(mapping).get("B73")).toBe("First")
  })
})
