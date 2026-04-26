/**
 * BoundaryMap — Leaflet + Geoman polygon editor for plot boundaries.
 *
 * Renders an OpenStreetMap basemap, lets the user draw polygons via the
 * Geoman toolbar, and emits the current FeatureCollection up to the parent
 * on every change. Imported boundaries (from a saved version or grid
 * generation) are rendered into the editable layer.
 */
import { useEffect, useRef } from "react"
import L, { type FeatureGroup } from "leaflet"
import "leaflet/dist/leaflet.css"
import "@geoman-io/leaflet-geoman-free"
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css"

const DEFAULT_CENTER: L.LatLngTuple = [38.5, -121.7]
const DEFAULT_ZOOM = 6

export type BoundaryMapProps = {
  features: GeoJSON.Feature[]
  onFeaturesChange: (features: GeoJSON.Feature[]) => void
  /** Optional starting view; falls back to bounds of features or a default. */
  center?: L.LatLngTuple
  zoom?: number
  className?: string
}

export function BoundaryMap({
  features,
  onFeaturesChange,
  center,
  zoom,
  className,
}: BoundaryMapProps) {
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<FeatureGroup | null>(null)
  const onChangeRef = useRef(onFeaturesChange)

  useEffect(() => {
    onChangeRef.current = onFeaturesChange
  }, [onFeaturesChange])

  // One-time map init.
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current, {
      center: center ?? DEFAULT_CENTER,
      zoom: zoom ?? DEFAULT_ZOOM,
    })
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 22,
    }).addTo(map)

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
