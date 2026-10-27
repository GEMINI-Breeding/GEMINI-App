/**
 * PlotImageGrid — thumbnail grid of per-plot PNGs.
 *
 * Each tile is a small server-resized preview (AuthImage: bearer-authed
 * blob, fetched once it scrolls into view), so a run with hundreds of plots
 * does not download every full image to draw the grid.
 */

import { ChevronLeft, ChevronRight, Download } from "lucide-react"
import { useMemo, useState } from "react"
import type { FileMetadata } from "@/client"

import { Button } from "@/components/ui/button"
import { ImageLightbox } from "@/features/files/components/ImageLightbox"
import { downloadZip } from "@/features/files/lib/download"
import {
  AuthImage,
  thumbnailSrc,
} from "@/features/genotyping/components/AuthImage"
import useCustomToast from "@/hooks/useCustomToast"

/** Plot images shown at once; the rest page through. */
const PER_PAGE = 24

export function PlotImageGrid({
  files,
  prefix,
  download = true,
}: {
  files: FileMetadata[]
  prefix: string
  /** Its own "Download all" button; off where the page has its own downloads. */
  download?: boolean
}) {
  const pngFiles = useMemo(
    () => files.filter((f) => /\.(png|jpe?g)$/i.test(f.object_name ?? "")),
    [files],
  )
  const { showErrorToast } = useCustomToast()
  const [zipping, setZipping] = useState(false)
  const [page, setPage] = useState(0)
  const [viewing, setViewing] = useState<number | null>(null)
  const downloadAll = async () => {
    setZipping(true)
    try {
      // prefix ends ".../{date}/{platform}/{sensor}/"; name the file after it.
      const tail = prefix.split("/").filter(Boolean).slice(-3).join("-")
      await downloadZip({
        files: pngFiles.map((f) => f.object_name ?? "").filter(Boolean),
        filename: `plot-images-${tail || "plots"}.zip`,
      })
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : "Download failed")
    } finally {
      setZipping(false)
    }
  }

  const pages = Math.ceil(pngFiles.length / PER_PAGE)
  if (pngFiles.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No plot images yet. Run the split job, then check back here.
      </p>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {pngFiles.length} plot{pngFiles.length === 1 ? "" : "s"}
          </span>
          {pages > 1 && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                disabled={page === 0}
                onClick={() => setPage((n) => n - 1)}
                aria-label="Previous plots"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-muted-foreground">
                {page * PER_PAGE + 1}–
                {Math.min((page + 1) * PER_PAGE, pngFiles.length)}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                disabled={page >= pages - 1}
                onClick={() => setPage((n) => n + 1)}
                aria-label="Next plots"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
        {download && (
          <Button
            size="sm"
            variant="outline"
            onClick={downloadAll}
            disabled={zipping}
            data-testid="plot-images-zip"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {zipping ? "Preparing…" : "Download all (.zip)"}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {pngFiles.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map((f) => (
          <PlotThumb
            key={f.object_name}
            file={f}
            prefix={prefix}
            onOpen={() =>
              setViewing(
                pngFiles.findIndex((x) => x.object_name === f.object_name),
              )
            }
          />
        ))}
      </div>
      <ImageLightbox
        images={pngFiles.map((f) => f.object_name ?? "")}
        index={viewing}
        onIndex={(i) => {
          setViewing(i)
          setPage(Math.floor(i / PER_PAGE))
        }}
        onClose={() => setViewing(null)}
        caption={(n) => n.replace(prefix, "")}
      />
    </div>
  )
}

function PlotThumb({
  file,
  prefix,
  onOpen,
}: {
  file: FileMetadata
  prefix: string
  onOpen: () => void
}) {
  // A resized preview, fetched when it scrolls into view; the full image
  // opens in the viewer on click.
  const path = file.object_name ?? ""
  const label = (file.object_name ?? "").replace(prefix, "")

  return (
    <div className="space-y-1">
      <div className="bg-muted relative aspect-square overflow-hidden rounded">
        <AuthImage
          src={thumbnailSrc(path, 400)}
          alt={label}
          className="h-full w-full border-0 object-cover"
          onImageClick={onOpen}
          lazy
        />
      </div>
      <p className="truncate text-xs" title={label}>
        {label}
      </p>
    </div>
  )
}
