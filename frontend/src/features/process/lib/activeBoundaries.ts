import { PlotGeometryService } from "@/client"

/**
 * Plot polygons of the active plot-geometry version at `directory`, or
 * undefined when there is none. Absence isn't an error: inference still
 * runs, it just can't attribute counts to plots.
 */
export async function loadActiveBoundaries(
  directory: string,
): Promise<GeoJSON.FeatureCollection | undefined> {
  const versions =
    ((await PlotGeometryService.apiPlotGeometryVersionsListListVersions({
      requestBody: { directory },
    })) ?? []) as Array<{ version: number; is_active?: boolean }>
  const active =
    versions.find((v) => v.is_active)?.version ?? versions[0]?.version
  if (active == null) return undefined
  const loaded =
    (await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion({
      requestBody: { directory, version: active },
    })) as unknown as {
      state_snapshot?: { boundaries?: GeoJSON.FeatureCollection }
    }
  const fc = loaded?.state_snapshot?.boundaries
  return fc?.features?.length ? fc : undefined
}
