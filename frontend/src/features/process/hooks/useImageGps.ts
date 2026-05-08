/**
 * useImageGps — list raw images at a scope's MinIO prefix and look up
 * each one's EXIF GPS via the backend's cached endpoint.
 *
 * The backend writes per-image GPS into ``experiment_files.metadata_json``
 * at upload time, and lazily backfills any missing rows on first
 * request. This hook therefore makes one DB-cached fetch instead of
 * fanning out 192 HTTP Range requests to read EXIF in the browser.
 *
 * Shared by `GcpPicker` (proximity filter to a CSV-supplied GCP) and
 * `ImageDotMap` (drop a satellite-overlay dot per image).
 */

import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { type FileMetadata, FilesService } from "@/client"
import type { ImageGps } from "@/features/process/lib/imageGps"
import type { AerialScope } from "@/features/process/lib/paths"
import { rawImagesPrefix } from "@/features/process/lib/paths"
import { isLoggedIn } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"
const IMAGE_RE = /\.(jpe?g|png|tif?f)$/i

export interface ImageBbox {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
  count: number
}

export interface UseImageGpsResult {
  /** All image FileMetadata at the prefix, filtered by extension. */
  images: FileMetadata[]
  /** basename → ImageGps (or null when EXIF is missing). */
  gpsMap: Record<string, ImageGps>
  /** Image basenames in the same order as `images`. */
  imageNames: string[]
  /** True while the GPS lookup is pending. */
  gpsLoading: boolean
  /**
   * Set when the file-list or bulk-GPS request failed. Consumers must
   * render this — without it, a 500 from /image-gps presents as a
   * permanent spinner because there's no `isSuccess` to clear loading.
   */
  gpsError: Error | null
  /** Number of images for which GPS is known (incl. known-null). */
  gpsReadyCount: number
  /** Bounding box across all images with GPS, or null if none have GPS. */
  imageBbox: ImageBbox | null
  /** Underlying file-list query state. */
  filesQuery: ReturnType<typeof useQuery<FileMetadata[], Error>>
  /** MinIO prefix the images live under. */
  imagesPrefix: string
}

export function useImageGps(scope: AerialScope): UseImageGpsResult {
  const imagesPrefix = rawImagesPrefix(scope)

  const filesQuery = useQuery<FileMetadata[], Error>({
    queryKey: ["files", "list", imagesPrefix, "image-gps"],
    queryFn: async () => {
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${imagesPrefix}`,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: isLoggedIn(),
  })

  const allFiles = filesQuery.data ?? []
  const images = useMemo(
    () => allFiles.filter((f) => IMAGE_RE.test(f.object_name ?? "")),
    [allFiles],
  )

  // One backend call returns every image's GPS (cached or freshly
  // extracted). Driven by the file-list query so we re-fetch when new
  // images appear at the prefix.
  const gpsQuery = useQuery({
    queryKey: ["image-gps-bulk", imagesPrefix, images.length],
    queryFn: async () => {
      const res = await FilesService.apiFilesImageGpsFilePathListImageGps({
        filePath: `${DEFAULT_BUCKET}/${imagesPrefix}`,
      })
      return res
    },
    enabled: isLoggedIn() && images.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const imageNames = useMemo(
    () => images.map((f) => f.object_name?.split("/").pop() ?? ""),
    [images],
  )

  const gpsMap = useMemo<Record<string, ImageGps>>(() => {
    const out: Record<string, ImageGps> = {}
    for (const name of imageNames) out[name] = null
    const entries = gpsQuery.data?.images ?? []
    for (const e of entries) {
      if (typeof e.lat === "number" && typeof e.lon === "number") {
        out[e.name] = {
          lat: e.lat,
          lon: e.lon,
          alt: typeof e.alt === "number" ? e.alt : 0,
        }
      } else {
        out[e.name] = null
      }
    }
    return out
  }, [imageNames, gpsQuery.data])

  // True while either the file listing or the bulk-GPS fetch is in
  // flight. We gate on `isFetching` rather than `isLoading` because
  // React Query v5 reports `isLoading=true` for disabled queries (and
  // gpsQuery is disabled until the first non-empty file list arrives).
  // Without this, the "Reading EXIF GPS" diagnostic vanishes before
  // gpsMap is populated and downstream UI (closest-image diagnostic,
  // map dots) renders against empty data.
  //
  // Errors must NOT count as "still loading" — otherwise a 500 from
  // the backend (e.g. when the experiment_files.metadata_json column
  // is missing) presents as a permanent spinner instead of an error.
  const gpsError = (gpsQuery.error ?? filesQuery.error) as Error | null
  const gpsLoading =
    !gpsError &&
    (filesQuery.isFetching ||
      gpsQuery.isFetching ||
      (images.length > 0 && !gpsQuery.isSuccess))
  const gpsReadyCount = gpsQuery.isSuccess ? imageNames.length : 0

  const imageBbox = useMemo<ImageBbox | null>(() => {
    let minLat = Infinity
    let maxLat = -Infinity
    let minLon = Infinity
    let maxLon = -Infinity
    let n = 0
    for (const v of Object.values(gpsMap)) {
      if (!v) continue
      n++
      if (v.lat < minLat) minLat = v.lat
      if (v.lat > maxLat) maxLat = v.lat
      if (v.lon < minLon) minLon = v.lon
      if (v.lon > maxLon) maxLon = v.lon
    }
    if (n === 0) return null
    return { minLat, maxLat, minLon, maxLon, count: n }
  }, [gpsMap])

  return {
    images,
    gpsMap,
    imageNames,
    gpsLoading,
    gpsError,
    gpsReadyCount,
    imageBbox,
    filesQuery,
    imagesPrefix,
  }
}
