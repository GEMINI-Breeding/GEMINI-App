/**
 * Tiny CSV utilities shared by upload dialogs.
 *
 * Why hand-rolled and not papaparse: the inputs we handle (msgs_synced
 * manifests, field-design CSVs) are well-formed exports from spreadsheets;
 * we don't need streaming, type coercion, or worker offloading. Keeping
 * the parser in-tree avoids a 30 KB dep for what amounts to ~80 lines.
 *
 * Strips a UTF-8 BOM if present and drops trailing empty header columns
 * (common when a spreadsheet exports a sparse header row like
 * `a,b,c,,` — those phantom "" columns would otherwise become real keys
 * and shadow real data when callers do `row[""]`).
 */

export type ParsedCsv = {
  headers: string[]
  rows: Record<string, string>[]
}

export function parseCSV(text: string): ParsedCsv {
  const stripped = text.replace(/^﻿/, "")
  const lines = stripped
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter(Boolean)
  if (!lines.length) return { headers: [], rows: [] }

  const rawHeaders = parseLine(lines[0]).map((h) => h.trim())
  // Trim trailing empty header columns (e.g. "a,b,c,," → ["a","b","c"]).
  let lastNonEmpty = rawHeaders.length - 1
  while (lastNonEmpty >= 0 && rawHeaders[lastNonEmpty] === "") lastNonEmpty -= 1
  const headers = rawHeaders.slice(0, lastNonEmpty + 1)

  const rows = lines.slice(1).map((line) => {
    const vals = parseLine(line)
    return Object.fromEntries(
      headers.map((h, i) => [h, (vals[i] ?? "").trim()]),
    )
  })
  return { headers, rows }
}

function parseLine(line: string): string[] {
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
    } else if (ch === "," && !inQ) {
      fields.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
}

/**
 * Auto-detect the best source column for a target key by trying a list of
 * aliases (case-insensitive). Returns "" when nothing matches so callers
 * can render the dropdown in an unselected state.
 */
export function autoDetect(
  headers: string[],
  aliases: readonly string[],
): string {
  const lower = headers.map((h) => h.toLowerCase())
  for (const alias of aliases) {
    const a = alias.toLowerCase()
    const idx = lower.findIndex((h) => h === a || h.startsWith(a))
    if (idx !== -1) return headers[idx]
  }
  return ""
}

/**
 * Re-emit `rows` as CSV with mapped columns first (renamed to their target
 * keys) followed by passthrough columns. Used to round-trip a user's CSV
 * into a normalized form for storage.
 */
export function remapAndSerialize<K extends string>(
  rows: Record<string, string>[],
  mapping: Partial<Record<K, string>>,
): string {
  if (!rows.length) return ""
  const usedSources = new Set(
    Object.values(mapping).filter(Boolean) as string[],
  )
  const passthroughCols = Object.keys(rows[0]).filter(
    (c) => !usedSources.has(c),
  )
  const newHeaders: string[] = [
    ...Object.entries(mapping)
      .filter(([, src]) => src)
      .map(([tgt]) => tgt),
    ...passthroughCols,
  ]
  const lines = [newHeaders.join(",")]
  for (const row of rows) {
    const vals = newHeaders.map((h) => {
      const src = (mapping as Record<string, string>)[h] ?? h
      const v = row[src] ?? ""
      return v.includes(",") || v.includes('"') || v.includes("\n")
        ? `"${v.replace(/"/g, '""')}"`
        : v
    })
    lines.push(vals.join(","))
  }
  return lines.join("\n")
}
