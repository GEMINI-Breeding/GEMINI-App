/**
 * Parse a CSV/TSV genotype matrix into the shape `GenotypeMatrixBatchInput`
 * expects.
 *
 * Format (one row per variant, samples as columns):
 *
 *   variant_name,chromosome,position,alleles,design_sequence,SAMPLE1,SAMPLE2,…
 *   SNP_001,1,12345,A/G,ACGTACGT,A/A,A/G,…
 *
 * Only `variant_name` is required on a row. Any of the next four metadata
 * columns may be absent (left blank or omitted from the header entirely);
 * the backend defaults the missing fields. Empty calls and the literal
 * strings `""`, `"NA"`, `"."`, `"--"` are normalised to `null` so the
 * server can skip those records cleanly.
 *
 * The parser auto-detects tab vs. comma delimiter from the header line so
 * users can drop in either CSV or TSV without flipping a switch.
 */
import type {
  GenotypeMatrixBatchInput,
  GenotypeMatrixVariantRow,
} from "@/client"

export type GenotypeMatrixParseResult = {
  batch: GenotypeMatrixBatchInput
  /** Header columns the parser interpreted as samples (everything after the
   *  meta columns). Used for the dialog preview. */
  sampleHeaders: string[]
  /** Header columns the parser interpreted as variant metadata. */
  metaHeaders: string[]
  /** Number of variant rows the parser produced. */
  variantCount: number
  /** Non-fatal parse warnings (rows skipped, unknown columns dropped, etc.). */
  warnings: string[]
}

const META_COLUMNS = [
  "variant_name",
  "chromosome",
  "position",
  "alleles",
  "design_sequence",
] as const

const NULL_CALL_TOKENS = new Set(["", "NA", "N/A", "na", ".", "--", "?"])

function detectDelimiter(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) ?? []).length
  const commas = (headerLine.match(/,/g) ?? []).length
  // TSV wins on tie because variant alleles ("A/G") and column metadata
  // ("AC,GT") can both contain commas in the wild; tabs are unambiguous.
  return tabs >= commas && tabs > 0 ? "\t" : ","
}

function splitLine(line: string, delim: string): string[] {
  // Quoted-field handling. Mirrors the in-tree `parseCSV` parser but
  // accepts an arbitrary single-character delimiter.
  const fields: string[] = []
  let cur = ""
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQ = !inQ
      }
    } else if (ch === delim && !inQ) {
      fields.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields.map((f) => f.trim())
}

function toNumberOrNull(raw: string): number | null {
  if (raw === "") return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function normaliseCall(raw: string): string | null {
  const trimmed = raw.trim()
  if (NULL_CALL_TOKENS.has(trimmed)) return null
  return trimmed
}

export class GenotypeMatrixParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GenotypeMatrixParseError"
  }
}

interface ParsedHeader {
  delim: string
  lines: string[]
  headers: string[]
  variantNameIdx: number
  metaIdx: Record<string, number>
  sampleIndices: number[]
  sampleHeaders: string[]
  metaHeaders: string[]
}

function parseHeader(text: string): ParsedHeader {
  const stripped = text.replace(/^﻿/, "")
  const rawLines = stripped
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
  const lines = rawLines.filter((l) => l.trim().length > 0)
  if (lines.length === 0) {
    throw new GenotypeMatrixParseError("File is empty.")
  }

  const delim = detectDelimiter(lines[0])
  const headers = splitLine(lines[0], delim).map((h) => h.trim())
  if (!headers.length) {
    throw new GenotypeMatrixParseError("Header row could not be parsed.")
  }

  const variantNameIdx = headers.findIndex(
    (h) => h.toLowerCase() === "variant_name" || h.toLowerCase() === "variant",
  )
  if (variantNameIdx === -1) {
    throw new GenotypeMatrixParseError(
      "Header is missing a 'variant_name' column.",
    )
  }

  const metaIdx: Record<string, number> = {}
  for (const meta of META_COLUMNS) {
    const idx = headers.findIndex((h) => h.toLowerCase() === meta)
    if (idx !== -1) metaIdx[meta] = idx
  }

  const sampleIndices: number[] = []
  for (let i = 0; i < headers.length; i++) {
    const name = headers[i].toLowerCase()
    if (META_COLUMNS.includes(name as (typeof META_COLUMNS)[number])) continue
    sampleIndices.push(i)
  }
  if (sampleIndices.length === 0) {
    throw new GenotypeMatrixParseError(
      "No sample columns found. The matrix needs at least one column besides the metadata fields.",
    )
  }

  const sampleHeaders = sampleIndices.map((i) => headers[i])
  const metaHeaders = META_COLUMNS.filter((m) => m in metaIdx) as string[]

  return {
    delim,
    lines,
    headers,
    variantNameIdx,
    metaIdx,
    sampleIndices,
    sampleHeaders,
    metaHeaders,
  }
}

