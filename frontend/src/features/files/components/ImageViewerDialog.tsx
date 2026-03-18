import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { OpenAPI } from "@/client"

interface ImageViewerDialogProps {
  uploadId: string
  title: string
  onClose: () => void
}

function apiBase() {
  return (window as any).__GEMI_BACKEND_URL__ ?? OpenAPI.BASE ?? ""
}

async function authHeader(): Promise<string> {
  const token =
    typeof OpenAPI.TOKEN === "function"
      ? await (OpenAPI.TOKEN as () => Promise<string>)()
      : OpenAPI.TOKEN ?? ""
  return token ? `Bearer ${token}` : ""
}

function serveUrl(path: string): string {
  return `${apiBase()}/api/v1/files/serve?path=${encodeURIComponent(path)}`
}

export function ImageViewerDialog({ uploadId, title, onClose }: ImageViewerDialogProps) {
  const [subfolderMap, setSubfolderMap] = useState<Record<string, string[]>>({})
  const [subfolders, setSubfolders] = useState<string[]>([])
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [imgLoading, setImgLoading] = useState(true)
  const [imgSrc, setImgSrc] = useState<string | null>(null)

  const blobUrlRef = useRef<string | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    let cancelled = false
    authHeader().then((auth) => {
      fetch(`${apiBase()}/api/v1/files/${uploadId}/list-images`, {
        headers: auth ? { Authorization: auth } : {},
      })
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) {
            const map: Record<string, string[]> = data.subfolder_map ?? {}
            const subs: string[] = data.subfolders ?? []
            setSubfolderMap(map)
            setSubfolders(subs)
            // Default to first subfolder (or the only folder if no dropdown)
            const keys = Object.keys(map).sort()
            setActiveFolder(keys[0] ?? null)
            setLoading(false)
          }
        })
        .catch(() => { if (!cancelled) setLoading(false) })
    })
    return () => { cancelled = true }
  }, [uploadId])

  // Images for the active subfolder
  const images = activeFolder ? (subfolderMap[activeFolder] ?? []) : []

  // Reset to first image when switching subfolder
  useEffect(() => { setIndex(0) }, [activeFolder])

  // Load image — debounced 150 ms, revoke old blob URLs
  useEffect(() => {
    if (!images[index]) return
    let cancelled = false
    setImgLoading(true)

    const timer = setTimeout(() => {
      authHeader().then((auth) => {
        fetch(serveUrl(images[index]), {
          headers: auth ? { Authorization: auth } : {},
        })
          .then((r) => r.blob())
          .then((blob) => {
            if (!cancelled) {
              if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
              const url = URL.createObjectURL(blob)
              blobUrlRef.current = url
              setImgSrc(url)
              setImgLoading(false)
            }
          })
          .catch(() => { if (!cancelled) setImgLoading(false) })
      })
    }, 150)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [images, index])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft")  { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)) }
      if (e.key === "ArrowRight") { e.preventDefault(); setIndex((i) => Math.min(images.length - 1, i + 1)) }
      if (e.key === "Escape") onCloseRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [images.length])

  const filename = images[index] ? images[index].split(/[\\/]/).pop() : ""

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div
        className="bg-background relative flex h-[90vh] w-[90vw] max-w-5xl flex-col rounded-lg overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">{title}</p>
            {!loading && images.length > 0 && (
              <p className="text-muted-foreground text-xs truncate">{filename}</p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-4">
            {/* Subfolder dropdown */}
            {subfolders.length > 1 && (
              <select
                value={activeFolder ?? ""}
                onChange={(e) => setActiveFolder(e.target.value)}
                className="border-input bg-background text-foreground rounded border px-2 py-1 text-xs focus:outline-none"
              >
                {subfolders.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            )}
            {!loading && images.length > 0 && (
              <span className="text-muted-foreground text-sm tabular-nums">
                {index + 1} / {images.length}
              </span>
            )}
            <button className="text-muted-foreground hover:text-foreground" onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Image area */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden min-h-0">
          {loading && (
            <p className="text-muted-foreground text-sm">Loading images…</p>
          )}
          {!loading && images.length === 0 && (
            <p className="text-muted-foreground text-sm">No images found in this upload.</p>
          )}
          {!loading && images.length > 0 && (
            <>
              {imgLoading && (
                <p className="text-muted-foreground text-sm absolute">Loading…</p>
              )}
              {imgSrc && (
                <img
                  src={imgSrc}
                  alt={filename}
                  className="max-h-full max-w-full object-contain"
                  style={{ opacity: imgLoading ? 0 : 1, transition: "opacity 0.15s" }}
                  onLoad={() => setImgLoading(false)}
                />
              )}

              {/* Prev */}
              <button
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60 disabled:opacity-20"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>

              {/* Next */}
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60 disabled:opacity-20"
                onClick={() => setIndex((i) => Math.min(images.length - 1, i + 1))}
                disabled={index === images.length - 1}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
        </div>

        {/* Slider */}
        {!loading && images.length > 1 && (
          <div className="border-t px-4 py-3 shrink-0">
            <input
              type="range"
              min={0}
              max={images.length - 1}
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
              className="accent-primary h-2 w-full cursor-pointer"
            />
          </div>
        )}
      </div>
    </div>
  )
}
