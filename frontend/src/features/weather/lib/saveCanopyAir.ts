/**
 * Store canopy − air temperature as traits: one dataset per thermal run
 * (flight), named after it, so Analyze treats it like any other trait. Saving
 * again replaces this scope's earlier canopy − air datasets for those dates.
 */
import {
  type DatasetOutput,
  DatasetsService,
  type TraitOutput,
  TraitsService,
} from "@/client"
import { idAsString } from "@/features/admin/lib/ids"
import { type CanopyAirRow, CTD_REL_TRAIT, CTD_TRAIT } from "./canopyAir"

export const SOURCE = "CANOPY_AIR"
const DATASET_TYPE_TRAIT = 2

export interface SaveScope {
  experiment: string
  year: string
  site: string
}

async function ensureTrait(
  name: string,
  units: string,
  experiment: string,
  info: string,
): Promise<string> {
  // The search only finds traits linked to the experiment.
  const found = ((await TraitsService.apiTraitsGetTraits({
    traitName: name,
    experimentName: experiment,
  }).catch(() => [])) ?? []) as TraitOutput[]
  const hit = found.find((t) => t.trait_name === name)
  if (hit?.id) return idAsString(hit.id)
  try {
    const made = await TraitsService.apiTraitsCreateTrait({
      requestBody: {
        trait_name: name,
        trait_units: units,
        trait_level_id: 2,
        experiment_name: experiment,
        trait_info: { description: info, source: SOURCE },
      },
    })
    if (made?.id) return idAsString(made.id)
  } catch {
    // Names are unique: it exists already (for another experiment).
  }
  const all = ((await TraitsService.apiTraitsAllGetAllTraits({
    limit: 5000,
  })) ?? []) as TraitOutput[]
  const any = all.find((t) => t.trait_name === name)
  if (!any?.id) throw new Error(`Could not make the trait ${name}`)
  return idAsString(any.id)
}

/** "PLOT_FRAMES · … · d7905fed" → "d7905fed" (the thermal run it came from). */
const runId = (name: string) => /([0-9a-f]{8})\s*$/.exec(name)?.[1] ?? "run"

export function datasetName(
  scope: SaveScope,
  population: string,
  date: string,
  thermalDataset: string,
): string {
  return `${SOURCE} · ${scope.experiment} · ${scope.year}/${scope.site}/${population} · ${date} · ${runId(thermalDataset)}`
}

export async function saveCanopyAir(
  scope: SaveScope,
  rows: CanopyAirRow[],
  opts: { relative: boolean; halfWindow: number },
): Promise<{ records: number; flights: number }> {
  if (!rows.length) return { records: 0, flights: 0 }

  // Earlier canopy − air datasets of these dates and crops.
  const prefixes = new Set(
    rows.map(
      (r) =>
        `${SOURCE} · ${scope.experiment} · ${scope.year}/${scope.site}/${r.record.population_name ?? ""} · ${r.date}`,
    ),
  )
  const existing = ((await DatasetsService.apiDatasetsGetDatasets({
    experimentName: scope.experiment,
  })) ?? []) as DatasetOutput[]
  for (const d of existing) {
    const n = d.dataset_name ?? ""
    if ([...prefixes].some((p) => n.startsWith(p)))
      await DatasetsService.apiDatasetsIdDatasetIdDeleteDataset({
        datasetId: idAsString(d.id),
      })
  }

  const traits: { name: string; value: (r: CanopyAirRow) => number }[] = [
    { name: CTD_TRAIT, value: (r) => r.ctd },
    ...(opts.relative
      ? [{ name: CTD_REL_TRAIT, value: (r: CanopyAirRow) => r.ctdRel }]
      : []),
  ]
  const ids = new Map<string, string>()
  for (const t of traits)
    ids.set(
      t.name,
      await ensureTrait(
        t.name,
        "°C",
        scope.experiment,
        t.name === CTD_TRAIT
          ? "Canopy temperature minus the weather station's air temperature at the flight time"
          : "Canopy − air temperature minus its flight's field median",
      ),
    )

  // Group by flight and crop: one dataset per flight, one post per crop.
  const groups = new Map<string, CanopyAirRow[]>()
  for (const r of rows) {
    const k = `${r.record.dataset_name ?? r.date}\u0000${r.record.population_name ?? ""}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  let records = 0
  const made = new Set<string>()
  for (const group of groups.values()) {
    const first = group[0]
    const population = first.record.population_name ?? ""
    const name = datasetName(
      scope,
      population,
      first.date,
      first.record.dataset_name ?? "",
    )
    if (!made.has(name)) {
      await DatasetsService.apiDatasetsCreateDataset({
        requestBody: {
          dataset_name: name,
          experiment_name: scope.experiment,
          dataset_type_id: DATASET_TYPE_TRAIT,
          collection_date: first.date,
          dataset_info: {
            source: SOURCE,
            thermal_dataset: first.record.dataset_name ?? null,
          },
        },
      }).catch(() => undefined) // already there: carry on
      made.add(name)
    }
    for (const t of traits) {
      const res =
        await TraitsService.apiTraitsIdTraitIdRecordsBulkBulkAddTraitRecords({
          traitId: ids.get(t.name) as string,
          requestBody: {
            experiment_name: scope.experiment,
            season_name: scope.year,
            site_name: scope.site,
            population_name: population || null,
            dataset_name: name,
            collection_date: `${first.date}T00:00:00`,
            records: group.map((r) => ({
              plot_number: r.record.plot_number,
              plot_row_number: r.record.plot_row_number,
              plot_column_number: r.record.plot_column_number,
              trait_value: Number(t.value(r).toFixed(3)),
              timestamp: r.record.timestamp,
              record_info: {
                source: SOURCE,
                canopy_c: r.canopy,
                air_temp_c: Number(r.air.toFixed(3)),
                rh: r.rh == null ? null : Number(r.rh.toFixed(1)),
                vpd_kpa: r.vpd == null ? null : Number(r.vpd.toFixed(3)),
                station: r.station,
                station_matched: r.matched,
                flight_time: r.time,
                window_minutes: opts.halfWindow * 2,
              },
            })),
          },
        })
      records += res.inserted_count ?? group.length
    }
  }
  return { records, flights: made.size }
}
