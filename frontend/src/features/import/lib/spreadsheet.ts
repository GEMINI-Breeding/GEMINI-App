/**
 * Spreadsheet parser shared by the trait wizard.
 *
 * For CSV/TSV inputs we delegate to the in-tree `parseCSV` helper from
 * `features/process/lib/csv.ts` (used by the field-design upload + the
 * Phase-9b genotype matrix path) so we share quoted-field semantics with
 * the rest of the codebase.
 *
 * For XLSX/XLS/ODS we use the SheetJS `xlsx` library — same dep + version
 * pin as `backend/gemini-ui` so that workbook quirks the reference UI
 * already handles (e.g. banner-row-before-header, blank trailing columns)
 * are handled the same way here.
 */
import * as XLSX from "xlsx"

import { parseCSV } from "@/features/process/lib/csv"
import type { ParsedSheet } from "./types"

const SPREADSHEET_EXTS = new Set(["xlsx", "xls", "ods"])

function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? ""
}

/** Detect a banner row before the real header by skipping any row with
 *  fewer than 4 populated cells. Mirrors gemini-ui detection-engine
 *  behaviour. */
function findHeaderRowIndex(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i] ?? []
    const populated = row.filter((c) => c !== "" && c != null).length
    if (populated >= 4) return i
  }
  return 0
}

function rowsFromAOA(
  aoa: unknown[][],
  headerRowIndex: number,
): { headers: string[]; rows: Record<string, unknown>[] } {
  const rawHeaders = (aoa[headerRowIndex] ?? []).map((c) =>
    String(c ?? "").trim(),
  )
  // Trim trailing empty header columns the same way `lib/csv.ts` does so a
  // worksheet that carries phantom "" headers doesn't shadow real keys.
  let lastNonEmpty = rawHeaders.length - 1
  while (lastNonEmpty >= 0 && rawHeaders[lastNonEmpty] === "") lastNonEmpty -= 1
  const headers = rawHeaders.slice(0, lastNonEmpty + 1)

  const rows: Record<string, unknown>[] = []
  for (let i = headerRowIndex + 1; i < aoa.length; i++) {
    const raw = aoa[i] ?? []
    const allEmpty = raw.every((c) => c === "" || c == null)
    if (allEmpty) continue
    const row: Record<string, unknown> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = raw[j] ?? ""
    }
    rows.push(row)
  }
  return { headers, rows }
}

/**
 * Parse any of CSV / TSV / XLSX / XLS / ODS into one or more
 * `ParsedSheet`s. Tabular files always yield a single sheet named after
 * the file (or "Sheet1"); workbooks yield one sheet per workbook tab.
 */
export async function parseSpreadsheet(file: File): Promise<ParsedSheet[]> {
  const ext = fileExtension(file.name)

  if (SPREADSHEET_EXTS.has(ext)) {
    const buffer = await readFileArrayBuffer(file)
    const wb = XLSX.read(buffer, { type: "array" })
    const sheets: ParsedSheet[] = []
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name]
      if (!sheet) continue
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
      })
      const headerRowIndex = findHeaderRowIndex(aoa)
      const { headers, rows } = rowsFromAOA(aoa, headerRowIndex)
      sheets.push({ name, headers, rows })
    }
    return sheets
  }

  // CSV / TSV / TXT path. Prefer `parseCSV` (shared with field-design); fall
  // back to manual TSV split because `parseCSV` is comma-only.
  const text = await readFileText(file)
  const isTsv =
    ext === "tsv" || (text.split("\n", 2)[0]?.includes("\t") ?? false)
  if (isTsv) {
    const lines = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .filter((l) => l.length > 0)
    if (lines.length === 0) return [{ name: file.name, headers: [], rows: [] }]
    const headers = lines[0].split("\t").map((h) => h.trim())
    const rows = lines.slice(1).map((line) => {
      const fields = line.split("\t")
      const obj: Record<string, unknown> = {}
      headers.forEach((h, i) => {
        obj[h] = (fields[i] ?? "").trim()
      })
      return obj
    })
    return [{ name: file.name, headers, rows }]
  }
  const parsed = parseCSV(text)
  return [{ name: file.name, headers: parsed.headers, rows: parsed.rows }]
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.readAsText(file)
  })
}

function readFileArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.readAsArrayBuffer(file)
  })
}

/** Read up to `maxLines` lines off the head of a text file. Used by the
 *  detection engine's HapMap/VCF preview helpers — exposed here so other
 *  callers can reuse it without bumping the detection module's surface.
 *
 *  Uses FileReader rather than `file.text()` because jsdom 22's File
 *  polyfill is missing the latter; FileReader is supported in jsdom and
 *  real browsers alike. Peak memory bounded by file size. */
export async function readFirstNLines(
  file: File,
  maxLines = 20,
  byteBudget = 32_000,
): Promise<string[]> {
  const fullText = await readFileText(file)
  const text =
    fullText.length > byteBudget ? fullText.slice(0, byteBudget) : fullText
  return text.split(/\r?\n/).slice(0, maxLines)
}
