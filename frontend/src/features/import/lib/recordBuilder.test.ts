/**
 * Pure tests for the trait-record-building helpers.
 *
 *   - collectTraitUnits / collectPopulationNames / collectSeasonAndSiteNames
 *     should match what gemini-ui's StepUpload computes inline.
 *   - collectPlotSpecs honors germplasm-mapping-mode rules and dedupes.
 *   - buildTraitRecords' row-walk emits one record per (numeric trait,
 *     numeric plot, non-empty season + site), grouped by `${season}::${site}`.
 *   - record_info carries sheet, source_column, accession_name / line_name
 *     / germplasm_alias / population / metadata columns.
 */
import { describe, expect, it } from "vitest"
import {
  buildTraitRecords,
  collectPlotSpecs,
  collectPopulationNames,
  collectSeasonAndSiteNames,
  collectTraitUnits,
  pickGermplasmFromRow,
} from "./recordBuilder"
import type { ColumnMapping, GermplasmReview, SheetMapping } from "./types"

const cfg = (overrides: Partial<SheetMapping> = {}): SheetMapping => ({
  sheetName: "S1",
  skipped: false,
  plotNumberColumn: "plot",
  plotRowColumn: null,
  plotColumnColumn: null,
  populationName: "",
  traitColumns: [
    { columnHeader: "ndvi", traitName: "NDVI", units: "", enabled: true },
  ],
  accessionNameColumn: null,
  lineNameColumn: null,
  aliasColumn: null,
  collectionDateMode: "fixed",
  collectionDate: "2026-05-01",
  collectionDateColumn: null,
  seasonMode: "fixed",
  seasonName: "Summer 2026",
  seasonColumn: null,
  siteMode: "fixed",
  siteName: "Davis Field A",
  siteColumn: null,
  timestampColumn: null,
  metadataColumns: [],
  ...overrides,
})

const FIXED_NOW = () => new Date("2026-05-01T12:00:00Z")

describe("pickGermplasmFromRow", () => {
  it("prefers accession > line > alias", () => {
    const row = { acc: "A", line: "L", alias: "1" }
    const config = cfg({
      accessionNameColumn: "acc",
      lineNameColumn: "line",
      aliasColumn: "alias",
    })
    expect(pickGermplasmFromRow(row, config)).toBe("A")
  })
  it("falls through to alias when others are blank", () => {
    const row = { acc: "  ", line: "", alias: "X" }
    const config = cfg({
      accessionNameColumn: "acc",
      lineNameColumn: "line",
      aliasColumn: "alias",
    })
    expect(pickGermplasmFromRow(row, config)).toBe("X")
  })
  it("returns null when nothing is mapped", () => {
    expect(pickGermplasmFromRow({ acc: "A" }, cfg())).toBe(null)
  })
})

describe("collectTraitUnits / Population / SeasonSite", () => {
  it("collects trait names with units, deduped across sheets", () => {
    const mapping: ColumnMapping = {
      recordType: "trait",
      sheets: [
        { name: "S1", headers: [], rows: [] },
        { name: "S2", headers: [], rows: [] },
      ],
      sheetConfigs: [
        cfg({
          traitColumns: [
            {
              columnHeader: "ndvi",
              traitName: "NDVI",
              units: "ratio",
              enabled: true,
            },
          ],
        }),
        cfg({
          sheetName: "S2",
          traitColumns: [
            {
              columnHeader: "ndvi",
              traitName: "NDVI",
              units: "different",
              enabled: true,
            },
            {
              columnHeader: "yield",
              traitName: "Yield",
              units: "g",
              enabled: true,
            },
          ],
        }),
      ],
    }
    const units = collectTraitUnits(mapping)
    expect(units.get("NDVI")).toBe("ratio")
    expect(units.get("Yield")).toBe("g")
    expect(units.size).toBe(2)
  })

  it("collectPopulationNames trims and dedupes", () => {
    const mapping: ColumnMapping = {
      recordType: "trait",
      sheets: [
        { name: "S1", headers: [], rows: [] },
        { name: "S2", headers: [], rows: [] },
      ],
      sheetConfigs: [
        cfg({ populationName: "  Diversity Panel " }),
        cfg({ sheetName: "S2", populationName: "Diversity Panel" }),
      ],
    }
    expect(collectPopulationNames(mapping)).toEqual(
      new Set(["Diversity Panel"]),
    )
  })

  it("collectSeasonAndSiteNames pulls from fixed values + columns", () => {
    const mapping: ColumnMapping = {
      recordType: "trait",
      sheets: [
        {
          name: "S1",
          headers: ["plot", "season", "site"],
          rows: [
            { plot: "1", season: "Spring", site: "Field B" },
            { plot: "2", season: "Spring", site: "Field B" },
          ],
        },
        {
          name: "S2",
          headers: ["plot"],
          rows: [{ plot: "1" }],
        },
      ],
      sheetConfigs: [
        cfg({
          seasonMode: "column",
          seasonColumn: "season",
          seasonName: "",
          siteMode: "column",
          siteColumn: "site",
          siteName: "",
        }),
        cfg({
          sheetName: "S2",
          seasonName: "Summer 2026",
          siteName: "Davis Field A",
        }),
      ],
    }
    const { seasonNames, siteNames } = collectSeasonAndSiteNames(mapping)
    expect(seasonNames).toEqual(new Set(["Spring", "Summer 2026"]))
    expect(siteNames).toEqual(new Set(["Field B", "Davis Field A"]))
  })
})

