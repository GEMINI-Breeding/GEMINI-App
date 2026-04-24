/**
 * MultispectralUploadDialog — band configuration wizard for Multispectral Data uploads.
 *
 * Opens after the standard file upload completes.  Three steps:
 *   1. Layout & bands — grid layout selector, per-band name/wavelength/orientation
 *   2. Timestamp — how to extract capture time from each image
 *   3. Preview — SVG overlay showing split grid on the first image; optional
 *      live band extraction via backend
 *
 * On "Save & Close", POSTs to POST /api/v1/multispectral/{uploadId}/config.
 * The last-used config is stored server-side and offered for quick reuse.
 */

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { OpenAPI } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"

// ── Types ─────────────────────────────────────────────────────────────────────

interface BandConfig {
  index: number
  name: string
  wavelength_nm: number | null
  flip_h: boolean
  flip_v: boolean
  rotate_deg: 0 | 90 | 180 | 270
}

interface BandPreview {
  index: number
  name: string
  wavelength_nm: number | null
  b64_jpeg: string
  width: number
  height: number
}

interface PreviewResult {
  source_filename: string
  source_width: number
  source_height: number
  bands: BandPreview[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiUrl(path: string): string {
  return OpenAPI.BASE.replace(/\/$/, "") + path
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("access_token") || ""
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function makeBands(cols: number, rows: number, existing?: BandConfig[]): BandConfig[] {
  const count = cols * rows
  return Array.from({ length: count }, (_, i) => {
    const prev = existing?.find((b) => b.index === i)
    return prev
      ? { ...prev, index: i }
      : { index: i, name: "", wavelength_nm: null, flip_h: false, flip_v: false, rotate_deg: 0 as const }
  })
}

const TIMESTAMP_FORMAT_OPTIONS = [
  { value: "unix_epoch", label: "Unix epoch (10–16 digits in filename)" },
  { value: "YYYYMMDD_HHMMSSffffff", label: "YYYYMMDD_HHMMSSffffff" },
  { value: "YYYYMMDD_HHMMSS", label: "YYYYMMDD_HHMMSS" },
  { value: "YYYYMMDD", label: "YYYYMMDD" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
  { value: "custom", label: "Custom strptime format…" },
] as const

const LAYOUT_PRESETS = [
  { label: "4×1", cols: 4, rows: 1 },
  { label: "1×4", cols: 1, rows: 4 },
  { label: "2×2", cols: 2, rows: 2 },
] as const

const STEP_LABELS = ["Layout & Bands", "Timestamp", "Preview"]

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  uploadId: string
  onClose: () => void
}

export function MultispectralUploadDialog({ open, uploadId, onClose }: Props) {
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [step, setStep] = useState(0)
  const [layoutCols, setLayoutCols] = useState(4)
  const [layoutRows, setLayoutRows] = useState(1)
  const [bands, setBands] = useState<BandConfig[]>(() => makeBands(4, 1))
  const [tsSource, setTsSource] = useState<"none" | "exif" | "filename">("none")
  const [tsFmt, setTsFmt] = useState<string>("unix_epoch")
  const [customFmt, setCustomFmt] = useState("")

  // Preview step state
  const [firstImageUrl, setFirstImageUrl] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null)

  // Load last config on mount
  useEffect(() => {
    if (!open) return
    fetch(apiUrl("/api/v1/multispectral/last-config"), { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.config) {
          const c = data.config
          setLayoutCols(c.layout_cols ?? 4)
          setLayoutRows(c.layout_rows ?? 1)
          setBands(makeBands(c.layout_cols ?? 4, c.layout_rows ?? 1, c.bands))
          setTsSource(c.timestamp_source ?? "none")
          setTsFmt(c.timestamp_format ?? "unix_epoch")
        }
      })
      .catch(() => {})
  }, [open])

  // Load first image URL when reaching preview step
  useEffect(() => {
    if (step !== 2 || !uploadId) return
    fetch(apiUrl(`/api/v1/files/${uploadId}/list-images`), { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((data: any) => {
        const paths: string[] = data?.images ?? data ?? []
        if (paths.length > 0) {
          setFirstImageUrl(apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(paths[0])}`))
        }
      })
      .catch(() => {})
  }, [step, uploadId])

  function applyLayout(cols: number, rows: number) {
    setLayoutCols(cols)
    setLayoutRows(rows)
    setBands((prev) => makeBands(cols, rows, prev))
    setPreviewResult(null)
  }

  function updateBand(index: number, patch: Partial<BandConfig>) {
    setBands((prev) => prev.map((b) => b.index === index ? { ...b, ...patch } : b))
    setPreviewResult(null)
  }

  async function fetchPreview() {
    setPreviewLoading(true)
    setPreviewResult(null)
    try {
      const res = await fetch(apiUrl(`/api/v1/multispectral/${uploadId}/preview`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ image_index: 0, layout_cols: layoutCols, layout_rows: layoutRows, bands }),
      })
      if (!res.ok) throw new Error(await res.text())
      setPreviewResult(await res.json())
    } catch (e: any) {
      showErrorToast(`Preview failed: ${e.message}`)
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const finalFmt = tsSource === "filename"
        ? (tsFmt === "custom" ? customFmt : tsFmt)
        : null
      const res = await fetch(apiUrl(`/api/v1/multispectral/${uploadId}/config`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          band_count: layoutCols * layoutRows,
          layout_cols: layoutCols,
          layout_rows: layoutRows,
          bands,
          timestamp_source: tsSource,
          timestamp_format: finalFmt,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      showSuccessToast("Band configuration saved")
      onClose()
    } catch (e: any) {
      showErrorToast(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  function canProceed(): boolean {
    if (step === 0) {
      return layoutCols >= 1 && layoutRows >= 1
    }
    if (step === 1 && tsSource === "filename" && tsFmt === "custom") {
      return customFmt.trim().length > 0
    }
    return true
  }

  // ── Render steps ──────────────────────────────────────────────────────────

  function renderStepLayout() {
    return (
      <div className="space-y-5">
        {/* Layout presets */}
        <div className="space-y-2">
          <Label>Layout presets</Label>
          <div className="flex gap-2">
            {LAYOUT_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyLayout(p.cols, p.rows)}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                  layoutCols === p.cols && layoutRows === p.rows
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-accent"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom layout */}
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Columns</Label>
            <Input
              type="number"
              min={1}
              max={8}
              value={layoutCols}
              onChange={(e) => applyLayout(Math.max(1, parseInt(e.target.value) || 1), layoutRows)}
              className="w-20"
            />
          </div>
          <span className="mt-5 text-muted-foreground">×</span>
          <div className="space-y-1">
            <Label className="text-xs">Rows</Label>
            <Input
              type="number"
              min={1}
              max={8}
              value={layoutRows}
              onChange={(e) => applyLayout(layoutCols, Math.max(1, parseInt(e.target.value) || 1))}
              className="w-20"
            />
          </div>
          <span className="mt-5 text-sm text-muted-foreground">
            = {layoutCols * layoutRows} band{layoutCols * layoutRows !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Band table */}
        <div className="space-y-2">
          <Label>Band settings</Label>
          <div className="rounded-md border text-sm">
            <div className="grid grid-cols-[2rem_1fr_5rem_3.5rem_3.5rem_5.5rem] gap-0 border-b bg-muted/40 px-3 py-2 font-medium text-muted-foreground text-xs">
              <span>#</span>
              <span>Name</span>
              <span>λ (nm)</span>
              <span>Flip H</span>
              <span>Flip V</span>
              <span>Rotate</span>
            </div>
            <div className="max-h-56 overflow-y-auto divide-y">
              {bands.map((band) => {
                const gridCol = band.index % layoutCols
                const gridRow = Math.floor(band.index / layoutCols)
                return (
                  <div
                    key={band.index}
                    className="grid grid-cols-[2rem_1fr_5rem_3.5rem_3.5rem_5.5rem] items-center gap-0 px-3 py-1.5"
                  >
                    <span className="text-xs text-muted-foreground">
                      {band.index + 1}
                      <span className="block text-[10px] leading-none opacity-60">
                        r{gridRow + 1}c{gridCol + 1}
                      </span>
                    </span>
                    <Input
                      value={band.name}
                      placeholder={`Band ${band.index + 1}`}
                      onChange={(e) => updateBand(band.index, { name: e.target.value })}
                      className="h-7 text-xs"
                    />
                    <Input
                      type="number"
                      min={300}
                      max={1100}
                      placeholder="—"
                      value={band.wavelength_nm ?? ""}
                      onChange={(e) => updateBand(band.index, {
                        wavelength_nm: e.target.value ? parseFloat(e.target.value) : null,
                      })}
                      className="h-7 text-xs"
                    />
                    <div className="flex justify-center">
                      <input
                        type="checkbox"
                        checked={band.flip_h}
                        onChange={(e) => updateBand(band.index, { flip_h: e.target.checked })}
                        className="h-4 w-4 cursor-pointer"
                      />
                    </div>
                    <div className="flex justify-center">
                      <input
                        type="checkbox"
                        checked={band.flip_v}
                        onChange={(e) => updateBand(band.index, { flip_v: e.target.checked })}
                        className="h-4 w-4 cursor-pointer"
                      />
                    </div>
                    <Select
                      value={String(band.rotate_deg)}
                      onValueChange={(v) =>
                        updateBand(band.index, { rotate_deg: parseInt(v) as 0 | 90 | 180 | 270 })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">0°</SelectItem>
                        <SelectItem value="90">90°</SelectItem>
                        <SelectItem value="180">180°</SelectItem>
                        <SelectItem value="270">270°</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderStepTimestamp() {
    return (
      <div className="space-y-5">
        <div className="space-y-3">
          <Label>Timestamp source</Label>
          <div className="space-y-2">
            {(["none", "exif", "filename"] as const).map((src) => (
              <label key={src} className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="ts-source"
                  value={src}
                  checked={tsSource === src}
                  onChange={() => setTsSource(src)}
                  className="h-4 w-4"
                />
                <div>
                  <span className="text-sm font-medium capitalize">{src === "none" ? "None" : src === "exif" ? "EXIF metadata" : "Filename"}</span>
                  <p className="text-xs text-muted-foreground">
                    {src === "none" && "No timestamp will be extracted"}
                    {src === "exif" && "Read DateTimeOriginal / DateTime tag from image EXIF"}
                    {src === "filename" && "Parse timestamp from the image filename"}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {tsSource === "filename" && (
          <div className="space-y-3 rounded-md border p-4">
            <Label>Filename timestamp format</Label>
            <Select value={tsFmt} onValueChange={setTsFmt}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMESTAMP_FORMAT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tsFmt === "custom" && (
              <div className="space-y-1">
                <Input
                  value={customFmt}
                  onChange={(e) => setCustomFmt(e.target.value)}
                  placeholder="e.g. %Y%m%d_%H%M%S"
                />
                <p className="text-xs text-muted-foreground">
                  Python strptime format string. The parser will search for a matching
                  substring within the filename stem.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  function renderStepPreview() {
    const bandCount = layoutCols * layoutRows
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Grid lines show where the image will be split into {bandCount} band{bandCount !== 1 ? "s" : ""}.
          Band labels and orientation indicators are shown in each cell.
        </p>

        {/* Wireframe overlay */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Split preview (wireframe)</Label>
          <div className="relative overflow-hidden rounded-md border bg-muted/20">
            {firstImageUrl ? (
              <div className="relative">
                <img
                  ref={imgRef}
                  src={firstImageUrl}
                  alt="First frame"
                  className="w-full"
                  onLoad={() => {
                    if (imgRef.current) {
                      setImgDims({
                        w: imgRef.current.naturalWidth,
                        h: imgRef.current.naturalHeight,
                      })
                    }
                  }}
                />
                {/* SVG overlay — drawn relative to displayed image size */}
                <svg
                  className="absolute inset-0 h-full w-full"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 100"
                >
                  {/* Vertical split lines */}
                  {Array.from({ length: layoutCols - 1 }, (_, i) => (
                    <line
                      key={`v${i}`}
                      x1={`${((i + 1) * 100) / layoutCols}`}
                      y1="0"
                      x2={`${((i + 1) * 100) / layoutCols}`}
                      y2="100"
                      stroke="rgba(239,68,68,0.85)"
                      strokeWidth="0.5"
                      strokeDasharray="2 1"
                    />
                  ))}
                  {/* Horizontal split lines */}
                  {Array.from({ length: layoutRows - 1 }, (_, i) => (
                    <line
                      key={`h${i}`}
                      x1="0"
                      y1={`${((i + 1) * 100) / layoutRows}`}
                      x2="100"
                      y2={`${((i + 1) * 100) / layoutRows}`}
                      stroke="rgba(239,68,68,0.85)"
                      strokeWidth="0.5"
                      strokeDasharray="2 1"
                    />
                  ))}
                  {/* Band labels */}
                  {bands.map((band) => {
                    const col = band.index % layoutCols
                    const row = Math.floor(band.index / layoutCols)
                    const cx = ((col + 0.5) * 100) / layoutCols
                    const cy = ((row + 0.5) * 100) / layoutRows
                    const label = band.name || `B${band.index + 1}`
                    const wl = band.wavelength_nm ? `${band.wavelength_nm}nm` : ""
                    const transforms: string[] = []
                    if (band.flip_h) transforms.push("↔")
                    if (band.flip_v) transforms.push("↕")
                    if (band.rotate_deg) transforms.push(`${band.rotate_deg}°`)
                    const hint = transforms.join(" ")
                    return (
                      <g key={band.index}>
                        <text
                          x={cx}
                          y={cy - (wl || hint ? 3 : 0)}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="rgba(239,68,68,0.95)"
                          fontSize="4"
                          fontWeight="bold"
                        >
                          {label}
                        </text>
                        {wl && (
                          <text x={cx} y={cy + 3} textAnchor="middle" dominantBaseline="middle" fill="rgba(239,68,68,0.8)" fontSize="3">
                            {wl}
                          </text>
                        )}
                        {hint && (
                          <text x={cx} y={cy + (wl ? 6.5 : 3)} textAnchor="middle" dominantBaseline="middle" fill="rgba(239,68,68,0.7)" fontSize="2.5">
                            {hint}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </svg>
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                Loading first image…
              </div>
            )}
          </div>
          {imgDims && (
            <p className="text-xs text-muted-foreground">
              Source: {imgDims.w} × {imgDims.h} px → each band ≈ {Math.round(imgDims.w / layoutCols)} × {Math.round(imgDims.h / layoutRows)} px
            </p>
          )}
        </div>

        {/* Live band extraction */}
        <div className="space-y-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPreview}
            disabled={previewLoading || !firstImageUrl}
          >
            {previewLoading ? "Extracting…" : "Extract bands from first image"}
          </Button>

          {previewResult && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Extracted from {previewResult.source_filename}
              </p>
              <div className="flex flex-wrap gap-2">
                {previewResult.bands.map((b) => (
                  <div key={b.index} className="space-y-1 text-center">
                    <img
                      src={`data:image/jpeg;base64,${b.b64_jpeg}`}
                      alt={b.name}
                      className="h-28 w-auto rounded border object-contain"
                    />
                    <p className="text-xs font-medium">{b.name || `Band ${b.index + 1}`}</p>
                    {b.wavelength_nm && (
                      <p className="text-xs text-muted-foreground">{b.wavelength_nm} nm</p>
                    )}
                    <p className="text-xs text-muted-foreground">{b.width}×{b.height}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure Multispectral Bands</DialogTitle>
          {/* Step indicator */}
          <div className="flex items-center gap-1 pt-1">
            {STEP_LABELS.map((label, i) => (
              <div key={i} className="flex items-center gap-1">
                <button
                  onClick={() => i < step && setStep(i)}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                    i === step
                      ? "bg-primary text-primary-foreground"
                      : i < step
                      ? "cursor-pointer bg-primary/20 text-primary hover:bg-primary/30"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </button>
                <span className={`text-xs ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  {label}
                </span>
                {i < STEP_LABELS.length - 1 && (
                  <span className="mx-1 text-muted-foreground/40">›</span>
                )}
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="py-2">
          {step === 0 && renderStepLayout()}
          {step === 1 && renderStepTimestamp()}
          {step === 2 && renderStepPreview()}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2">
          <div>
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {step < STEP_LABELS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed()}>
                Next
              </Button>
            ) : (
              <Button onClick={handleSave} disabled={saving || !canProceed()}>
                {saving ? "Saving…" : "Save & Close"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
