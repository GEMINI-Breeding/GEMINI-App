/**
 * ImageDotMap — Esri-satellite map with one dot per raw drone image at
 * its EXIF GPS. Used by:
 *   - Image Review (`mode="exclude"`) — selected dots are dropped from ODM
 *   - GCP Picker Map tab (`mode="group"`) — selected dots are the
 *     candidate set for the active GCP
 *
 * Built directly on Leaflet (mirrors BoundaryMap.tsx) rather than
 * react-leaflet so we can manage the selection rectangle and per-dot
 * styling imperatively without re-rendering the whole map on every
 * selection toggle.
 *
 * Selection input:
 *   - shift-drag a rectangle to add every dot inside it
 *   - shift-click a single dot to toggle it
 *   - click a dot (no shift) to open a preview popup
 */

import L from "leaflet"
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import "leaflet/dist/leaflet.css"

import {
  fetchObjectAsBlob,
  type ImageGps,
} from "@/features/process/lib/imageGps"

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
const ESRI_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

const DEFAULT_CENTER: L.LatLngTuple = [38.5, -121.7]
const DEFAULT_ZOOM = 16

/** Selection mode — drives marker palette but not behavior. */
export type ImageDotMapMode = "exclude" | "group"

/** Extra non-image overlay markers (e.g., GCP locations from a CSV). */
export interface ExtraMarker {
  lat: number
  lon: number
  label: string
  color: string
}

export interface ImageDotMapProps {
  /** basename → ImageGps. Entries with `null` GPS are skipped. */
  gpsMap: Record<string, ImageGps>
  /** MinIO prefix the image basenames live under (used for popup preview). */
  imagesPrefix: string
  /** Currently-selected basenames (controlled). */
  selected: Set<string>
  onSelectionChange: (next: Set<string>) => void
  mode: ImageDotMapMode
  /** Optional accent color override (defaults: red for exclude, blue for group). */
  accentColor?: string
  /** Optional non-image markers to overlay (e.g., GCP positions). */
  extraMarkers?: ExtraMarker[]
  /**
   * Optional per-dot fill color (basename → CSS color). Used by the GCP
   * picker to color image dots according to which GCP "owns" them. The
   * `selected` highlight (accent + thicker stroke) still wins on top.
   * Dots not present in this map fall back to the default neutral color.
   */
  dotColors?: Record<string, string>
  className?: string
}

// Memoize to avoid re-creating the array on every parent render.
function gpsEntries(
  gpsMap: Record<string, ImageGps>,
): Array<{ name: string; lat: number; lon: number }> {
  const out: Array<{ name: string; lat: number; lon: number }> = []
  for (const [name, g] of Object.entries(gpsMap)) {
    if (!g) continue
    out.push({ name, lat: g.lat, lon: g.lon })
  }
  return out
}

