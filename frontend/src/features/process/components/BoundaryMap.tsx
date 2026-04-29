/**
 * BoundaryMap — Leaflet + Geoman polygon editor for plot boundaries.
 *
 * Renders an OSM/Esri basemap (toggle in the top-right layers control),
 * an optional orthomosaic XYZ overlay served by TiTiler, and lets the
 * user draw polygons via the Geoman toolbar. Imported boundaries (from
 * a saved version or grid generation) are rendered into the editable
 * layer.
 */
import { useEffect, useRef } from "react"
import L, { type FeatureGroup } from "leaflet"
import "leaflet/dist/leaflet.css"
import "@geoman-io/leaflet-geoman-free"
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css"

const DEFAULT_CENTER: L.LatLngTuple = [38.5, -121.7]
const DEFAULT_ZOOM = 6

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
const ESRI_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

export type BoundaryMapProps = {
  features: GeoJSON.Feature[]
  onFeaturesChange: (features: GeoJSON.Feature[]) => void
  /** Optional starting view; falls back to bounds of features or a default. */
  center?: L.LatLngTuple
  zoom?: number
  className?: string
  /** TiTiler XYZ template, e.g. `/titiler/cog/tiles/{z}/{x}/{y}.png?url=...` */
  orthoTileUrl?: string
  /** WGS84 bounds [[south, west], [north, east]] for auto-fit. */
  orthoBounds?: [[number, number], [number, number]]
  /** 0-1 overlay opacity (default 0.85). */
  orthoOpacity?: number
}

export function BoundaryMap({
  features,
  onFeaturesChange,
  center,
  zoom,
  className,
  orthoTileUrl,
  orthoBounds,
  orthoOpacity,
}: BoundaryMapProps) {
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<FeatureGroup | null>(null)
  const orthoLayerRef = useRef<L.TileLayer | null>(null)
  const didFitOrthoRef = useRef(false)
  const onChangeRef = useRef(onFeaturesChange)
  // Latest orthoTileUrl available at map-init time. Refs let the one-time
  // init effect read the current prop without depending on it.
  const orthoTileUrlRef = useRef(orthoTileUrl)

  useEffect(() => {
    onChangeRef.current = onFeaturesChange
  }, [onFeaturesChange])

  useEffect(() => {
    orthoTileUrlRef.current = orthoTileUrl
  }, [orthoTileUrl])

  // One-time map init.
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current, {
      center: center ?? DEFAULT_CENTER,
      zoom: zoom ?? DEFAULT_ZOOM,
    })

    // OSM serves up to z19; Esri up to z19 reliably and z22 in some areas.
    // Cap each provider at its native limit and let Leaflet upscale via
    // maxZoom on the map itself when the user zooms further into the ortho.
    const osm = L.tileLayer(OSM_URL, {
      attribution: "© OpenStreetMap contributors",
      maxNativeZoom: 19,
      maxZoom: 24,
    })
    const sat = L.tileLayer(ESRI_URL, {
      attribution: "Tiles © Esri",
      maxNativeZoom: 19,
      maxZoom: 24,
    })
    // When an ortho overlay is available, satellite gives more useful
    // surrounding context than OSM road labels.
    ;(orthoTileUrlRef.current ? sat : osm).addTo(map)
    L.control
      .layers(
        { "Satellite (Esri)": sat, "Streets (OSM)": osm },
        {},
        { position: "topright", collapsed: true },
      )
      .addTo(map)

    const editable = L.featureGroup().addTo(map)
    layerRef.current = editable
    mapRef.current = map

    map.pm.addControls({
      position: "topleft",
      drawCircle: false,
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawText: false,
      cutPolygon: false,
      rotateMode: false,
    })
    map.pm.setGlobalOptions({ layerGroup: editable })

    function emit() {
      const out: GeoJSON.Feature[] = []
      editable.eachLayer((layer) => {
        const gj = (layer as L.Layer & { toGeoJSON?: () => GeoJSON.Feature }).toGeoJSON?.()
        if (gj && gj.type === "Feature") out.push(gj as GeoJSON.Feature)
      })
      onChangeRef.current(out)
    }

    map.on("pm:create", (e) => {
      // pm:create fires before the new layer is in editable; add manually so
      // the next emit() picks it up.
      const layer = (e as { layer: L.Layer }).layer
      if (layer && !editable.hasLayer(layer)) editable.addLayer(layer)
      emit()
    })
    map.on("pm:remove", emit)
    map.on("pm:edit", emit)
    editable.on("pm:edit", emit)

    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
      orthoLayerRef.current = null
      didFitOrthoRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Manage the ortho tile layer. Re-runs on URL or opacity change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (orthoLayerRef.current) {
      map.removeLayer(orthoLayerRef.current)
      orthoLayerRef.current = null
    }
    if (!orthoTileUrl) return
    const opts: L.TileLayerOptions = {
      opacity: orthoOpacity ?? 0.85,
      // TiTiler's tilejson reports the ortho's native max zoom; the geo
      // worker writes overviews so reasonable values around z21-22 are
      // typical for drone orthos. Cap at z22 and let Leaflet upscale.
      maxNativeZoom: 22,
      maxZoom: 24,
      // TiTiler's default tilesize for /cog/tiles is 512; matches the value
      // in the tilejson template. Leaflet must agree or tiles misalign.
      tileSize: 512,
    }
    if (orthoBounds) {
      // bounds keep Leaflet from requesting tiles outside the ortho's
      // footprint — TiTiler 404s on those and they spam the console.
      const [[s, w], [n, e]] = orthoBounds
      opts.bounds = L.latLngBounds([s, w], [n, e])
    }
    const layer = L.tileLayer(orthoTileUrl, opts)
    layer.addTo(map)
    orthoLayerRef.current = layer
  }, [orthoTileUrl, orthoOpacity, orthoBounds])

  // First-load fit-to-ortho when no features are drawn yet. The
  // fit-to-features effect below wins whenever the user has features.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!orthoBounds) return
    if (features.length > 0) return
    if (didFitOrthoRef.current) return
    const [[s, w], [n, e]] = orthoBounds
    map.fitBounds([
      [s, w],
      [n, e],
    ], { padding: [20, 20] })
    didFitOrthoRef.current = true
  }, [orthoBounds, features.length])

  // Keep editable layer in sync with `features` prop.
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    layer.clearLayers()
    for (const f of features) {
      L.geoJSON(f as GeoJSON.GeoJsonObject, {
        style: { color: "#2563eb", weight: 2, fillOpacity: 0.2 },
      }).eachLayer((l) => layer.addLayer(l))
    }
    if (features.length > 0) {
      try {
        const bounds = layer.getBounds()
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] })
      } catch {
        // ignore
      }
    }
  }, [features])

  return <div ref={mapEl} className={className ?? "h-[500px] w-full rounded-md border"} />
}
