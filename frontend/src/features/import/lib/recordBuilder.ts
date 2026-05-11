/**
 * Pure helpers that walk a `ColumnMapping` and produce the work the
 * StepUpload step performs in order:
 *
 *   1. Set of trait specs → `apiTraitsCreateTrait`
 *   2. Set of population names → `apiPopulationsCreatePopulation`
 *   3. Set of season names    → `apiSeasonsCreateSeason`
 *   4. Set of site names      → `apiSitesCreateSite`
 *   5. List of plot specs     → `apiPlotsBulkCreatePlotsBulk` (chunked)
 *   6. Per (sheet, trait) record groups → `apiTraitsIdRecordsBulkBulkAddTraitRecords`
 *
 * Extracting these from the React component lets the unit suite cover
 * the surprisingly subtle row-walking rules without spinning up react-
 * query + the SDK + jsdom.
 *
 * Mirrors `backend/gemini-ui/src/components/import-wizard/step-upload.tsx`.
 */
import { germplasmMappingMode } from "./germplasmMode"
import type {
  ColumnMapping,
  GermplasmReview,
  ParsedSheet,
  SheetMapping,
} from "./types"

/** Pull a row's germplasm value, preferring accession > line > alias. */
export function pickGermplasmFromRow(
  row: Record<string, unknown>,
  config: SheetMapping,
): string | null {
  const tryColumn = (col: string | null): string | null => {
    if (!col) return null
    const v = row[col]
    if (v == null) return null
    const trimmed = String(v).trim()
    return trimmed || null
  }
  return (
    tryColumn(config.accessionNameColumn) ??
    tryColumn(config.lineNameColumn) ??
    tryColumn(config.aliasColumn)
  )
}

/** Map of trait_name → units (default ""). Order isn't preserved by Map
 *  insertion-order semantics matter here because we ship them to the
 *  backend in this order; the user typically expects creation order to
 *  follow the spreadsheet's column order. */
export function collectTraitUnits(mapping: ColumnMapping): Map<string, string> {
  const m = new Map<string, string>()
  for (const config of mapping.sheetConfigs) {
    if (!config || config.skipped) continue
    for (const tc of config.traitColumns.filter((t) => t.enabled)) {
      if (!m.has(tc.traitName)) m.set(tc.traitName, tc.units || "")
    }
  }
  return m
}

/** Set of population names referenced by any unskipped sheet (trimmed,
 *  blanks dropped). */
export function collectPopulationNames(mapping: ColumnMapping): Set<string> {
  const s = new Set<string>()
  for (const config of mapping.sheetConfigs) {
    if (!config || config.skipped) continue
    if (config.populationName.trim()) s.add(config.populationName.trim())
  }
  return s
}

interface ScopeNamesResult {
  seasonNames: Set<string>
  siteNames: Set<string>
}

/** Collect every season + site name that shows up across the sheets,
 *  whether configured as a fixed value or read from a column. */
export function collectSeasonAndSiteNames(
  mapping: ColumnMapping,
): ScopeNamesResult {
  const seasonNames = new Set<string>()
  const siteNames = new Set<string>()
  for (let si = 0; si < mapping.sheets.length; si++) {
    const config = mapping.sheetConfigs[si]
    if (!config || config.skipped) continue
    if (config.seasonMode === "fixed" && config.seasonName.trim()) {
      seasonNames.add(config.seasonName.trim())
    } else if (config.seasonMode === "column" && config.seasonColumn) {
      for (const row of mapping.sheets[si].rows) {
        const v = row[config.seasonColumn]
        if (v != null && String(v).trim() !== "") {
          seasonNames.add(String(v).trim())
        }
      }
    }
    if (config.siteMode === "fixed" && config.siteName.trim()) {
      siteNames.add(config.siteName.trim())
    } else if (config.siteMode === "column" && config.siteColumn) {
      for (const row of mapping.sheets[si].rows) {
        const v = row[config.siteColumn]
        if (v != null && String(v).trim() !== "") {
          siteNames.add(String(v).trim())
        }
      }
    }
  }
  return { seasonNames, siteNames }
}