export function ImageDotMap({
  gpsMap,
  imagesPrefix,
  selected,
  onSelectionChange,
  mode,
  accentColor,
  extraMarkers,
  dotColors,
  className,
}: ImageDotMapProps) {
  const wrapEl = useRef<HTMLDivElement | null>(null)
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map())
  const extraLayerRef = useRef<L.LayerGroup | null>(null)
  const didFitRef = useRef(false)
  const onSelChangeRef = useRef(onSelectionChange)
  const selectedRef = useRef(selected)
  const dotsRef = useRef<Array<{ name: string; lat: number; lon: number }>>([])
  // Click-to-activate: scroll-wheel zoom is off until the user clicks the
  // map, so vertical wheel scrolling over the map keeps scrolling the page.
  // Esc or a click outside the map deactivates again.
  const [wheelActive, setWheelActive] = useState(false)

  useEffect(() => {
    onSelChangeRef.current = onSelectionChange
    selectedRef.current = selected
  })

  const dots = useMemo(() => gpsEntries(gpsMap), [gpsMap])
  useEffect(() => {
    dotsRef.current = dots
  }, [dots])

  const accent = accentColor ?? (mode === "exclude" ? "#ef4444" : "#3b82f6")

  // ── One-time map init ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      // Disable Leaflet's built-in BoxZoom so shift-drag is free for
      // selection rectangles instead of zooming.
      boxZoom: false,
      // Wheel zoom is gated by click-to-activate (see effect below) so
      // scrolling the page doesn't get hijacked when the cursor passes
      // over the map.
      scrollWheelZoom: false,
    })

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
    // Expose for e2e — image-review and GCP-map specs need to drive
    // selection via map bounds rather than computing screen
    // coordinates against a non-deterministic Esri ortho.
    ;(window as unknown as { __imageDotMap__?: L.Map }).__imageDotMap__ = map

    // ── Shift-drag selection rectangle ────────────────────────────────────
    // Registered on the map container DOM (not via Leaflet's event API)
    // so the box-select machinery doesn't compete with Leaflet's marker
    // click delivery. We only intercept when:
    //   - shift is held on mousedown
    //   - the user moves more than DRAG_THRESHOLD_PX before mouseup
    // Shift-drag adds; shift+alt-drag removes. A pure shift-click on
    // the map background therefore does nothing (no rectangle drawn);
    // a shift-click on a marker propagates normally so the marker's
    // own click handler runs.
    const DRAG_THRESHOLD_PX = 5
    let pending = false
    let dragging = false
    let dragMode: "add" | "remove" = "add"
    let startClient: { x: number; y: number } | null = null
    let rect: L.Rectangle | null = null
    const container = mapEl.current

    function clientToLatLng(x: number, y: number): L.LatLng {
      const r = container!.getBoundingClientRect()
      return map.containerPointToLatLng([x - r.left, y - r.top])
    }
    function onMouseDownDom(ev: MouseEvent) {
      if (!ev.shiftKey) return
      // Skip if the press landed on a marker — let the marker click
      // handler drive single-toggle.
      const t = ev.target as HTMLElement | null
      if (t?.closest(".leaflet-interactive")) return
      pending = true
      dragMode = ev.altKey ? "remove" : "add"
      startClient = { x: ev.clientX, y: ev.clientY }
    }
    function onMouseMoveDom(ev: MouseEvent) {
      if (!pending || !startClient) return
      const dx = Math.abs(ev.clientX - startClient.x)
      const dy = Math.abs(ev.clientY - startClient.y)
      if (!dragging) {
        if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return
        dragging = true
        map.dragging.disable()
      }
      const sLL = clientToLatLng(startClient.x, startClient.y)
      const eLL = clientToLatLng(ev.clientX, ev.clientY)
      const bounds = L.latLngBounds(sLL, eLL)
      // Add mode = amber rectangle (today). Remove mode = slate so the
      // user sees which gesture they're performing.
      const color = dragMode === "remove" ? "#64748b" : "#fbbf24"
      if (rect) {
        rect.setBounds(bounds)
        rect.setStyle({ color })
      } else {
        rect = L.rectangle(bounds, {
          color,
          weight: 2,
          fillOpacity: 0.15,
          interactive: false,
        }).addTo(map)
      }
    }
    function onMouseUpDom(ev: MouseEvent) {
      if (!pending) {
        return
      }
      if (dragging && startClient) {
        const sLL = clientToLatLng(startClient.x, startClient.y)
        const eLL = clientToLatLng(ev.clientX, ev.clientY)
        const bounds = L.latLngBounds(sLL, eLL)
        const next = new Set(selectedRef.current)
        for (const [name, marker] of markersRef.current) {
          if (!bounds.contains(marker.getLatLng())) continue
          if (dragMode === "remove") next.delete(name)
          else next.add(name)
        }
        if (rect) {
          map.removeLayer(rect)
          rect = null
        }
        map.dragging.enable()
        onSelChangeRef.current(next)
      }
      pending = false
      dragging = false
      startClient = null
    }
    container?.addEventListener("mousedown", onMouseDownDom)
    window.addEventListener("mousemove", onMouseMoveDom)
    window.addEventListener("mouseup", onMouseUpDom)

    return () => {
      container?.removeEventListener("mousedown", onMouseDownDom)
      window.removeEventListener("mousemove", onMouseMoveDom)
      window.removeEventListener("mouseup", onMouseUpDom)
      map.remove()
      mapRef.current = null
      markersRef.current.clear()
      didFitRef.current = false
      const w = window as unknown as { __imageDotMap__?: L.Map }
      if (w.__imageDotMap__ === map) w.__imageDotMap__ = undefined
    }
  }, [])

  // ── Click-to-activate wheel zoom ─────────────────────────────────────────
  // Engage Leaflet's scroll-wheel handler only after the user clicks the
  // map. A click outside or Escape disengages. This keeps page scroll from
  // being hijacked when the cursor merely passes over the map.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (wheelActive) map.scrollWheelZoom.enable()
    else map.scrollWheelZoom.disable()
  }, [wheelActive])

  useEffect(() => {
    const wrap = wrapEl.current
    if (!wrap) return
    function onDocPointerDown(ev: PointerEvent) {
      if (!wrap) return
      const inside = wrap.contains(ev.target as Node)
      setWheelActive(inside)
    }
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") setWheelActive(false)
    }
    document.addEventListener("pointerdown", onDocPointerDown, true)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  // ── Sync markers with `dots` ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Drop stale markers.
    const present = new Set(dots.map((d) => d.name))
    for (const [name, marker] of markersRef.current) {
      if (!present.has(name)) {
        map.removeLayer(marker)
        markersRef.current.delete(name)
      }
    }
    // Expose for e2e: keyed-by-basename so the spec can pick exact dots
    // without scraping CircleMarker layers in iteration order.
    ;(
      window as unknown as {
        __imageDotMapMarkers__?: Map<string, L.CircleMarker>
      }
    ).__imageDotMapMarkers__ = markersRef.current

    // Add/update.
    for (const d of dots) {
      let marker = markersRef.current.get(d.name)
      if (!marker) {
        marker = L.circleMarker([d.lat, d.lon], {
          radius: 6,
          weight: 1.5,
          color: "#0f172a",
          fillColor: "#cbd5e1",
          fillOpacity: 0.9,
        }).addTo(map)
        marker.on("click", (e) => {
          const orig = (e as L.LeafletMouseEvent).originalEvent
          if (orig.shiftKey) {
            const next = new Set(selectedRef.current)
            if (next.has(d.name)) next.delete(d.name)
            else next.add(d.name)
            onSelChangeRef.current(next)
            return
          }
          // Cycling sequence: if the clicked dot is part of the current
          // selection, the popup steps through every selected dot
          // (geographically ordered). Otherwise it shows just the one.
          let sequence: string[] = [d.name]
          let startIndex = 0
          if (selectedRef.current.has(d.name) && selectedRef.current.size > 1) {
            const ordered = [...dotsRef.current]
              .filter((x) => selectedRef.current.has(x.name))
              .sort((a, b) => a.lon - b.lon || a.lat - b.lat)
              .map((x) => x.name)
            startIndex = Math.max(0, ordered.indexOf(d.name))
            sequence = ordered
          }
          const inSelection = selectedRef.current.has(d.name)
          void openPreviewPopup({
            map,
            markersByName: markersRef.current,
            sequence,
            startIndex,
            imagesPrefix,
            inSelection,
            removeFromSelection: (name: string) => {
              const next = new Set(selectedRef.current)
              next.delete(name)
              onSelChangeRef.current(next)
            },
          })
        })
        markersRef.current.set(d.name, marker)
      } else {
        marker.setLatLng([d.lat, d.lon])
      }
    }
  }, [dots, imagesPrefix])

  // ── Reflect `selected` into marker styles ────────────────────────────────
  useEffect(() => {
    for (const [name, marker] of markersRef.current) {
      const isSel = selected.has(name)
      const ownerColor = dotColors?.[name]
      marker.setStyle({
        // Selected dots adopt the accent (the active GCP's color); other
        // dots fall back to their owning-GCP color (or neutral gray).
        fillColor: isSel ? accent : (ownerColor ?? "#cbd5e1"),
        color: isSel ? accent : "#0f172a",
        weight: isSel ? 2.5 : 1.5,
      })
    }
  }, [selected, accent, dotColors])

  // ── First-load fit-to-bbox ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || dots.length === 0 || didFitRef.current) return
    const bounds = L.latLngBounds(dots.map((d) => [d.lat, d.lon]))
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 19 })
      didFitRef.current = true
    }
  }, [dots])

  // ── Sync extra markers (GCP positions etc.) ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (extraLayerRef.current) {
      map.removeLayer(extraLayerRef.current)
      extraLayerRef.current = null
    }
    if (!extraMarkers || extraMarkers.length === 0) return
    const group = L.layerGroup().addTo(map)
    for (const m of extraMarkers) {
      // Larger, distinctively-styled marker so GCPs read clearly against
      // the image-dot field. A circle ring + center dot in the GCP's
      // catalog color, with the label as a permanent tooltip.
      L.circleMarker([m.lat, m.lon], {
        radius: 11,
        color: m.color,
        weight: 3,
        fillColor: m.color,
        fillOpacity: 0.25,
        interactive: true,
      })
        .bindTooltip(m.label, {
          permanent: true,
          direction: "top",
          offset: [0, -8],
          className: "gcp-tooltip",
        })
        .addTo(group)
    }
    extraLayerRef.current = group
  }, [extraMarkers])

  // Active-state border lives on the wrapper as an inline boxShadow ring
  // so it works regardless of any custom `className` the caller passes,
  // and stays visible (the map div's own border was masking ring utilities).
  const wrapStyle: CSSProperties = {
    boxShadow: wheelActive
      ? "0 0 0 3px #2563eb" // blue-600
      : "0 0 0 1px #cbd5e1", // slate-300
    borderRadius: 6,
    transition: "box-shadow 150ms ease",
  }

  return (
    <div
      ref={wrapEl}
      className="group relative"
      style={wrapStyle}
      data-wheel-active={wheelActive}
    >
      <div
        ref={mapEl}
        data-testid="image-dot-map"
        // `isolate` matches BoundaryMap so Leaflet's panes (z-index 200-800)
        // stay scoped inside the map and don't render above body-portaled
        // dialogs. No `border` here — the wrapper renders the colored
        // outline so it can switch color on activation.
        className={className ?? "h-[720px] w-full rounded-md isolate"}
      />
      {!wheelActive && (
        <div
          className="pointer-events-none absolute bottom-2 left-1/2 z-[400] -translate-x-1/2 rounded-md bg-black/60 px-3 py-1 text-xs text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          data-testid="image-dot-map-wheel-hint"
        >
          Click map to enable scroll-zoom
        </div>
      )}
    </div>
  )
}

