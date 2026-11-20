/**
 * One flight date on the Analyze map: the trait values, the plot boundaries
 * and the orthomosaic underneath all come from that date. Traits measured
 * on one date drawn over another date's plots or image would show values
 * where nothing was measured, so the date is chosen first and the rest
 * follows from it.
 */
import type { FileMetadata } from "@/client"
import type { TraitRecord } from "@/features/analyze/api"
import { decodeRecordId } from "@/features/dashboard/lib/traitCatalog"
import {
  type FolderOrtho,
  folderOrthos,
} from "@/features/process/lib/multiOrtho"

export interface MapScope {
  experiment: string | null
  season: string | null
  site: string | null
  population: string | null
}

/** A catalog record's season: the exact name from its id, else its year. */
export function seasonOf(r: TraitRecord): string {
  return (r.id ? decodeRecordId(r.id)?.season : null) || r.date.slice(0, 4)
}

function inScope(r: TraitRecord, s: MapScope): boolean {
  return (
    (!s.experiment || r.experiment === s.experiment) &&
    (!s.site || r.location === s.site) &&
    (!s.population || r.population === s.population) &&
    (!s.season || seasonOf(r) === s.season)
  )
}

/** Filters that each allow several values (empty = any). */
export interface ScopeSets {
  experiments: Set<string>
  seasons: Set<string>
  sites: Set<string>
  populations: Set<string>
}

/** For the multivariate views: the dates with records in the filters, newest
 *  first, and the traits that can be compared — those with records in the
 *  filters, and on `date` when one date is analysed. */
export function comparable(
  records: TraitRecord[],
  f: ScopeSets,
  date: string | null,
): { dates: string[]; traits: Set<string> } {
  const any = (set: Set<string>, v: string) => set.size === 0 || set.has(v)
  const scoped = records.filter(
    (r) =>
      any(f.experiments, r.experiment) &&
      any(f.seasons, seasonOf(r)) &&
      any(f.sites, r.location) &&
      any(f.populations, r.population),
  )
  const dates = [...new Set(scoped.map((r) => r.date.slice(0, 10)))].sort(
    (a, b) => b.localeCompare(a),
  )
  const traits = new Set<string>()
  for (const r of scoped)
    if (!date || r.date.slice(0, 10) === date)
      for (const t of r.trait_columns) traits.add(t)
  return { dates, traits }
}

/** Dates with trait records or an orthomosaic in the scope, newest first. */
export function mapDates(
  records: TraitRecord[],
  orthoDates: string[],
  scope: MapScope,
): { date: string; traits: boolean; ortho: boolean }[] {
  const by = new Map<string, { traits: boolean; ortho: boolean }>()
  for (const r of records) {
    if (!inScope(r, scope) || !r.date) continue
    const d = r.date.slice(0, 10)
    by.set(d, { ...(by.get(d) ?? { ortho: false }), traits: true })
  }
  for (const d of orthoDates) {
    if (!d) continue
    by.set(d, { ...(by.get(d) ?? { traits: false }), ortho: true })
  }
  return [...by.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** The traits measured on `date` in the scope. */
export function traitsOnDate(
  records: TraitRecord[],
  scope: MapScope,
  date: string | null,
): Set<string> {
  const out = new Set<string>()
  if (!date) return out
  for (const r of records)
    if (inScope(r, scope) && r.date.slice(0, 10) === date)
      for (const t of r.trait_columns) out.add(t)
  return out
}

/** Processed folders of `date` (…/{date}/{platform}/{sensor}/) that hold an
 *  orthomosaic, from a population or site listing. */
export function dateFolders(files: FileMetadata[], date: string): string[] {
  const out = new Set<string>()
  for (const f of files) {
    const name = f.object_name ?? ""
    const m = /^(.*\/)odm_orthophoto[^/]*\.tiff?$/i.exec(name)
    if (!m) continue
    const parts = m[1].split("/").filter(Boolean)
    if (parts.at(-3) === date) out.add(m[1])
  }
  return [...out].sort()
}

/** The orthomosaics of one date, each flight's latest when the runs say
 *  which job that was (a re-run leaves the older one beside it). */
export function dateOrthos(
  files: FileMetadata[],
  date: string,
  latestJobs: Set<string>,
): FolderOrtho[] {
  const out: FolderOrtho[] = []
  for (const folder of dateFolders(files, date)) {
    const all = folderOrthos(files, folder)
    const kept = all.filter((o) => o.jobId && latestJobs.has(o.jobId))
    out.push(...(kept.length ? kept : all))
  }
  return out
}

type Feature = {
  type: "Feature"
  geometry: { type: string; coordinates: unknown }
  properties: Record<string, unknown> | null
}

/** A saved boundary version's plots, with the keys the trait join reads
 *  (plot_number / plot_row_number / plot_column_number). */
export function boundaryPlots(snapshot: unknown): Feature[] {
  const fc = (snapshot as { boundaries?: { features?: Feature[] } } | null)
    ?.boundaries
  const out: Feature[] = []
  for (const f of fc?.features ?? []) {
    const p = f.properties ?? {}
    if (p.role === "outer" || f.geometry?.type !== "Polygon") continue
    const num = (v: unknown) =>
      typeof v === "number" ? v : v != null && v !== "" ? Number(v) : null
    out.push({
      ...f,
      properties: {
        ...p,
        plot_number: num(p.plot_number ?? p.plot),
        plot_row_number: num(p.plot_row_number ?? p.row),
        plot_column_number: num(p.plot_column_number ?? p.col),
      },
    })
  }
  return out
}
