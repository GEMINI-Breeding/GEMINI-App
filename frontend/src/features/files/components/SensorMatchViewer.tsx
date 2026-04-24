/**
 * SensorMatchViewer — timestamp-based side-by-side matching of a sensor upload
 * (Multispectral Data, Thermal Data) against an RGB source (Farm-ng Binary File
 * or Synced Metadata) using the nearest-neighbour timestamp algorithm.
 *
 * Opens from the "Match with RGB" action in UploadActionsMenu.
 *
 * # FUTURE: once orthomosaics are stitched and georeferenced, integrate matched
 * pairs into the map viewer — overlay sensor thumbnails at the GPS coordinates
 * stored in each MatchedPair (lat/lon already returned by the backend).
 * The pipeline section can also link to this view from a completed run's detail
 * page to show which sensor frames correspond to each RGB acquisition.
 */

import { useEffect, useState } from "react"
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { OpenAPI } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"

// ── Types ─────────────────────────────────────────────────────────────────────

interface CandidateRgb {
  upload_id: string
  data_type: string
  experiment: string
  location: string
  population: string
  date: string
  platform: string | null
  sensor: string | null
  file_count: number
  has_msgs_synced: boolean
}

interface MatchedPair {
  sensor_rel_path: string
  sensor_filename: string
  sensor_timestamp_iso: string | null
  rgb_filename: string
  rgb_timestamp: number
  time_delta_ms: number
  lat: number | null
  lon: number | null
  alt: number | null
}

interface MatchResult {
  matches: MatchedPair[]
  total_sensor_images: number
  matched_count: number
  unmatched_count: number
  median_delta_ms: number | null
  max_delta_ms: number | null
  applied_offset_s: number
  timestamp_method: string | null
  warning: string | null
}

const TS_METHOD_LABEL: Record<string, string> = {
  exif_tag:    "EXIF tag",
  tiff_ifd:   "TIFF IFD tag",
  legacy_exif: "EXIF (legacy)",
  filesystem:  "filesystem creation time ⚠",
}

// ── Timezone quick-select options ─────────────────────────────────────────────

interface TzOption { label: string; offsetS: number }

