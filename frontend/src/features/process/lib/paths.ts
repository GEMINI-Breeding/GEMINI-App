/**
 * Shared path helpers for the Phase-7 aerial pipeline.
 *
 * GEMINIbase workers consume scope as path components — `year`, `experiment`,
 * `location`, `population`, `date`, `platform`, `sensor` — and discover their
 * MinIO inputs by listing the resulting prefix. The frontend is responsible
 * for building those scope tuples from the user's experiment/season/site/
 * population picks plus a date and a platform/sensor pair.
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
 */
export function processedPrefix(scope: AerialScope): string {
  const { year, experiment, location, population, date, platform, sensor } = scope
  return `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/`
}

export function rawImagesPrefix(scope: AerialScope): string {
  const { year, experiment, location, population, date, platform, sensor } = scope
  return `Raw/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/Images/`
}

export function plotImagesPrefix(scope: AerialScope): string {
  return `${processedPrefix(scope)}PlotImages/`
}

export function orthomosaicPath(scope: AerialScope): string {
  return `${processedPrefix(scope)}odm_orthophoto.tif`
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
