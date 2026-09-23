/**
 * TraitPreview — see what the ExG threshold does to one plot before
 * running extraction over all of them.
 *
 * Main computed this on the server per click. Here the plot's crop comes
 * straight from TiTiler and the mask is computed in the browser with the
 * worker's own rule (lib/exgPreview), so it updates live as the
 * threshold slider moves.
 */
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  exgMask,
  tintVegetation,
  vegetationFraction,
} from "@/features/process/lib/exgPreview"
import { titilerBase } from "@/lib/stack"

export interface PreviewPlot {
  label: string
  /** WGS84 [west, south, east, north]. */
  bbox: [number, number, number, number]
}

/** Bounding box of a (Multi)Polygon feature, WGS84. */
export function featureBbox(
  f: GeoJSON.Feature,
): [number, number, number, number] | null {
  const g = f.geometry
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return null
  const rings = g.type === "Polygon" ? g.coordinates : g.coordinates.flat()
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x < w) w = x
      if (x > e) e = x
      if (y < s) s = y
      if (y > n) n = y
    }
  return Number.isFinite(w) ? [w, s, e, n] : null
}

async function loadCrop(s3Url: string, bbox: PreviewPlot["bbox"]) {
  const url = `${titilerBase()}/cog/bbox/${bbox.join(",")}.png?url=${encodeURIComponent(s3Url)}&coord_crs=epsg:4326&max_size=1024`
  const res = await fetch(url)
  if (!res.ok)
    throw new Error(`Couldn't read the plot from the ortho (${res.status})`)
  const bitmap = await createImageBitmap(await res.blob())
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas unavailable")
  ctx.drawImage(bitmap, 0, 0)
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
}

export function TraitPreview({
  s3Url,
  plots,
  threshold,
}: {
  /** s3:// URL of the ortho TiTiler reads. */
  s3Url: string
  plots: PreviewPlot[]
  threshold: number
}) {
  const [plotIdx, setPlotIdx] = useState(0)
  const plot = plots[Math.min(plotIdx, plots.length - 1)]
  const crop = useQuery({
    queryKey: ["trait-preview", s3Url, plot?.bbox.join(",")],
    queryFn: () => loadCrop(s3Url, plot.bbox),
    enabled: Boolean(plot),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  const result = useMemo(() => {
    const img = crop.data
    if (!img) return null
    const mask = exgMask(img.data, img.width, img.height, threshold)
    return {
      vf: vegetationFraction(mask),
      pixels: tintVegetation(img.data, mask),
      width: img.width,
      height: img.height,
    }
  }, [crop.data, threshold])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvasRef.current
    if (!c || !result) return
    c.width = result.width
    c.height = result.height
    c.getContext("2d")?.putImageData(
      new ImageData(
        new Uint8ClampedArray(result.pixels),
        result.width,
        result.height,
      ),
      0,
      0,
    )
  }, [result])

  if (plots.length === 0) return null
  return (
    <div className="space-y-2 rounded border p-2" data-testid="trait-preview">
      <div className="flex items-end justify-between gap-2">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="trait-preview-plot">
            Preview plot
          </Label>
          <Select
            value={String(Math.min(plotIdx, plots.length - 1))}
            onValueChange={(v) => setPlotIdx(Number(v))}
          >
            <SelectTrigger
              id="trait-preview-plot"
              className="h-8 w-40 text-xs"
              data-testid="trait-preview-plot"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {plots.map((p, i) => (
                <SelectItem key={`${p.label}-${i}`} value={String(i)}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs" data-testid="trait-preview-vf">
          {result
            ? `Vegetation fraction ${result.vf.toFixed(4)}`
            : crop.isError
              ? ""
              : "…"}
        </p>
      </div>
      {crop.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading plot…
        </div>
      )}
      {crop.isError && (
        <p className="text-destructive text-xs">
          {(crop.error as Error).message}
        </p>
      )}
      <canvas
        ref={canvasRef}
        className={`max-h-56 w-full rounded object-contain ${result ? "" : "hidden"}`}
        data-testid="trait-preview-canvas"
      />
      <p className="text-muted-foreground text-[11px]">
        Green = counted as vegetation at this threshold. Height and canopy
        temperature are computed when the extraction runs.
      </p>
    </div>
  )
}
