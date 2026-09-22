/**
 * Adapter from GEMINIbase's trait surface to the shapes the dashboard
 * widgets were written against.
 *
 * On main a "trait record" was one extraction run's output: a GeoJSON of
 * plots with one property per trait, stamped with a date and a pipeline.
 * GEMINIbase stores one row per (trait, plot, date) instead. The closest
 * equivalent unit is every record sharing an experiment, season, site,
 * population and collection date — listed by
 * `GET /api/multivariate_analysis/catalog` and pivoted per plot by the
 * matrix endpoint's `aggregation: "date"` mode.
 *
 * A record's "pipeline" is the same group without the date, so the
 * temporal widgets ("pipeline-avg" sources) chart one field across flights
 * the way they charted one pipeline across runs.
 */
import type { FileMetadata } from "@/client"
import type { TraitRecord } from "@/features/analyze/api"
import type { MatrixRow } from "@/features/analyze/lib/multivariate"

export interface CatalogEntry {
  experiment_name?: string | null
  season_name?: string | null
  site_name?: string | null
  population?: string | null
  collection_date: string
  trait_names: string[]
  plot_count: number
  record_count: number
}

export interface RecordKey {
  experiment: string
  season: string
  site: string
  population: string
  date: string
}

const PREFIX = "tr:"

function keyOf(e: CatalogEntry): RecordKey {
  return {
    experiment: e.experiment_name ?? "",
    season: e.season_name ?? "",
    site: e.site_name ?? "",
    population: e.population ?? "",
    date: e.collection_date,
  }
}

export function encodeRecordId(k: RecordKey): string {
  return `${PREFIX}${JSON.stringify([k.experiment, k.season, k.site, k.population, k.date])}`
}

/** null for ids that aren't ours (e.g. a widget saved against main's API). */
export function decodeRecordId(id: string): RecordKey | null {
  if (!id.startsWith(PREFIX)) return null
  try {
    const v = JSON.parse(id.slice(PREFIX.length))
    if (!Array.isArray(v) || v.length !== 5) return null
    const [experiment, season, site, population, date] = v.map(String)
    return { experiment, season, site, population, date }
  } catch {
    return null
  }
}

export function pipelineIdOf(k: RecordKey): string {
  return `pl:${JSON.stringify([k.experiment, k.season, k.site, k.population])}`
}

export function pipelineNameOf(k: RecordKey): string {
  const where = [k.site, k.population].filter(Boolean).join(" · ")
  return `${k.experiment} — ${where}${k.season ? ` (${k.season})` : ""}`
}

export function catalogToRecords(entries: CatalogEntry[]): TraitRecord[] {
  return entries.map((e) => {
    const k = keyOf(e)
    return {
      id: encodeRecordId(k),
      run_id: "",
      pipeline_id: pipelineIdOf(k),
      pipeline_name: pipelineNameOf(k),
      pipeline_type: "aerial",
      workspace_id: "",
      workspace_name: k.experiment,
      date: k.date,
      experiment: k.experiment,
      location: k.site,
      population: k.population,
      platform: "",
      sensor: "",
      version: 1,
      ortho_version: null,
      ortho_name: null,
      stitch_version: null,
      stitch_name: null,
      boundary_version: null,
      boundary_name: null,
      plot_count: e.plot_count,
      trait_columns: e.trait_names,
      created_at: k.date,
    }
  })
}

/**
 * Per-plot images for one flight date: prefer PNGs under a `/{date}/`
 * folder of the population, else any the population has.
 */
export function plotImagesForDate(
  files: FileMetadata[],
  date: string,
): Map<number, string> {
  const exact = new Map<number, string>()
  const any = new Map<number, string>()
  const names = files
    .map((f) => f.object_name ?? "")
    .filter((n) => n.includes("/PlotImages/") && /\.(png|jpe?g)$/i.test(n))
    .sort()
  for (const n of names) {
    const m = (n.split("/").pop() ?? "").match(/^plot_(\d+)/i)
    if (!m) continue
    const plot = Number(m[1])
    any.set(plot, n)
    if (n.includes(`/${date}/`)) exact.set(plot, n)
  }
  for (const [plot, n] of any) if (!exact.has(plot)) exact.set(plot, n)
  return exact
}

/**
 * Matrix rows → the FeatureCollection widgets read. Geometry is null: no
 * widget draws it, and plot boundaries live per run, not per record.
 * `_image` carries the plot's image object path for the plot viewer.
 */
export function rowsToFeatureCollection(
  rows: MatrixRow[],
  traitNames: string[],
  images: Map<number, string>,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.map((r) => {
      const plot = r.plot_number ?? null
      const props: Record<string, unknown> = {
        plot_id: plot != null ? String(plot) : "",
        plot: plot,
        row: r.plot_row_number ?? null,
        col: r.plot_column_number ?? null,
        accession: r.accession_name ?? "",
        population: r.population ?? "",
      }
      for (const t of traitNames) props[t] = r.values[t] ?? null
      const img = plot != null ? images.get(plot) : undefined
      if (img) props._image = img
      return {
        type: "Feature",
        geometry: null,
        properties: props,
      } as unknown as GeoJSON.Feature
    }),
  }
}
