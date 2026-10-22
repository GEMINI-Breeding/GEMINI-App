/**
 * What an experiment holds, in the terms a person uses: uploads (data
 * brought in) and results (what the pipeline, a model or the agent made),
 * each with its season, site, population, field date and platform.
 *
 * Uploads made since the cluster-folder/upload rework record those facts in
 * `dataset_info`; results carry them in their name
 * ("LOCATE_PLANTS · GEMINI · 2026/Riverside/Cowpea · 2026-09-16 Amiga/RGB ·
 * roboflow-pod · eb4fe549"). Older uploads have neither and are listed
 * apart, with what is known.
 */
import type { DatasetOutput } from "@/client"

export interface Where {
  season: string
  site: string
  population: string
  /** Field date (when the data was collected), YYYY-MM-DD. */
  date: string
  platform: string
  sensor: string
}

export interface UploadEntry {
  kind: "upload"
  dataset: DatasetOutput
  where: Where | null
  typeLabel: string | null
  /** When it was brought into the app (YYYY-MM-DD). */
  uploaded: string | null
  sourceFolder: string | null
}

export interface ResultEntry {
  kind: "result"
  dataset: DatasetOutput
  where: Where | null
  /** "canopy cover", "roboflow-pod", … */
  what: string
  madeBy: "agent" | "model" | "pipeline"
}

export type Entry = UploadEntry | ResultEntry

function info(ds: DatasetOutput): Record<string, unknown> {
  const i = ds.dataset_info
  return i && typeof i === "object" ? (i as Record<string, unknown>) : {}
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** "SOURCE · EXP · 2026/Site/Pop · 2026-09-16 Platform/Sensor · label · id" */
export function parseResultName(
  name: string,
): { where: Where | null; what: string } | null {
  const parts = name.split(" · ").map((p) => p.trim())
  if (parts.length < 4) return null
  const [season, site, population] = parts[2].split("/")
  const m = /^(\d{4}-\d{2}-\d{2})\s+([^/]+)\/(.+)$/.exec(parts[3])
  if (!season || !site || !m) return null
  const tail = parts.slice(4)
  // A trailing 8-hex job id is bookkeeping, not part of the label.
  if (tail.length > 1 && /^[0-9a-f]{8}$/.test(tail[tail.length - 1])) tail.pop()
  return {
    where: {
      season,
      site,
      population: population ?? "",
      date: m[1],
      platform: m[2],
      sensor: m[3],
    },
    what: tail.join(" · ") || "results",
  }
}

export function classify(ds: DatasetOutput): Entry {
  const i = info(ds)
  const source = str(i.source)
  if (source || /^[A-Z_]+ · /.test(ds.dataset_name ?? "")) {
    const parsed = parseResultName(ds.dataset_name ?? "")
    return {
      kind: "result",
      dataset: ds,
      where: parsed?.where ?? null,
      what: parsed?.what ?? ds.dataset_name ?? "results",
      madeBy:
        source === "agent"
          ? "agent"
          : source === "LOCATE_PLANTS" || i.job_id
            ? "model"
            : "pipeline",
    }
  }
  const season = str(i.season)
  const date = str(i.collection_date)
  const where: Where | null =
    season && date
      ? {
          season,
          site: str(i.site),
          population: str(i.population),
          date,
          platform: str(i.platform),
          sensor: str(i.sensor),
        }
      : null
  return {
    kind: "upload",
    dataset: ds,
    where,
    typeLabel: str(i.data_type_label) || null,
    uploaded: ds.collection_date ?? null,
    sourceFolder: str(i.source_folder) || null,
  }
}

export interface SeasonGroup<T extends Entry> {
  /** "2023", or null for entries whose season is not recorded. */
  season: string | null
  entries: T[]
}

/** Newest season first; within it by field date, then site. Unknown last. */
export function bySeason<T extends Entry>(entries: T[]): SeasonGroup<T>[] {
  const groups = new Map<string | null, T[]>()
  for (const e of entries) {
    const k = e.where?.season ?? null
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  const keys = [...groups.keys()].sort((a, b) =>
    a === null ? 1 : b === null ? -1 : b.localeCompare(a),
  )
  return keys.map((season) => ({
    season,
    entries: (groups.get(season) ?? []).sort((a, b) => {
      const wa = a.where
      const wb = b.where
      if (!wa || !wb) return 0
      return (
        wa.date.localeCompare(wb.date) ||
        wa.site.localeCompare(wb.site) ||
        wa.platform.localeCompare(wb.platform)
      )
    }),
  }))
}

/** Raw/{season}/{experiment}/{site}/{population}/{date}/{platform}/{sensor}/ */
export function uploadFolder(experiment: string, w: Where): string {
  return `Raw/${w.season}/${experiment}/${w.site}/${w.population}/${w.date}/${w.platform}/${w.sensor}/`
}

/** "2026-08-21T00:00:00" → "2026-08-21"; anything else unchanged. */
export function dayOf(v: string | null | undefined): string {
  if (!v) return ""
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v)
  return m ? m[1] : v
}