describe("collectPlotSpecs", () => {
  const mapping: ColumnMapping = {
    recordType: "trait",
    sheets: [
      {
        name: "S1",
        headers: ["plot", "row", "col", "acc", "ndvi"],
        rows: [
          { plot: "1", row: "1", col: "1", acc: "B73", ndvi: "0.4" },
          { plot: "1", row: "1", col: "1", acc: "B73", ndvi: "0.5" }, // dup → dedup
          { plot: "2", row: "2", col: "1", acc: "MAGIC110", ndvi: "0.6" },
          { plot: "", row: "1", col: "1", acc: "X", ndvi: "0.1" }, // skipped: blank plot
        ],
      },
    ],
    sheetConfigs: [
      cfg({
        plotRowColumn: "row",
        plotColumnColumn: "col",
        accessionNameColumn: "acc",
      }),
    ],
  }

  it("dedupes by (season,site,plot,row,col) and skips invalid rows", () => {
    const { plotSpecs } = collectPlotSpecs(mapping, null)
    expect(plotSpecs.length).toBe(2)
    expect(plotSpecs[0]).toMatchObject({
      plotNumber: 1,
      plotRow: 1,
      plotCol: 1,
      season: "Summer 2026",
      site: "Davis Field A",
      accessionName: "B73",
    })
    expect(plotSpecs[1].accessionName).toBe("MAGIC110")
  })

  it("for accession-only mapping, marks germplasm names for inline create", () => {
    const { inlineGermplasmNames, missingGermplasmRefs } = collectPlotSpecs(
      mapping,
      null,
    )
    expect(inlineGermplasmNames).toEqual(new Set(["B73", "MAGIC110"]))
    expect(missingGermplasmRefs.size).toBe(0)
  })

  it("ambiguous mapping reads from review.resolved + tracks misses", () => {
    const ambig: ColumnMapping = {
      ...mapping,
      sheetConfigs: [
        cfg({
          plotRowColumn: "row",
          plotColumnColumn: "col",
          accessionNameColumn: "acc",
          aliasColumn: "ndvi", // adding alias makes it ambiguous
        }),
      ],
    }
    const review: GermplasmReview = {
      allNames: ["B73", "MAGIC110", "0.4"],
      resolved: {
        B73: {
          match_kind: "accession_exact",
          canonical_name: "B73",
        },
        // MAGIC110 absent → counted as missing
      },
    }
    const { plotSpecs, missingGermplasmRefs, inlineGermplasmNames } =
      collectPlotSpecs(ambig, review)
    // Picker prefers accession column over alias.
    expect(plotSpecs[0].accessionName).toBe("B73")
    expect(plotSpecs[1].accessionName).toBeUndefined()
    expect(missingGermplasmRefs.has("MAGIC110")).toBe(true)
    expect(inlineGermplasmNames.size).toBe(0)
  })
})

