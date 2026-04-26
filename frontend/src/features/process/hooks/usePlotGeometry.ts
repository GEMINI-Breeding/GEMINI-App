/**
 * React-Query hooks over GEMINIbase PlotGeometryService.
 *
 * The backend stores plot-geometry as named, versioned state snapshots
 * keyed on a MinIO `directory` (the Processed/{...}/{date}/ prefix). One
 * version per directory is "active" at a time; SPLIT_ORTHOMOSAIC and
 * EXTRACT_TRAITS pick up the active version's `boundaries` GeoJSON.
 *
 * The state-snapshot payload itself is freeform JSON (the backend doesn't
 * impose a schema); the convention this app uses is:
 *   {
 *     boundaries: GeoJSON.FeatureCollection,
 *     grid?: { rows: number, cols: number, spacing_m: number, angle_deg: number },
 *     created_from?: "draw" | "grid" | "import"
 *   }
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { PlotGeometryService } from "@/client"
import { isLoggedIn } from "@/lib/auth"

export type PlotGeometryVersion = {
  version: number
  name: string | null
  is_active: boolean
  created_at: string | null
  created_by?: string | null
}

export type PlotGeometryStateSnapshot = {
  boundaries: GeoJSON.FeatureCollection
  grid?: {
    rows: number
    cols: number
    spacing_m: number
    angle_deg: number
  }
  created_from?: "draw" | "grid" | "import"
}

export type PlotGeometryVersionLoaded = PlotGeometryVersion & {
  state_snapshot: PlotGeometryStateSnapshot
}

export type GpsShiftStatus = {
  shifted: boolean
  current_lat?: number
  current_lon?: number
  reference_lat?: number
  reference_lon?: number
}

const versionKey = (directory: string) => ["plot-geometry", "versions", directory]
const gpsKey = (directory: string) => ["plot-geometry", "gps-shift", directory]

export function usePlotGeometryVersions(directory: string | null | undefined) {
  return useQuery<PlotGeometryVersion[], Error>({
    queryKey: versionKey(directory ?? ""),
    queryFn: async () => {
      if (!directory) return []
      const res = await PlotGeometryService.apiPlotGeometryVersionsListListVersions(
        { requestBody: { directory } },
      )
      return (res as PlotGeometryVersion[] | null) ?? []
    },
    enabled: isLoggedIn() && Boolean(directory),
  })
}

export function useLoadPlotGeometryVersion(
  directory: string | null | undefined,
  version: number | null,
) {
  return useQuery<PlotGeometryVersionLoaded, Error>({
    queryKey: ["plot-geometry", "version", directory, version],
    queryFn: async () => {
      if (!directory) throw new Error("directory required")
      const res = await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion(
        { requestBody: { directory, version } },
      )
      return res as unknown as PlotGeometryVersionLoaded
    },
    enabled: isLoggedIn() && Boolean(directory),
  })
}

export function useSavePlotGeometryVersion() {
  const qc = useQueryClient()
  return useMutation<
    PlotGeometryVersion,
    Error,
    {
      directory: string
      stateSnapshot: PlotGeometryStateSnapshot
      name?: string
    }
  >({
    mutationFn: async ({ directory, stateSnapshot, name }) => {
      const res = await PlotGeometryService.apiPlotGeometryVersionsSaveSaveVersion(
        {
          requestBody: {
            directory,
            state_snapshot: stateSnapshot as unknown as Record<string, unknown>,
            name: name ?? undefined,
          },
        },
      )
      return res as unknown as PlotGeometryVersion
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: versionKey(vars.directory) })
    },
  })
}

export function useActivatePlotGeometryVersion() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, { directory: string; version: number }>({
    mutationFn: async ({ directory, version }) => {
      return PlotGeometryService.apiPlotGeometryVersionsActivateActivateVersion(
        { requestBody: { directory, version } },
      )
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: versionKey(vars.directory) })
    },
  })
}

export function useDeletePlotGeometryVersion() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, { directory: string; version: number }>({
    mutationFn: async ({ directory, version }) => {
      return PlotGeometryService.apiPlotGeometryVersionsDeleteDeleteVersion({
        requestBody: { directory, version },
      })
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: versionKey(vars.directory) })
    },
  })
}

// --- GPS shift ---

export function useGpsShiftStatus(directory: string | null | undefined) {
  return useQuery<GpsShiftStatus, Error>({
    queryKey: gpsKey(directory ?? ""),
    queryFn: async () => {
      if (!directory) return { shifted: false }
      const res = await PlotGeometryService.apiPlotGeometryGpsShiftStatusCheckGpsShiftStatus(
        { requestBody: { directory } },
      )
      return res as unknown as GpsShiftStatus
    },
    enabled: isLoggedIn() && Boolean(directory),
  })
}

export function useShiftGps() {
  const qc = useQueryClient()
  return useMutation<
    unknown,
    Error,
    { directory: string; currentLat: number; currentLon: number }
  >({
    mutationFn: async ({ directory, currentLat, currentLon }) => {
      return PlotGeometryService.apiPlotGeometryShiftGpsShiftGps({
        requestBody: { directory, current_lat: currentLat, current_lon: currentLon },
      })
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: gpsKey(vars.directory) })
      qc.invalidateQueries({ queryKey: versionKey(vars.directory) })
    },
  })
}

export function useUndoGpsShift() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, { directory: string }>({
    mutationFn: async ({ directory }) => {
      return PlotGeometryService.apiPlotGeometryUndoGpsShiftUndoGpsShift({
        requestBody: { directory },
      })
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: gpsKey(vars.directory) })
      qc.invalidateQueries({ queryKey: versionKey(vars.directory) })
    },
  })
}