const TZ_OPTIONS: TzOption[] = [
  { label: "UTC−12:00", offsetS: -43200 },
  { label: "UTC−11:00", offsetS: -39600 },
  { label: "UTC−10:00", offsetS: -36000 },
  { label: "UTC−09:30", offsetS: -34200 },
  { label: "UTC−09:00", offsetS: -32400 },
  { label: "UTC−08:00", offsetS: -28800 },
  { label: "UTC−07:00", offsetS: -25200 },
  { label: "UTC−06:00", offsetS: -21600 },
  { label: "UTC−05:00", offsetS: -18000 },
  { label: "UTC−04:00", offsetS: -14400 },
  { label: "UTC−03:30", offsetS: -12600 },
  { label: "UTC−03:00", offsetS: -10800 },
  { label: "UTC−02:00", offsetS: -7200 },
  { label: "UTC−01:00", offsetS: -3600 },
  { label: "UTC±00:00", offsetS: 0 },
  { label: "UTC+01:00", offsetS: 3600 },
  { label: "UTC+02:00", offsetS: 7200 },
  { label: "UTC+03:00", offsetS: 10800 },
  { label: "UTC+03:30", offsetS: 12600 },
  { label: "UTC+04:00", offsetS: 14400 },
  { label: "UTC+04:30", offsetS: 16200 },
  { label: "UTC+05:00", offsetS: 18000 },
  { label: "UTC+05:30", offsetS: 19800 },
  { label: "UTC+05:45", offsetS: 20700 },
  { label: "UTC+06:00", offsetS: 21600 },
  { label: "UTC+06:30", offsetS: 23400 },
  { label: "UTC+07:00", offsetS: 25200 },
  { label: "UTC+08:00", offsetS: 28800 },
  { label: "UTC+08:45", offsetS: 31500 },
  { label: "UTC+09:00", offsetS: 32400 },
  { label: "UTC+09:30", offsetS: 34200 },
  { label: "UTC+10:00", offsetS: 36000 },
  { label: "UTC+10:30", offsetS: 37800 },
  { label: "UTC+11:00", offsetS: 39600 },
  { label: "UTC+12:00", offsetS: 43200 },
  { label: "UTC+12:45", offsetS: 45900 },
  { label: "UTC+13:00", offsetS: 46800 },
  { label: "UTC+14:00", offsetS: 50400 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiBase(): string {
  return OpenAPI.BASE.replace(/\/$/, "")
}

function authHdrs(): Record<string, string> {
  const token = localStorage.getItem("access_token") || ""
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function serveUrl(absPath: string): string {
  return `${apiBase()}/api/v1/files/serve?path=${encodeURIComponent(absPath)}`
}

function fmtDelta(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function fmtTs(iso: string | null): string {
  if (!iso) return "—"
  try { return new Date(iso + "Z").toLocaleString() } catch { return iso }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  uploadId: string
  uploadDataType: string   // "Multispectral Data" | "Thermal Data"
  title: string
  onClose: () => void
}

export function SensorMatchViewer({ uploadId, uploadDataType, title, onClose }: Props) {
  const { showErrorToast } = useCustomToast()

  // Step 1 — candidate selection
  const [candidates, setCandidates] = useState<CandidateRgb[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(true)
  const [selectedRgbId, setSelectedRgbId] = useState<string | null>(null)

  // Timestamp offset (seconds) — applied uniformly to correct systemic clock drift
  const [offsetS, setOffsetS] = useState<number>(0)
  const [offsetInput, setOffsetInput] = useState<string>("0")

  // Step 2 — match result
  const [result, setResult] = useState<MatchResult | null>(null)
  const [matching, setMatching] = useState(false)

  // Step 3 — pair navigation
  const [pairIdx, setPairIdx] = useState(0)

  // Resolved image URLs for the current pair
  const [sensorImagePaths, setSensorImagePaths] = useState<string[]>([])
  const [rgbImagePaths, setRgbImagePaths] = useState<Record<string, string>>({})

  // ── Load saved offset for this data type ───────────────────────────────────
  useEffect(() => {
    fetch(`${apiBase()}/api/v1/sensor-match/last-offset?data_type=${encodeURIComponent(uploadDataType)}`, {
      headers: authHdrs(),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.offset_s != null) {
          setOffsetS(data.offset_s)
          setOffsetInput(String(data.offset_s))
        }
      })
      .catch(() => {})
  }, [uploadDataType])

  // ── Load candidates ─────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingCandidates(true)
    fetch(`${apiBase()}/api/v1/sensor-match/${uploadId}/candidates`, {
      headers: authHdrs(),
    })
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((data) => setCandidates(data.candidates ?? []))
      .catch((e) => showErrorToast(`Could not load RGB candidates: ${e}`))
      .finally(() => setLoadingCandidates(false))
  }, [uploadId])

  // ── Load sensor image absolute paths (for serving) ──────────────────────────
  useEffect(() => {
    fetch(`${apiBase()}/api/v1/files/${uploadId}/list-images`, { headers: authHdrs() })
      .then((r) => r.ok ? r.json() : null)
      .then((data: any) => setSensorImagePaths(data?.images ?? data ?? []))
      .catch(() => {})
  }, [uploadId])

  // ── Load RGB image paths when candidate selected ─────────────────────────────
  useEffect(() => {
    if (!selectedRgbId) return
    fetch(`${apiBase()}/api/v1/files/${selectedRgbId}/list-images`, { headers: authHdrs() })
      .then((r) => r.ok ? r.json() : null)
      .then((data: any) => {
        const paths: string[] = data?.images ?? data ?? []
        // Build filename → absolute-path map for quick lookup
        const map: Record<string, string> = {}
        for (const p of paths) {
          const name = p.split(/[\\/]/).pop() ?? p
          map[name] = p
        }
        setRgbImagePaths(map)
      })
      .catch(() => {})
  }, [selectedRgbId])

  // ── Run match ───────────────────────────────────────────────────────────────
  async function runMatch() {
    if (!selectedRgbId) return
    setMatching(true)
    setResult(null)
    setPairIdx(0)
    try {
      const res = await fetch(`${apiBase()}/api/v1/sensor-match/${uploadId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHdrs() },
        body: JSON.stringify({
          rgb_upload_id: selectedRgbId,
          timestamp_source: "exif",   // backend will prefer stored MultispectralConfig
          timestamp_offset_s: offsetS,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail ?? res.statusText)
      }
      const data: MatchResult = await res.json()
      setResult(data)
      // Persist offset so future matches default to the same value
      fetch(`${apiBase()}/api/v1/sensor-match/save-offset`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHdrs() },
        body: JSON.stringify({ offset_s: offsetS, data_type: uploadDataType }),
      }).catch(() => {})
    } catch (e: any) {
      showErrorToast(`Matching failed: ${e.message}`)
    } finally {
      setMatching(false)
    }
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const currentPair = result?.matches[pairIdx] ?? null

  // Resolve sensor image URL: find the absolute path whose filename matches
  const sensorUrl = (() => {
    if (!currentPair) return null
    const abs = sensorImagePaths.find(
      (p) => p.split(/[\\/]/).pop() === currentPair.sensor_filename
    )
    return abs ? serveUrl(abs) : null
  })()

  const rgbUrl = (() => {
    if (!currentPair?.rgb_filename) return null
    // msgs_synced.csv stores paths like "/top/rgb-123.jpg"; normalise to basename
    const basename = currentPair.rgb_filename.split(/[\\/]/).pop() ?? currentPair.rgb_filename
    const abs = rgbImagePaths[currentPair.rgb_filename] ?? rgbImagePaths[basename]
    return abs ? serveUrl(abs) : null
  })()

  const selectedCandidate = candidates.find((c) => c.upload_id === selectedRgbId)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="!max-w-7xl w-[95vw] max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Match with RGB — {title}</DialogTitle>
        </DialogHeader>

        {/* ── Step 1: candidate + offset controls ─────────────────────────── */}
        <div className="flex flex-wrap items-end gap-4 rounded-lg border p-4 bg-muted/30">
          {/* RGB source picker */}
          <div className="flex-1 min-w-[200px] space-y-1">
            <label className="text-xs font-medium text-muted-foreground">RGB source</label>
            {loadingCandidates ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : candidates.length === 0 ? (
              <p className="text-xs text-amber-600">
                No matching RGB uploads found for this experiment / location / population / date.
              </p>
            ) : (
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={selectedRgbId ?? ""}
                onChange={(e) => { setSelectedRgbId(e.target.value || null); setResult(null) }}
              >
                <option value="">— select RGB source —</option>
                {candidates.map((c) => (
                  <option key={c.upload_id} value={c.upload_id} disabled={!c.has_msgs_synced}>
                    {c.data_type} · {c.platform ?? "?"} · {c.sensor ?? "?"}
                    {!c.has_msgs_synced ? " (no msgs_synced.csv)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Timestamp offset */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Timestamp offset
              <span className="ml-1 text-muted-foreground/60 font-normal">
                — timezone or clock drift correction
              </span>
            </label>
            {/* Timezone quick-select */}
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={TZ_OPTIONS.find((t) => t.offsetS === offsetS)?.offsetS ?? ""}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v)) {
                  setOffsetS(v)
                  setOffsetInput(String(v))
                }
              }}
            >
              <option value="">— pick timezone offset —</option>
              {TZ_OPTIONS.map((tz) => (
                <option key={tz.offsetS} value={tz.offsetS}>{tz.label}</option>
              ))}
            </select>
            {/* Custom hours + seconds inputs */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="1"
                  placeholder="hrs"
                  className="w-16 rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums"
                  value={Number.isInteger(offsetS / 3600) ? offsetS / 3600 : ""}
                  onChange={(e) => {
                    const h = parseFloat(e.target.value)
                    if (!isNaN(h)) {
                      const s = Math.round(h * 3600)
                      setOffsetS(s)
                      setOffsetInput(String(s))
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground">h</span>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.1"
                  placeholder="secs"
                  className="w-24 rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums"
                  value={offsetInput}
                  onChange={(e) => {
                    setOffsetInput(e.target.value)
                    const n = parseFloat(e.target.value)
                    if (!isNaN(n)) setOffsetS(n)
                  }}
                />
                <span className="text-xs text-muted-foreground">s</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {offsetS > 0 ? `(sensor behind)` :
                 offsetS < 0 ? `(sensor ahead)` : "no offset"}
              </span>
            </div>
          </div>

          {/* Match button */}
          <Button
            onClick={runMatch}
            disabled={!selectedRgbId || matching || !selectedCandidate?.has_msgs_synced}
          >
            {matching
              ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Matching…</>
              : result
                ? <><RefreshCw className="mr-2 h-4 w-4" />Re-match</>
                : "Run match"}
          </Button>
        </div>

        {/* ── Warning banner ───────────────────────────────────────────────── */}
        {result?.warning && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p>{result.warning}</p>
          </div>
        )}

        {/* ── Match stats ──────────────────────────────────────────────────── */}
        {result && (
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>{result.matched_count} / {result.total_sensor_images} images matched</span>
            {result.unmatched_count > 0 && (
              <span className="text-amber-600">{result.unmatched_count} without timestamp</span>
            )}
            {result.median_delta_ms != null && (
              <span>median Δt {fmtDelta(result.median_delta_ms)}</span>
            )}
            {result.max_delta_ms != null && (
              <span>max Δt {fmtDelta(result.max_delta_ms)}</span>
            )}
            {result.timestamp_method && (
              <span className={result.timestamp_method === "filesystem" ? "text-amber-600" : ""}>
                timestamps: {TS_METHOD_LABEL[result.timestamp_method] ?? result.timestamp_method}
              </span>
            )}
            {result.applied_offset_s !== 0 && (
              <span className="text-primary">offset applied: {result.applied_offset_s > 0 ? "+" : ""}{result.applied_offset_s} s</span>
            )}
          </div>
        )}

        {/* ── Side-by-side viewer ──────────────────────────────────────────── */}
        {result && result.matches.length > 0 && (
          <div className="space-y-3">
            {/* Navigation bar */}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => setPairIdx((i) => Math.max(0, i - 1))}
                disabled={pairIdx === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-center text-xs text-muted-foreground">
                <span className="font-medium">{pairIdx + 1} / {result.matches.length}</span>
                {currentPair && (
                  <>
                    <span className="mx-2">·</span>
                    <span>Δt {fmtDelta(currentPair.time_delta_ms)}</span>
                    {currentPair.lat != null && currentPair.lon != null && (
                      <>
                        <span className="mx-2">·</span>
                        <span>{currentPair.lat.toFixed(6)}, {currentPair.lon.toFixed(6)}</span>
                        {currentPair.alt != null && (
                          <span className="ml-1">({currentPair.alt.toFixed(1)} m)</span>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
              <Button
                variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => setPairIdx((i) => Math.min(result.matches.length - 1, i + 1))}
                disabled={pairIdx >= result.matches.length - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Image panels */}
            <div className="grid grid-cols-2 gap-4">
              {/* Sensor panel */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground truncate">
                  {uploadDataType} — {currentPair?.sensor_filename}
                </p>
                <div className="overflow-hidden rounded-md border bg-muted/20 flex justify-center">
                  {sensorUrl ? (
                    <img
                      key={sensorUrl}
                      src={sensorUrl}
                      alt={currentPair?.sensor_filename}
                      className="max-h-72 max-w-full block object-contain"
                    />
                  ) : (
                    <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
                      {currentPair ? "Image not found" : "No pair selected"}
                    </div>
                  )}
                </div>
                {currentPair?.sensor_timestamp_iso && (
                  <p className="text-xs text-muted-foreground">{fmtTs(currentPair.sensor_timestamp_iso)}</p>
                )}
              </div>

              {/* RGB panel */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground truncate">
                  RGB — {currentPair?.rgb_filename || "—"}
                </p>
                <div className="overflow-hidden rounded-md border bg-muted/20 flex justify-center">
                  {rgbUrl ? (
                    <img
                      key={rgbUrl}
                      src={rgbUrl}
                      alt={currentPair?.rgb_filename}
                      className="max-h-72 max-w-full block object-contain"
                    />
                  ) : (
                    <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
                      {currentPair?.rgb_filename
                        ? "RGB image not found in upload"
                        : "No RGB frame for this pair"}
                    </div>
                  )}
                </div>
                {currentPair && (
                  <p className="text-xs text-muted-foreground">
                    {fmtTs(new Date(currentPair.rgb_timestamp * 1000).toISOString().replace("Z", ""))}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {result && result.matches.length === 0 && !matching && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No matched pairs — check that the correct RGB source and timestamp source are selected.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
