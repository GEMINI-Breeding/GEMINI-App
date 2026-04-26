/**
 * PlotImageGrid — thumbnail grid of per-plot PNGs.
 *
 * The /api/files/download/{path} endpoint requires bearer auth so we can't
 * just point an <img src=…> at it. Instead, fetch into a blob and render
 * via object URLs. Object URLs are revoked on unmount.
 */
import { useEffect, useMemo, useState } from "react"

import type { FileMetadata } from "@/client"
import { OpenAPI } from "@/client/core/OpenAPI"
import { Skeleton } from "@/components/ui/skeleton"
import { getToken } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"
const MAX_INITIAL = 60

function apiUrl(path: string): string {
  return `${(OpenAPI.BASE ?? "").replace(/\/$/, "")}${path}`
}

export function PlotImageGrid({
  files,
  prefix,
}: {
  files: FileMetadata[]
  prefix: string
}) {
  const pngFiles = useMemo(
    () => files.filter((f) => /\.(png|jpe?g)$/i.test(f.object_name ?? "")),
    [files],
  )

  if (pngFiles.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No plot images yet. Run the split job, then check back here.
      </p>
    )
  }

  return (
    <div>
      <p className="text-muted-foreground mb-3 text-xs">
        {pngFiles.length} plot{pngFiles.length === 1 ? "" : "s"} · showing{" "}
        {Math.min(pngFiles.length, MAX_INITIAL)}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {pngFiles.slice(0, MAX_INITIAL).map((f) => (
          <PlotThumb key={f.object_name} file={f} prefix={prefix} />
        ))}
      </div>
    </div>
  )
}

function PlotThumb({ file, prefix }: { file: FileMetadata; prefix: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    async function load() {
      try {
        const path = file.object_name
        if (!path) return
        const res = await fetch(
          apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${path}`),
          { headers: { Authorization: `Bearer ${getToken()}` } },
        )
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        if (!cancelled) setSrc(objectUrl)
      } catch {
        if (!cancelled) setError(true)
      }
    }
    void load()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file.object_name])

  const label = (file.object_name ?? "").replace(prefix, "")

  return (
    <div className="space-y-1">
      <div className="bg-muted relative aspect-square overflow-hidden rounded">
        {src ? (
          <img src={src} alt={label} className="h-full w-full object-cover" />
        ) : error ? (
          <div className="text-muted-foreground flex h-full w-full items-center justify-center text-xs">
            ✗
          </div>
        ) : (
          <Skeleton className="h-full w-full" />
        )}
      </div>
      <p className="truncate text-xs" title={label}>{label}</p>
    </div>
  )
}
