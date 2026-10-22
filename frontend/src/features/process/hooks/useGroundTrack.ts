/**
 * useGroundTrack — a run's rover track(s): the frame folders at its raw
 * scope (narrowed to the run's datasets), the chosen track's msgs_synced
 * points, and its frames in capture order. Shared by Plot Marking and the
 * edge-crop editor.
 *
 * Two ways to find the tracks:
 *  - Direct: when the run names its datasets, each one's
 *    `{id}/RGB/Metadata/msgs_synced.csv` is read and its frame names taken
 *    from it. One small request per dataset, whatever the track's size.
 *    A run that does not name its datasets (older runs) tries the
 *    experiment's uploads that can be at this scope instead: an upload's
 *    folder is the first 8 hex characters of its dataset id.
 *  - Listing: otherwise (or when a dataset has no msgs_synced.csv there,
 *    e.g. a handheld pass) the whole raw scope is listed. That listing is
 *    recursive — fine for hundreds of files, but it never returned for a
 *    102-log Amiga day (127k objects), which left Plot Marking on
 *    "Loading frames…".
 */
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import {
  type DatasetOutput,
  type ExperimentOutput,
  ExperimentsService,
  type FileMetadata,
  FilesService,
} from "@/client"
import { authHeaders } from "@/components/Common/PlotImage"
import { apiUrl, DEFAULT_BUCKET } from "@/features/files/lib/download"
import { classify } from "@/features/files/lib/experimentContents"
import {
  findGroundTracks,
  type GroundTrack,
  parseTrack,
  type TrackPoint,
} from "@/features/process/lib/groundTrack"
import { type AerialScope, rawScopePrefix } from "@/features/process/lib/paths"
import { isLoggedIn } from "@/lib/auth"

interface DirectTrack {
  track: GroundTrack
  points: TrackPoint[]
}

/** Amiga frame names carry the capture time, so they sort in capture order. */
const AMIGA_FRAME = /^rgb-\d+\.(jpe?g|png)$/i

/**
 * msgs_synced.csv is appended to per extracted log, so after several logs
 * its rows are in extraction order, not capture order. Amiga frames are
 * put back in capture order by name; other sources keep the file's order.
 */
export function inCaptureOrder(points: TrackPoint[]): TrackPoint[] {
  if (!points.length || !points.every((p) => AMIGA_FRAME.test(p.image)))
    return points
  return [...points].sort((a, b) =>
    a.image < b.image ? -1 : a.image > b.image ? 1 : 0,
  )
}

async function fetchTrackCsv(path: string): Promise<TrackPoint[] | null> {
  const res = await fetch(
    apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${path}`),
    { headers: authHeaders() },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`msgs_synced.csv: HTTP ${res.status}`)
  return inCaptureOrder(parseTrack(await res.text()))
}

export function useGroundTrack(
  scope: AerialScope | null,
  datasetShortIds: string[] | undefined,
) {
  const rawPrefix = scope ? rawScopePrefix(scope) : null
  // Keyed on strings, not the scope/array objects: callers often build
  // those per render, and a new track object per render re-runs every
  // effect downstream (it looped the crop tool's image loading).
  const namedKey = (datasetShortIds ?? []).join(",")

  // No datasets named: the experiment's uploads that may be at this scope.
  const candidates = useQuery<string[]>({
    queryKey: ["ground-track", "candidates", rawPrefix],
    queryFn: async () => {
      const exps =
        ((await ExperimentsService.apiExperimentsAllGetAllExperiments({
          limit: 500,
          offset: 0,
        })) as ExperimentOutput[] | null) ?? []
      const exp = exps.find((e) => e.experiment_name === scope?.experiment)
      if (!exp?.id) return []
      const datasets =
        ((await ExperimentsService.apiExperimentsIdExperimentIdDatasetsGetExperimentDatasets(
          { experimentId: String(exp.id) },
        )) as DatasetOutput[] | null) ?? []
      return datasets
        .map(classify)
        .filter((e) => {
          if (e.kind !== "upload") return false
          const w = e.where
          // Facts recorded: must be this scope. Not recorded (older uploads):
          // could be; a wrong guess costs one small 404.
          return w
            ? w.date === scope?.date &&
                w.site === scope?.location &&
                w.platform === scope?.platform
            : true
        })
        .map((e) => String(e.dataset.id).replace(/-/g, "").slice(0, 8))
        .filter((id) => /^[0-9a-f]{8}$/.test(id))
    },
    enabled: isLoggedIn() && Boolean(rawPrefix) && !namedKey,
    staleTime: 10 * 60_000,
  })
  const idsKey = namedKey || (candidates.data ?? []).join(",")

  const direct = useQuery<DirectTrack[]>({
    queryKey: ["ground-track", "direct", rawPrefix, idsKey],
    queryFn: async () => {
      const found: DirectTrack[] = []
      for (const id of idsKey.split(",")) {
        const msgsSyncedPath = `${rawPrefix}${id}/RGB/Metadata/msgs_synced.csv`
        const points = await fetchTrackCsv(msgsSyncedPath)
        if (!points?.length) continue
        found.push({
          points,
          track: {
            dataset: id,
            imagesPrefix: `${rawPrefix}${id}/RGB/Images/top/`,
            images: points.map((p) => p.image),
            msgsSyncedPath,
          },
        })
      }
      return found
    },
    enabled: isLoggedIn() && Boolean(rawPrefix) && Boolean(idsKey),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  const useDirect = (direct.data?.length ?? 0) > 0
  // List only when the direct way is not available or found nothing.
  const needListing =
    Boolean(rawPrefix) &&
    Boolean(namedKey || candidates.isFetched || candidates.isError) &&
    (!idsKey || (direct.isFetched && !useDirect))

  const listing = useQuery<FileMetadata[]>({
    queryKey: ["files", "list", rawPrefix],
    queryFn: async () =>
      ((await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${rawPrefix}`,
      })) as FileMetadata[] | null) ?? [],
    enabled: isLoggedIn() && needListing,
  })
  const tracks = useMemo<GroundTrack[]>(() => {
    if (!rawPrefix) return []
    if (useDirect) return (direct.data ?? []).map((d) => d.track)
    const all = findGroundTracks(listing.data ?? [], rawPrefix)
    const wanted = idsKey ? idsKey.split(",") : []
    const mine = all.filter((t) => wanted.includes(t.dataset))
    return mine.length ? mine : all
  }, [useDirect, direct.data, listing.data, rawPrefix, idsKey])
  const [trackKey, setTrackKey] = useState<string | null>(null)
  const track =
    tracks.find((t) => t.imagesPrefix === trackKey) ?? tracks[0] ?? null

  const trackCsv = useQuery<TrackPoint[]>({
    queryKey: ["ground-track", track?.msgsSyncedPath],
    queryFn: async () =>
      (await fetchTrackCsv(track?.msgsSyncedPath as string)) ?? [],
    enabled: !useDirect && Boolean(track?.msgsSyncedPath),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const points = useMemo(
    () =>
      useDirect
        ? ((direct.data ?? []).find(
            (d) => d.track.imagesPrefix === track?.imagesPrefix,
          )?.points ?? [])
        : (trackCsv.data ?? []),
    [useDirect, direct.data, track?.imagesPrefix, trackCsv.data],
  )

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
    /** Frames known; msgs_synced (if any) read. */
    isReady: useDirect
      ? true
      : listing.isSuccess && (!track?.msgsSyncedPath || trackCsv.isFetched),
    isLoading: useDirect
      ? false
      : candidates.isLoading ||
        direct.isLoading ||
        (needListing && listing.isLoading),
  }
}
