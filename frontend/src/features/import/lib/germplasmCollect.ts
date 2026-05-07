/**
 * Pure helpers that walk a `ColumnMapping` and pull out germplasm names
 * + their population context. Extracted so unit tests can exercise the
 * walk rules without spinning up React + react-query + the SDK.
 *
 * Used by StepGermplasmReview (9e.3) to seed the resolver and the
 * fall-back population link.
 */

import { normalizeGermplasmName } from "./germplasmResolve"
import type { ColumnMapping, SheetMapping } from "./types"

/**
 * Walk every non-skipped sheet and return the set of unique germplasm
 * names the user wants resolved. A name is any cell value from
 * accessionNameColumn, lineNameColumn, or aliasColumn, normalized via
 * `normalizeGermplasmName`. Empty strings + duplicates dropped.
 */
export function collectGermplasmNames(mapping: ColumnMapping): string[] {
  const set = new Set<string>()
  for (let i = 0; i < mapping.sheets.length; i++) {
    const sheet = mapping.sheets[i]
    const config: SheetMapping | undefined = mapping.sheetConfigs[i]
    if (!config || config.skipped) continue
    const cols = [
      config.accessionNameColumn,
      config.lineNameColumn,
      config.aliasColumn,
    ].filter((c): c is string => Boolean(c))
    if (cols.length === 0) continue
    for (const row of sheet.rows) {
      for (const col of cols) {
        const v = row[col]
        if (v == null) continue
        const trimmed = normalizeGermplasmName(String(v))
        if (trimmed) set.add(trimmed)
      }
    }
  }
  return Array.from(set)
}

/**
 * Build a germplasm-name → population-name map from the mapping. Used to
 * link new accessions/lines to a population so experiment-cascade-delete
 * can reach them via experiment → population → accession. Without this
 * link, wizard-created germplasm becomes a DB orphan the moment the
 * experiment is deleted.
 *
 * When a name appears under multiple populations, the first wins — one
 * linkage is sufficient to keep the cascade reachable.
 */
export function collectPopulationForGermplasm(
  mapping: ColumnMapping,
): Map<string, string> {
  const map = new Map<string, string>()
  for (let i = 0; i < mapping.sheets.length; i++) {
    const sheet = mapping.sheets[i]
    const config: SheetMapping | undefined = mapping.sheetConfigs[i]
    if (!config || config.skipped) continue
    const populationName = config.populationName?.trim()
    if (!populationName) continue
    const cols = [
      config.accessionNameColumn,
      config.lineNameColumn,
      config.aliasColumn,
    ].filter((c): c is string => Boolean(c))
    if (cols.length === 0) continue
    for (const row of sheet.rows) {
      for (const col of cols) {
        const v = row[col]
        if (v == null) continue
        const name = normalizeGermplasmName(String(v))
        if (name && !map.has(name)) map.set(name, populationName)
      }
    }
  }
  return map
}
