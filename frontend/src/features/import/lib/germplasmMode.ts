/**
 * Classification of germplasm columns across the active sheets of a
 * `ColumnMapping`. Lifted out of `WizardShell.tsx` so library helpers
 * (recordBuilder, etc.) can use it without pulling React.
 *
 * Rules (matches the reference gemini-ui UI):
 *   - any alias column on any sheet → "ambiguous"
 *   - both accession AND line columns somewhere → "ambiguous"
 *   - only accession columns         → "accession-only"
 *   - only line columns              → "line-only"
 *   - no germplasm columns at all    → "none"
 */
import type { ColumnMapping } from "./types"

export type GermplasmMappingMode =
  | "none"
  | "accession-only"
  | "line-only"
  | "ambiguous"

export function germplasmMappingMode(
  mapping: ColumnMapping | null,
): GermplasmMappingMode {
  if (!mapping) return "none"
  let sawAccession = false
  let sawLine = false
  let sawAlias = false
  for (const c of mapping.sheetConfigs) {
    if (c.skipped) continue
    if (c.accessionNameColumn) sawAccession = true
    if (c.lineNameColumn) sawLine = true
    if (c.aliasColumn) sawAlias = true
  }
  if (!sawAccession && !sawLine && !sawAlias) return "none"
  if (sawAlias) return "ambiguous"
  if (sawAccession && sawLine) return "ambiguous"
  if (sawAccession) return "accession-only"
  return "line-only"
}
