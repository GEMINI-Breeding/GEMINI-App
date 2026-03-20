/**
 * FilePreviewDialog — lightweight local-file previewer used in UploadList.
 *
 * Supports:
 *   - Images (jpg, png, gif, webp, bmp, tif): displayed via Tauri asset protocol
 *   - CSV / JSON / TXT: raw text shown in a monospace pane
 */

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { isTauri } from "@/lib/platform"

interface FilePreviewDialogProps {
  filePath: string
  onClose: () => void
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff"])
const TEXT_EXTS  = new Set(["csv", "json", "txt", "log", "md"])

function ext(path: string): string {
  return (path.split(".").pop() ?? "").toLowerCase()
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

async function loadText(filePath: string): Promise<string> {
  if (isTauri()) {
    // Use Tauri's asset protocol — assetProtocol scope must include "**"
    const { convertFileSrc } = await import("@tauri-apps/api/core")
    const url = convertFileSrc(filePath)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }
  // Browser fallback: won't work for absolute paths, but fine for dev/test
  const res = await fetch(filePath)
  return res.text()
}

async function imageUrl(filePath: string): Promise<string> {
  if (isTauri()) {
    const { convertFileSrc } = await import("@tauri-apps/api/core")
    return convertFileSrc(filePath)
  }
  return filePath
}

export function FilePreviewDialog({ filePath, onClose }: FilePreviewDialogProps) {
  const fileExt = ext(filePath)
  const isImage = IMAGE_EXTS.has(fileExt)
  const isText  = TEXT_EXTS.has(fileExt)

  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isImage) {
      imageUrl(filePath).then(setImgSrc).catch((e) => setError(String(e)))
    } else if (isText) {
      loadText(filePath)
        .then((t) => setText(t.slice(0, 50_000))) // cap at 50 k chars
        .catch((e) => setError(String(e)))
    }
  }, [filePath, isImage, isText])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div
        className="bg-background relative flex h-[85vh] w-[85vw] max-w-4xl flex-col rounded-lg overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
          <p className="font-medium text-sm truncate">{fileNameFromPath(filePath)}</p>
          <button className="text-muted-foreground hover:text-foreground ml-4" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto min-h-0 flex items-center justify-center p-4">
          {error && (
            <p className="text-destructive text-sm">Failed to load: {error}</p>
          )}
          {!error && isImage && !imgSrc && (
            <p className="text-muted-foreground text-sm">Loading…</p>
          )}
          {!error && isImage && imgSrc && (
            <img src={imgSrc} alt={fileNameFromPath(filePath)} className="max-h-full max-w-full object-contain" />
          )}
          {!error && isText && text === null && (
            <p className="text-muted-foreground text-sm">Loading…</p>
          )}
          {!error && isText && text !== null && (
            <pre className="w-full h-full overflow-auto text-xs font-mono whitespace-pre-wrap break-all text-foreground">
              {text}
            </pre>
          )}
          {!isImage && !isText && !error && (
            <p className="text-muted-foreground text-sm">
              Preview not available for <code>.{fileExt}</code> files.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
