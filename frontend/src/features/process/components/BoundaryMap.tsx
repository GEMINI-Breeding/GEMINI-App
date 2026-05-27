/**
 * BoundaryMap — Leaflet + Geoman polygon editor for plot boundaries.
 *
 * Renders an OSM/Esri basemap (toggle in the top-right layers control),
 * an optional orthomosaic XYZ overlay served by TiTiler, and lets the
 * user draw polygons via the Geoman toolbar. Imported boundaries (from
 * a saved version or grid generation) are rendered into the editable
 * layer.
 */

import L, { type FeatureGroup } from "leaflet"
import { useEffect, useRef } from "react"
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
  /**
   * Currently-selected blockId. The matching outer polygon renders with
   * a highlight stroke; its grid cells render in the block's accent color
   * at higher opacity.
   */
  selectedBlockId?: string | null
  /**
   * Fires when the user clicks an outer-boundary polygon. Pass through to
   * lift the selected block into the parent component.
   */
  onSelectBlock?: (blockId: string) => void
  /**
   * Currently-selected cell ids. Cells in this set draw with a yellow
   * highlight stroke so the user can see what bulk action will apply.
   */
  selectedCellIds?: ReadonlyArray<string>
  /**
   * Fires when the user clicks a grid cell. `mode` reflects the
   * keyboard modifiers used during the click: replace (no modifier),
   * add (shift), or toggle (cmd/ctrl).
   */
  onCellSelect?: (cellId: string, mode: "replace" | "toggle" | "add") => void
  /** Fires when the user clicks the map background — used to clear cell selection. */
  onSelectionClear?: () => void
}

/**
 * Deterministic HSL colour from a blockId. Same id → same hue every
 * render, so a block keeps its accent across re-renders and reloads.
 */