describe("buildTraitRecords", () => {
  const mapping: ColumnMapping = {
    recordType: "trait",
    sheets: [
      {
        name: "S1",
        headers: ["plot", "ndvi", "yield", "acc", "alias", "season", "notes"],
        rows: [
          {
            plot: "1",
            ndvi: "0.4",
            yield: "10",
            acc: "B73",
            alias: "1",
            season: "Spring",
            notes: "n1",
          },
          {
            plot: "2",
            ndvi: "",
            yield: "11",
            acc: "MAGIC110",
            alias: "2",
            season: "Spring",
            notes: "n2",
          },
          {
            plot: "3",
            ndvi: "0.5",
            yield: "abc",
            acc: "C",
            alias: "3",
            season: "",
            notes: "",
          }, // empty season → skipped
        ],
      },
    ],
    sheetConfigs: [
      cfg({
        traitColumns: [
          {
            columnHeader: "ndvi",
            traitName: "NDVI",
            units: "",
            enabled: true,
          },
          {
            columnHeader: "yield",
            traitName: "Yield",
            units: "g",
            enabled: true,
          },
        ],
        accessionNameColumn: "acc",
        aliasColumn: "alias",
        populationName: "Diversity Panel",
        seasonMode: "column",
        seasonColumn: "season",
        seasonName: "",
        metadataColumns: [{ columnHeader: "notes", label: "Notes" }],
      }),
    ],
  }

  it("emits one TraitRecordGroup per (sheet,trait) and groups by season::site", () => {
    const { groups, perTraitTotal, grandTotal } = buildTraitRecords(mapping, {
      now: FIXED_NOW,
    })
    expect(groups).toHaveLength(2)
    const ndvi = groups.find((g) => g.traitName === "NDVI")
    const yld = groups.find((g) => g.traitName === "Yield")
    expect(ndvi?.bySeasonSite.size).toBe(1)
    // NDVI: only row 1 contributes (row 2 has blank ndvi, row 3 has
    // empty season).
    expect(ndvi?.bySeasonSite.get("Spring::Davis Field A")?.length).toBe(1)
    // Yield: rows 1 and 2 both contribute (row 3 has empty season + the
    // value "abc" which is non-numeric).
    expect(yld?.bySeasonSite.get("Spring::Davis Field A")?.length).toBe(2)
    expect(perTraitTotal.get("S1::NDVI")).toBe(1)
    expect(perTraitTotal.get("S1::Yield")).toBe(2)
    expect(grandTotal).toBe(3)
  })

  it("populates record_info with sheet, source_column, germplasm cells, population, metadata", () => {
    const { groups } = buildTraitRecords(mapping, { now: FIXED_NOW })
    const ndvi = groups.find((g) => g.traitName === "NDVI")!
    const rec = ndvi.bySeasonSite.get("Spring::Davis Field A")![0]
    expect(rec.record_info).toMatchObject({
      sheet: "S1",
      source_column: "ndvi",
      population: "Diversity Panel",
      accession_name: "B73",
      germplasm_alias: "1",
      Notes: "n1",
    })
    // line_name column wasn't mapped → key absent.
    expect(rec.record_info.line_name).toBeUndefined()
  })

  it("skips a sheet with skipped=true even if it has trait columns", () => {
    const skipped: ColumnMapping = {
      ...mapping,
      sheetConfigs: [{ ...mapping.sheetConfigs[0], skipped: true }],
    }
    const { groups, grandTotal } = buildTraitRecords(skipped, {
      now: FIXED_NOW,
    })
    expect(groups).toEqual([])
    expect(grandTotal).toBe(0)
  })

  it("emits records with plot_* keys when plot column is mapped (regression)", () => {
    const { groups } = buildTraitRecords(mapping, { now: FIXED_NOW })
    const ndvi = groups.find((g) => g.traitName === "NDVI")!
    const rec = ndvi.bySeasonSite.get("Spring::Davis Field A")![0]
    expect(Object.hasOwn(rec, "plot_number")).toBe(true)
    expect(rec.plot_number).toBe(1)
    expect(Object.hasOwn(rec, "plot_row_number")).toBe(true)
    expect(Object.hasOwn(rec, "plot_column_number")).toBe(true)
  })

  describe("orphan trait records (no plot column mapped)", () => {
    const orphanMapping: ColumnMapping = {
      recordType: "trait",
      sheets: [
        {
          name: "S1",
          headers: ["ndvi", "season"],
          rows: [
            { ndvi: "0.4", season: "Spring" },
            { ndvi: "0.5", season: "Spring" },
            { ndvi: "", season: "Spring" }, // non-numeric → skipped
            { ndvi: "0.6", season: "" }, // empty season → skipped
          ],
        },
      ],
      sheetConfigs: [
        cfg({
          plotNumberColumn: null,
          plotRowColumn: null,
          plotColumnColumn: null,
          traitColumns: [
            {
              columnHeader: "ndvi",
              traitName: "NDVI",
              units: "",
              enabled: true,
            },
          ],
          seasonMode: "column",
          seasonColumn: "season",
          seasonName: "",
        }),
      ],
    }

    it("emits records (sheets without plot column no longer early-return)", () => {
      const { groups, grandTotal } = buildTraitRecords(orphanMapping, {
        now: FIXED_NOW,
      })
      expect(grandTotal).toBe(2)
      expect(groups).toHaveLength(1)
      expect(
        groups[0].bySeasonSite.get("Spring::Davis Field A")?.length,
      ).toBe(2)
    })

    it("omits plot_number / plot_row_number / plot_column_number keys", () => {
      const { groups } = buildTraitRecords(orphanMapping, { now: FIXED_NOW })
      const rec = groups[0].bySeasonSite.get("Spring::Davis Field A")![0]
      expect(Object.hasOwn(rec, "plot_number")).toBe(false)
      expect(Object.hasOwn(rec, "plot_row_number")).toBe(false)
      expect(Object.hasOwn(rec, "plot_column_number")).toBe(false)
      // The non-plot fields are still set correctly.
      expect(rec.trait_value).toBe(0.4)
      expect(typeof rec.timestamp).toBe("string")
      expect(rec.record_info).toMatchObject({
        sheet: "S1",
        source_column: "ndvi",
      })
    })
  })
})
