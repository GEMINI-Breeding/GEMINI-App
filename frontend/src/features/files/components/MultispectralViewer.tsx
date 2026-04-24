/**
 * MultispectralViewer — browse and download bands from a Multispectral Data upload.
 *
 * Shows image list with timestamps (if configured), a wireframe split overlay,
 * optional live band extraction for the current image, and a download selector.
 *
 * # FUTURE: match images to other sensor uploads by timestamp overlap.
 *   The ImageInfo.timestamp_iso field is already populated by the backend.
 *   Cross-reference with other FileUpload records for the same date/location/population,
 *   or match against msgs_synced.csv GPS timestamps to filter for GPS-tagged subsets.
 */

import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { OpenAPI } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"
import { downloadPost } from "@/lib/platform"

// ── Types ─────────────────────────────────────────────────────────────────────

interface BandConfig {
  index: number
  name: string
  wavelength_nm: number | null
  flip_h: boolean
  flip_v: boolean
  rotate_deg: number
}

interface MultispectralConfig {
  band_count: number
  layout_cols: number
  layout_rows: number
  bands: BandConfig[]
  timestamp_source: string
  timestamp_format: string | null
}

interface ImageInfo {
  filename: string
  rel_path: string
  timestamp_iso: string | null
}

interface BandPreview {
  index: number
  name: string
  wavelength_nm: number | null
  b64_jpeg: string
  width: number
  height: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiUrl(path: string): string {
  return OpenAPI.BASE.replace(/\/$/, "") + path
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("access_token") || ""
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function formatTs(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso + "Z").toLocaleString()
  } catch {
    return iso
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  uploadId: string
  title: string
  onClose: () => void
}

export function MultispectralViewer({ uploadId, title, onClose }: Props) {
  const { showErrorToast } = useCustomToast()

  const [config, setConfig] = useState<MultispectralConfig | null>(null)
  const [images, setImages] = useState<ImageInfo[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null)
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  // Band extraction state
  const [extractedBands, setExtractedBands] = useState<BandPreview[] | null>(null)
  const [extracting, setExtracting] = useState(false)

  // Selection state for download
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set())
  const [selectedBands, setSelectedBands] = useState<Set<number>>(new Set())
  const [downloading, setDownloading] = useState(false)

  // Flat image path list for serving (from files list-images endpoint)
  const [imagePaths, setImagePaths] = useState<string[]>([])

  useEffect(() => {
    // Load config
    fetch(apiUrl(`/api/v1/multispectral/${uploadId}/config`), { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setConfig(data)
          setSelectedBands(new Set(data.bands.map((b: BandConfig) => b.index)))
        }
      })
      .catch(() => {})

    // Load image list with timestamps
    fetch(apiUrl(`/api/v1/multispectral/${uploadId}/images`), { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.images) setImages(data.images)
      })
      .catch(() => {})

    // Load raw image paths for serving
    fetch(apiUrl(`/api/v1/files/${uploadId}/list-images`), { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((data: any) => {
        const paths: string[] = data?.images ?? data ?? []
        setImagePaths(paths)
      })
      .catch(() => {})
  }, [uploadId])

