/**
 * Network side of the dashboard adapter (see ./traitCatalog.ts): list the
 * trait-record groups, and build one group's per-plot FeatureCollection.
 */
import {
  type FileMetadata,
  FilesService,
  MultivariateAnalysisService,
} from "@/client"
import type { TraitRecord, TraitsResponse } from "@/features/analyze/api"
import { fetchMatrix } from "@/features/analyze/lib/multivariate"
import { processedPopulationPrefix } from "@/features/process/lib/paths"
import {
  type CatalogEntry,
  catalogToRecords,
  decodeRecordId,
  plotImagesForDate,
  rowsToFeatureCollection,
} from "./traitCatalog"

export async function fetchTraitRecords(): Promise<TraitRecord[]> {
  const res =
    await MultivariateAnalysisService.apiMultivariateAnalysisCatalogCatalog()
  return catalogToRecords((res as CatalogEntry[] | null) ?? [])
}

export async function fetchRecordGeojson(
  id: string,
  traitNames: string[],
): Promise<TraitsResponse> {
  const k = decodeRecordId(id)
  if (!k) {
    throw new Error(
      "This widget points at a trait record from the previous version of the app. Edit it and pick a record again.",
    )
  }
  if (traitNames.length === 0) {
    return {
      geojson: { type: "FeatureCollection", features: [] },
      metric_columns: [],
      feature_count: 0,
    }
  }
  const imagesPrefix =
    k.season && k.experiment && k.site && k.population
      ? processedPopulationPrefix({
          year: k.season,
          experiment: k.experiment,
          location: k.site,
          population: k.population,
        })
      : null
  const [matrix, files] = await Promise.all([
    fetchMatrix({
      trait_names: traitNames,
      experiment_names: [k.experiment],
      season_names: [k.season],
      site_names: [k.site],
      ...(k.population ? { populations: [k.population] } : {}),
      aggregation: "date",
      aggregation_date: k.date,
    }),
    imagesPrefix
      ? FilesService.apiFilesListFilePathListFiles({
          filePath: `gemini/${imagesPrefix}`,
        }).then((r) => (r as FileMetadata[] | null) ?? [])
      : Promise.resolve([] as FileMetadata[]),
  ])
  const traits = matrix.trait_names?.length ? matrix.trait_names : traitNames
  const geojson = rowsToFeatureCollection(
    matrix.rows ?? [],
    traits,
    plotImagesForDate(files, k.date),
  )
  return {
    geojson,
    metric_columns: traits,
    feature_count: geojson.features.length,
  }
}
