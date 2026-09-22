/**
 * PlotImageDialog — shows the per-plot PNG for a plot clicked on the
 * Analyze map, alongside that plot's properties.
 *
 * The images come from SPLIT_ORTHOMOSAIC (see usePlotImages). The download
 * endpoint requires bearer auth, so an <img src> can't point at it
 * directly — fetch into a blob and render an object URL, revoking it on
 * unmount. Same approach as PlotImageGrid.
 */
import { useEffect, useState } from "react"

import { objectImageUrl } from "@/components/Common/PlotImage"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { getToken } from "@/lib/auth"

export interface PlotImageDialogProps {
  open: boolean
  onClose: () => void
  /** Plot number clicked on the map. */
  plot: number | null
  /** MinIO object path for that plot's PNG, or null when none exists. */
  objectPath: string | null
  /** Raw feature properties, rendered as a small key/value list. */
  properties?: Record<string, unknown>
  /** True while the plot-image listing is still loading. */
  loading?: boolean
}

export function PlotImageDialog({
  open,
  onClose,
  plot,
  objectPath,
  properties,
  loading,
}: PlotImageDialogProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open || !objectPath) {
      setUrl(null)
      setFailed(false)
      return
    }
    let revoked = false
    let objectUrl: string | null = null
    setFailed(false)
    const token = getToken()
    fetch(objectImageUrl(objectPath), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.blob()
      })
      .then((blob) => {
        if (revoked) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!revoked) setFailed(true)
      })
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [open, objectPath])

  // Only the identity/trait fields are worth showing; the geometry-side
  // bookkeeping (cellId, role, blockId) is noise here.
  const shown = Object.entries(properties ?? {}).filter(
    ([k, v]) =>
      v !== null &&
      v !== undefined &&
      v !== "" &&
      !["cellId", "role", "blockId"].includes(k),
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="plot-image-dialog">
        <DialogHeader>
          <DialogTitle>{plot != null ? `Plot ${plot}` : "Plot"}</DialogTitle>
          <DialogDescription>
            Per-plot image cut from the orthomosaic by the Split step.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : !objectPath ? (
          <p
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 text-sm"
            data-testid="plot-image-missing"
          >
            No image for this plot yet. Run “Split Into Plot Images” on the
            processing run for this field, then reopen this plot.
          </p>
        ) : failed ? (
          <p
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-800 text-sm"
            data-testid="plot-image-failed"
          >
            Couldn’t load this plot’s image.
          </p>
        ) : url ? (
          <img
            src={url}
            alt={plot != null ? `Plot ${plot}` : "Plot image"}
            className="max-h-[60vh] w-full rounded-md border object-contain"
            data-testid="plot-image-img"
          />
        ) : (
          <Skeleton className="h-64 w-full" />
        )}

        {shown.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            {shown.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-muted-foreground truncate">{k}</dt>
                <dd className="truncate font-medium">
                  {typeof v === "number"
                    ? v.toFixed(3).replace(/\.?0+$/, "")
                    : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  )
}
