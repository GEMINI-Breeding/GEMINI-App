/**
 * Discover the date / platform / sensor combinations that have actual
 * data uploaded under the active experiment scope.
 *
 * Why not just hard-code "Drone, Amiga, RoverM2" + the user types whatever
 * they want? Because the path the worker discovers images under is built
 * verbatim from these strings — case-sensitive, character-for-character.
 * "drone" won't match "Drone", "iPhone" won't find a Sensor row of the
 * same name unless the user spelled it the same way at upload time. The
 * old free-text inputs forced researchers to remember exactly what they
 * typed (potentially years ago) before processing the data.
 *
 * The hook walks the MinIO listing of
 *     Raw/{year}/{experiment}/{site}/{population}/
 * and parses every object_name to derive the (date, platform, sensor)
 * tuples that exist. Sets are returned ordered, deduped, and ready to
 * feed a Select component.
 */

import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { type FileMetadata, FilesService } from "@/client"
import { isLoggedIn } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"

export interface ScopeRoot {
  experiment: string
  /** Site name (the upload form labels it "location"). */
  location: string
  population: string
}

export interface AvailableScope {
  /** ISO dates that have data under the experiment-site-population. */
  dates: string[]
  /** Platforms that have data under (..., date). Empty until date picked. */
  platforms: string[]
  /** Sensors that have data under (..., date, platform). Empty until platform picked. */
  sensors: string[]
  /**
   * Year string for the picked date (parsed from the matching object_names).
   * Same value the worker would derive — keeps callers from having to
   * recompute it from the date string when the upload may have used a
   * non-calendar season name.
   */
  yearForPickedDate: string
  /** Loading state for the listing call. */
  isLoading: boolean
  /** True if the experiment scope is incomplete (caller hasn't picked enough). */
  scopeIncomplete: boolean
  /** True if the listing succeeded but yielded no data at all. */
  empty: boolean
}

function isCompleteRoot(r: ScopeRoot): boolean {
  return Boolean(r.experiment && r.location && r.population)
}

function parseRawObjectName(
  objectName: string,
  experiment: string,
  location: string,
  population: string,
): { year: string; date: string; platform: string; sensor: string } | null {
  // Matches "Raw/{year}/{exp}/{site}/{pop}/{date}/{platform}/{sensor}/.../file"
  if (!objectName.startsWith("Raw/")) return null
  const parts = objectName.split("/")
  // ["Raw", year, exp, site, pop, date, platform, sensor, ..., file]
  if (parts.length < 9) return null
  const [, year, exp, site, pop, date, platform, sensor] = parts
  if (exp !== experiment || site !== location || pop !== population) {
    return null
  }
  if (!year || !date || !platform || !sensor) return null
  return { year, date, platform, sensor }
}

/**
 * Fetch a recursive listing of `Raw/` and derive (year, date, platform,
 * sensor) tuples that match the given experiment / site / population.
 *
 * Why list `Raw/` and filter client-side instead of the precise prefix?
 * The path includes the year, but we want to discover dates without
 * forcing the caller to guess the year first. Listing one level deeper
 * (`Raw/{year}/...`) would require enumerating years, which the backend
 * doesn't expose as a separate endpoint. Listing all of `Raw/` is
 * acceptable today (a few hundred to a few thousand objects is fine);
 * if MinIO grows past that, an extension to the backend `list_files`
 * to support a "delimiter" param (returning pseudo-folders only) is
 * the proper fix.
 */
export function useAvailableScopeOptions(
  root: ScopeRoot,
  pickedDate: string | null,
  pickedPlatform: string | null,
): AvailableScope {
  const complete = isCompleteRoot(root)

  const listing = useQuery<FileMetadata[], Error>({
    queryKey: [
      "files",
      "list-raw-tree",
      root.experiment,
      root.location,
      root.population,
    ],
    queryFn: async () => {
      if (!complete) return []
      try {
        const res = await FilesService.apiFilesListFilePathListFiles({
          filePath: `${DEFAULT_BUCKET}/Raw/`,
        })
        return (res as FileMetadata[] | null) ?? []
      } catch {
        return []
      }
    },
    enabled: isLoggedIn() && complete,
    staleTime: 30_000,
  })

  return useMemo<AvailableScope>(() => {
    if (!complete) {
      return {
        dates: [],
        platforms: [],
        sensors: [],
        yearForPickedDate: "",
        isLoading: false,
        scopeIncomplete: true,
        empty: false,
      }
    }
    if (listing.isLoading) {
      return {
        dates: [],
        platforms: [],
        sensors: [],
        yearForPickedDate: "",
        isLoading: true,
        scopeIncomplete: false,
        empty: false,
      }
    }

    const datesSet = new Set<string>()
    const platformsSet = new Set<string>()
    const sensorsSet = new Set<string>()
    let yearForPickedDate = ""
    let matchesUnderScope = 0

    for (const item of listing.data ?? []) {
      const parsed = parseRawObjectName(
        item.object_name ?? "",
        root.experiment,
        root.location,
        root.population,
      )
      if (!parsed) continue
      matchesUnderScope++
      datesSet.add(parsed.date)
      if (pickedDate && parsed.date === pickedDate) {
        platformsSet.add(parsed.platform)
        if (!yearForPickedDate) yearForPickedDate = parsed.year
        if (pickedPlatform && parsed.platform === pickedPlatform) {
          sensorsSet.add(parsed.sensor)
        }
      }
    }

    return {
      dates: Array.from(datesSet).sort(),
      platforms: Array.from(platformsSet).sort(),
      sensors: Array.from(sensorsSet).sort(),
      yearForPickedDate,
      isLoading: false,
      scopeIncomplete: false,
      empty: matchesUnderScope === 0,
    }
  }, [
    complete,
    listing.data,
    listing.isLoading,
    root.experiment,
    root.location,
    root.population,
    pickedDate,
    pickedPlatform,
  ])
}
