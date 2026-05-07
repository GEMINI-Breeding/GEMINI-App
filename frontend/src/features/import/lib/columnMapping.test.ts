/**
 * Pure-helper tests for the column-mapping rules. The component test
 * (StepColumnMapping.test.tsx, light integration) covers the wiring;
 * these cover the rules in isolation so a single edit to validation
 * logic doesn't have to drag QueryClient + SDK mocks along with it.
 */
import { describe, expect, it } from "vitest"
import {
  emptySheetConfig,
  isPristine,
  isSheetConfigValid,
  reservedColumnSet,
  seedSheetConfig,
} from "./columnMapping"
import type { ParsedSheet, SheetMapping } from "./types"

const sheet = (name: string, headers: string[], rowCount = 0): ParsedSheet => ({
  name,
  headers,
  rows: Array.from({ length: rowCount }, () => ({})),
})

const validBase = (overrides: Partial<SheetMapping> = {}): SheetMapping => ({
  ...emptySheetConfig(sheet("S1", ["plot", "ndvi", "season"])),
  plotNumberColumn: "plot",
  traitColumns: [
    { columnHeader: "ndvi", traitName: "NDVI", units: "", enabled: true },
  ],
  collectionDateMode: "fixed",
  collectionDate: "2026-05-01",
  seasonMode: "fixed",
  seasonName: "Summer 2026",
  siteMode: "fixed",
  siteName: "Davis Field A",
  ...overrides,
})

describe("emptySheetConfig", () => {
  it("creates a config that returns true for isPristine", () => {
    const cfg = emptySheetConfig(sheet("S1", ["a", "b"]))
    expect(isPristine(cfg)).toBe(true)
    expect(cfg.sheetName).toBe("S1")
  })
})

describe("seedSheetConfig", () => {
  it("returns a fresh empty config when prev is null", () => {
    const out = seedSheetConfig(null, sheet("S2", ["x"]))
    expect(isPristine(out)).toBe(true)
  })

  it("carries forward column choices that exist in the new sheet", () => {
    const prev = validBase({
      plotNumberColumn: "plot",
      lineNameColumn: "line",
      traitColumns: [
        { columnHeader: "ndvi", traitName: "NDVI", units: "", enabled: true },
        { columnHeader: "ndre", traitName: "NDRE", units: "", enabled: true },
      ],
      metadataColumns: [{ columnHeader: "notes", label: "Notes" }],
    })
    const out = seedSheetConfig(prev, sheet("S2", ["plot", "ndvi", "notes"]))
    expect(out.plotNumberColumn).toBe("plot")
    // line column doesn't exist on S2 → dropped.
    expect(out.lineNameColumn).toBe(null)
    // NDVI carries; NDRE dropped (column missing).
    expect(out.traitColumns.map((tc) => tc.columnHeader)).toEqual(["ndvi"])
    expect(out.metadataColumns.map((mc) => mc.columnHeader)).toEqual(["notes"])
  })

  it("carries fixed-value selections (season/site/date) wholesale", () => {
    const prev = validBase()
    const out = seedSheetConfig(prev, sheet("S2", ["plot"]))
    expect(out.seasonMode).toBe("fixed")
    expect(out.seasonName).toBe("Summer 2026")
    expect(out.siteName).toBe("Davis Field A")
    expect(out.collectionDate).toBe("2026-05-01")
  })
})

describe("isSheetConfigValid", () => {
  it("accepts a skipped sheet unconditionally", () => {
    const cfg = emptySheetConfig(sheet("S1", []))
    cfg.skipped = true
    expect(isSheetConfigValid(cfg)).toBe(true)
  })

  it("accepts a fully-configured sheet", () => {
    expect(isSheetConfigValid(validBase())).toBe(true)
  })

  it("rejects when plotNumberColumn is missing", () => {
    expect(isSheetConfigValid(validBase({ plotNumberColumn: null }))).toBe(
      false,
    )
  })

  it("rejects when no trait columns are enabled", () => {
    expect(
      isSheetConfigValid(
        validBase({
          traitColumns: [
            {
              columnHeader: "ndvi",
              traitName: "NDVI",
              units: "",
              enabled: false,
            },
          ],
        }),
      ),
    ).toBe(false)
  })

  it("rejects when an enabled trait has a blank name", () => {
    expect(
      isSheetConfigValid(
        validBase({
          traitColumns: [
            {
              columnHeader: "ndvi",
              traitName: "   ",
              units: "",
              enabled: true,
            },
          ],
        }),
      ),
    ).toBe(false)
  })

  it("rejects when a metadata column has a blank label", () => {
    expect(
      isSheetConfigValid(
        validBase({
          metadataColumns: [{ columnHeader: "notes", label: "  " }],
        }),
      ),
    ).toBe(false)
  })

  it.each([
    [
      "season fixed but blank",
      { seasonMode: "fixed" as const, seasonName: "" },
    ],
    [
      "season column but no column picked",
      { seasonMode: "column" as const, seasonColumn: null, seasonName: "" },
    ],
    ["site fixed but blank", { siteMode: "fixed" as const, siteName: "" }],
    [
      "site column but no column picked",
      { siteMode: "column" as const, siteColumn: null, siteName: "" },
    ],
    [
      "collection date fixed but blank",
      { collectionDateMode: "fixed" as const, collectionDate: "" },
    ],
    [
      "collection date column but no column picked",
      {
        collectionDateMode: "column" as const,
        collectionDateColumn: null,
        collectionDate: "",
      },
    ],
  ])("rejects when %s", (_label, overrides) => {
    expect(isSheetConfigValid(validBase(overrides))).toBe(false)
  })

  it("accepts collection date in 'unknown' mode without a value or column", () => {
    expect(
      isSheetConfigValid(
        validBase({
          collectionDateMode: "unknown",
          collectionDate: "",
          collectionDateColumn: null,
        }),
      ),
    ).toBe(true)
  })
})

describe("reservedColumnSet", () => {
  it("collects every role-bound column", () => {
    const cfg = validBase({
      plotNumberColumn: "plot",
      plotRowColumn: "row",
      plotColumnColumn: "col",
      accessionNameColumn: "acc",
      lineNameColumn: "line",
      aliasColumn: "alias",
      collectionDateMode: "column",
      collectionDateColumn: "date",
      collectionDate: "",
      seasonMode: "column",
      seasonColumn: "season",
      seasonName: "",
      siteMode: "column",
      siteColumn: "site",
      siteName: "",
      timestampColumn: "ts",
      metadataColumns: [{ columnHeader: "notes", label: "Notes" }],
    })
    const set = reservedColumnSet(cfg)
    expect(set).toEqual(
      new Set([
        "plot",
        "row",
        "col",
        "acc",
        "line",
        "alias",
        "date",
        "season",
        "site",
        "ts",
        "notes",
      ]),
    )
  })

  it("returns an empty set for an empty config", () => {
    expect(reservedColumnSet(emptySheetConfig(sheet("S1", [])))).toEqual(
      new Set<string>(),
    )
  })
})
