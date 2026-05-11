/**
 * Pure helpers for the trait wizard's StepColumnMapping. Extracted so
 * unit tests can exercise the seed / pristine / validation rules without
 * spinning up a React tree + react-query + SDK mocks.
 *
 * Mirrors the behavior of `backend/gemini-ui/src/components/import-wizard/
 * step-column-mapping.tsx` — kept in sync so the reference UI stays a
 * useful comparison point.
 */
import type { ParsedSheet, SheetMapping } from "./types"

/** Sentinel value the StepColumnMapping component uses for "no column
 *  picked". Lives here so component + helpers agree on the shape. */
export const NOT_MAPPED = "__not_mapped__"

/** A fresh, empty config for one sheet — every field defaulted, nothing
 *  selected. */
export function emptySheetConfig(sheet: ParsedSheet): SheetMapping {
  return {
    sheetName: sheet.name,
    skipped: false,
    plotNumberColumn: null,
    plotRowColumn: null,
    plotColumnColumn: null,
    populationName: "",
    traitColumns: [],
    accessionNameColumn: null,
    lineNameColumn: null,
    aliasColumn: null,
    collectionDateMode: "fixed",
    collectionDate: "",
    collectionDateColumn: null,
    seasonMode: "fixed",
    seasonName: "",
    seasonColumn: null,
    siteMode: "fixed",
    siteName: "",
    siteColumn: null,
    timestampColumn: null,
    metadataColumns: [],
  }
}

/**
 * Seed a new sheet's config from the most recently visited sheet, carrying
 * forward column choices by header name. Mappings that point at a header
 * the new sheet doesn't have are dropped. Trait + metadata edits are
 * preserved for columns that do exist.
 */
export function seedSheetConfig(
  prev: SheetMapping | null,
  sheet: ParsedSheet,
): SheetMapping {
  if (!prev) return emptySheetConfig(sheet)
  const headerSet = new Set(sheet.headers)
  const copyIfPresent = (col: string | null) =>
    col && headerSet.has(col) ? col : null
  return {
    sheetName: sheet.name,
    skipped: false,
    plotNumberColumn: copyIfPresent(prev.plotNumberColumn),
    plotRowColumn: copyIfPresent(prev.plotRowColumn),
    plotColumnColumn: copyIfPresent(prev.plotColumnColumn),
    populationName: prev.populationName,
    traitColumns: prev.traitColumns
      .filter((tc) => headerSet.has(tc.columnHeader))
      .map((tc) => ({ ...tc })),
    accessionNameColumn: copyIfPresent(prev.accessionNameColumn),
    lineNameColumn: copyIfPresent(prev.lineNameColumn),
    aliasColumn: copyIfPresent(prev.aliasColumn),
    collectionDateMode: prev.collectionDateMode,
    collectionDate: prev.collectionDate,
    collectionDateColumn: copyIfPresent(prev.collectionDateColumn),
    seasonMode: prev.seasonMode,
    seasonName: prev.seasonName,
    seasonColumn: copyIfPresent(prev.seasonColumn),
    siteMode: prev.siteMode,
    siteName: prev.siteName,
    siteColumn: copyIfPresent(prev.siteColumn),
    timestampColumn: copyIfPresent(prev.timestampColumn),
    metadataColumns: prev.metadataColumns
      .filter((mc) => headerSet.has(mc.columnHeader))
      .map((mc) => ({ ...mc })),
  }
}

/** True when the sheet config is still in its just-seeded empty state, so
 *  it's safe to overwrite from the previous sheet's selections. */
export function isPristine(config: SheetMapping): boolean {
  return (
    !config.skipped &&
    config.plotNumberColumn === null &&
    config.plotRowColumn === null &&
    config.plotColumnColumn === null &&
    config.populationName === "" &&
    config.traitColumns.length === 0 &&
    config.accessionNameColumn === null &&
    config.lineNameColumn === null &&
    config.aliasColumn === null &&
    config.collectionDateMode === "fixed" &&
    config.collectionDate === "" &&
    config.collectionDateColumn === null &&
    config.seasonMode === "fixed" &&
    config.seasonName === "" &&
    config.seasonColumn === null &&
    config.siteMode === "fixed" &&
    config.siteName === "" &&
    config.siteColumn === null &&
    config.timestampColumn === null &&
    config.metadataColumns.length === 0
  )
}

/**
 * True when the sheet config is complete enough to ingest. A skipped
 * sheet is always valid (it'll be excluded). Required: at least one
 * enabled trait column with a non-empty trait name, season + site (fixed
 * value or chosen column), collection date (fixed value or chosen
 * column — "unknown" mode also counts as complete). Plot number is
 * optional: when unmapped, records are saved with NULL plot fields and
 * won't join to plot polygons on the map.
 */
export function isSheetConfigValid(config: SheetMapping): boolean {
  if (config.skipped) return true
  const enabledTraits = config.traitColumns.filter((tc) => tc.enabled)
  if (enabledTraits.length === 0) return false
  if (!enabledTraits.every((tc) => tc.traitName.trim() !== "")) return false
  if (!config.metadataColumns.every((mc) => mc.label.trim() !== "")) {
    return false
  }
  if (config.seasonMode === "fixed" && !config.seasonName.trim()) return false
  if (config.seasonMode === "column" && !config.seasonColumn) return false
  if (config.siteMode === "fixed" && !config.siteName.trim()) return false
  if (config.siteMode === "column" && !config.siteColumn) return false
  if (config.collectionDateMode === "fixed" && !config.collectionDate) {
    return false
  }
  if (config.collectionDateMode === "column" && !config.collectionDateColumn) {
    return false
  }
  return true
}

/** Set of column headers that are "in use" — picked for plot, germplasm,
 *  timestamp, season/site/date column, or metadata. Used to hide them
 *  from the trait selection list (a column should serve only one role at
 *  a time). */
export function reservedColumnSet(config: SheetMapping): Set<string> {
  const s = new Set<string>()
  if (config.plotNumberColumn) s.add(config.plotNumberColumn)
  if (config.plotRowColumn) s.add(config.plotRowColumn)
  if (config.plotColumnColumn) s.add(config.plotColumnColumn)
  if (config.accessionNameColumn) s.add(config.accessionNameColumn)
  if (config.lineNameColumn) s.add(config.lineNameColumn)
  if (config.aliasColumn) s.add(config.aliasColumn)
  if (config.collectionDateColumn) s.add(config.collectionDateColumn)
  if (config.seasonColumn) s.add(config.seasonColumn)
  if (config.siteColumn) s.add(config.siteColumn)
  if (config.timestampColumn) s.add(config.timestampColumn)
  for (const mc of config.metadataColumns) s.add(mc.columnHeader)
  return s
}
