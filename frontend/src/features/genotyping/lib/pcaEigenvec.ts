/**
 * Parse PLINK2's `pca.eigenvec` text format.
 *
 * The file is tab-separated with a leading header row:
 *
 *   #FID  IID         PC1       PC2       PC3       …
 *   0     IT89KD-288  0.109274  -0.0341…  0.0751…   …
 *   0     IT84S-2049  0.0227…   -0.0459…  -0.1167…  …
 *
 * We only care about IID (the accession name PLINK wrote into the
 * .fam, which is what the genomic import wizard set to
 * accession_name) and the PC columns. FID is ignored — it's always
 * "0" in our pipeline because we don't model family structure.
 */

export interface PcaPoint {
  /** Accession / sample name (the .fam IID). */
  sample: string
  /** PC scores, indexed 0-based: pcs[0] = PC1, pcs[1] = PC2, … */
  pcs: number[]
}

export interface PcaTable {
  points: PcaPoint[]
  /** Number of PC columns the file actually carried (usually 10). */
  nPcs: number
}

/**
 * Parse the raw text into a structured table. Lines that aren't at
 * least `IID + 1 PC` columns wide are skipped silently.
 */
export function parsePcaEigenvec(text: string): PcaTable {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { points: [], nPcs: 0 }

  // Header: split on whitespace (tab or runs of spaces — PLINK2 docs
  // promise tabs but real files have been observed mixing both).
  const headerCols = lines[0].split(/\s+/).filter((c) => c.length > 0)
  const iidIdx = headerCols.findIndex((c) => c.toUpperCase() === "IID")
  if (iidIdx < 0) return { points: [], nPcs: 0 }
  const pcStart = iidIdx + 1
  const nPcs = headerCols.length - pcStart

  const points: PcaPoint[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/\s+/).filter((c) => c.length > 0)
    // Require the full PC column set — partial rows are almost always
    // a truncated / corrupt file and silently zero-padding them would
    // misrepresent the data on the chart.
    if (cols.length < pcStart + nPcs) continue
    const sample = cols[iidIdx]
    const pcs: number[] = []
    for (let j = 0; j < nPcs; j++) {
      const v = Number(cols[pcStart + j])
      pcs.push(Number.isFinite(v) ? v : 0)
    }
    points.push({ sample, pcs })
  }
  return { points, nPcs }
}
