/**
 * Thermal Viewer dialog — renders a single thermal frame's raw uint16
 * data on a canvas with palette + window controls + a per-pixel
 * temperature HUD.
 *
 * Inputs:
 *   - `bucket` + `rgbObjectName` — the MinIO path of the iron-palette
 *     preview JPEG (i.e., the file the user clicked in ImageViewer).
 *     The component derives the matching `RawThermal/{basename}.tif`
 *     and `RawThermal/{basename}.json` paths from this.
 *
 * The component never talks to the worker — it only reads sidecars
 * the worker already wrote. If the sidecar/raw pair is missing
 * (worker hasn't run yet or pruned them), the dialog shows the
 * preview JPEG with a "no calibration data" hint and disables
 * temperature features.
 */
import { useEffect, useMemo, useRef, useState } from "react"

import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  applyPalette,
  decodeRawThermalTiff,
  deriveTemperatureCelsius,
  paletteLut,
  type PaletteName,
  percentileWindow,
  type ThermalSidecar,
} from "@/features/files/lib/thermal"
import { getToken } from "@/lib/auth"

interface ThermalViewerDialogProps {
  open: boolean
  bucket: string
  rgbObjectName: string
  onOpenChange: (open: boolean) => void
}

interface ThermalData {
  sidecar: ThermalSidecar
  width: number
  height: number
  counts: Uint16Array
  /** Computed once from counts + sidecar. Null for non-radiometric. */
  temperatureC: Float32Array | null
}

function apiUrl(path: string): string {
  return `${(OpenAPI.BASE ?? "").replace(/\/$/, "")}${path}`
}

/**
 * Derive the sidecar pair paths from the clicked preview's MinIO key.
 *
 * Preview: `…/{any}/Images/{base}.jpg`
 * Sidecar: `…/{any}/RawThermal/{base}.tif` (+ `.json`)
 *
 * Falls back to "same directory, swap extension" if the preview isn't
 * inside an `Images/` subfolder — that handles re-runs against legacy
 * layouts without crashing.
 */
function deriveSidecarPaths(rgbObjectName: string): {
  rawTif: string
  rawJson: string
  basename: string
} {
  const lastSlash = rgbObjectName.lastIndexOf("/")
  const dir = lastSlash >= 0 ? rgbObjectName.slice(0, lastSlash) : ""
  const fileWithExt = rgbObjectName.slice(lastSlash + 1)
  const dotIdx = fileWithExt.lastIndexOf(".")
  const basename = dotIdx > 0 ? fileWithExt.slice(0, dotIdx) : fileWithExt
  // `…/Images` → `…/RawThermal`, otherwise keep the directory as-is.
  const rawDir = dir.endsWith("/Images")
    ? `${dir.slice(0, -"/Images".length)}/RawThermal`
    : dir
  return {
    rawTif: `${rawDir}/${basename}.tif`,
    rawJson: `${rawDir}/${basename}.json`,
    basename,
  }
}