function colorForBlockId(blockId: string): string {
  let h = 0
  for (let i = 0; i < blockId.length; i += 1) {
    h = (h * 31 + blockId.charCodeAt(i)) >>> 0
  }
  const hue = h % 360
  return `hsl(${hue}, 75%, 45%)`
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
  selectedBlockId,
  onSelectBlock,
  selectedCellIds,
  onCellSelect,
  onSelectionClear,
}: BoundaryMapProps) {
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<FeatureGroup | null>(null)
  const orthoLayerRef = useRef<L.TileLayer | null>(null)
  const didFitOrthoRef = useRef(false)
  const onChangeRef = useRef(onFeaturesChange)
  const onSelectBlockRef = useRef(onSelectBlock)
  const onCellSelectRef = useRef(onCellSelect)
  const onSelectionClearRef = useRef(onSelectionClear)
  // Mirror selectedCellIds into a ref so the Geoman drag handler can
  // read the latest set without re-binding the listeners.
  const selectedCellIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    selectedCellIdsRef.current = new Set(selectedCellIds ?? [])
  }, [selectedCellIds])
  // Timestamp of the last layer (cell/outer) click. The map's
  // background click handler uses this to tell whether a click bubbled
  // up from a layer it should have ignored.
  const lastLayerClickRef = useRef<number>(0)
  // Timestamp of the last Geoman drag-end. Some browsers fire a synthetic
  // click event after the mouseup that ends a drag — if we let that
  // click fire selection (and therefore a re-render), the layer rebuild
  // would snap the just-dragged polygon back to its pre-drag coords
  // before React has committed the drag's geometry change.
  const lastDragEndRef = useRef<number>(0)
  // Latest orthoTileUrl available at map-init time. Refs let the one-time
  // init effect read the current prop without depending on it.
  useEffect(() => {
    onChangeRef.current = onFeaturesChange
  }, [onFeaturesChange])
  useEffect(() => {
    onSelectBlockRef.current = onSelectBlock
  }, [onSelectBlock])
  useEffect(() => {
    onCellSelectRef.current = onCellSelect
  }, [onCellSelect])
  useEffect(() => {
    onSelectionClearRef.current = onSelectionClear
  }, [onSelectionClear])
  // Track the feature-count signature so we can refit the map only when
  // polygons are added/removed — not on every pm:edit. Without this
  // guard, dragging a vertex causes a refit that yanks the view.
  const lastFitSignatureRef = useRef<string>("")

  // One-time map init.
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current, {
      center: center ?? DEFAULT_CENTER,
      zoom: zoom ?? DEFAULT_ZOOM,
    })

    // Custom pane for the ortho overlay. Default tilePane has z-index 200;
    // putting the ortho at 250 keeps it above any basemap regardless of
    // insertion order, so toggling Esri ↔ OSM via the layers control
    // doesn't push the ortho underneath the new basemap.
    map.createPane("orthoPane")
    const orthoPaneEl = map.getPane("orthoPane")
    if (orthoPaneEl) orthoPaneEl.style.zIndex = "250"

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
    // Default to Esri satellite. The ortho query hasn't resolved at
    // map-init time so we can't condition on its presence, and Esri is
    // the more useful basemap regardless — when an ortho is loaded it
    // sits on top, and when there isn't one yet the satellite imagery
    // gives the user real geographic context to draw against. OSM is
    // one click away via the layers control.
    sat.addTo(map)
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
    // Expose for e2e: the field-design spec needs to inject a polygon
    // programmatically rather than driving the Geoman toolbar over a
    // non-deterministic ortho. The map and L are otherwise unreachable
    // from the test runner.
    ;(window as unknown as { __leafletMap__?: L.Map }).__leafletMap__ = map
    ;(window as unknown as { L?: typeof L }).L = L

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

    // Rename Geoman's tool tooltips from "Layer(s)" to "Block(s)" so the
    // UI matches the rest of the boundary-prep tool's terminology. The
    // strings here come from Geoman's default English translation table
    // (buttonTitles + tooltips); only the keys we want to override need
    // to appear, but setLang requires the full object shape so we set
    // the rest verbatim from the source. fallback = "en" keeps Geoman's
    // built-in strings for anything we haven't named.
    const customLang = {
      tooltips: {
        placeMarker: "Click to place marker",
        firstVertex: "Click to place first vertex",
        continueLine: "Click to continue drawing",
        finishLine: "Click any existing marker to finish",
        finishPoly: "Click first marker to finish",
        finishRect: "Click to finish",
        startCircle: "Click to place circle center",
        finishCircle: "Click to finish circle",
        placeCircleMarker: "Click to place circle marker",
        placeText: "Click to place text",
      },
      actions: {
        finish: "Finish",
        cancel: "Cancel",
        removeLastVertex: "Remove Last Vertex",
      },
      buttonTitles: {
        drawMarkerButton: "Draw Marker",
        drawPolyButton: "Draw Polygons",
        drawLineButton: "Draw Polyline",
        drawCircleButton: "Draw Circle",
        drawRectButton: "Draw Rectangle",
        editButton: "Edit Blocks",
        dragButton: "Drag Blocks",
        cutButton: "Cut Blocks",
        deleteButton: "Remove Blocks",
        drawCircleMarkerButton: "Draw Circle Marker",
        snappingButton: "Snap dragged marker to other layers and vertices",
        pinningButton: "Pin shared vertices together",
        rotateButton: "Rotate Blocks",
        drawTextButton: "Draw Text",
        scaleButton: "Scale Blocks",
      },
    } as unknown as Parameters<typeof map.pm.setLang>[1]
    map.pm.setLang("en", customLang, "en")

    function emit() {
      const out: GeoJSON.Feature[] = []
      editable.eachLayer((layer) => {
        const gj = (
          layer as L.Layer & { toGeoJSON?: () => GeoJSON.Feature }
        ).toGeoJSON?.()
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

    // Drag-time highlight + group-drag. When Geoman's drag tool grabs a
    // polygon: always paint it yellow so the user can see what they're
    // holding. If the dragged cell is part of a multi-cell selection,
    // also snapshot every other selected cell's coords and translate
    // them in lockstep on pm:drag — that's how the "move the whole
    // grid" UX works without needing a separate translate-mode toggle.
    //
    // After dragend, Geoman fires pm:edit, which calls emit() and
    // rebuilds layers from React state — so the temporary in-flight
    // setLatLngs writes are picked up naturally as one history entry.
    let dragGroup: {
      others: Array<{
        layer: L.Polygon
        baseRings: Array<Array<[number, number]>>
      }>
      startLatLng: { lat: number; lng: number }
    } | null = null

    function getCellId(l: L.Layer): string | null {
      const gj = (
        l as L.Layer & { toGeoJSON?: () => GeoJSON.Feature }
      ).toGeoJSON?.()
      const id = (gj?.properties as Record<string, unknown> | undefined)?.cellId
      return typeof id === "string" ? id : null
    }

    function getRings(l: L.Polygon): Array<Array<[number, number]>> {
      const gj = l.toGeoJSON() as GeoJSON.Feature<GeoJSON.Polygon>
      return gj.geometry.coordinates.map((ring) =>
        (ring as Array<[number, number]>).map(([x, y]) => [x, y]),
      )
    }

    editable.on("pm:dragstart", (e) => {
      const layer = (e as { layer: L.Layer }).layer as L.Path
      layer.setStyle?.({ color: "#facc15", weight: 3, fillOpacity: 0.5 })
      const draggedId = getCellId(layer as L.Layer)
      const sel = selectedCellIdsRef.current
      if (!draggedId || !sel.has(draggedId) || sel.size < 2) {
        dragGroup = null
        return
      }
      const others: NonNullable<typeof dragGroup>["others"] = []
      editable.eachLayer((other) => {
        if (other === layer) return
        const oid = getCellId(other)
        if (oid && sel.has(oid)) {
          others.push({
            layer: other as L.Polygon,
            baseRings: getRings(other as L.Polygon),
          })
        }
      })
      const c = (layer as L.Polygon).getBounds().getCenter()
      dragGroup = { others, startLatLng: { lat: c.lat, lng: c.lng } }
    })

    editable.on("pm:drag", (e) => {
      if (!dragGroup) return
      const layer = (e as { layer: L.Layer }).layer as L.Polygon
      const c = layer.getBounds().getCenter()
      const dLat = c.lat - dragGroup.startLatLng.lat
      const dLng = c.lng - dragGroup.startLatLng.lng
      for (const o of dragGroup.others) {
        const moved: L.LatLngTuple[][] = o.baseRings.map((ring) =>
          ring.map(([x, y]) => [y + dLat, x + dLng] as L.LatLngTuple),
        )
        // Leaflet polygons accept LatLngs in [[ring1], [ring2], ...] shape
        // for polygons with holes; single-ring polygons just use [ring].
        o.layer.setLatLngs(moved.length === 1 ? moved[0] : moved)
      }
    })

    editable.on("pm:dragend", () => {
      dragGroup = null
      lastDragEndRef.current = Date.now()
      // Force-emit on dragend: Geoman's pm:edit timing varies by version
      // and event source (map vs layer vs editable group) — calling
      // emit() here guarantees the dragged layer's new lat/lngs land in
      // React state before the next render cycle re-creates layers from
      // (stale) features and snaps them back to the old position.
      emit()
    })

    // Clicking the map background (not a polygon) clears cell selection.
    // Cell and outer click handlers stamp this ref AND we sniff the DOM
    // event target — Leaflet dispatches map "click" regardless of what
    // the click originally hit, so we need both checks. The target check
    // catches the case where the polygon click hasn't fired yet (some
    // Leaflet versions dispatch map clicks first); the timestamp guards
    // against synthetic clicks fired after a drag.
    map.on("click", (ev) => {
      const lastLayerClick = lastLayerClickRef.current
      if (lastLayerClick && Date.now() - lastLayerClick < 300) return
      if (Date.now() - lastDragEndRef.current < 300) return
      const oe = (ev as L.LeafletMouseEvent).originalEvent
      const target = oe?.target as Element | null
      // Polygon SVG paths live inside the overlay pane. Background
      // clicks land on the map container itself or on tile/leaflet-pane
      // elements. If the click target is anywhere under an svg <path>
      // that we drew, ignore it.
      if (target?.closest?.("path")) return
      onSelectionClearRef.current?.()
    })

    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
      orthoLayerRef.current = null
      didFitOrthoRef.current = false
      const w = window as unknown as { __leafletMap__?: L.Map }
      if (w.__leafletMap__ === map) w.__leafletMap__ = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, zoom])

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
      // Render in the dedicated orthoPane so basemap-toggle reordering
      // can't push the ortho beneath the new basemap.
      pane: "orthoPane",
      // TiTiler's tilejson reports the ortho's native max zoom; the geo
      // worker writes overviews so reasonable values around z21-22 are
      // typical for drone orthos. Cap at z22 and let Leaflet upscale.
      maxNativeZoom: 22,
      maxZoom: 24,
    }
    // Note: out-of-footprint tile requests are inevitable — drone orthos
    // are non-rectangular within their bounding box, and Leaflet's
    // animated zoom transitions also request buffer tiles around the
    // viewport. The /titiler proxy in vite.config.ts rewrites TiTiler's
    // 404s to a 200 transparent PNG so the browser's network log stays
    // quiet and the e2e console-error guard isn't tripped.
    const layer = L.tileLayer(orthoTileUrl, opts)
    layer.addTo(map)
    orthoLayerRef.current = layer
  }, [orthoTileUrl, orthoOpacity])

  // First-load fit-to-ortho when no features are drawn yet. The
  // fit-to-features effect below wins whenever the user has features.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!orthoBounds) return
    if (features.length > 0) return
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
  }, [orthoBounds, features.length])

  // Keep editable layer in sync with `features` prop.
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    const selectedCellSet = new Set(selectedCellIds ?? [])
    layer.clearLayers()
    for (const f of features) {
      const props = (f.properties ?? {}) as Record<string, unknown>
      const blockId =
        typeof props.blockId === "string" ? (props.blockId as string) : null
      const cellId =
        typeof props.cellId === "string" ? (props.cellId as string) : null
      const isOuter = props.role === "outer"
      const isSelected = blockId != null && blockId === selectedBlockId
      const isCellSelected = cellId != null && selectedCellSet.has(cellId)
      const accent = blockId ? colorForBlockId(blockId) : "#2563eb"
      // Outer boundaries draw with a thicker stroke and minimal fill so
      // the user can see what's inside; grid cells draw with the block's
      // accent at a higher fill so they read as one cohesive group.
      // A selected cell overrides the block accent with a yellow stroke
      // so the user can see exactly which cells the next bulk action
      // will affect.
      const baseStyle: L.PathOptions = isOuter
        ? {
            color: isSelected ? "#facc15" : accent,
            weight: isSelected ? 4 : 2,
            fillOpacity: 0.05,
            dashArray: isSelected ? undefined : "4 4",
          }
        : {
            color: isCellSelected ? "#facc15" : accent,
            weight: isCellSelected ? 3 : 1,
            fillOpacity: isCellSelected ? 0.55 : isSelected ? 0.35 : 0.2,
          }
      L.geoJSON(f as GeoJSON.GeoJsonObject, { style: baseStyle }).eachLayer(
        (l) => {
          // Clicking an outer polygon selects that block. Use a flag on
          // the layer so pm-edit clicks don't double-fire selection.
          if (isOuter && blockId) {
            ;(l as L.Path).on?.("click", (ev: L.LeafletMouseEvent) => {
              // Stop the click from propagating to the map background so
              // it doesn't deselect or interfere with Geoman tooling.
              L.DomEvent.stopPropagation(ev.originalEvent)
              if (Date.now() - lastDragEndRef.current < 300) return
              lastLayerClickRef.current = Date.now()
              onSelectBlockRef.current?.(blockId)
            })
            // Tooltip with the block label so the user can identify
            // which polygon is which at a glance.
            const label =
              typeof props.label === "string" ? (props.label as string) : null
            if (label) {
              ;(l as L.Path).bindTooltip?.(label, {
                permanent: true,
                direction: "center",
                className: "boundary-block-label",
              })
            }
          } else if (!isOuter && cellId) {
            // Clicking a grid cell selects it. Shift = add to selection,
            // Cmd/Ctrl = toggle, otherwise = replace.
            ;(l as L.Path).on?.("click", (ev: L.LeafletMouseEvent) => {
              L.DomEvent.stopPropagation(ev.originalEvent)
              // Suppress synthetic clicks generated by the mouseup that
              // ends a Geoman drag.
              if (Date.now() - lastDragEndRef.current < 300) return
              lastLayerClickRef.current = Date.now()
              const oe = ev.originalEvent
              const mode = oe.shiftKey
                ? "add"
                : oe.metaKey || oe.ctrlKey
                  ? "toggle"
                  : "replace"
              onCellSelectRef.current?.(cellId, mode)
            })
          }
          layer.addLayer(l)
        },
      )
    }
    // Refit only on empty <-> non-empty transitions so undo back to an
    // empty state doesn't yank the user's view.
    const signature = features.length === 0 ? "empty" : "nonempty"
    if (
      features.length > 0 &&
      signature !== lastFitSignatureRef.current &&
      lastFitSignatureRef.current === "empty"
    ) {
      lastFitSignatureRef.current = signature
      try {
        const bounds = layer.getBounds()
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] })
      } catch {
        // ignore
      }
    } else {
      lastFitSignatureRef.current = signature
    }
  }, [features, selectedBlockId, selectedCellIds])

  return (
    <div
      ref={mapEl}
      // `isolate` creates a new stacking context so Leaflet's pane
      // z-indexes (200-800) stay scoped to inside the map. Without it,
      // panes participate in the root stacking context and render *above*
      // body-portaled dialogs/overlays (z-50), which makes the
      // FieldDesignUploadDialog appear cut off or hidden behind tiles.
      className={className ?? "h-[500px] w-full rounded-md border isolate"}
    />
  )
}
