/**
 * useAvailableUploads — list the unique uploaded *datasets* the user has
 * available for a NewRunDialog, derived from the MinIO listing of `Raw/`.
 *
 * GEMINIbase doesn't store an explicit FileUpload row per-upload (`main`
 * had one in Postgres); the only source of truth is the path layout
 *     Raw/{year}/{experiment}/{location}/{population}/{date}/
 *         {platform}/{sensor}/...
 * Every distinct prefix down to {sensor} is one "uploaded dataset" the
 * user can run a pipeline against. This hook walks the listing once and
 * groups by that 7-tuple.
 *
 * Aerial pipelines also accept Orthomosaic/ uploads (drone TIFs the user
 * brought in pre-mosaicked); ground pipelines only accept Image Data.
 * Filtering by data type is the caller's job — see `pipelineKindAccepts`.
 */
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { type FileMetadata, FilesService } from "@/client"
import { isLoggedIn } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"

export interface AvailableUpload {
  /**
   * Stable identity for the upload tuple — the seven path components
   * joined by "/". Used as React `key` and dialog selection state.
   */
  id: string
  year: string
  experiment: string
  location: string
  population: string
  date: string
  platform: string
  sensor: string
  /**
   * Inferred data type — "Image Data" if any frames are jpg/png, or
   * "Orthomosaic" if any TIF is uploaded directly under
   * Raw/.../Orthomosaic/. Mirrors `main`'s FileUpload.data_type so the
   * NewRunDialog can filter the same way.
   */
  dataType: "Image Data" | "Orthomosaic"
  /** Number of files counted under this prefix (just for display). */
  fileCount: number
  /**
   * Sorted list of distinct dataset short-ids observed at this scope
   * (new layout). Empty for legacy uploads. The Run wizard exposes a
   * multi-select over these so a single ODM job can pool images from
   * multiple per-dataset prefixes.
   */
  datasetShortIds: string[]
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png)$/i
const TIF_EXTENSIONS = /\.(tif?f)$/i

interface ParsedRawObject {
  year: string
  experiment: string
  location: string
  population: string
  date: string
  platform: string
  sensor: string
  /** Path component immediately after sensor — e.g. "Images" or "Orthomosaic". */
  bucketKind: string
  /**
   * 8-hex dataset prefix segment (post Option-A migration) when this
   * object lives under a per-dataset subdir. Null for legacy layouts
   * where the bucketKind sits directly after sensor.
   */
  datasetShortId: string | null
  filename: string
}

/** 8 lowercase hex chars — see datasetForUpload.extractDatasetShortId. */
const SHORT_ID_RE = /^[0-9a-f]{8}$/

function parseRawObjectName(objectName: string): ParsedRawObject | null {
  if (!objectName.startsWith("Raw/")) return null
  const parts = objectName.split("/")
  // New:    [Raw, year, exp, site, pop, date, platform, sensor, SHORTID, bucketKind, ...rest, filename]
  // Legacy: [Raw, year, exp, site, pop, date, platform, sensor, bucketKind,           ...rest, filename]
  if (parts.length < 10) return null
  const [
    ,
    year,
    experiment,
    location,
    population,
    date,
    platform,
    sensor,
    eighth,
  ] = parts
  if (
    !year ||
    !experiment ||
    !location ||
    !population ||
    !date ||
    !platform ||
    !sensor
  ) {
    return null
  }
  // The eighth segment is either the dataset short-id (new) or the
  // bucketKind directly (legacy). Distinguish by hex shape.
  let datasetShortId: string | null = null
  let bucketKind: string
  if (SHORT_ID_RE.test(eighth)) {
    if (parts.length < 11) return null
    datasetShortId = eighth
    bucketKind = parts[9]
  } else {
    bucketKind = eighth
  }
  const filename = parts[parts.length - 1]
  return {
    year,
    experiment,
    location,
    population,
    date,
    platform,
    sensor,
    bucketKind,
    datasetShortId,
    filename,
  }
}

export function useAvailableUploads(): {
  uploads: AvailableUpload[]
  isLoading: boolean
  isError: boolean
} {
  const listing = useQuery<FileMetadata[], Error>({
    queryKey: ["files", "list-raw-tree-all"],
    queryFn: async () => {
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/Raw/`,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: isLoggedIn(),
    staleTime: 30_000,
  })

  const uploads = useMemo<AvailableUpload[]>(() => {
    const groups = new Map<string, AvailableUpload>()
    // Per-group set of distinct short-ids — turned into a sorted array
    // at the end. Tracked separately because Maps aren't structurally
    // mutable per-key from a sort callback later.
    const shortIdSets = new Map<string, Set<string>>()
    for (const item of listing.data ?? []) {
      const parsed = parseRawObjectName(item.object_name ?? "")
      if (!parsed) continue
      const isImage = IMAGE_EXTENSIONS.test(parsed.filename)
      const isTif = TIF_EXTENSIONS.test(parsed.filename)
      // Treat Raw/.../Sensor/Orthomosaic/*.tif as an "Orthomosaic" upload
      // (the user brought in a pre-built mosaic). Everything under
      // Raw/.../Sensor/[shortId/]Images/*.{jpg,png,tif} counts as "Image Data".
      // Keys other than Images / Orthomosaic (e.g. metadata sidecars,
      // GCP CSVs) don't represent processable uploads on their own.
      let dataType: "Image Data" | "Orthomosaic" | null = null
      if (parsed.bucketKind === "Orthomosaic" && isTif) {
        dataType = "Orthomosaic"
      } else if (parsed.bucketKind === "Images" && (isImage || isTif)) {
        dataType = "Image Data"
      }
      if (!dataType) continue
      const key = [
        parsed.year,
        parsed.experiment,
        parsed.location,
        parsed.population,
        parsed.date,
        parsed.platform,
        parsed.sensor,
        dataType,
      ].join("/")
      let shortIds = shortIdSets.get(key)
      if (!shortIds) {
        shortIds = new Set<string>()
        shortIdSets.set(key, shortIds)
      }
      if (parsed.datasetShortId) shortIds.add(parsed.datasetShortId)
      const existing = groups.get(key)
      if (existing) {
        existing.fileCount += 1
        continue
      }
      groups.set(key, {
        id: key,
        year: parsed.year,
        experiment: parsed.experiment,
        location: parsed.location,
        population: parsed.population,
        date: parsed.date,
        platform: parsed.platform,
        sensor: parsed.sensor,
        dataType,
        fileCount: 1,
        datasetShortIds: [],
      })
    }
    // Materialize the per-group short-ids so the React-Query value is
    // immutable and stable across renders (sorted = deterministic).
    for (const [key, upload] of groups) {
      const set = shortIdSets.get(key)
      upload.datasetShortIds = set ? Array.from(set).sort() : []
    }
    return Array.from(groups.values()).sort((a, b) => {
      // Most recent date first; tiebreak by experiment then platform so
      // the table is stable across reloads.
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      if (a.experiment !== b.experiment)
        return a.experiment < b.experiment ? -1 : 1
      return a.platform < b.platform ? -1 : 1
    })
  }, [listing.data])

  return {
    uploads,
    isLoading: listing.isLoading,
    isError: listing.isError,
  }
}

export function pipelineKindAccepts(
  pipelineType: "aerial" | "ground",
  dataType: AvailableUpload["dataType"],
): boolean {
  if (pipelineType === "aerial") {
    return dataType === "Image Data" || dataType === "Orthomosaic"
  }
  // Ground: GEMINIbase doesn't yet ingest Farm-ng binary as its own
  // data_type — it's just Image Data for now. Mirror main's loose check.
  return dataType === "Image Data"
}
