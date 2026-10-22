/**
 * ImageLightbox — one image large, stepping through a list of them.
 *
 * Shows the server-made preview at once (a few KB) and swaps in the full
 * file when it arrives, so a remote link never leaves an empty box while a
 * 7 MB drone photo downloads. Arrow keys step, Escape closes.
 */
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { authHeaders } from "@/components/Common/PlotImage"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiUrl, downloadViaBrowser } from "@/features/files/lib/download"
import { thumbnailSrc } from "@/features/genotyping/components/AuthImage"

/** Browsers cannot show TIFFs; those stay at the server's preview. */
const SHOWS_FULL = /\.(jpe?g|png|gif|webp)$/i

function encoded(objectName: string): string {
  return objectName.split("/").map(encodeURIComponent).join("/")
}

/** Authed fetch → object URL; `false` once the request has failed. */
function useBlob(url: string | null): string | null | false {
  const [blob, setBlob] = useState<string | null | false>(null)
  useEffect(() => {
    setBlob(null)
    if (!url) return
    let cancelled = false
    let made: string | null = null
    fetch(apiUrl(url), { headers: authHeaders() })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (cancelled) return
        if (!b) {
          setBlob(false)
          return
        }
        made = URL.createObjectURL(b)
        setBlob(made)
      })
      .catch(() => {
        if (!cancelled) setBlob(false)
      })
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [url])
  return blob
}

export function ImageLightbox({
  images,
  index,
  onIndex,
  onClose,
  caption,
}: {
  /** Object names in the "gemini" bucket. */
  images: string[]
  index: number | null
  onIndex: (i: number) => void
  onClose: () => void
  /** Optional line under the name (e.g. where the image is from). */
  caption?: (objectName: string) => string | null
}) {
  const open = index !== null && index >= 0 && index < images.length
  const name = open ? images[index] : null
  const preview = useBlob(name ? thumbnailSrc(name, 800) : null)
  const full = useBlob(
    name && SHOWS_FULL.test(name)
      ? `/api/files/download/gemini/${encoded(name)}`
      : null,
  )
  const shown = full || preview || null
  const failed = preview === false && !full

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && index < images.length - 1)
        onIndex(index + 1)
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, index, images.length, onIndex])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[95vh] w-[95vw] max-w-6xl flex-col gap-2 p-3 sm:max-w-6xl"
        dismissOnOutsideClick
        data-testid="image-lightbox"
      >
        <div className="flex items-center gap-2 pr-8">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-medium">
              {name?.split("/").pop()}
            </DialogTitle>
            <DialogDescription className="truncate text-xs">
              {name ? (caption?.(name) ?? name) : ""}
            </DialogDescription>
          </div>
          <span className="text-muted-foreground shrink-0 text-xs">
            {open ? `${index + 1} / ${images.length}` : ""}
          </span>
        </div>
        <div className="relative flex min-h-[50vh] flex-1 items-center justify-center overflow-hidden rounded bg-black">
          {shown ? (
            <img
              src={shown}
              alt={name ?? ""}
              className="max-h-[78vh] max-w-full object-contain"
              draggable={false}
            />
          ) : failed ? (
            <p className="px-6 text-center text-sm text-white/80">
              This file can't be shown in the browser. Download it to open it in
              another program.
            </p>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-white/70" />
          )}
          {shown && !full && name && SHOWS_FULL.test(name) && (
            <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
              <Loader2 className="h-3 w-3 animate-spin" /> loading full size
            </span>
          )}
          {open && index > 0 && (
            <Button
              variant="secondary"
              size="icon"
              className="absolute left-2 top-1/2 -translate-y-1/2 opacity-80"
              onClick={() => onIndex(index - 1)}
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          {open && index < images.length - 1 && (
            <Button
              variant="secondary"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-80"
              onClick={() => onIndex(index + 1)}
              aria-label="Next image"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            ← → to step through · Esc to close
          </span>
          {name && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => void downloadViaBrowser(name)}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Download
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