export interface PlotSpec {
  plotNumber: number
  plotRow: number
  plotCol: number
  season: string
  site: string
  population?: string
  /** Canonical accession name resolved from the spreadsheet's germplasm
   *  cell — either via the review step's `germplasmReview` (ambiguous
   *  mapping) or inline from the row value (unambiguous accession-only /
   *  line-only). Undefined when no germplasm column was mapped or the
   *  row was marked skip. */
  accessionName?: string
}

export interface PlotCollectionResult {
  plotSpecs: PlotSpec[]
  /** Unique raw germplasm names used inline (non-ambiguous mapping).
   *  StepUpload pre-creates these as Accessions (or Line + Accession for
   *  the line-only case) before the bulk plot insert. */
  inlineGermplasmNames: Set<string>
  /** Raw germplasm values that didn't appear in the review step's
   *  resolved map. Surfaced as a warning — they get no accession link. */
  missingGermplasmRefs: Set<string>
}

/**
 * Walk every row of every unskipped sheet and turn it into a deduped
 * list of `PlotSpec`s, plus the auxiliary sets the upload step needs
 * (inline germplasm names to create, missing-from-review names to warn
 * about).
 */
export function collectPlotSpecs(
  mapping: ColumnMapping,
  germplasmReview: GermplasmReview | null,
): PlotCollectionResult {
  const mode = germplasmMappingMode(mapping)
  const resolutionMap = germplasmReview?.resolved ?? {}
  const plotSpecs: PlotSpec[] = []
  const seen = new Set<string>()
  const inlineGermplasmNames = new Set<string>()
  const missingGermplasmRefs = new Set<string>()

  for (let si = 0; si < mapping.sheets.length; si++) {
    const sheet = mapping.sheets[si]
    const config = mapping.sheetConfigs[si]
    if (!config || config.skipped || !config.plotNumberColumn) continue
    const populationName = config.populationName.trim() || undefined

    for (const row of sheet.rows) {
      const plotRaw = row[config.plotNumberColumn]
      if (plotRaw == null || plotRaw === "") continue
      const plotNumber = Number(plotRaw)
      if (Number.isNaN(plotNumber)) continue

      let plotRow = 0
      if (config.plotRowColumn && row[config.plotRowColumn] != null) {
        const v = Number(row[config.plotRowColumn])
        if (!Number.isNaN(v)) plotRow = v
      }
      let plotCol = 0
      if (config.plotColumnColumn && row[config.plotColumnColumn] != null) {
        const v = Number(row[config.plotColumnColumn])
        if (!Number.isNaN(v)) plotCol = v
      }

      const rowSeason = rowScalar(
        row,
        config.seasonMode,
        config.seasonColumn,
        config.seasonName,
      )
      const rowSite = rowScalar(
        row,
        config.siteMode,
        config.siteColumn,
        config.siteName,
      )
      if (!rowSeason || !rowSite) continue

      let accessionName: string | undefined
      const rowGermplasm = pickGermplasmFromRow(row, config)
      if (rowGermplasm) {
        if (mode === "ambiguous") {
          const hit = resolutionMap[rowGermplasm]
          if (hit?.canonical_name && hit.match_kind !== "unresolved") {
            accessionName = hit.canonical_name
          } else if (!hit) {
            missingGermplasmRefs.add(rowGermplasm)
          }
        } else if (mode === "accession-only" || mode === "line-only") {
          accessionName = rowGermplasm
          inlineGermplasmNames.add(rowGermplasm)
        }
      }

      const key = `${rowSeason}::${rowSite}::${plotNumber}::${plotRow}::${plotCol}`
      if (seen.has(key)) continue
      seen.add(key)
      plotSpecs.push({
        plotNumber,
        plotRow,
        plotCol,
        season: rowSeason,
        site: rowSite,
        population: populationName,
        accessionName,
      })
    }
  }
  return { plotSpecs, inlineGermplasmNames, missingGermplasmRefs }
}

function rowScalar(
  row: Record<string, unknown>,
  mode: "fixed" | "column",
  column: string | null,
  fixed: string,
): string {
  if (mode === "column" && column) {
    const v = row[column]
    return v != null ? String(v).trim() : ""
  }
  return fixed.trim()
}

