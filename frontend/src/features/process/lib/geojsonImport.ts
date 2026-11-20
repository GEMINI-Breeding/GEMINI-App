/**
 * Plot boundaries from a GeoJSON file made elsewhere (QGIS, another tool, an
 * earlier export): its polygons become plots, each keeping its properties.
 * Common names for the plot number, row and column are copied to the ones the
 * app uses (plot, row, col), so the field design and traits match them.
 */

const NAMES: Record<"plot" | "row" | "col", string[]> = {
  plot: [
    "plot",
    "plot_id",
    "plotid",
    "plot_no",
    "plot_number",
    "plotnumber",
    "plot_name",
    "name",
    "id",
  ],
  row: ["row", "tier", "range", "row_no"],
  col: ["col", "column", "bed", "col_no"],
}
const OURS = new Set(["role", "cellId", "blockId", "block", "border", "label"])

function pick(props: Record<string, unknown>, names: string[]): unknown {
  const lower = new Map(Object.keys(props).map((k) => [k.toLowerCase(), k]))
  for (const n of names) {
    const k = lower.get(n)
    if (k !== undefined && props[k] !== null && props[k] !== "") return props[k]
  }
  return undefined
}

function inLonLat(ring: number[][]): boolean {
  return ring.every(
    ([x, y]) =>
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Math.abs(x) <= 180 &&
      Math.abs(y) <= 90,
  )
}

/** The plots of a GeoJSON text: one Polygon feature per plot (MultiPolygons split). */
export function plotsFromGeojson(
  text: string,
): GeoJSON.Feature<GeoJSON.Polygon>[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(
      "This is not a GeoJSON file (it could not be read as JSON).",
    )
  }
  const d = data as {
    type?: string
    features?: unknown[]
    crs?: { properties?: { name?: string } }
  }
  const features: GeoJSON.Feature[] =
    d?.type === "FeatureCollection"
      ? ((d.features ?? []) as GeoJSON.Feature[])
      : d?.type === "Feature"
        ? [d as unknown as GeoJSON.Feature]
        : Array.isArray(data)
          ? (data as GeoJSON.Feature[])
          : []
  const out: GeoJSON.Feature<GeoJSON.Polygon>[] = []
  for (const f of features) {
    const g = f?.geometry
    const rings: number[][][][] =
      g?.type === "Polygon"
        ? [(g as GeoJSON.Polygon).coordinates as number[][][]]
        : g?.type === "MultiPolygon"
          ? ((g as GeoJSON.MultiPolygon).coordinates as number[][][][])
          : []
    const src = (f.properties ?? {}) as Record<string, unknown>
    const props: Record<string, unknown> = Object.fromEntries(
      Object.entries(src).filter(([k]) => !OURS.has(k) && !k.startsWith("_")),
    )
    for (const key of ["plot", "row", "col"] as const) {
      if (props[key] === undefined) {
        const v = pick(src, NAMES[key])
        if (v !== undefined) props[key] = key === "plot" ? String(v) : Number(v)
      }
    }
    for (const poly of rings) {
      if (!poly[0] || poly[0].length < 4) continue
      if (!inLonLat(poly[0])) {
        throw new Error(
          "The coordinates are not longitude/latitude: save the file in WGS 84 (EPSG:4326) and import it again.",
        )
      }
      out.push({
        type: "Feature",
        properties: { ...props },
        geometry: { type: "Polygon", coordinates: poly },
      })
    }
  }
  if (!out.length)
    throw new Error("No polygons in this file: plot boundaries are polygons.")
  return out
}