function parseRow(
  fields: string[],
  variantNameIdx: number,
  metaIdx: Record<string, number>,
  sampleIndices: number[],
): GenotypeMatrixVariantRow | null {
  const variantName = (fields[variantNameIdx] ?? "").trim()
  if (!variantName) return null
  const chromosome =
    "chromosome" in metaIdx
      ? toNumberOrNull(fields[metaIdx.chromosome] ?? "")
      : null
  const position =
    "position" in metaIdx
      ? toNumberOrNull(fields[metaIdx.position] ?? "")
      : null
  const alleles =
    "alleles" in metaIdx ? (fields[metaIdx.alleles] ?? "").trim() || null : null
  const design_sequence =
    "design_sequence" in metaIdx
      ? (fields[metaIdx.design_sequence] ?? "").trim() || null
      : null
  const calls = sampleIndices.map((i) => normaliseCall(fields[i] ?? ""))
  return {
    variant_name: variantName,
    chromosome,
    position,
    alleles,
    design_sequence,
    calls,
  }
}

export function parseGenotypeMatrix(text: string): GenotypeMatrixParseResult {
  const h = parseHeader(text)
  const warnings: string[] = []
  const variant_rows: GenotypeMatrixVariantRow[] = []
  for (let li = 1; li < h.lines.length; li++) {
    const fields = splitLine(h.lines[li], h.delim)
    const row = parseRow(fields, h.variantNameIdx, h.metaIdx, h.sampleIndices)
    if (!row) {
      warnings.push(`Row ${li + 1}: missing variant_name; skipped.`)
      continue
    }
    variant_rows.push(row)
  }

  if (variant_rows.length === 0) {
    throw new GenotypeMatrixParseError(
      "No variant rows after header — file appears to contain only a header.",
    )
  }

  return {
    batch: {
      sample_headers: h.sampleHeaders,
      variant_rows,
    },
    sampleHeaders: h.sampleHeaders,
    metaHeaders: h.metaHeaders,
    variantCount: variant_rows.length,
    warnings,
  }
}

/**
 * Streaming variant of {@link parseGenotypeMatrix} that yields batches of
 * variant rows. Used by Phase 9d's `StepIngestGenomic` so a 50k-row matrix
 * doesn't hold the entire `variant_rows` array in memory while POSTing.
 *
 * Each yield carries the same `sample_headers` (pinned at the header row),
 * the slice of variant rows for that batch, the batch index, and the
 * accumulated row count + warnings so far. Callers POST each batch
 * directly to the ingest endpoint without re-batching.
 *
 * Empty matrices throw the same `GenotypeMatrixParseError` as the
 * non-streaming path; callers don't need to special-case "no rows".
 */
export type GenotypeMatrixBatchYield = {
  batch: GenotypeMatrixBatchInput
  /** 0-indexed batch number. */
  batchIndex: number
  /** Total rows yielded across all batches so far (including this one). */
  totalRows: number
  /** Cumulative warnings for skipped rows. New entries each yield. */
  warnings: string[]
  sampleHeaders: string[]
  metaHeaders: string[]
}

export function* parseGenotypeMatrixBatches(
  text: string,
  batchSize = 500,
): Generator<GenotypeMatrixBatchYield, void, void> {
  if (batchSize <= 0) {
    throw new GenotypeMatrixParseError("batchSize must be > 0")
  }
  const h = parseHeader(text)
  const warnings: string[] = []
  let buffer: GenotypeMatrixVariantRow[] = []
  let batchIndex = 0
  let totalRows = 0

  for (let li = 1; li < h.lines.length; li++) {
    const fields = splitLine(h.lines[li], h.delim)
    const row = parseRow(fields, h.variantNameIdx, h.metaIdx, h.sampleIndices)
    if (!row) {
      warnings.push(`Row ${li + 1}: missing variant_name; skipped.`)
      continue
    }
    buffer.push(row)
    totalRows++
    if (buffer.length >= batchSize) {
      yield {
        batch: { sample_headers: h.sampleHeaders, variant_rows: buffer },
        batchIndex: batchIndex++,
        totalRows,
        warnings: [...warnings],
        sampleHeaders: h.sampleHeaders,
        metaHeaders: h.metaHeaders,
      }
      buffer = []
    }
  }

  if (buffer.length > 0) {
    yield {
      batch: { sample_headers: h.sampleHeaders, variant_rows: buffer },
      batchIndex: batchIndex++,
      totalRows,
      warnings: [...warnings],
      sampleHeaders: h.sampleHeaders,
      metaHeaders: h.metaHeaders,
    }
    return
  }

  if (totalRows === 0) {
    throw new GenotypeMatrixParseError(
      "No variant rows after header — file appears to contain only a header.",
    )
  }
}