export interface TraitRecord {
  trait_value: number
  /** Omitted entirely when the sheet has no plot number column mapped —
   *  those records are saved with NULL plot fields ("orphan" traits) and
   *  won't appear on the plot map. */
  plot_number?: number
  plot_row_number?: number
  plot_column_number?: number
  /** Per-row germplasm name (accession-preferred, line, then alias).
   *  The backend's populate_trait_record_ids trigger resolves this to
   *  accession_id at INSERT time and RAISEs if it doesn't match a real
   *  accession. Omitted when no germplasm column is mapped and no plot
   *  is mapped either — the trigger then leaves accession_id NULL and
   *  the record won't appear in GWAS phenotype lookups. */
  accession_name?: string
  record_info: Record<string, unknown>
  timestamp: string
}

export interface TraitRecordGroup {
  sheetName: string
  traitName: string
  traitColumnHeader: string
  /** Records grouped by `${season}::${site}` so the bulk POST has a
   *  single (season_name, site_name) per call. */
  bySeasonSite: Map<string, TraitRecord[]>
  /** Fixed collection date (yyyy-mm-dd) when the sheet's
   *  collectionDateMode === "fixed" and a date was set. */
  collectionDate?: string
}

interface BuildTraitRecordsOptions {
  /** Monotonically incrementing offset used to disambiguate auto-
   *  generated timestamps when the sheet has none. Mirrors gemini-ui's
   *  `tsOffset` so unit tests can match its output exactly. */
  tsOffsetStart?: number
  /** Override `Date.now()` for stable test timestamps. */
  now?: () => Date
}

export interface BuildTraitRecordsResult {
  groups: TraitRecordGroup[]
  /** Per-sheet × per-trait totals. Keys are `${sheetName}::${traitName}`. */
  perTraitTotal: Map<string, number>
  grandTotal: number
}

/**
 * Walk the mapping and emit ready-to-POST trait record groups, plus the
 * per-trait totals the UI uses to drive its progress display.
 *
 * A row contributes a record to (sheet S, trait T) iff:
 *   - the trait column has a numeric value in this row,
 *   - the plot number column has a numeric value in this row,
 *   - the row's resolved season + site (fixed value or column) are
 *     non-empty.
 *
 * `record_info` carries the sheet name, source column, the raw germplasm
 * cells (whitespace-trimmed) under `accession_name` / `line_name` /
 * `germplasm_alias`, the population (when set), and any user-selected
 * metadata columns under their labels.
 */
