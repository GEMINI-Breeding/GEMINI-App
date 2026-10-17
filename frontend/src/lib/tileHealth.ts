/**
 * Notice when a map's raster tiles never arrive.
 *
 * A tile server that cannot be reached (a tunnel not open, a session started
 * without one) leaves an orthomosaic map blank with nothing said. Leaflet
 * reports each tile; when several fail and none has loaded, the layer is
 * taken as unreachable. A single good tile clears it: tiles outside a
 * drone ortho's footprint fail as a matter of course.
 */
import type L from "leaflet"

import { titilerBase } from "@/lib/stack"

const FAILS_BEFORE_DOWN = 6

export function watchTileLayer(
  layer: L.TileLayer,
  onDown: (down: boolean) => void,
): () => void {
  let loaded = 0
  let failed = 0
  const ok = () => {
    loaded++
    onDown(false)
  }
  const bad = () => {
    failed++
    if (loaded === 0 && failed >= FAILS_BEFORE_DOWN) onDown(true)
  }
  layer.on("tileload", ok)
  layer.on("tileerror", bad)
  onDown(false)
  return () => {
    layer.off("tileload", ok)
    layer.off("tileerror", bad)
  }
}

export function tilesDownMessage(): string {
  const base = titilerBase()
  return (
    `The map's imagery could not be loaded from the tile server (${base}). ` +
    (base.startsWith("http://127.0.0.1")
      ? "On a cluster session, the tunnel to its tile server may be closed: reopen the app with `gemi-hpc app`, or start a new session if this one began without a tile server."
      : "Check that the stack's tile server (TiTiler) is running.")
  )
}
