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
 * brought in pre-mosaicked); ground pipelines accept Image Data and
 * extracted Amiga logs.
 * Filtering by data type is the caller's job — see `pipelineKindAccepts`.
 */
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { type FileMetadata, FilesService, OpenAPI } from "@/client"
import { getToken, isLoggedIn } from "@/lib/auth"

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
   * Inferred data type — "Image Data" if any frames are jpg/png,
   * "Orthomosaic" if any TIF is uploaded directly under
   * Raw/.../Orthomosaic/, or "Farm-ng Binary File" for an extracted Amiga
   * log ({shortId}/RGB/Images/top/). Mirrors `main`'s FileUpload.data_type
   * so the NewRunDialog can filter the same way.
   */
  dataType: "Image Data" | "Orthomosaic" | "Farm-ng Binary File"
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
  /** Path components between bucketKind and the filename. */
  subPath: string[]
  filename: string
}

/** 8 lowercase hex chars — see datasetForUpload.extractDatasetShortId. */
const SHORT_ID_RE = /^[0-9a-f]{8}$/

function parseRawObjectName(objectName: string): ParsedRawObject | null {
  if (!objectName.startsWith("Raw/")) return null
  const parts = objectName.split("/")
  // New:    [Raw, season, exp, site, pop, date, platform, sensor, SHORTID, bucketKind, ...rest, filename]
  // Legacy: [Raw, season, exp, site, pop, date, platform, sensor, bucketKind,           ...rest, filename]
  //
  // The "season" slot used to be called "year" and was derived from the
  // calendar year of the upload date. Variable names below still use
  // `year` for backwards compatibility with the worker job-param
  // contract, but the value is the season name the user picked at
  // upload time.
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
  let kindIndex: number
  if (SHORT_ID_RE.test(eighth)) {
    if (parts.length < 11) return null
    datasetShortId = eighth
    kindIndex = 9
  } else {
    kindIndex = 8
  }
  const bucketKind = parts[kindIndex]
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
    subPath: parts.slice(kindIndex + 1, -1),
    filename,
  }
}

/** A listed object, or a whole folder's files of one extension
 *  (`count` of them) standing in for its objects. */
export type UploadEntry = Pick<FileMetadata, "object_name"> & {
  count?: number
}

/** Group a Raw/ listing into one entry per uploaded dataset scope. */
export function groupUploads(files: UploadEntry[]): AvailableUpload[] {
  const groups = new Map<string, AvailableUpload>()
  // Per-group set of distinct short-ids — turned into a sorted array
  // at the end. Tracked separately because Maps aren't structurally
  // mutable per-key from a sort callback later.
  const shortIdSets = new Map<string, Set<string>>()
  for (const item of files) {
    const parsed = parseRawObjectName(item.object_name ?? "")
    if (!parsed) continue
    const isImage = IMAGE_EXTENSIONS.test(parsed.filename)
    const isTif = TIF_EXTENSIONS.test(parsed.filename)
    // Treat Raw/.../Sensor/Orthomosaic/*.tif as an "Orthomosaic" upload
    // (the user brought in a pre-built mosaic). Everything under
    // Raw/.../Sensor/[shortId/]Images/*.{jpg,png,tif} counts as "Image Data".
    // Keys other than Images / Orthomosaic (e.g. metadata sidecars,
    // GCP CSVs) don't represent processable uploads on their own.
    let dataType: AvailableUpload["dataType"] | null = null
    if (parsed.bucketKind === "Orthomosaic" && isTif) {
      dataType = "Orthomosaic"
    } else if (parsed.bucketKind === "Images" && (isImage || isTif)) {
      dataType = "Image Data"
    } else if (
      // The amiga worker extracts a .bin beside it: {shortId}/RGB/Images/
      // {top,left,right}/. The ground pipeline stitches the top camera.
      parsed.bucketKind === "RGB" &&
      parsed.subPath[0] === "Images" &&
      parsed.subPath[1] === "top" &&
      isImage
    ) {
      dataType = "Farm-ng Binary File"
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
    const n = item.count ?? 1
    const existing = groups.get(key)
    if (existing) {
      existing.fileCount += n
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
      fileCount: n,
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
}

/**
 * The uploaded folders under Raw/ with their file counts, from the
 * server's register of uploaded files: about a second, where listing the
 * bucket walks every object (minutes once it holds a few seasons). Each
 * folder comes back as one entry per file extension, with a stand-in file
 * name so `groupUploads` reads it like a listed object. Null when the
 * server has no such route or its register is empty (an older stack).
 */
async function listUploadFolders(
  bucket: string,
): Promise<UploadEntry[] | null> {
  const base = (OpenAPI.BASE ?? "").replace(/\/$/, "")
  try {
    const res = await fetch(
      `${base}/api/files/upload_folders/${encodeURIComponent(bucket)}?prefix=Raw/`,
      { headers: { Authorization: `Bearer ${getToken()}` } },
    )
    if (!res.ok) return null
    const rows = (await res.json()) as
      | { folder: string; extension?: string | null; count: number }[]
      | null
    if (!rows?.length) return null
    return rows.map((r) => ({
      object_name: `${r.folder}/files${r.extension ? `.${r.extension}` : ""}`,
      count: r.count,
    }))
  } catch {
    return null
  }
}

export function useAvailableUploads(): {
  uploads: AvailableUpload[]
  isLoading: boolean
  isError: boolean
} {
  const listing = useQuery<UploadEntry[], Error>({
    queryKey: ["files", "list-raw-tree-all"],
    queryFn: async () => {
      const folders = await listUploadFolders(DEFAULT_BUCKET)
      if (folders) return folders
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/Raw/`,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: isLoggedIn(),
    staleTime: 30_000,
  })

  const uploads = useMemo(
    () => groupUploads(listing.data ?? []),
    [listing.data],
  )

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
  // Ground: an extracted Amiga log, or images from a handheld/monopod pass.
  return dataType === "Image Data" || dataType === "Farm-ng Binary File"
}