export function buildTraitRecords(
  mapping: ColumnMapping,
  options: BuildTraitRecordsOptions = {},
): BuildTraitRecordsResult {
  const groups: TraitRecordGroup[] = []
  const perTraitTotal = new Map<string, number>()
  let grandTotal = 0
  let tsOffset = options.tsOffsetStart ?? 0
  const now = options.now ?? (() => new Date())

  for (let si = 0; si < mapping.sheets.length; si++) {
    const sheet: ParsedSheet = mapping.sheets[si]
    const config = mapping.sheetConfigs[si]
    if (!config || config.skipped) continue
    const enabledTraits = config.traitColumns.filter((tc) => tc.enabled)
    if (enabledTraits.length === 0) continue
    // When no plot column is mapped, every row contributes an orphan
    // record (no plot_number/row/col). When a plot column IS mapped, a
    // row without a numeric value in that column is skipped — preserves
    // the prior behavior of dropping partial-plot rows.
    const hasPlotColumn = !!config.plotNumberColumn

    const sheetBaseDate =
      config.collectionDateMode === "fixed" && config.collectionDate
        ? new Date(`${config.collectionDate}T12:00:00`)
        : now()
    const sheetCollectionDate =
      config.collectionDateMode === "fixed" && config.collectionDate
        ? config.collectionDate
        : undefined

    for (const trait of enabledTraits) {
      const bySeasonSite = new Map<string, TraitRecord[]>()
      const traitKey = `${sheet.name}::${trait.traitName}`
      let count = 0

      for (const row of sheet.rows) {
        const raw = row[trait.columnHeader]
        if (raw == null || raw === "") continue
        const value = Number(raw)
        if (Number.isNaN(value)) continue

        let plotNumber: number | undefined
        let plotRow: number | undefined
        let plotCol: number | undefined
        if (hasPlotColumn) {
          const plotRaw = row[config.plotNumberColumn as string]
          if (plotRaw == null || plotRaw === "") continue
          const n = Number(plotRaw)
          if (Number.isNaN(n)) continue
          plotNumber = n
          plotRow = 0
          if (config.plotRowColumn && row[config.plotRowColumn] != null) {
            const v = Number(row[config.plotRowColumn])
            if (!Number.isNaN(v)) plotRow = v
          }
          plotCol = 0
          if (config.plotColumnColumn && row[config.plotColumnColumn] != null) {
            const v = Number(row[config.plotColumnColumn])
            if (!Number.isNaN(v)) plotCol = v
          }
        }

        const recordInfo: Record<string, unknown> = {
          sheet: sheet.name,
          source_column: trait.columnHeader,
        }
        if (config.populationName.trim()) {
          recordInfo.population = config.populationName.trim()
        }
        if (config.accessionNameColumn) {
          const v = row[config.accessionNameColumn]
          recordInfo.accession_name = v != null ? String(v).trim() : null
        }
        if (config.lineNameColumn) {
          const v = row[config.lineNameColumn]
          recordInfo.line_name = v != null ? String(v).trim() : null
        }
        if (config.aliasColumn) {
          const v = row[config.aliasColumn]
          recordInfo.germplasm_alias = v != null ? String(v).trim() : null
        }
        for (const mc of config.metadataColumns) {
          const v = row[mc.columnHeader]
          recordInfo[mc.label] = v != null ? v : null
        }

        let timestamp: string
        if (config.timestampColumn && row[config.timestampColumn] != null) {
          timestamp = String(row[config.timestampColumn])
        } else if (
          config.collectionDateMode === "column" &&
          config.collectionDateColumn
        ) {
          const cdRaw = row[config.collectionDateColumn]
          if (cdRaw != null && String(cdRaw).trim() !== "") {
            timestamp = new Date(`${String(cdRaw)}T12:00:00`).toISOString()
          } else {
            timestamp = new Date(
              sheetBaseDate.getTime() + tsOffset * 1000,
            ).toISOString()
          }
        } else {
          timestamp = new Date(
            sheetBaseDate.getTime() + tsOffset * 1000,
          ).toISOString()
        }
        tsOffset++

        const rowSeason = rowScalar(
          row,
          config.seasonMode,
          config.seasonColumn,
          config.seasonName,
        )
        const rowSite = rowScalar(
          row,
          config.siteMode,
          config.siteColumn,
          config.siteName,
        )
        // gemini-ui's StepUpload didn't filter these — empty season/site
        // rows shipped as `::` keyed records. We drop them to match the
        // collectPlotSpecs walk's behavior; both walks must agree on
        // which rows count or perTraitTotal vs grandTotal would diverge
        // from what the bulk POST actually inserts.
        if (!rowSeason || !rowSite) continue
        const key = `${rowSeason}::${rowSite}`

        const record: TraitRecord = {
          trait_value: value,
          record_info: recordInfo,
          timestamp,
        }
        if (hasPlotColumn) {
          record.plot_number = plotNumber
          record.plot_row_number = plotRow
          record.plot_column_number = plotCol
        }
        // Per-row germplasm. `pickGermplasmFromRow` already enforces
        // the accession > line > alias priority the wizard documents.
        // We surface it as a top-level record field so the backend's
        // populate_trait_record_ids trigger can resolve it to
        // accession_id (and RAISE on a typo) instead of leaving it
        // buried inside record_info JSONB where no FK/trigger can
        // reach it.
        const germplasm = pickGermplasmFromRow(row, config)
        if (germplasm) record.accession_name = germplasm
        let bucket = bySeasonSite.get(key)
        if (!bucket) {
          bucket = []
          bySeasonSite.set(key, bucket)
        }
        bucket.push(record)
        count++
      }

      if (count > 0) {
        groups.push({
          sheetName: sheet.name,
          traitName: trait.traitName,
          traitColumnHeader: trait.columnHeader,
          bySeasonSite,
          collectionDate: sheetCollectionDate,
        })
        perTraitTotal.set(traitKey, count)
        grandTotal += count
      }
    }
  }

  return { groups, perTraitTotal, grandTotal }
}