async function fetchObject(bucket: string, objectName: string): Promise<Response> {
  return fetch(apiUrl(`/api/files/download/${bucket}/${objectName}`), {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
}

export function ThermalViewerDialog({
  open,
  bucket,
  rgbObjectName,
  onOpenChange,
}: ThermalViewerDialogProps) {
  const [thermal, setThermal] = useState<ThermalData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [palette, setPalette] = useState<PaletteName>("iron")
  const [vmin, setVmin] = useState<number | null>(null)
  const [vmax, setVmax] = useState<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hover, setHover] = useState<{
    x: number
    y: number
    count: number
    tempC: number | null
  } | null>(null)

  // Reset state every time a new file opens — keeps stale palette
  // windows from leaking between back-to-back image clicks.
  useEffect(() => {
    if (!open) return
    setThermal(null)
    setLoadError(null)
    setHover(null)
    setVmin(null)
    setVmax(null)

    const { rawTif, rawJson } = deriveSidecarPaths(rgbObjectName)
    let cancelled = false
    ;(async () => {
      try {
        const [jsonRes, tifRes] = await Promise.all([
          fetchObject(bucket, rawJson),
          fetchObject(bucket, rawTif),
        ])
        if (!jsonRes.ok) {
          throw new Error(
            `sidecar JSON ${jsonRes.status} (run THERMAL_EXTRACT for this dataset?)`,
          )
        }
        if (!tifRes.ok) {
          throw new Error(`raw thermal TIFF ${tifRes.status}`)
        }
        const sidecar = (await jsonRes.json()) as ThermalSidecar
        const tifBuf = await tifRes.arrayBuffer()
        const decoded = decodeRawThermalTiff(tifBuf)
        const temperatureC = deriveTemperatureCelsius(decoded.counts, sidecar)
        if (cancelled) return
        setThermal({
          sidecar,
          width: decoded.width,
          height: decoded.height,
          counts: decoded.counts,
          temperatureC,
        })
        // Seed the window from the sidecar (worker computed it once
        // already) so the canvas isn't blank on first paint.
        const values = temperatureC ?? decoded.counts
        const seedMin =
          sidecar.preview_vmin_c ?? sidecar.preview_vmin_counts ?? null
        const seedMax =
          sidecar.preview_vmax_c ?? sidecar.preview_vmax_counts ?? null
        if (seedMin !== null && seedMax !== null) {
          setVmin(seedMin)
          setVmax(seedMax)
        } else {
          const [lo, hi] = percentileWindow(values)
          setVmin(lo)
          setVmax(hi)
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, bucket, rgbObjectName])

  // Re-render whenever the palette window changes.
  useEffect(() => {
    if (!thermal || vmin === null || vmax === null) return
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = thermal.width
    canvas.height = thermal.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const values = thermal.temperatureC ?? thermal.counts
    const img = applyPalette(
      values,
      thermal.width,
      thermal.height,
      vmin,
      vmax,
      paletteLut(palette),
    )
    ctx.putImageData(img, 0, 0)
  }, [thermal, vmin, vmax, palette])

  // Reasonable slider bounds: full-scene min/max gives the user
  // freedom to push beyond the auto-windowed defaults.
  const sliderBounds = useMemo(() => {
    if (!thermal) return { lo: 0, hi: 1 }
    const values = thermal.temperatureC ?? thermal.counts
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      if (!Number.isFinite(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1 }
    if (hi <= lo) hi = lo + 1
    return { lo, hi }
  }, [thermal])

  function onCanvasMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas || !thermal) return
    const rect = canvas.getBoundingClientRect()
    // Translate from CSS pixels to image-pixel coordinates so the HUD
    // samples the right cell regardless of the canvas's display size.
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * thermal.width)
    const py = Math.floor(
      ((e.clientY - rect.top) / rect.height) * thermal.height,
    )
    if (px < 0 || py < 0 || px >= thermal.width || py >= thermal.height) {
      setHover(null)
      return
    }
    const idx = py * thermal.width + px
    const count = thermal.counts[idx]
    const tempC = thermal.temperatureC ? thermal.temperatureC[idx] : null
    setHover({ x: px, y: py, count, tempC })
  }

  const isRadiometric = thermal?.sidecar.radiometric === true
  const sidecarSource = thermal?.sidecar.source ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl"
        data-testid="thermal-viewer-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            Thermal Viewer
            {sidecarSource && (
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                {sidecarSource}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            View per-pixel temperature, adjust palette and window for the
            selected thermal image.
          </DialogDescription>
        </DialogHeader>

        {loadError && (
          <div
            className="text-destructive text-sm"
            data-testid="thermal-error"
          >
            {loadError}
          </div>
        )}

        {!loadError && !thermal && (
          <div className="text-muted-foreground text-sm">
            Loading thermal frame…
          </div>
        )}

        {thermal && vmin !== null && vmax !== null && (
          <>
            <div
              className="bg-muted relative flex items-center justify-center rounded"
              style={{ maxHeight: "60vh" }}
            >
              <canvas
                ref={canvasRef}
                onMouseMove={onCanvasMove}
                onMouseLeave={() => setHover(null)}
                className="max-h-[60vh] max-w-full"
                style={{ imageRendering: "pixelated" }}
                data-testid="thermal-canvas"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="thermal-palette">Palette</Label>
                <Select
                  value={palette}
                  onValueChange={(v) => setPalette(v as PaletteName)}
                >
                  <SelectTrigger
                    id="thermal-palette"
                    data-testid="thermal-palette-trigger"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="iron">Iron</SelectItem>
                    <SelectItem value="grayscale">Grayscale</SelectItem>
                    <SelectItem value="viridis">Viridis</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="thermal-vmin">
                  Min ({isRadiometric ? "°C" : "counts"})
                </Label>
                <input
                  id="thermal-vmin"
                  type="range"
                  className="w-full"
                  min={sliderBounds.lo}
                  max={sliderBounds.hi}
                  step={isRadiometric ? 0.1 : 1}
                  value={vmin}
                  onChange={(e) =>
                    setVmin(Math.min(Number(e.target.value), vmax))
                  }
                  data-testid="thermal-vmin"
                />
                <span className="text-muted-foreground text-xs">
                  {vmin.toFixed(isRadiometric ? 1 : 0)}
                </span>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="thermal-vmax">
                  Max ({isRadiometric ? "°C" : "counts"})
                </Label>
                <input
                  id="thermal-vmax"
                  type="range"
                  className="w-full"
                  min={sliderBounds.lo}
                  max={sliderBounds.hi}
                  step={isRadiometric ? 0.1 : 1}
                  value={vmax}
                  onChange={(e) =>
                    setVmax(Math.max(Number(e.target.value), vmin))
                  }
                  data-testid="thermal-vmax"
                />
                <span className="text-muted-foreground text-xs">
                  {vmax.toFixed(isRadiometric ? 1 : 0)}
                </span>
              </div>
            </div>

            <div
              className="text-sm font-mono"
              data-testid="thermal-hud"
            >
              {hover ? (
                <span>
                  pixel ({hover.x}, {hover.y}) — counts: {hover.count}
                  {isRadiometric && hover.tempC !== null && (
                    <span data-testid="thermal-hud-temp">
                      {" "}— T ={" "}
                      {Number.isFinite(hover.tempC)
                        ? `${hover.tempC.toFixed(2)} °C`
                        : "NaN"}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Hover over the image to read pixel values
                  {isRadiometric ? " and temperature" : ""}.
                </span>
              )}
            </div>
          </>
        )}

        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="thermal-close"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
