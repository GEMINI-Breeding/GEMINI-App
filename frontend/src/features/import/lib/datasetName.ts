/**
 * Build a default dataset name for the import wizard.
 *
 * Design goals:
 *  - **Never lie about the collection date.** The previous fallback used
 *    `today` (the upload date) when no in-data date was detected, which
 *    made the resulting name misleading. We just omit the date in that
 *    case.
 *  - **Avoid silent merges.** The `gemini.datasets` table has a global
 *    UNIQUE(dataset_name) constraint, and the `check_trait_validity`
 *    trigger is get-or-create. If two uploads share a name, their records
 *    silently land in the same dataset row. A short random hex suffix on
 *    every auto-generated name keeps re-uploads distinct by default.
 *  - **Stay human-readable.** We deliberately don't mimic the long
 *    `GEMINI__ImageData__YYYYMMDD__HHMMSS__hash` shape from the image
 *    pipeline — the typical user wants something they can spot in a list.
 *
 * Examples:
 *   buildDatasetName({ expName: "GEMINI", category: "csv_tabular" })
 *     → "GEMINI - Traits - a3f7"
 *   buildDatasetName({ expName: "GEMINI", category: "csv_tabular",
 *                      collectionDate: "2024-06-15" })
 *     → "GEMINI - Traits - 2024-06-15 - a3f7"
 *   buildDatasetName({ expName: null })
 *     → "Collection - a3f7"
 */

const CATEGORY_LABEL: Record<string, string> = {
  csv_tabular: "Traits",
  drone_imagery: "Imagery",
  genomic: "Genomic",
  thermal: "Thermal",
  elevation: "Elevation",
  mixed: "Mixed",
}

/**
 * 4-char lowercase hex. ~65k combinations is plenty to keep typical
 * same-session re-uploads distinct; the DB's UNIQUE constraint plus the
 * conflict-warning UI catch the rare collision.
 */
export function shortHex(rng: () => number = Math.random): string {
  return Math.floor(rng() * 0x10000)
    .toString(16)
    .padStart(4, "0")
}

export interface BuildDatasetNameOpts {
  expName: string | null | undefined
  /** A DataCategory string from detection-engine, or freeform. */
  category?: string | null
  /** Detected (or user-supplied) collection date — NOT upload date. */
  collectionDate?: string | null
  /** Hex disambiguator override (useful in tests). */
  hex?: string
}

export function buildDatasetName(opts: BuildDatasetNameOpts): string {
  const parts: string[] = []
  const expName = opts.expName?.trim()
  parts.push(expName || "Collection")
  const label = opts.category ? CATEGORY_LABEL[opts.category] : undefined
  if (label) parts.push(label)
  const collectionDate = opts.collectionDate?.trim()
  if (collectionDate) parts.push(collectionDate)
  parts.push(opts.hex ?? shortHex())
  return parts.join(" - ")
}
