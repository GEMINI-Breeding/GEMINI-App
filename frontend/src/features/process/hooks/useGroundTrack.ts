/**
 * useGroundTrack — a run's rover track(s): the frame folders at its raw
 * scope (narrowed to the run's datasets), the chosen track's msgs_synced
 * points, and its frames in capture order. Shared by Plot Marking and the
 * edge-crop editor.
 */
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { type FileMetadata, FilesService } from "@/client"
import { authHeaders } from "@/components/Common/PlotImage"
import { apiUrl, DEFAULT_BUCKET } from "@/features/files/lib/download"
import {
  findGroundTracks,
  type GroundTrack,
  parseTrack,
  type TrackPoint,
} from "@/features/process/lib/groundTrack"
import { type AerialScope, rawScopePrefix } from "@/features/process/lib/paths"
import { isLoggedIn } from "@/lib/auth"

export function useGroundTrack(
  scope: AerialScope | null,
  datasetShortIds: string[] | undefined,
) {
  const rawPrefix = scope ? rawScopePrefix(scope) : null
  const listing = useQuery<FileMetadata[]>({
    queryKey: ["files", "list", rawPrefix],
    queryFn: async () =>
      ((await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${rawPrefix}`,
      })) as FileMetadata[] | null) ?? [],
    enabled: isLoggedIn() && Boolean(rawPrefix),
  })
  // Keyed on strings, not the scope/array objects: callers often build
  // those per render, and a new track object per render re-runs every
  // effect downstream (it looped the crop tool's image loading).
  const idsKey = (datasetShortIds ?? []).join(",")
  const tracks = useMemo<GroundTrack[]>(() => {
    if (!rawPrefix) return []
    const all = findGroundTracks(listing.data ?? [], rawPrefix)
    const wanted = idsKey ? idsKey.split(",") : []
    const mine = all.filter((t) => wanted.includes(t.dataset))
    return mine.length ? mine : all
  }, [listing.data, rawPrefix, idsKey])
  const [trackKey, setTrackKey] = useState<string | null>(null)
  const track =
    tracks.find((t) => t.imagesPrefix === trackKey) ?? tracks[0] ?? null

  const trackCsv = useQuery<TrackPoint[]>({
    queryKey: ["ground-track", track?.msgsSyncedPath],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(
          `/api/files/download/${DEFAULT_BUCKET}/${track?.msgsSyncedPath}`,
        ),
        { headers: authHeaders() },
      )
      if (!res.ok) throw new Error(`msgs_synced.csv: HTTP ${res.status}`)
      return parseTrack(await res.text())
    },
    enabled: Boolean(track?.msgsSyncedPath),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const points = trackCsv.data ?? []

  // Frames in capture order: msgs_synced's order when it names them.
  const images = useMemo(() => {
    if (!track) return []
    const present = new Set(track.images)
    const ordered = points.map((p) => p.image).filter((n) => present.has(n))
    const seen = new Set(ordered)
    return ordered.length
      ? [...ordered, ...track.images.filter((n) => !seen.has(n))]
      : track.images
  }, [track, points])

  return {
    tracks,
    track,
    setTrackKey,
    points,
    images,
    /** Frames listed; msgs_synced (if any) read. */
    isReady:
      listing.isSuccess && (!track?.msgsSyncedPath || trackCsv.isFetched),
    isLoading: listing.isLoading,
  }
}
