/**
 * Shared path helpers for the Phase-7 aerial pipeline.
 *
 * GEMINIbase workers consume scope as path components — `year`, `experiment`,
 * `location`, `population`, `date`, `platform`, `sensor` — and discover their
 * MinIO inputs by listing the resulting prefix. The frontend is responsible
 * for building those scope tuples from the user's experiment/season/site/
 * population picks plus a date and a platform/sensor pair.
 *
 * Per-dataset isolation: post Option-A migration, raw images live under
 * `Raw/.../{sensor}/{datasetShortId}/Images/` instead of
 * `Raw/.../{sensor}/Images/`. The `datasetShortId` is a separate explicit
 * parameter to the raw-image builders so the type system catches "I forgot
 * which dataset" mistakes — there is no single right answer when a scope
 * has multiple uploads.
 *
 * Scope-wide artifacts (image_filter.txt, gcp_list.txt, geo.txt,
 * gcp_locations.csv, gcp_image_groups.json) live at the scope root —
 * see `rawScopePrefix`.
 */

export type AerialScope = {
  year: string
  experiment: string
  location: string
  population: string
  date: string
  platform: string
  sensor: string
}

export type AerialScopePartial = Partial<AerialScope>

/** "2024-05-01" → "2024" */
export function yearFromDate(date: string | null | undefined): string {
  if (!date) return ""
  return date.split("-")[0] ?? ""
}

/**
 * Derive the MinIO prefix the ODM worker writes to for a given scope.
 * Matches `_build_output_prefix` in `backend/gemini/workers/odm/worker.py`.
 *
 * `dataset_short_id` is intentionally NOT included: outputs (orthophoto,
 * COG, log, traits, plot-boundaries) are scope-wide products of one or
 * more datasets fed to the same job.
 */
export function processedPrefix(scope: AerialScope): string {
  const { year, experiment, location, population, date, platform, sensor } =
    scope
  return `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/`
}

/**
 * Scope-root prefix `Raw/.../{sensor}/` (no `Images`, no `datasetShortId`).
 *
 * This is where scope-wide artifacts live: `image_filter.txt`,
 * `gcp_list.txt`, `geo.txt`, `gcp_locations.csv`, `gcp_image_groups.json`.
 * The Image Review and GCP Picker tools write them here so they survive
 * multi-dataset selection in the Run wizard. Mirrors
 * `_build_scope_prefix` in `backend/gemini/workers/odm/worker.py`.
 */
export function rawScopePrefix(scope: AerialScope): string {
  const { year, experiment, location, population, date, platform, sensor } =
    scope
  return `Raw/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/`
}

/**
 * Per-dataset raw-images prefix. `datasetShortId` is required — pass the
 * short-id of the dataset whose images you want.
 *
 * Throws if `datasetShortId` is empty: the post-migration layout has no
 * single canonical "Images" directory per scope, so callers must say
 * which dataset they mean.
 */
export function rawImagesPrefix(
  scope: AerialScope,
  datasetShortId: string,
): string {
  if (!datasetShortId) {
    throw new Error(
      "rawImagesPrefix: datasetShortId is required (the scope alone is " +
        "ambiguous when multiple uploads exist).",
    )
  }
  return `${rawScopePrefix(scope)}${datasetShortId}/Images/`
}

export function plotImagesPrefix(scope: AerialScope): string {
  return `${processedPrefix(scope)}PlotImages/`
}

export function orthomosaicPath(scope: AerialScope): string {
  return `${processedPrefix(scope)}odm_orthophoto.tif`
}

/**
 * MinIO object path for a materialized plot-boundary GeoJSON. Boundaries are
 * authoritatively stored as PlotGeometryService versions (Postgres snapshots);
 * the EXTRACT_TRAITS worker reads from MinIO, so the frontend writes the chosen
 * version's FeatureCollection here right before submitting the job.
 */
export function plotBoundariesPath(
  scope: AerialScope,
  version: number,
): string {
  return `${processedPrefix(scope)}plot-boundaries/v${version}.geojson`
}

export function isAerialScopeComplete(
  scope: AerialScopePartial,
): scope is AerialScope {
  return Boolean(
    scope.year &&
      scope.experiment &&
      scope.location &&
      scope.population &&
      scope.date &&
      scope.platform &&
      scope.sensor,
  )
}