  // Update displayed image when index or path list changes
  useEffect(() => {
    if (imagePaths[currentIdx]) {
      setCurrentImageUrl(
        apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(imagePaths[currentIdx])}`)
      )
      setExtractedBands(null)
      setImgDims(null)
    }
  }, [currentIdx, imagePaths])

  function navigate(delta: number) {
    setCurrentIdx((i) => Math.max(0, Math.min(images.length - 1, i + delta)))
  }

  async function extractBands() {
    if (!config) return
    setExtracting(true)
    setExtractedBands(null)
    try {
      const res = await fetch(apiUrl(`/api/v1/multispectral/${uploadId}/preview`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          image_index: currentIdx,
          layout_cols: config.layout_cols,
          layout_rows: config.layout_rows,
          bands: config.bands,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setExtractedBands(data.bands)
    } catch (e: any) {
      showErrorToast(`Extraction failed: ${e.message}`)
    } finally {
      setExtracting(false)
    }
  }

  async function downloadSelected() {
    if (selectedImages.size === 0 || selectedBands.size === 0) return
    setDownloading(true)
    try {
      await downloadPost(
        apiUrl(`/api/v1/multispectral/${uploadId}/download`),
        { rel_paths: Array.from(selectedImages), band_indices: Array.from(selectedBands) },
        "bands.zip",
        [{ name: "ZIP archive", extensions: ["zip"] }],
        authHeaders(),
      )
    } catch (e: any) {
      // Tauri invoke errors are plain strings, not Error objects
      showErrorToast(`Download failed: ${e?.message ?? String(e)}`)
    } finally {
      setDownloading(false)
    }
  }

  function toggleImageSelection(relPath: string) {
    setSelectedImages((prev) => {
      const next = new Set(prev)
      if (next.has(relPath)) next.delete(relPath)
      else next.add(relPath)
      return next
    })
  }

  function toggleBand(idx: number) {
    setSelectedBands((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const currentImage = images[currentIdx]

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="!max-w-7xl w-[92vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Multispectral Bands — {title}</DialogTitle>
        </DialogHeader>

        {!config && (
          <p className="text-sm text-muted-foreground py-4">
            No band configuration found. Open Upload tab and configure bands first.
          </p>
        )}

        {config && (
          <div className="grid grid-cols-[300px_1fr] gap-6 min-h-0">
            {/* Left panel: image list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  {images.length} image{images.length !== 1 ? "s" : ""}
                </p>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => {
                    if (selectedImages.size === images.length) {
                      setSelectedImages(new Set())
                    } else {
                      setSelectedImages(new Set(images.map((i) => i.rel_path)))
                    }
                  }}
                >
                  {selectedImages.size === images.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto rounded-md border divide-y text-xs">
                {images.map((img, i) => (
                  <div
                    key={img.rel_path}
                    onClick={() => setCurrentIdx(i)}
                    className={`flex cursor-pointer items-start gap-2 px-2 py-1.5 transition-colors ${
                      i === currentIdx ? "bg-accent" : "hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedImages.has(img.rel_path)}
                      onChange={() => toggleImageSelection(img.rel_path)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 h-3.5 w-3.5 cursor-pointer flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{img.filename}</p>
                      {img.timestamp_iso && (
                        <p className="text-muted-foreground">{formatTs(img.timestamp_iso)}</p>
                      )}
                    </div>
                  </div>
                ))}
                {images.length === 0 && (
                  <p className="px-3 py-4 text-muted-foreground">No images found</p>
                )}
              </div>
            </div>

            {/* Right panel: viewer + band strip */}
            <div className="space-y-3 min-w-0">
              {/* Image with overlay */}
              <div className="overflow-hidden rounded-md border bg-muted/20 flex justify-center">
                {currentImageUrl ? (
                  <div className="relative inline-block">
                    <img
                      ref={imgRef}
                      src={currentImageUrl}
                      alt={currentImage?.filename}
                      className="max-h-64 max-w-full block"
                      onLoad={() => {
                        if (imgRef.current) {
                          setImgDims({
                            w: imgRef.current.naturalWidth,
                            h: imgRef.current.naturalHeight,
                          })
                        }
                      }}
                    />
                    <svg
                      className="absolute inset-0 h-full w-full pointer-events-none"
                      preserveAspectRatio="none"
                      viewBox="0 0 100 100"
                    >
                      {Array.from({ length: config.layout_cols - 1 }, (_, i) => (
                        <line
                          key={`v${i}`}
                          x1={`${((i + 1) * 100) / config.layout_cols}`}
                          y1="0"
                          x2={`${((i + 1) * 100) / config.layout_cols}`}
                          y2="100"
                          stroke="rgba(239,68,68,0.8)"
                          strokeWidth="0.4"
                          strokeDasharray="2 1"
                        />
                      ))}
                      {Array.from({ length: config.layout_rows - 1 }, (_, i) => (
                        <line
                          key={`h${i}`}
                          x1="0"
                          y1={`${((i + 1) * 100) / config.layout_rows}`}
                          x2="100"
                          y2={`${((i + 1) * 100) / config.layout_rows}`}
                          stroke="rgba(239,68,68,0.8)"
                          strokeWidth="0.4"
                          strokeDasharray="2 1"
                        />
                      ))}
                      {config.bands.map((band) => {
                        const col = band.index % config.layout_cols
                        const row = Math.floor(band.index / config.layout_cols)
                        const cx = ((col + 0.5) * 100) / config.layout_cols
                        const cy = ((row + 0.5) * 100) / config.layout_rows
                        const label = band.name || `B${band.index + 1}`
                        return (
                          <text
                            key={band.index}
                            x={cx}
                            y={cy}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill="rgba(239,68,68,0.9)"
                            fontSize="4"
                            fontWeight="bold"
                          >
                            {label}{band.wavelength_nm ? ` ${band.wavelength_nm}nm` : ""}
                          </text>
                        )
                      })}
                    </svg>
                  </div>
                ) : (
                  <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                    {images.length === 0 ? "No images in upload" : "Loading…"}
                  </div>
                )}
              </div>

              {/* Navigation + image info */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(-1)} disabled={currentIdx === 0}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-center">
                  <span>{currentIdx + 1} / {Math.max(1, images.length)}</span>
                  {currentImage?.filename && (
                    <span className="ml-2 opacity-70">{currentImage.filename}</span>
                  )}
                  {currentImage?.timestamp_iso && (
                    <span className="ml-2 opacity-70">{formatTs(currentImage.timestamp_iso)}</span>
                  )}
                  {imgDims && (
                    <span className="ml-2 opacity-50">{imgDims.w}×{imgDims.h}</span>
                  )}
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(1)} disabled={currentIdx >= images.length - 1}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Extract bands button + result */}
              <div className="space-y-2">
                <Button variant="outline" size="sm" onClick={extractBands} disabled={extracting || !currentImageUrl}>
                  {extracting ? "Extracting…" : "Extract bands for this image"}
                </Button>
                {extractedBands && (
                  <div className="flex flex-wrap gap-2">
                    {extractedBands.map((b) => (
                      <div key={b.index} className="space-y-1 text-center text-xs">
                        <img
                          src={`data:image/jpeg;base64,${b.b64_jpeg}`}
                          alt={b.name}
                          className="h-20 w-auto rounded border object-contain"
                        />
                        <p className="font-medium">{b.name || `Band ${b.index + 1}`}</p>
                        {b.wavelength_nm && <p className="text-muted-foreground">{b.wavelength_nm} nm</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Download section */}
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-sm font-medium">Download selected bands</p>
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Bands to include:</p>
                  <div className="flex flex-wrap gap-2">
                    {config.bands.map((band) => (
                      <label key={band.index} className="flex cursor-pointer items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={selectedBands.has(band.index)}
                          onChange={() => toggleBand(band.index)}
                          className="h-3.5 w-3.5"
                        />
                        <span>{band.name || `Band ${band.index + 1}`}</span>
                        {band.wavelength_nm && (
                          <span className="text-muted-foreground">{band.wavelength_nm} nm</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    onClick={downloadSelected}
                    disabled={downloading || selectedImages.size === 0 || selectedBands.size === 0}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    {downloading
                      ? "Preparing…"
                      : `Download ${selectedImages.size} image${selectedImages.size !== 1 ? "s" : ""} × ${selectedBands.size} band${selectedBands.size !== 1 ? "s" : ""}`}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Output: flat ZIP, one PNG per image × band
                  </p>
                </div>
                {selectedImages.size === 0 && (
                  <p className="text-xs text-amber-600">Select images from the list on the left</p>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
