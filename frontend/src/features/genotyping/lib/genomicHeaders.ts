/**
 * Read sample column headers from HapMap and VCF files without loading
 * the entire file into memory. Phase 9d's `StepSampleResolve` calls
 * these to get the canonical name list before resolving against the
 * backend.
 *
 * Both formats have well-known header conventions:
 *   - HapMap: a tab-delimited line whose first cell is `rs#` (or `rs`).
 *     The first 11 columns are metadata; everything after is a sample.
 *   - VCF: the line starting with `#CHROM` (after any `##` meta lines).
 *     The first 9 columns are metadata; everything after is a sample.
 *
 * Implementation reads chunks via the browser File API until it sees the
 * header line. Files larger than 64KB without a header line throw rather
 * than scan the whole file (a malformed VCF would otherwise hang the UI).
 */

const HAPMAP_META_COLS = 11
const VCF_META_COLS = 9
const HEADER_SCAN_LIMIT_BYTES = 64 * 1024

class GenomicHeaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GenomicHeaderError"
  }
}

function blobToText(blob: Blob): Promise<string> {
  // jsdom (vitest unit-test env) ships a partial Blob without text() or
  // arrayBuffer(); FileReader.readAsText is universally implemented.
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.readAsText(blob)
  })
}

async function readFirstHeaderLine(
  file: File,
  isHeader: (line: string) => boolean,
): Promise<string> {
  const chunkSize = 16 * 1024
  let offset = 0
  let buffer = ""
  while (offset < file.size && offset < HEADER_SCAN_LIMIT_BYTES) {
    const blob = file.slice(offset, offset + chunkSize)
    const text = await blobToText(blob)
    buffer += text
    offset += chunkSize
    const reachedEnd = offset >= file.size
    const lines = buffer.split(/\r?\n/)
    // Keep the last partial line in the buffer if there's more file to
    // read and the buffer doesn't end with a newline. Once we've consumed
    // the whole file, every accumulated line counts.
    const partial =
      reachedEnd || buffer.endsWith("\n") ? "" : (lines.pop() ?? "")
    for (const line of lines) {
      if (isHeader(line)) return line
    }
    buffer = partial
  }
  throw new GenomicHeaderError(
    `No header line found in the first ${HEADER_SCAN_LIMIT_BYTES} bytes of the file.`,
  )
}

export async function readHapmapSampleHeaders(file: File): Promise<string[]> {
  const line = await readFirstHeaderLine(file, (l) => /^rs#?\b/i.test(l.trim()))
  const cols = line.split(/\t/)
  if (cols.length <= HAPMAP_META_COLS) {
    throw new GenomicHeaderError(
      `HapMap header has only ${cols.length} columns; expected at least ${HAPMAP_META_COLS + 1}.`,
    )
  }
  return cols
    .slice(HAPMAP_META_COLS)
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function readVcfSampleHeaders(file: File): Promise<string[]> {
  const line = await readFirstHeaderLine(file, (l) => l.startsWith("#CHROM"))
  const cols = line.split(/\t/)
  if (cols.length <= VCF_META_COLS) {
    throw new GenomicHeaderError(
      `VCF header has only ${cols.length} columns; expected at least ${VCF_META_COLS + 1}.`,
    )
  }
  return cols
    .slice(VCF_META_COLS)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Read sample column headers from a CSV/TSV genotype matrix. Reuses the
 * matrix parser's delimiter detection by reading the first line only.
 */
export async function readMatrixSampleHeaders(file: File): Promise<string[]> {
  const blob = file.slice(0, HEADER_SCAN_LIMIT_BYTES)
  const text = await blobToText(blob)
  const headerLine = text.split(/\r?\n/)[0] ?? ""
  if (!headerLine.trim()) {
    throw new GenomicHeaderError("Matrix file has no header line.")
  }
  const tabs = (headerLine.match(/\t/g) ?? []).length
  const commas = (headerLine.match(/,/g) ?? []).length
  const delim = tabs >= commas && tabs > 0 ? "\t" : ","
  const cols = headerLine.split(delim).map((c) => c.trim())
  const metaSet = new Set([
    "variant_name",
    "variant",
    "chromosome",
    "position",
    "alleles",
    "design_sequence",
  ])
  return cols.filter((c) => !metaSet.has(c.toLowerCase()))
}

export { GenomicHeaderError }
