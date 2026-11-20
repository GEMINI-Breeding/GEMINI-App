/**
 * A genotyping study's `study_info` as facts a person reads: how many
 * markers and samples it holds, the file they came from, who added it.
 * Anything else in the blob is kept as short label/value notes, so nothing
 * is lost and no raw JSON reaches the screen.
 */

export interface StudyFacts {
  markers?: number
  samples?: number
  sourceFile?: string
  byAgent: boolean
  mock: boolean
  notes: Array<[string, string]>
}

const KNOWN = new Set(["n_variants", "n_samples", "source_file", "by", "mock"])

function asNumber(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) ? n : undefined
}

function label(key: string): string {
  const s = key.replace(/_/g, " ").trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function studyFacts(info: unknown): StudyFacts {
  const facts: StudyFacts = { byAgent: false, mock: false, notes: [] }
  if (info == null) return facts
  if (typeof info === "string") {
    if (info.trim()) facts.notes.push(["Note", info.trim()])
    return facts
  }
  if (typeof info !== "object") return facts
  const o = info as Record<string, unknown>
  facts.markers = asNumber(o.n_variants)
  facts.samples = asNumber(o.n_samples)
  facts.sourceFile =
    typeof o.source_file === "string" && o.source_file
      ? o.source_file
      : undefined
  facts.byAgent = o.by === "agent"
  facts.mock = o.mock === true
  for (const [k, v] of Object.entries(o)) {
    if (KNOWN.has(k) || v == null || v === "") continue
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    )
      facts.notes.push([label(k), String(v)])
  }
  return facts
}

/** "32,130 markers · 313 samples", or "" when the study does not say. */
export function sizeLine(f: StudyFacts): string {
  const parts: string[] = []
  if (f.markers != null)
    parts.push(
      `${f.markers.toLocaleString()} marker${f.markers === 1 ? "" : "s"}`,
    )
  if (f.samples != null)
    parts.push(
      `${f.samples.toLocaleString()} sample${f.samples === 1 ? "" : "s"}`,
    )
  return parts.join(" · ")
}
