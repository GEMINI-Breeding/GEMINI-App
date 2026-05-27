/**
 * usePlotPolygons — fetch the active plot-boundary version for a MinIO
 * directory and project its `state_snapshot.boundaries` to a standard
 * GeoJSON FeatureCollection the analyze-page map can render.
 *
 * Slice 1 talks to the existing process-side endpoint (which is keyed
 * by MinIO directory string). Slice 2 introduces `/api/plots/geojson`
 * scoped by experiment/season/site; this hook will swap its data source
 * at that point without breaking callers.
 */
import { type UseQueryResult, useQuery } from "@tanstack/react-query"

import { PlotGeometryService, PlotsService } from "@/client"

export type PlotPolygonProps = {
  /** UUID; helpful to surface alongside row/col for joining later. */
  plot_id?: string
  /** Numeric plot id from the field-design CSV. */
  plot_number?: number
  plot_row_number?: number
  plot_column_number?: number
  accession_name?: string | null
  /** Carry remaining feature properties through untouched. */
  [extra: string]: unknown
}

export type PlotPolygonFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  PlotPolygonProps
>
export type PlotPolygonFC = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  PlotPolygonProps
>

/**
 * Coerce the snapshot's per-feature properties into the normalized
 * `PlotPolygonProps` shape regardless of which casing/key set was used
 * by the boundary editor / field-design CSV. R5a-era snapshots used
 * `plot`/`row`/`column`/`accession`; newer field-design imports use the
 * Postgres-side `plot_number`/`plot_row_number`/`plot_column_number`/
 * `accession_name`. Accept either.
 */
function normalizeProps(raw: unknown): PlotPolygonProps {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >
  const num = (v: unknown): number | undefined =>
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
        ? Number(v)
        : undefined
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined
  return {
    ...p,
    plot_number: num(p.plot_number) ?? num(p.plot) ?? num(p.Plot),
    plot_row_number: num(p.plot_row_number) ?? num(p.row) ?? num(p.Row),
    plot_column_number:
      num(p.plot_column_number) ??
      num(p.column) ??
      num(p.Column) ??
      num(p.col) ??
      num(p.Col),
    accession_name:
      str(p.accession_name) ??
      str(p.accession) ??
      str(p.Accession) ??
      str(p.Label) ??
      null,
  }
}

/**
 * Pull `state_snapshot.boundaries` out of the load-version response.
 * Older snapshots stored the FeatureCollection at the root; later ones
 * nest it under `boundaries`. Accept either.
 */
export function projectSnapshotToFeatureCollection(
  loaded: unknown,
): PlotPolygonFC {
  const root = (loaded ?? {}) as Record<string, unknown>
  const snap = (root.state_snapshot ?? {}) as Record<string, unknown>
  const boundaries = (snap.boundaries ?? snap) as Record<string, unknown>
  const features = Array.isArray(boundaries.features)
    ? (boundaries.features as Array<Record<string, unknown>>)
    : []
  const out: PlotPolygonFeature[] = []
  for (const f of features) {
    const geom = f.geometry as GeoJSON.Geometry | undefined
    if (!geom) continue
    if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") continue
    out.push({
      type: "Feature",
      geometry: geom as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      properties: normalizeProps(f.properties),
    })
  }
  return { type: "FeatureCollection", features: out }
}

/**
 * Coerce the `/api/plots/geojson` response to the same normalized
 * shape `projectSnapshotToFeatureCollection` returns, so callers don't
 * have to special-case which path the data came from.
 *
 * The backend already returns a clean FeatureCollection with
 * `plot_id`/`plot_number`/`plot_row_number`/`plot_column_number` in
 * each feature's `properties`. We still run them through
 * `normalizeProps` to pick up any legacy short-hands that survived in
 * the merged-in snapshot properties.
 */
function projectGeojsonResponse(loaded: unknown): PlotPolygonFC {
  // Same projection as the snapshot path: take features, filter to
  // polygon-typed geometry, normalize properties.
  return projectSnapshotToFeatureCollection({ state_snapshot: loaded })
}

export type UsePlotPolygonsArgs = {
  /** Scope IDs — when all three are supplied the hook calls the new
   *  `/api/plots/geojson` endpoint (preferred). */
  experimentId?: string | null
  seasonId?: string | null
  siteId?: string | null
  /** MinIO directory string — used as a fallback when scope IDs aren't
   *  yet available (e.g. the user picked a date/platform/sensor but
   *  hasn't materialized plots for this scope yet). */
  directory?: string | null
}

export function usePlotPolygons(
  args: UsePlotPolygonsArgs,
): UseQueryResult<PlotPolygonFC | null, Error> {
  const { experimentId, seasonId, siteId, directory } = args
  const hasIds = Boolean(experimentId && seasonId && siteId)
  const enabled = hasIds || Boolean(directory && directory.length > 0)
  return useQuery<PlotPolygonFC | null, Error>({
    queryKey: [
      "analyze",
      "plot-polygons",
      experimentId ?? null,
      seasonId ?? null,
      siteId ?? null,
      directory ?? null,
    ],
    enabled,
    queryFn: async () => {
      // Preferred path: scope-ID-keyed endpoint. Returns plots that have
      // been materialized from the active plot-geometry version.
      if (hasIds) {
        try {
          const fc = await PlotsService.apiPlotsGeojsonGetPlotsGeojson({
            experimentId: experimentId as string,
            seasonId: seasonId as string,
            siteId: siteId as string,
          })
          const projected = projectGeojsonResponse(fc)
          // If the scope has no materialized plots yet but the user has
          // a directory, fall back to the snapshot read so they see
          // *something* (a freshly-saved boundary that hasn't been
          // materialized into plots yet, for example).
          if (projected.features.length > 0 || !directory) return projected
        } catch {
          // fall through to directory fallback
        }
      }
      if (directory) {
        try {
          const loaded =
            await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion({
              requestBody: { directory },
            })
          return projectSnapshotToFeatureCollection(loaded)
        } catch {
          // No active version yet → empty FC rather than a hard error,
          // so the UI can render an "upload a boundary first" empty
          // state instead of a red toast.
          return { type: "FeatureCollection", features: [] }
        }
      }
      return { type: "FeatureCollection", features: [] }
    },
    staleTime: 30_000,
  })
}
