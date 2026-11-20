/**
 * <img> that fetches a JWT-protected URL via `authHeaders()` and renders
 * the resulting blob via `URL.createObjectURL`. Needed because the new
 * frontend's `/api/files/download/*` requires `Authorization: Bearer`,
 * which a naked `<img src>` cannot send.
 *
 * Also exports `downloadAuthed`, a one-shot helper that fetches a
 * protected URL with the bearer token, builds a blob URL, triggers a
 * browser download with the chosen filename, and revokes the URL.
 * Used by the GWAS detail page's "Download sumstats" + artifact-chip
 * buttons; same need (raw `<a href>` to /api/files/download 401s
 * without the header).
 */
import { ImageOff, Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { authHeaders } from "@/components/Common/PlotImage"

export async function downloadAuthed(
  url: string,
  filename: string,
): Promise<void> {
  const base = (window as unknown as { __GEMI_BACKEND_URL__?: string })
    .__GEMI_BACKEND_URL__
  const fullUrl = base && !url.startsWith("http") ? `${base}${url}` : url
  const res = await fetch(fullUrl, { headers: authHeaders() })
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement("a")
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // Defer revoke so the browser actually opens the download. Same
    // pattern as the FileSaver / msSaveBlob fallbacks elsewhere.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  }
}

export interface AuthImageProps {
  /**
   * Full URL or relative path to the protected resource (e.g.
   * `/api/files/download/gemini/gwas/<id>/manhattan.png`).
   */
  src: string
  alt: string
  className?: string
  "data-testid"?: string
  /**
   * Optional click handler invoked with the resolved blob URL once
   * the auth'd fetch lands. Use to open the image full-size in a new
   * tab (`window.open(url, "_blank")`) — the parent doesn't have its
   * own copy of the blob URL since `AuthImage` owns the fetch.
   * Click is a no-op while the image is still loading.
   */
  onImageClick?: (blobUrl: string) => void
  /** Fetch only once the image scrolls near the viewport. */
  lazy?: boolean
}

/**
 * Server-side resized preview of an image object (longest side `size` px,
 * at most 800): a few KB instead of the full file. Use it for grids and
 * cards; fetch the full file only when the user opens one.
 */
export function thumbnailSrc(objectPath: string, size = 400): string {
  const path = objectPath.split("/").map(encodeURIComponent).join("/")
  return `/api/files/thumbnail/gemini/${path}?size=${Math.min(size, 800)}`
}

/** Open the full-size file in a new tab (opened at click time, so popup
 *  blockers allow it; filled in once the authed download lands). */
export function openFullImage(objectPath: string): void {
  const tab = window.open("", "_blank")
  const base = (window as unknown as { __GEMI_BACKEND_URL__?: string })
    .__GEMI_BACKEND_URL__
  const path = `/api/files/download/gemini/${objectPath.split("/").map(encodeURIComponent).join("/")}`
  fetch(base ? `${base}${path}` : path, { headers: authHeaders() })
    .then((r) =>
      r.ok ? r.blob() : Promise.reject(new Error(String(r.status))),
    )
    .then((b) => {
      if (tab) tab.location.href = URL.createObjectURL(b)
    })
    .catch(() => tab?.close())
}

/** True once `ref` has come within `margin` of the viewport (then stays true). */
function useNearViewport(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  margin = "300px",
): boolean {
  const [near, setNear] = useState(!enabled)
  useEffect(() => {
    if (!enabled || near) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: margin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, enabled, near, margin])
  return near
}

export function AuthImage({
  src,
  alt,
  className,
  "data-testid": testId,
  onImageClick,
  lazy = false,
}: AuthImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)
  const holder = useRef<HTMLDivElement | null>(null)
  const near = useNearViewport(holder, lazy)

  useEffect(() => {
    if (!near) return
    if (!src) {
      setErrored(true)
      return
    }
    setBlobUrl(null)
    setErrored(false)

    let cancelled = false
    let created: string | null = null
    const base = (window as unknown as { __GEMI_BACKEND_URL__?: string })
      .__GEMI_BACKEND_URL__
    const url = base && !src.startsWith("http") ? `${base}${src}` : src

    fetch(url, { headers: authHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        created = URL.createObjectURL(blob)
        setBlobUrl(created)
      })
      .catch(() => {
        if (!cancelled) setErrored(true)
      })
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [src, near])

  if (errored) {
    return (
      <div
        data-testid={testId}
        className={`bg-muted/30 text-muted-foreground flex items-center justify-center rounded border p-4 ${className ?? ""}`}
      >
        <ImageOff className="mr-2 h-4 w-4" />
        <span className="text-xs">Image unavailable</span>
      </div>
    )
  }
  if (!blobUrl) {
    return (
      <div
        ref={holder}
        data-testid={testId}
        className={`bg-muted/20 text-muted-foreground flex items-center justify-center rounded border p-4 ${className ?? ""}`}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }
  const clickable = onImageClick != null
  return (
    <img
      data-testid={testId}
      src={blobUrl}
      alt={alt}
      className={`${className ?? ""}${clickable ? " cursor-zoom-in" : ""}`}
      onClick={clickable ? () => onImageClick!(blobUrl) : undefined}
    />
  )
}
