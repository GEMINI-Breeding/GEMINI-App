/**
 * OrthoMapView — viewer-only Leaflet wrapper for an orthomosaic raster.
 *
 * Mirrors the basemap + ortho-pane scaffolding in BoundaryMap.tsx but skips
 * the Geoman polygon toolbar, the editable FeatureGroup, and the pm:* event
 * wiring. The result is an ~80-line read-only map suitable for the ortho
 * preview dialog. Coupling those branches into BoundaryMap would interleave
 * conditional logic across the most fragile leaflet code in the app — see
 * the RUN_ODM viewer plan for the trade-off discussion.
 */

import L from "leaflet"
import { useEffect, useRef } from "react"
import "leaflet/dist/leaflet.css"

const DEFAULT_CENTER: L.LatLngTuple = [38.5, -121.7]
const DEFAULT_ZOOM = 6

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
const ESRI_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

export type OrthoMapViewProps = {
  /** TiTiler XYZ template, e.g. `/titiler/cog/tiles/.../{z}/{x}/{y}?url=…`. */
  orthoTileUrl?: string
  /** WGS84 bounds [[south, west], [north, east]] for auto-fit. */
  orthoBounds?: [[number, number], [number, number]]
  /** 0-1 overlay opacity (default 1.0 — viewer wants a fully opaque ortho). */
  orthoOpacity?: number
  className?: string
}

export function OrthoMapView({
  orthoTileUrl,
  orthoBounds,
  orthoOpacity,
  className,
}: OrthoMapViewProps) {
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const orthoLayerRef = useRef<L.TileLayer | null>(null)
  const didFitOrthoRef = useRef(false)

  // One-time map init.
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    })

    // Custom pane for the ortho overlay; matches BoundaryMap so toggling
    // basemaps via the layers control can't push the ortho beneath them.
    map.createPane("orthoPane")
    const orthoPaneEl = map.getPane("orthoPane")
    if (orthoPaneEl) orthoPaneEl.style.zIndex = "250"

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
    sat.addTo(map)
    L.control
      .layers(
        { "Satellite (Esri)": sat, "Streets (OSM)": osm },
        {},
        { position: "topright", collapsed: true },
      )
      .addTo(map)

    mapRef.current = map
    // Expose for e2e: the viewer spec needs to confirm the Leaflet map
    // actually mounted inside the dialog.
    ;(window as unknown as { __orthoViewerMap__?: L.Map }).__orthoViewerMap__ =
      map

    return () => {
      map.remove()
      mapRef.current = null
      orthoLayerRef.current = null
      didFitOrthoRef.current = false
      const w = window as unknown as { __orthoViewerMap__?: L.Map }
      if (w.__orthoViewerMap__ === map) w.__orthoViewerMap__ = undefined
    }
  }, [])

  // Mount/unmount the ortho tile layer when URL or opacity changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (orthoLayerRef.current) {
      map.removeLayer(orthoLayerRef.current)
      orthoLayerRef.current = null
    }
    if (!orthoTileUrl) return
    const layer = L.tileLayer(orthoTileUrl, {
      opacity: orthoOpacity ?? 1,
      pane: "orthoPane",
      maxNativeZoom: 22,
      maxZoom: 24,
    })
    layer.addTo(map)
    orthoLayerRef.current = layer
  }, [orthoTileUrl, orthoOpacity])

  // First-load fit-to-ortho once bounds arrive. There's no feature-fit branch
  // here — the viewer never has user-drawn geometry to compete with.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!orthoBounds) return
    if (didFitOrthoRef.current) return
    const [[s, w], [n, e]] = orthoBounds
    map.fitBounds(
      [
        [s, w],
        [n, e],
      ],
      { padding: [20, 20] },
    )
    didFitOrthoRef.current = true
  }, [orthoBounds])

  return (
    <div
      ref={mapEl}
      data-testid="ortho-viewer-map"
      // `isolate` keeps Leaflet's pane z-indexes (200-800) inside the map's
      // stacking context so they don't leak above the dialog (z-50).
      className={className ?? "h-[480px] w-full rounded-md border isolate"}
    />
  )
}
