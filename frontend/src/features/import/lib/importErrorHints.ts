/**
 * Translate cryptic backend trigger errors from the trait-record bulk
 * insert into actionable, plain-language guidance for the import wizard.
 *
 * The backend's `populate_trait_record_ids` trigger raises low-level
 * messages that mention internal UUIDs / accession IDs — useful for
 * debugging, useless to a breeder who picked the wrong column mapping.
 * `humanizeImportError` recognizes the known signatures and prepends a
 * sentence that says what went wrong AND what to change, while keeping
 * the raw detail for support.
 */

export interface ImportErrorHint {
  /** Short, plain-language explanation of the likely cause. */
  summary: string
  /** Concrete next step the user can take in the wizard. */
  action: string
  /** The original backend message, preserved for support / debugging. */
  detail: string
}

/**
 * The trigger fires this when a plot already linked to accession A gets a
 * trait record claiming accession B. In practice this almost always means
 * the user collapsed a multi-site / multi-year / multi-experiment file
 * onto a single fixed Season or Site, so the same plot_number from two
 * different fields was merged into one plot — and the two fields have
 * different germplasm.
 *
 *   'Accession mismatch on trait_records: plot <uuid> is associated with
 *    accession <A> but record supplied accession <B>'
 */
const ACCESSION_MISMATCH_RE =
  // Capture the two accession names up to end-of-line (not end-of-string)
  // so a trailing rollback note appended to the message doesn't break the
  // match.
  /Accession mismatch on trait_records: plot .* is associated with accession (.+?) but record supplied accession ([^\n]+)/

export function humanizeImportError(raw: string): ImportErrorHint | null {
  const m = ACCESSION_MISMATCH_RE.exec(raw.trim())
  if (m) {
    const [, existing, supplied] = m
    return {
      summary:
        `The same plot number ended up linked to two different germplasm` +
        ` entries ("${existing}" and "${supplied}"). This happens when a` +
        ` file covering multiple sites, years, or experiments is imported` +
        ` with a single fixed Season or Site — plot numbers that repeat` +
        ` across fields get merged into one plot.`,
      action:
        `Go Back to "Map Columns" and set Season and Site to "From column"` +
        ` (pointing at your year/location columns) instead of a fixed` +
        ` value, so each field's plots stay distinct. If a single file` +
        ` also mixes multiple experiments that reuse plot numbers, split` +
        ` it into one file per experiment.`,
      detail: raw,
    }
  }
  return null
}