// ── Preview popup ────────────────────────────────────────────────────────────

interface PreviewArgs {
  map: L.Map
  markersByName: Map<string, L.CircleMarker>
  /** Names to cycle through. Length 1 = single-image preview. */
  sequence: string[]
  /** Index into `sequence` to open on. */
  startIndex: number
  imagesPrefix: string
  /** Whether the dot the user clicked was already in the selection. */
  inSelection: boolean
  /** Callback to drop a name from the selection (used by the popup's
   *  "Remove from selection" button). */
  removeFromSelection: (name: string) => void
}

async function openPreviewPopup(args: PreviewArgs) {
  const {
    map,
    markersByName,
    sequence: initialSequence,
    startIndex,
    imagesPrefix,
    inSelection,
    removeFromSelection,
  } = args
  // The cycling sequence is mutable: clicking "Remove from selection"
  // drops the current name from the array and advances. Start from a
  // copy so the caller's reference isn't mutated.
  const sequence = [...initialSequence]
  const multi = sequence.length > 1

  // Size the preview against the visible map. We reserve room for the
  // popup's chrome (header row + hint + tip arrow + content padding ≈
  // 72 px tall and 40 px wide) and cap at our preferred 640×480.
  const mapSize = map.getSize() // { x: width, y: height } in CSS px
  const maxImgW = Math.max(240, Math.min(640, mapSize.x - 80))
  const maxImgH = Math.max(180, Math.min(480, mapSize.y - 130))

  // Build the popup DOM imperatively so we can refresh the <img> and
  // header without tearing the popup down — that keeps the browser
  // from blanking the popup between cycle steps. Fix the root width to
  // the image's max width so the header / hint stretch to match the
  // preview, instead of collapsing to their natural content width.
  const root = document.createElement("div")
  root.style.cssText = `display:flex;flex-direction:column;gap:6px;align-items:stretch;width:${maxImgW}px;max-width:100%;`

  const headerRow = document.createElement("div")
  headerRow.style.cssText =
    "display:flex;align-items:center;gap:8px;width:100%;justify-content:center;"
  const prevBtn = document.createElement("button")
  prevBtn.type = "button"
  prevBtn.textContent = "‹ Prev"
  prevBtn.title = "Previous (←)"
  prevBtn.style.cssText = btnStyle()
  const nextBtn = document.createElement("button")
  nextBtn.type = "button"
  nextBtn.textContent = "Next ›"
  nextBtn.title = "Next (→)"
  nextBtn.style.cssText = btnStyle()
  const nameEl = document.createElement("div")
  nameEl.style.cssText =
    "font-size:12px;font-weight:500;flex:1;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
  const counterEl = document.createElement("div")
  counterEl.style.cssText =
    "font-size:11px;color:#64748b;min-width:3em;text-align:right;"
  if (multi) headerRow.appendChild(prevBtn)
  headerRow.appendChild(nameEl)
  if (multi) {
    headerRow.appendChild(counterEl)
    headerRow.appendChild(nextBtn)
  }

  // Wrap the <img> in a fixed-size box so the popup opens at its full
  // intended footprint *before* the blob arrives. Without this, Leaflet's
  // autoPan computes against a tiny "header-only" popup at open time,
  // decides no pan is needed, and the preview gets clipped once the
  // image loads. The box also centers small images instead of letting
  // `align-items: stretch` distort them.
  const imgWrap = document.createElement("div")
  imgWrap.style.cssText = `width:${maxImgW}px;height:${maxImgH}px;display:flex;align-items:center;justify-content:center;background:#f1f5f9;border-radius:4px;overflow:hidden;`
  const imgEl = document.createElement("img")
  imgEl.alt = ""
  imgEl.style.cssText = `max-width:100%;max-height:100%;display:block;`
  imgWrap.appendChild(imgEl)

  // Action row — appears under the image. The "Remove from selection"
  // button is only meaningful when the dot is part of the selection;
  // we hide it otherwise (single-image previews, dots outside the
  // selection set).
  const actionRow = document.createElement("div")
  actionRow.style.cssText =
    "display:flex;align-items:center;justify-content:center;gap:8px;width:100%;"
  const removeBtn = document.createElement("button")
  removeBtn.type = "button"
  removeBtn.textContent = "Remove from selection"
  removeBtn.title = "Drop this image from the current selection"
  removeBtn.style.cssText = btnStyle({ tone: "danger" })

  const hintEl = document.createElement("div")
  hintEl.style.cssText = "color:#64748b;font-size:11px;text-align:center;"
  hintEl.textContent = multi
    ? "‹ Prev / Next › or ← / → to step through the selection. Shift+Alt-drag to deselect a region."
    : "Shift-click to toggle selection. Shift-drag to box-select; shift+alt-drag to deselect."

  if (inSelection) actionRow.appendChild(removeBtn)

  root.appendChild(headerRow)
  root.appendChild(imgWrap)
  if (inSelection) root.appendChild(actionRow)
  root.appendChild(hintEl)

  // Stop wheel/scroll/click events on the popup from bubbling into
  // Leaflet (zoom-on-wheel, pan-on-drag, etc.). Without this, dragging
  // inside the popup pans the map and clicks on prev/next can trigger
  // marker hits.
  L.DomEvent.disableClickPropagation(root)
  L.DomEvent.disableScrollPropagation(root)

  let index = Math.max(0, Math.min(startIndex, sequence.length - 1))
  let cancelled = false
  const objectUrls: string[] = []

  const popup = L.popup({
    // Width budget: image + 40 px of popup chrome + safety margin.
    maxWidth: maxImgW + 40,
    autoClose: true,
    closeOnEscapeKey: true,
    // Disable Leaflet's lateral autoPan — when the popup is large enough
    // that it would push dots off the opposite edge, panning is the
    // wrong tool. We instead zoom-to-fit below so the popup *and* every
    // image dot stay visible together.
    autoPan: false,
    keepInView: false,
  })
    .setLatLng(
      markersByName.get(sequence[index])?.getLatLng() ?? map.getCenter(),
    )
    .setContent(root)
    .openOn(map)

  /**
   * Fit the map so every image dot AND the popup stay visible.
   *
   * The popup is in pixel space — it doesn't shrink when the map zooms
   * out — so we treat its footprint as *padding* on top of the dot
   * bbox: full popup height above the anchor, normal margin below and
   * to the sides. fitBounds picks a zoom that fits the dots in the
   * remaining area.
   *
   * Fallback: if the popup is taller than the map can sensibly
   * accommodate (popup height + a minimum viewport for the dots
   * exceeds the map's pixel height), we clamp the top padding to what
   * still leaves a usable viewport. The popup then overlaps the upper
   * portion of the map, but the dots remain visible underneath
   * — better than either zooming-to-nothing or skipping the fit.
   */
  function fitToShowEverything(_anchorLL: L.LatLng) {
    let dotBounds: L.LatLngBounds | null = null
    for (const m of markersByName.values()) {
      const ll = m.getLatLng()
      dotBounds = dotBounds ? dotBounds.extend(ll) : L.latLngBounds(ll, ll)
    }
    if (!dotBounds) return

    const popupEl = popup.getElement()
    const popupH = popupEl?.offsetHeight ?? 0
    const mapSize = map.getSize()

    const sideMargin = 24
    const safetyMargin = 16
    const minViewportH = 120

    const desiredPadTop = popupH + safetyMargin
    const padBottom = sideMargin
    const padX = sideMargin

    // If the desired popup-shaped gap leaves room for at least
    // minViewportH of dot space, use it; otherwise clamp so we keep
    // that minimum and let the popup overlap the upper area.
    const maxPadTop = mapSize.y - padBottom - minViewportH
    const padTop = Math.max(sideMargin, Math.min(desiredPadTop, maxPadTop))

    map.fitBounds(dotBounds, {
      paddingTopLeft: [padX, padTop],
      paddingBottomRight: [padX, padBottom],
      animate: true,
    })
  }

  // Leaflet's popup hasn't finished laying out at openOn() time, so
  // the popup's measured size is wrong. Wait for the next animation
  // frame to call fitToShowEverything against the real footprint.
  requestAnimationFrame(() => {
    if (cancelled) return
    const anchor =
      markersByName.get(sequence[index])?.getLatLng() ?? map.getCenter()
    fitToShowEverything(anchor)
  })

  // Disable Leaflet's keyboard panning while the popup owns ← / →.
  // Without this, arrow keys both cycle the popup *and* pan the map.
  const keyboardWasEnabled = map.keyboard.enabled()
  if (multi) map.keyboard.disable()

  async function render(i: number) {
    index = (i + sequence.length) % sequence.length
    const name = sequence[index]
    nameEl.textContent = name
    if (multi) counterEl.textContent = `${index + 1}/${sequence.length}`
    // Reposition the popup to the dot we're showing so it stays visually
    // anchored as we cycle, then re-fit so the popup *and* every dot
    // remain visible together.
    const m = markersByName.get(name)
    if (m) {
      popup.setLatLng(m.getLatLng())
      requestAnimationFrame(() => {
        if (!cancelled) fitToShowEverything(m.getLatLng())
      })
    }
    imgEl.removeAttribute("src")
    try {
      const blob = await fetchObjectAsBlob(`${imagesPrefix}${name}`)
      if (cancelled) return
      const url = URL.createObjectURL(blob)
      objectUrls.push(url)
      imgEl.src = url
      imgEl.alt = name
    } catch (err) {
      if (cancelled) return
      hintEl.textContent = `Failed to load preview: ${String(err)}`
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      e.stopPropagation()
      void render(index - 1)
    } else if (e.key === "ArrowRight") {
      e.preventDefault()
      e.stopPropagation()
      void render(index + 1)
    } else if (e.key === "Escape") {
      map.closePopup(popup)
    }
  }
  prevBtn.addEventListener("click", (ev) => {
    ev.stopPropagation()
    void render(index - 1)
  })
  nextBtn.addEventListener("click", (ev) => {
    ev.stopPropagation()
    void render(index + 1)
  })
  removeBtn.addEventListener("click", (ev) => {
    ev.stopPropagation()
    const name = sequence[index]
    removeFromSelection(name)
    sequence.splice(index, 1)
    if (sequence.length === 0) {
      map.closePopup(popup)
      return
    }
    // Hide the prev/next chrome if we just dropped to a single image.
    if (sequence.length === 1) {
      prevBtn.style.display = "none"
      nextBtn.style.display = "none"
      counterEl.style.display = "none"
    }
    // Stay at the same index (which now points to the *next* element)
    // — except when we just removed the tail, where we wrap back.
    void render(Math.min(index, sequence.length - 1))
  })
  // Capture phase so we win against any other window-level listeners.
  if (multi) window.addEventListener("keydown", onKey, true)

  map.once("popupclose", () => {
    cancelled = true
    if (multi) window.removeEventListener("keydown", onKey, true)
    if (multi && keyboardWasEnabled) map.keyboard.enable()
    for (const u of objectUrls) URL.revokeObjectURL(u)
  })

  await render(index)
}

function btnStyle(opts: { tone?: "default" | "danger" } = {}): string {
  const danger = opts.tone === "danger"
  return [
    `border:1px solid ${danger ? "#fecaca" : "#cbd5e1"}`,
    `background:${danger ? "#fef2f2" : "#ffffff"}`,
    "border-radius:4px",
    "padding:3px 10px",
    "font-size:12px",
    "line-height:1.2",
    "cursor:pointer",
    `color:${danger ? "#b91c1c" : "#0f172a"}`,
    "white-space:nowrap",
  ].join(";")
}
