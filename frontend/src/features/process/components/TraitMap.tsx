/**
 * TraitMap — deck.gl GeoJsonLayer over a raster basemap (Esri satellite by
 * default, OSM optional), colored by the chosen trait column with a
 * viridis-like ramp.
 *
 * Three render modes, switched by props:
 *   1. Heatmap: pass `data` (FeatureCollection) + `traitColumn`. Plots are
 *      filled with viridis(value).
 *   2. Outline-only: pass `data` (FeatureCollection) with no `traitColumn`.
 *      Plots are stroked, not filled — the user sees "where are the
 *      plots" without committing to a trait yet.
 *   3. Underlay: optionally pass `orthoTileUrl` to render a TiTiler raster
 *      tile source beneath the polygons. The dev-server `/titiler` proxy
 *      handles auth + 404→transparent rewrites.
 *
 * No Mapbox token required: the basemap uses maplibre-gl raster styles.
 */

import { GeoJsonLayer } from "@deck.gl/layers"
import DeckGL from "@deck.gl/react"
import type { StyleSpecification } from "maplibre-gl"
import { useMemo } from "react"
import { Map as MaplibreMap, NavigationControl } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"

const ESRI_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
]
const OSM_TILES = ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"]

/** Build a MapLibre style with an Esri or OSM basemap and an optional
 *  TiTiler ortho raster source layered on top. The ortho is a regular
 *  raster source pointed at the TiTiler XYZ tile endpoint (the dev-server
 *  `/titiler` proxy handles auth and out-of-footprint 404 rewrites). */
function buildStyle(
  basemap: "esri" | "osm",
  orthoTileUrl: string | undefined,
): StyleSpecification {
  const baseTiles = basemap === "esri" ? ESRI_TILES : OSM_TILES
  const baseAttr =
    basemap === "esri"
      ? "Tiles © Esri — World Imagery"
      : "© OpenStreetMap contributors"
  const style: StyleSpecification = {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: baseTiles,
        tileSize: 256,
        attribution: baseAttr,
      },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  }
  if (orthoTileUrl) {
    style.sources.ortho = {
      type: "raster",
      tiles: [orthoTileUrl],
      tileSize: 256,
    }
    style.layers.push({ id: "ortho", type: "raster", source: "ortho" })
  }
  return style
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

function bboxOf(
  fc: GeoJSON.FeatureCollection,
): [number, number, number, number] | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
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
  for (const f of fc.features)
    visit((f.geometry as { coordinates?: unknown })?.coordinates)
  return any ? [minX, minY, maxX, maxY] : null
}

export type TraitMapProps = {
  data: GeoJSON.FeatureCollection
  /** When set, polygons are filled with viridis(value) and the legend
   *  shows the value range. Omit to render outline-only. */
  traitColumn?: string
  /** TiTiler XYZ tile URL template (`/titiler/cog/tiles/.../{z}/{x}/{y}?url=…`).
   *  When supplied, the ortho is rendered as a raster layer beneath the
   *  polygons. */
  orthoTileUrl?: string
  /** Basemap layer behind the ortho/polygons. Default Esri (satellite). */
  basemap?: "esri" | "osm"
}

export function TraitMap({
  data,
  traitColumn,
  orthoTileUrl,
  basemap = "esri",
}: TraitMapProps) {
  const { range, viewState } = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    if (traitColumn) {
      for (const f of data.features) {
        const v = (f.properties as Record<string, unknown> | null)?.[
          traitColumn
        ]
        if (typeof v === "number" && Number.isFinite(v)) {
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
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

  const mapStyle = useMemo(
    () => buildStyle(basemap, orthoTileUrl),
    [basemap, orthoTileUrl],
  )

  const layer = new GeoJsonLayer({
    id: "traits",
    data: data.features as unknown as GeoJSON.Feature[],
    pickable: true,
    stroked: true,
    filled: Boolean(traitColumn),
    getFillColor: (f: GeoJSON.Feature) => {
      if (!traitColumn) return [0, 0, 0, 0]
      const props = (f.properties ?? {}) as Record<string, unknown>
      const v = props[traitColumn]
      if (typeof v !== "number" || !Number.isFinite(v))
        return [200, 200, 200, 120]
      const [lo, hi] = range
      const t = hi === lo ? 0.5 : (v - lo) / (hi - lo)
      return viridis(t)
    },
    getLineColor: traitColumn ? [40, 40, 40, 220] : [255, 220, 50, 240],
    lineWidthMinPixels: traitColumn ? 1 : 2,
  })

  return (
    <div
      className="relative h-[480px] w-full overflow-hidden rounded-md border"
      data-testid="trait-map-container"
    >
      <DeckGL
        initialViewState={viewState}
        controller={true}
        layers={[layer]}
        style={{
          position: "absolute",
          top: "0",
          right: "0",
          bottom: "0",
          left: "0",
        }}
        getTooltip={(info) => {
          const object = (info as { object?: GeoJSON.Feature | null }).object
          if (!object) return null
          const props = (object.properties ?? {}) as Record<string, unknown>
          const plot = props.plot ?? props.plot_number
          if (!traitColumn) {
            // Outline-only tooltip: show plot/accession identity.
            const acc = props.accession ?? props.accession_name
            return {
              text:
                (plot != null ? `Plot ${String(plot)}` : "") +
                (acc != null ? `\n${String(acc)}` : ""),
            }
          }
          const v = props[traitColumn]
          return {
            text: `${plot != null ? `Plot ${String(plot)}\n` : ""}${traitColumn}: ${
              typeof v === "number" ? v.toFixed(3) : String(v ?? "—")
            }`,
          }
        }}
      >
        <MaplibreMap
          reuseMaps
          mapStyle={mapStyle as never}
          attributionControl={{ compact: true }}
        >
          <NavigationControl position="top-right" />
        </MaplibreMap>
      </DeckGL>
      {traitColumn ? (
        <div
          className="absolute bottom-2 left-2 rounded bg-white/85 px-2 py-1 text-xs shadow"
          data-testid="trait-map-legend"
          data-min={range[0]}
          data-max={range[1]}
        >
          {traitColumn}: {range[0].toFixed(3)} → {range[1].toFixed(3)}
        </div>
      ) : (
        <div
          className="absolute bottom-2 left-2 rounded bg-white/85 px-2 py-1 text-xs shadow"
          data-testid="trait-map-legend"
        >
          {data.features.length} plot{data.features.length === 1 ? "" : "s"}
        </div>
      )}
    </div>
  )
}
