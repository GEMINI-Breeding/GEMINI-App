/**
 * TraitMap — deck.gl GeoJsonLayer over an OSM raster basemap, colored by
 * the chosen trait column with a viridis-like ramp.
 *
 * No Mapbox token required: the basemap uses the maplibre-gl raster style
 * pointed at OpenStreetMap tiles. The deck.gl overlay renders polygon
 * fills + thin outlines.
 */
import { useMemo } from "react"
import DeckGL from "@deck.gl/react"
import { GeoJsonLayer } from "@deck.gl/layers"
import { Map as MaplibreMap, NavigationControl } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
}

type Color = [number, number, number, number]

function viridis(t: number): Color {
  // Cheap viridis ramp — five-stop linear interpolation.
  const stops: Array<[number, Color]> = [
    [0.0, [68, 1, 84, 200]],
    [0.25, [59, 82, 139, 200]],
    [0.5, [33, 145, 140, 200]],
    [0.75, [94, 201, 98, 200]],
    [1.0, [253, 231, 37, 200]],
  ]
  const x = Math.min(1, Math.max(0, t))
  for (let i = 1; i < stops.length; i += 1) {
    const [aT, aC] = stops[i - 1]
    const [bT, bC] = stops[i]
    if (x <= bT) {
      const f = (x - aT) / (bT - aT || 1)
      return [
        Math.round(aC[0] + f * (bC[0] - aC[0])),
        Math.round(aC[1] + f * (bC[1] - aC[1])),
        Math.round(aC[2] + f * (bC[2] - aC[2])),
        aC[3],
      ]
    }
  }
  return stops[stops.length - 1][1]
}

function bboxOf(fc: GeoJSON.FeatureCollection): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let any = false
  function visit(coords: unknown): void {
    if (!Array.isArray(coords)) return
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const x = coords[0] as number
      const y = coords[1] as number
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      any = true
      return
    }
    for (const c of coords) visit(c)
  }
  for (const f of fc.features) visit((f.geometry as { coordinates?: unknown })?.coordinates)
  return any ? [minX, minY, maxX, maxY] : null
}

export function TraitMap({
  data,
  traitColumn,
}: {
  data: GeoJSON.FeatureCollection
  traitColumn: string
}) {
  const { range, viewState } = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const f of data.features) {
      const v = (f.properties as Record<string, unknown> | null)?.[traitColumn]
      if (typeof v === "number" && Number.isFinite(v)) {
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) {
      lo = 0
      hi = 1
    }
    const bbox = bboxOf(data)
    const view = bbox
      ? {
          longitude: (bbox[0] + bbox[2]) / 2,
          latitude: (bbox[1] + bbox[3]) / 2,
          zoom: 17,
          pitch: 0,
          bearing: 0,
        }
      : { longitude: -121.7, latitude: 38.5, zoom: 12, pitch: 0, bearing: 0 }
    return { range: [lo, hi] as [number, number], viewState: view }
  }, [data, traitColumn])

  const layer = new GeoJsonLayer({
    id: "traits",
    data: data.features as unknown as GeoJSON.Feature[],
    pickable: true,
    stroked: true,
    filled: true,
    getFillColor: (f: GeoJSON.Feature) => {
      const props = (f.properties ?? {}) as Record<string, unknown>
      const v = props[traitColumn]
      if (typeof v !== "number" || !Number.isFinite(v)) return [200, 200, 200, 120]
      const [lo, hi] = range
      const t = hi === lo ? 0.5 : (v - lo) / (hi - lo)
      return viridis(t)
    },
    getLineColor: [40, 40, 40, 220],
    lineWidthMinPixels: 1,
  })

  return (
    <div className="relative h-[480px] w-full overflow-hidden rounded-md border">
      <DeckGL
        initialViewState={viewState}
        controller={true}
        layers={[layer]}
        style={{ position: "absolute", top: "0", right: "0", bottom: "0", left: "0" }}
        getTooltip={(info) => {
          const object = (info as { object?: GeoJSON.Feature | null }).object
          if (!object) return null
          const props = (object.properties ?? {}) as Record<string, unknown>
          const v = props[traitColumn]
          const plot = props.plot
          return {
            text: `${plot != null ? `Plot ${String(plot)}\n` : ""}${traitColumn}: ${
              typeof v === "number" ? v.toFixed(3) : String(v ?? "—")
            }`,
          }
        }}
      >
        <MaplibreMap
          reuseMaps
          mapStyle={OSM_STYLE as never}
          attributionControl={{ compact: true }}
        >
          <NavigationControl position="top-right" />
        </MaplibreMap>
      </DeckGL>
      <div className="absolute bottom-2 left-2 rounded bg-white/85 px-2 py-1 text-xs shadow">
        {traitColumn}: {range[0].toFixed(3)} → {range[1].toFixed(3)}
      </div>
    </div>
  )
}
