/**
 * GcpPicker — interactive tool for marking ground control points.
 *
 * CSV-driven workflow ported from `main`. The user uploads a
 * `gcp_locations.csv` (Label,Lat_dec,Lon_dec,Altitude) which is stored at
 * `Raw/{scope}/Images/gcp_locations.csv` so it is shared across runs of the
 * same scope. The picker reads each image's EXIF GPS in the browser
 * (via `exifr`) so it can filter the image list by proximity to each GCP
 * and emit a `geo.txt` companion that NodeODM consumes alongside
 * `gcp_list.txt`. Marks are kept in the run's `gcp_selection` step state.
 *
 * On save we upload two files to `Raw/{scope}/Images/`:
 *  - `gcp_list.txt` — ODM GCP file (EPSG:4326 header + per-mark rows)
 *  - `geo.txt`      — image GPS sidecar (EPSG:4326 header + per-image rows)
 *
 * The GEMINIbase ODM worker is patched to forward both files to NodeODM.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  RefreshCw,
  SkipForward,
  Trash2,
  Upload,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { FilesService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ImageDotMap } from "@/features/process/components/ImageDotMap"
import { useImageGps } from "@/features/process/hooks/useImageGps"
import { parseImageFilter } from "@/features/process/lib/imageFilter"
import {
  fetchObjectAsBlob,
  fetchObjectAsText,
  type ImageGps,
} from "@/features/process/lib/imageGps"
import type { AerialScope } from "@/features/process/lib/paths"
import {
  type Run,
  setStepState,
  type Workspace,
} from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"

const DEFAULT_BUCKET = "gemini"
const GCP_FILENAME = "gcp_list.txt"
const GEO_FILENAME = "geo.txt"
const CSV_FILENAME = "gcp_locations.csv"
const IMAGE_FILTER_FILENAME = "image_filter.txt"
const GROUPS_FILENAME = "gcp_image_groups.json"
// Default proximity radius. Drone EXIF GPS is the *drone's* position
// (usually 30–100 m AGL), and a single GCP is typically visible across
// every image whose camera centre falls within the ground footprint —
// roughly 0.9 × altitude for a 24 mm-equivalent nadir lens, so tens of
// metres in practice. Keep the default generous; users can tighten it
// for RTK-precise flights via the radius input.
const DEFAULT_RADIUS_M = 5

/** Sentinel value for the "+ Add new GCP" item inside the active-GCP
 *  Select. Picking it switches the inline Lat / Lon / Elevation editor
 *  next to the dropdown into "adding new" mode (boxes blanked out) instead
 *  of changing the active label. The `__` prefix avoids collision with
 *  real labels. */
const ADD_GCP_SENTINEL = "__add_gcp__"

/** Stable no-op for ImageDotMap.onSelectionChange when lasso edits should
 *  be ignored (active GCP is in radius mode, or no active GCP). Keeping
 *  a single reference avoids re-attaching map handlers each render. */
const NOOP_SELECTION_CHANGE: (next: Set<string>) => void = () => {}

const GCP_COLORS = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
] as const

function gcpColor(idx: number): string {
  return GCP_COLORS[idx % GCP_COLORS.length]
}

function gcpShortLabel(label: string): string {
  const m = label.match(/(\d+)$/)
  return m ? m[1] : label
}

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * GCP catalog entry — the merged view of `gcp_locations.csv` (coordinates)
 * and `gcp_image_groups.json` (per-GCP explicit image lists). Coordinates
 * are optional because Map-discovery lets a user commit an image group
 * before they have survey lat/lon.
 */
export interface GcpCatalogEntry {
  label: string
  lat?: number | null
  lon?: number | null
  alt?: number | null
  /** Explicit per-GCP image group; overrides radius-based candidate filter. */
  images?: string[]
}

/** Persisted shape of `gcp_image_groups.json`. */
export interface GcpImageGroupsFile {
  version: 1
  groups: Record<string, { images: string[] }>
}

/** A single pixel mark for one GCP on one image. */
export interface GcpMark {
  /** Catalog entry's `label` — matches main's row identity. */
  label: string
  /** Image filename (basename, no path). */
  image: string
  /** Pixel coordinate, top-left origin. */
  pixel_x: number
  pixel_y: number
}

interface GcpPickerProps {
  workspace: Workspace
  run: Run
  scope: AerialScope
  onSaved?: () => void
  onCancel?: () => void
}

// ── CSV parse / serialize ───────────────────────────────────────────────────

/**
 * Parse a `gcp_locations.csv`. Expected header: `Label,Lat_dec,Lon_dec[,Altitude]`
 * (case-insensitive, header optional). Altitude column is optional and
 * defaults to 0 when missing. Throws on malformed rows.
 */
export function parseGcpLocationsCsv(text: string): GcpCatalogEntry[] {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
  if (rows.length === 0) return []

  // Detect header by checking whether the second column on the first row
  // parses as a number. Works for both 3- and 4-column CSVs.
  const headerCandidate = rows[0].split(",").map((c) => c.trim())
  const looksLikeHeader =
    headerCandidate.length >= 3 && Number.isNaN(Number(headerCandidate[1]))
  const dataRows = looksLikeHeader ? rows.slice(1) : rows

  const out: GcpCatalogEntry[] = []
  for (const [i, raw] of dataRows.entries()) {
    const parts = raw.split(",").map((c) => c.trim())
    if (parts.length < 3) {
      throw new Error(
        `Row ${i + 1}: expected 3+ columns (Label,Lat,Lon[,Alt]), got ${parts.length}`,
      )
    }
    const [label, latS, lonS, altS] = parts
    const lat = Number(latS)
    const lon = Number(lonS)
    const alt = altS === undefined || altS === "" ? 0 : Number(altS)
    if (!label || Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(alt)) {
      throw new Error(`Row ${i + 1}: bad numeric values (${raw})`)
    }
    // Range-check lat/lon. The most common cause of a working CSV that
    // produces "no images near any GCP" is column-order swap (Lon,Lat
    // instead of Lat,Lon — the OpenDroneMap gcp_list.txt convention).
    // We fail loudly instead of silently placing GCPs in the wrong
    // hemisphere.
    if (Math.abs(lat) > 90) {
      throw new Error(
        `Row ${i + 1}: latitude ${lat} is outside [-90, 90]. ` +
          `Expected column order is Label,Lat,Lon[,Alt] — if your CSV is ` +
          `Label,Lon,Lat[,Alt] you'll need to swap columns 2 and 3.`,
      )
    }
    if (Math.abs(lon) > 180) {
      throw new Error(`Row ${i + 1}: longitude ${lon} is outside [-180, 180].`)
    }
    out.push({ label, lat, lon, alt })
  }
  return out
}

/** Default cull radius around the image GPS bbox. Drone image footprints
 *  typically span tens of metres, so a GCP more than ~100 m beyond the
 *  outermost image position can't physically appear in any image — almost
 *  certainly a typo (decimal place, swapped lat/lon, copy-pasted from a
 *  different field). 100 m is generous enough to keep edge GCPs that sit
 *  just past the flight envelope. */
export const GCP_BBOX_CULL_BUFFER_M = 100

/** Lat/lon bounding box of every image with parseable EXIF GPS. Returns
 *  null when no images have GPS yet. Used to sanity-check user-entered
 *  GCP coordinates before they're sent to ODM. */
export function imageBboxFromGpsMap(gpsMap: Record<string, ImageGps>): {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
} | null {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  let any = false
  for (const g of Object.values(gpsMap)) {
    if (!g) continue
    any = true
    if (g.lat < minLat) minLat = g.lat
    if (g.lat > maxLat) maxLat = g.lat
    if (g.lon < minLon) minLon = g.lon
    if (g.lon > maxLon) maxLon = g.lon
  }
  return any ? { minLat, maxLat, minLon, maxLon } : null
}

/** Split a catalog into entries that fall inside the image bbox + buffer
 *  vs. ones too far outside to be real. Coord-less entries are kept (they
 *  haven't claimed a position yet, so there's nothing to cull against).
 *  When no image GPS is available, every entry is kept (we can't decide).
 */
export function cullDistantGcps(
  catalog: GcpCatalogEntry[],
  gpsMap: Record<string, ImageGps>,
  bufferM: number = GCP_BBOX_CULL_BUFFER_M,
): { kept: GcpCatalogEntry[]; culled: GcpCatalogEntry[] } {
  const bbox = imageBboxFromGpsMap(gpsMap)
  if (!bbox) return { kept: [...catalog], culled: [] }
  const midLat = (bbox.minLat + bbox.maxLat) / 2
  // Convert metres to degrees. Lon scales with cos(lat); guard against the
  // pole edge case where cos(lat) → 0 (no GEMINI flights there, but cheap).
  const dLatBuf = bufferM / 111_000
  const cosMid = Math.max(0.0001, Math.cos((midLat * Math.PI) / 180))
  const dLonBuf = bufferM / (111_000 * cosMid)
  const kept: GcpCatalogEntry[] = []
  const culled: GcpCatalogEntry[] = []
  for (const g of catalog) {
    if (g.lat == null || g.lon == null) {
      kept.push(g)
      continue
    }
    const inside =
      g.lat >= bbox.minLat - dLatBuf &&
      g.lat <= bbox.maxLat + dLatBuf &&
      g.lon >= bbox.minLon - dLonBuf &&
      g.lon <= bbox.maxLon + dLonBuf
    if (inside) kept.push(g)
    else culled.push(g)
  }
  return { kept, culled }
}

/**
 * OpenDroneMap GCP file format. Header is the EPSG code; rows follow.
 * Marks for catalog entries that lack coordinates are silently dropped —
 * a coord-less GCP cannot contribute to ODM's bundle adjustment.
 */
export function serializeGcpList(
  catalog: GcpCatalogEntry[],
  marks: GcpMark[],
): string {
  const lines: string[] = ["EPSG:4326"]
  const byLabel = new Map(catalog.map((g) => [g.label, g]))
  for (const m of marks) {
    const g = byLabel.get(m.label)
    if (!g) continue
    if (g.lat == null || g.lon == null) continue
    const alt = g.alt ?? 0
    lines.push(
      `${g.lon} ${g.lat} ${alt} ${Math.round(m.pixel_x)} ${Math.round(
        m.pixel_y,
      )} ${m.image} ${g.label}`,
    )
  }
  return `${lines.join("\n")}\n`
}

/**
 * Round-trip writer for `gcp_locations.csv`. Only entries with full
 * coordinates are emitted — coord-less entries live in
 * `gcp_image_groups.json` until the user supplies survey data.
 */
export function serializeGcpLocationsCsv(catalog: GcpCatalogEntry[]): string {
  const header = "Label,Lat_dec,Lon_dec,Altitude"
  const rows: string[] = []
  for (const g of catalog) {
    if (g.lat == null || g.lon == null) continue
    rows.push(`${g.label},${g.lat},${g.lon},${g.alt ?? 0}`)
  }
  return `${[header, ...rows].join("\n")}\n`
}

/** Parse `gcp_image_groups.json` → label → image basenames. */
export function parseGcpImageGroups(text: string): Record<string, string[]> {
  if (!text.trim()) return {}
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new Error(
      `gcp_image_groups.json is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("gcp_image_groups.json must be a JSON object.")
  }
  const groups = (json as { groups?: unknown }).groups
  if (groups == null) return {}
  if (typeof groups !== "object" || Array.isArray(groups)) {
    throw new Error("gcp_image_groups.json: `groups` must be an object.")
  }
  const out: Record<string, string[]> = {}
  for (const [label, value] of Object.entries(
    groups as Record<string, unknown>,
  )) {
    const images = (value as { images?: unknown })?.images
    if (!Array.isArray(images)) continue
    const basenames: string[] = []
    for (const n of images) {
      if (typeof n === "string" && n.length > 0) basenames.push(n)
    }
    // Preserve labels with empty image lists — they represent coord-less
    // GCPs added via the "+ Add new GCP" form before any images are
    // attached to them. Dropping them here would lose the catalog entry
    // on the next round-trip.
    out[label] = basenames
  }
  return out
}

/** Serialize the runtime image-group map to its sidecar JSON shape. */
export function serializeGcpImageGroups(
  groups: Record<string, string[]>,
): string {
  const out: GcpImageGroupsFile = { version: 1, groups: {} }
  // Sort labels and basenames for stable output (diff-friendly). Labels
  // with empty image arrays are preserved — they represent coord-less
  // catalog entries added via the inline "+ Add new GCP" form.
  for (const label of Object.keys(groups).sort()) {
    const images = groups[label] ?? []
    out.groups[label] = { images: [...images].sort() }
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

/**
 * Merge CSV rows (coordinate-bearing) and image groups (label → images)
 * into the unified catalog. Labels that appear in either source become
 * an entry; coordinates from CSV take precedence; images attach when
 * the label has a group entry.
 *
 * Order: CSV order first, then groups-only labels in alphabetical order.
 */
export function mergeCatalog(
  csvRows: GcpCatalogEntry[],
  groups: Record<string, string[]>,
): GcpCatalogEntry[] {
  const byLabel = new Map<string, GcpCatalogEntry>()
  const order: string[] = []
  for (const r of csvRows) {
    if (!byLabel.has(r.label)) order.push(r.label)
    byLabel.set(r.label, { ...r })
  }
  const groupOnly: string[] = []
  for (const label of Object.keys(groups)) {
    const existing = byLabel.get(label)
    if (existing) {
      existing.images = groups[label]
    } else {
      byLabel.set(label, { label, images: groups[label] })
      groupOnly.push(label)
    }
  }
  groupOnly.sort()
  return [...order, ...groupOnly].map((l) => byLabel.get(l)!)
}

/**
 * Determine which GCP "owns" each image dot for the always-visible map.
 *
 * Two-pass ownership: explicit (map-mode image groups) wins over implicit
 * (radius-mode haversine). For radius-mode ties, the GCP whose centre is
 * closer to the dot wins. Coord-less GCPs in radius mode are skipped
 * (they have no anchor). The returned map only contains entries for
 * dots that are claimed by some GCP — unclaimed dots stay at the
 * caller's default color.
 */
export function computeDotColors(args: {
  catalog: GcpCatalogEntry[]
  gpsMap: Record<string, ImageGps>
  modes: Record<string, "radius" | "map">
  radii: Record<string, number>
  groups: Record<string, string[]>
  defaultRadius: number
}): Record<string, string> {
  const { catalog, gpsMap, modes, radii, groups, defaultRadius } = args
  const out: Record<string, string> = {}

  // Effective mode for a label: explicit override falls back to the
  // shape of the entry. A coord-less label can never be in radius mode.
  const effectiveMode = (g: GcpCatalogEntry): "radius" | "map" => {
    const m = modes[g.label]
    if (m === "radius" || m === "map") {
      if (m === "radius" && (g.lat == null || g.lon == null)) return "map"
      return m
    }
    return g.lat == null || g.lon == null ? "map" : "radius"
  }

  // Pass 1 — explicit groups (map mode).
  for (const [i, g] of catalog.entries()) {
    if (effectiveMode(g) !== "map") continue
    const grp = groups[g.label]
    if (!grp || grp.length === 0) continue
    for (const name of grp) {
      if (out[name]) continue // earlier-in-catalog wins
      out[name] = gcpColor(i)
    }
  }

  // Pass 2 — radius mode. Pre-build the candidate list once.
  const radiusEntries: Array<{
    idx: number
    lat: number
    lon: number
    radius: number
  }> = []
  for (const [i, g] of catalog.entries()) {
    if (effectiveMode(g) !== "radius") continue
    if (g.lat == null || g.lon == null) continue
    radiusEntries.push({
      idx: i,
      lat: g.lat,
      lon: g.lon,
      radius: radii[g.label] ?? defaultRadius,
    })
  }
  if (radiusEntries.length > 0) {
    for (const [name, dot] of Object.entries(gpsMap)) {
      if (!dot || out[name]) continue
      let best = { idx: -1, dist: Number.POSITIVE_INFINITY }
      for (const e of radiusEntries) {
        const d = haversineM(e.lat, e.lon, dot.lat, dot.lon)
        if (d <= e.radius && d < best.dist) {
          best = { idx: e.idx, dist: d }
        }
      }
      if (best.idx >= 0) out[name] = gcpColor(best.idx)
    }
  }

  return out
}

/**
 * Validate a manual/discovery GCP entry. Throws on invalid input so
 * callers can surface the message via toast. `coordsRequired=false`
 * permits coord-less entries (Map-discovery).
 */
export function validateGcpEntry(
  entry: {
    label: string
    lat?: number | null
    lon?: number | null
    alt?: number | null
  },
  existingLabels: ReadonlyArray<string>,
  coordsRequired: boolean,
): void {
  const label = entry.label.trim()
  if (!label) throw new Error("Label is required.")
  if (existingLabels.includes(label)) {
    throw new Error(`A GCP named "${label}" already exists.`)
  }
  const hasLat = entry.lat != null && Number.isFinite(entry.lat)
  const hasLon = entry.lon != null && Number.isFinite(entry.lon)
  if (coordsRequired && (!hasLat || !hasLon)) {
    throw new Error("Lat and Lon are required (decimal degrees).")
  }
  if (hasLat && Math.abs(entry.lat as number) > 90) {
    throw new Error(`Latitude ${entry.lat} is outside [-90, 90].`)
  }
  if (hasLon && Math.abs(entry.lon as number) > 180) {
    throw new Error(`Longitude ${entry.lon} is outside [-180, 180].`)
  }
  if (entry.alt != null && !Number.isFinite(entry.alt)) {
    throw new Error("Altitude must be numeric.")
  }
  // If only one of lat/lon is set, force the user to provide both or neither.
  if (hasLat !== hasLon) {
    throw new Error("Provide both Lat and Lon, or leave both empty.")
  }
}

/**
 * NodeODM image-GPS sidecar. Header is the EPSG code; rows are
 * `image lon lat alt`. Images without GPS are skipped.
 */
export function serializeGeoTxt(
  images: string[],
  gpsMap: Record<string, ImageGps>,
): string {
  const lines: string[] = ["EPSG:4326"]
  for (const name of images) {
    const g = gpsMap[name]
    if (!g) continue
    lines.push(`${name} ${g.lon} ${g.lat} ${g.alt}`)
  }
  return `${lines.join("\n")}\n`
}

// ── Geo helper ──────────────────────────────────────────────────────────────

/** Great-circle distance in metres between two WGS-84 points. */
function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ── CSV upload panel ────────────────────────────────────────────────────────

interface CsvUploadPanelProps {
  imagesPrefix: string
  onLoaded: () => void
  onCancel?: () => void
  onSkip?: () => void
  hasExisting?: boolean
}

function CsvUploadPanel({
  imagesPrefix,
  onLoaded,
  onCancel,
  onSkip,
  hasExisting,
}: CsvUploadPanelProps) {
  const { showErrorToast } = useCustomToast()
  const [csvText, setCsvText] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  const saveMutation = useMutation({
    mutationFn: async (text: string) => {
      // Validate before upload — surfaces parse errors immediately.
      parseGcpLocationsCsv(text)
      const blob = new Blob([text], { type: "text/csv" })
      const file = new File([blob], CSV_FILENAME, { type: "text/csv" })
      await FilesService.apiFilesUploadUploadFile({
        formData: {
          file,
          bucket_name: DEFAULT_BUCKET,
          object_name: `${imagesPrefix}${CSV_FILENAME}`,
        },
      })
    },
    onSuccess: onLoaded,
    onError: (err) =>
      showErrorToast(
        err instanceof Error ? err.message : "Failed to save GCP locations",
      ),
  })

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = (ev) => setCsvText((ev.target?.result as string) ?? "")
    reader.readAsText(f)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MapPin className="text-muted-foreground h-5 w-5" />
          <CardTitle className="text-base">
            {hasExisting ? "Replace GCP locations" : "GCP locations required"}
          </CardTitle>
        </div>
        <CardDescription>
          {hasExisting
            ? "Paste or pick a new CSV to replace the existing file."
            : "Upload a CSV of survey GCPs. Format: "}
          <code className="text-xs">Label, Lat_dec, Lon_dec, Altitude</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasExisting && (
          <div className="rounded-md border border-yellow-400 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-200">
            Replacing overwrites <code>{CSV_FILENAME}</code> at this scope and
            invalidates marks taken against the previous catalog.
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">CSV content</Label>
          <Textarea
            rows={8}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            className="font-mono text-xs"
            placeholder={
              "Label,Lat_dec,Lon_dec,Altitude\n1,33.4512,-111.9876,380.5\n2,33.4498,-111.9845,381.0"
            }
            data-testid="gcp-csv-textarea"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            data-testid="gcp-csv-pick-file"
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Pick file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFile}
          />
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <div className="flex-1" />
          {onSkip && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSkip}
              data-testid="gcp-skip"
            >
              <SkipForward className="mr-1.5 h-3.5 w-3.5" />
              Skip GCP selection
            </Button>
          )}
          <Button
            size="sm"
            disabled={!csvText.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate(csvText)}
            data-testid="gcp-csv-save"
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {hasExisting ? "Replace" : "Load GCP locations"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}


// ── Main picker ─────────────────────────────────────────────────────────────

export function GcpPicker({
  workspace: _workspace,
  run,
  scope,
  onSaved,
  onCancel,
}: GcpPickerProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()

  // Image listing + EXIF GPS — shared with the image-review step.
  const {
    images: allImages,
    gpsMap,
    gpsLoading,
    gpsError,
    gpsReadyCount,
    filesQuery,
    imagesPrefix,
  } = useImageGps(scope)

  const allFiles = filesQuery.data ?? []

  const csvObjectName = `${imagesPrefix}${CSV_FILENAME}`
  const groupsObjectName = `${imagesPrefix}${GROUPS_FILENAME}`
  const csvExists = useMemo(
    () => allFiles.some((f) => f.object_name === csvObjectName),
    [allFiles, csvObjectName],
  )
  const groupsExist = useMemo(
    () => allFiles.some((f) => f.object_name === groupsObjectName),
    [allFiles, groupsObjectName],
  )

  // ── Excluded images (image_review step) ───────────────────────────────────
  // The optional Image Exclusion step writes `image_filter.txt` next to
  // the raw images. Drop those names from the candidate list and the
  // geo.txt sidecar so the GCP picker and ODM agree on what's in the run.
  const filterObjectName = `${imagesPrefix}${IMAGE_FILTER_FILENAME}`
  const filterExists = useMemo(
    () => allFiles.some((f) => f.object_name === filterObjectName),
    [allFiles, filterObjectName],
  )
  const filterQuery = useQuery<Set<string>, Error>({
    queryKey: ["gcp-image-filter", imagesPrefix, filterExists],
    queryFn: async () =>
      parseImageFilter(await fetchObjectAsText(filterObjectName)),
    enabled: filterExists,
  })
  const excludedNames = filterQuery.data ?? new Set<string>()

  const images = useMemo(
    () =>
      allImages.filter(
        (f) => !excludedNames.has(f.object_name?.split("/").pop() ?? ""),
      ),
    [allImages, excludedNames],
  )
  // Drop excluded entries from the gps map so map-based UIs (Map
  // discovery + in-flow Map sub-tab) only render dots for images that
  // will actually reach ODM. Marks on excluded images are pointless —
  // ODM never sees them — and a stale dot would invite the user to
  // commit one.
  const filteredGpsMap = useMemo(() => {
    if (excludedNames.size === 0) return gpsMap
    const out: Record<string, ImageGps> = {}
    for (const [name, g] of Object.entries(gpsMap)) {
      if (!excludedNames.has(name)) out[name] = g
    }
    return out
  }, [gpsMap, excludedNames])
  // GPS-ready count *within the non-excluded set*. The raw imageBbox
  // count comes from useImageGps before exclusion is applied, so
  // displaying that against the filtered total gave nonsense ratios
  // (e.g. "193/74") whenever Image Exclusion had run.
  const filteredGpsCount = useMemo(
    () => Object.values(filteredGpsMap).filter((g) => g != null).length,
    [filteredGpsMap],
  )

  // ── Fetch + parse the CSV (coordinates) and groups sidecar (per-GCP images)
  const csvQuery = useQuery<GcpCatalogEntry[], Error>({
    queryKey: ["gcp-csv", imagesPrefix, csvExists],
    queryFn: async () => {
      const text = await fetchObjectAsText(csvObjectName)
      return parseGcpLocationsCsv(text)
    },
    enabled: csvExists,
  })
  const groupsQuery = useQuery<Record<string, string[]>, Error>({
    queryKey: ["gcp-image-groups", imagesPrefix, groupsExist],
    queryFn: async () => {
      const text = await fetchObjectAsText(groupsObjectName)
      return parseGcpImageGroups(text)
    },
    enabled: groupsExist,
  })
  const csvRows = csvQuery.data ?? []

  // Per-GCP image groups (map mode). Initial value comes from step
  // state; hydrated from the durable JSON sidecar once it loads. Local
  // state is the source of truth for the catalog merge below — the
  // query data may lag a refetch by a few ms after a write, and the
  // catalog needs to reflect the just-added label immediately.
  const [gcpImageGroups, setGcpImageGroups] = useState<
    Record<string, string[]>
  >(() => {
    const prev = run.steps.gcp_selection?.outputs?.gcpImageGroups
    if (prev && typeof prev === "object" && !Array.isArray(prev)) {
      return prev as Record<string, string[]>
    }
    return {}
  })
  useEffect(() => {
    if (groupsQuery.data) setGcpImageGroups(groupsQuery.data)
  }, [groupsQuery.data])

  // Catalog merges CSV rows with the local gcpImageGroups state. Reading
  // groupsQuery.data here directly would miss a freshly-added coord-less
  // label until the refetch lands, which would then trip the activeLabel
  // reconciliation effect into resetting the user's selection.
  const catalog: GcpCatalogEntry[] = useMemo(
    () => mergeCatalog(csvRows, gcpImageGroups),
    [csvRows, gcpImageGroups],
  )
  const existingLabels = useMemo(() => catalog.map((g) => g.label), [catalog])

  // ── Marks (per-run state, persisted in runStore) ──────────────────────────
  const [marks, setMarks] = useState<GcpMark[]>(() => {
    const prev = run.steps.gcp_selection?.manualMarks
    return Array.isArray(prev) ? (prev as GcpMark[]) : []
  })
  useEffect(() => {
    const prev = run.steps.gcp_selection?.manualMarks
    if (JSON.stringify(prev) !== JSON.stringify(marks)) {
      setStepState(run.id, "gcp_selection", { manualMarks: marks })
    }
  }, [marks, run.id, run.steps.gcp_selection])

  // ── Active GCP + filter state ─────────────────────────────────────────────
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!activeLabel && catalog.length > 0) setActiveLabel(catalog[0].label)
    if (
      activeLabel &&
      catalog.length > 0 &&
      !catalog.some((g) => g.label === activeLabel)
    ) {
      setActiveLabel(catalog[0].label)
    }
  }, [catalog, activeLabel])
  const activeIdx = catalog.findIndex((g) => g.label === activeLabel)
  const activeGcp = activeIdx >= 0 ? catalog[activeIdx] : null

  // Per-GCP filter mode + radius. Each GCP independently picks "radius"
  // (haversine of its lat/lon ± radius) or "map" (explicit image-group).
  // Coord-less GCPs are forced to "map" — radius needs an anchor.
  const [gcpModes, setGcpModes] = useState<Record<string, "radius" | "map">>(
    () => {
      const prev = run.steps.gcp_selection?.outputs?.gcpModes
      if (prev && typeof prev === "object" && !Array.isArray(prev)) {
        return prev as Record<string, "radius" | "map">
      }
      return {}
    },
  )
  const [gcpRadii, setGcpRadii] = useState<Record<string, number>>(() => {
    const prev = run.steps.gcp_selection?.outputs?.gcpRadii
    if (prev && typeof prev === "object" && !Array.isArray(prev)) {
      return prev as Record<string, number>
    }
    return {}
  })
  // Persist per-GCP UI state on change so reload restores it. Only fire
  // when the maps' JSON shape actually differs from what's already in
  // step state — naive deps cause an infinite loop because setStepState
  // recreates `run.steps.gcp_selection.outputs` on every call.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment
  useEffect(() => {
    const stored = run.steps.gcp_selection?.outputs ?? {}
    const sameModes =
      JSON.stringify((stored as { gcpModes?: unknown }).gcpModes ?? {}) ===
      JSON.stringify(gcpModes)
    const sameRadii =
      JSON.stringify((stored as { gcpRadii?: unknown }).gcpRadii ?? {}) ===
      JSON.stringify(gcpRadii)
    if (sameModes && sameRadii) return
    setStepState(run.id, "gcp_selection", {
      outputs: { ...stored, gcpModes, gcpRadii },
    })
  }, [gcpModes, gcpRadii])

  // Effective mode/radius for the active GCP. Coord-less GCPs always
  // resolve to "map"; new GCPs default to "radius" when they have coords.
  const activeMode: "radius" | "map" = (() => {
    if (!activeGcp) return "radius"
    const stored = gcpModes[activeGcp.label]
    if (stored === "radius" || stored === "map") {
      if (
        stored === "radius" &&
        (activeGcp.lat == null || activeGcp.lon == null)
      ) {
        return "map"
      }
      return stored
    }
    return activeGcp.lat == null || activeGcp.lon == null ? "map" : "radius"
  })()
  const activeRadius = activeGcp
    ? (gcpRadii[activeGcp.label] ?? DEFAULT_RADIUS_M)
    : DEFAULT_RADIUS_M

  // Image candidates for the slider, governed by the active GCP's mode.
  const imageNames = useMemo(
    () => images.map((f) => f.object_name?.split("/").pop() ?? ""),
    [images],
  )
  const filteredImageNames = useMemo(() => {
    if (!activeGcp) return imageNames
    if (activeMode === "map") {
      const group = gcpImageGroups[activeGcp.label] ?? []
      if (group.length === 0) return []
      const namesSet = new Set(imageNames)
      return group.filter((n) => namesSet.has(n))
    }
    // Radius mode requires coords. Without them, fall back to no candidates;
    // the catalog UI nudges the user to fill coords or switch to map mode.
    if (activeGcp.lat == null || activeGcp.lon == null) return []
    const lat = activeGcp.lat
    const lon = activeGcp.lon
    return imageNames.filter((name) => {
      const g = gpsMap[name]
      if (!g) return false
      return haversineM(lat, lon, g.lat, g.lon) <= activeRadius
    })
  }, [activeGcp, activeMode, activeRadius, imageNames, gpsMap, gcpImageGroups])

  // Distance from the active GCP to its closest image. Surfaced in
  // the empty-state and the catalog header so the user sees whether
  // the filter excluded everything for proximity reasons (e.g. 200 m
  // away → bump radius) or alignment reasons (e.g. 12000 km away →
  // CSV column-order swap).
  const closestImageStat = useMemo(() => {
    if (!activeGcp || activeGcp.lat == null || activeGcp.lon == null)
      return null
    let bestName: string | null = null
    let bestDist = Infinity
    for (const name of imageNames) {
      const g = gpsMap[name]
      if (!g) continue
      const d = haversineM(
        activeGcp.lat as number,
        activeGcp.lon as number,
        g.lat,
        g.lon,
      )
      if (d < bestDist) {
        bestDist = d
        bestName = name
      }
    }
    if (!bestName) return null
    return { name: bestName, distM: bestDist }
  }, [activeGcp, imageNames, gpsMap])

  // Per-image-dot color for the always-visible map. Each dot adopts the
  // color of the GCP that "claims" it (explicit map-mode group beats
  // implicit radius proximity). Computed against the *filtered* gpsMap
  // so excluded images don't influence the coloring even transiently.
  const dotColors = useMemo(
    () =>
      computeDotColors({
        catalog,
        gpsMap: filteredGpsMap,
        modes: gcpModes,
        radii: gcpRadii,
        groups: gcpImageGroups,
        defaultRadius: DEFAULT_RADIUS_M,
      }),
    [catalog, filteredGpsMap, gcpModes, gcpRadii, gcpImageGroups],
  )

  const [imageIndex, setImageIndex] = useState(0)
  useEffect(() => {
    if (imageIndex >= filteredImageNames.length) setImageIndex(0)
  }, [filteredImageNames, imageIndex])
  const activeImageName = filteredImageNames[imageIndex] ?? ""

  // ── Authed image preview blob ─────────────────────────────────────────────
  // Hold the live URL in a ref so we can revoke the *previous* URL only
  // after a new one is in state. Revoking on cleanup (the obvious
  // pattern) caused a render race where the <img> tag still pointed at
  // the just-revoked URL between renders, which Chrome surfaces as
  // `Failed to load resource: net::ERR_FILE_NOT_FOUND` console errors.
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeImageName) {
      // Don't revoke the URL or clear state here — the <img> may still
      // be in the DOM for a tick while React commits, and Chrome will
      // log ERR_FILE_NOT_FOUND if the blob disappears underneath it.
      // The unmount cleanup further down releases the blob; until then
      // a stale image is harmless.
      return
    }
    let cancelled = false
    fetchObjectAsBlob(`${imagesPrefix}${activeImageName}`)
      .then((b) => {
        if (cancelled) return
        const newUrl = URL.createObjectURL(b)
        const oldUrl = blobUrlRef.current
        blobUrlRef.current = newUrl
        setImageBlobUrl(newUrl)
        if (oldUrl) URL.revokeObjectURL(oldUrl)
      })
      .catch(() => {
        if (!cancelled) setImageBlobUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [imagesPrefix, activeImageName])
  useEffect(
    () => () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    },
    [],
  )

  // ── Mark interactions ─────────────────────────────────────────────────────
  const imgRef = useRef<HTMLImageElement | null>(null)

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!activeLabel) {
      showErrorToast("Pick a GCP from the dropdown first.")
      return
    }
    if (activeGcp && (activeGcp.lat == null || activeGcp.lon == null)) {
      showErrorToast(
        `Add survey coordinates for ${activeGcp.label} before marking — coord-less GCPs aren't included in gcp_list.txt.`,
      )
      return
    }
    if (!activeImageName) return
    const img = imgRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top) * scaleY
    setMarks((prev) => [
      ...prev.filter(
        (m) => !(m.label === activeLabel && m.image === activeImageName),
      ),
      {
        label: activeLabel,
        image: activeImageName,
        pixel_x: px,
        pixel_y: py,
      },
    ])
  }

  function handleImageContextMenu(e: React.MouseEvent<HTMLImageElement>) {
    e.preventDefault()
    if (!activeLabel || !activeImageName) return
    setMarks((prev) =>
      prev.filter(
        (m) => !(m.label === activeLabel && m.image === activeImageName),
      ),
    )
  }

  const marksForActiveImage = useMemo(
    () => marks.filter((m) => m.image === activeImageName),
    [marks, activeImageName],
  )

  // For slider diamonds: every mark that touches a filtered image, mapped to
  // its index in the filtered list.
  const sliderDiamonds = useMemo(() => {
    const out: Array<{ idx: number; label: string; color: string }> = []
    for (const m of marks) {
      const idx = filteredImageNames.indexOf(m.image)
      if (idx < 0) continue
      const i = catalog.findIndex((g) => g.label === m.label)
      if (i < 0) continue
      out.push({ idx, label: m.label, color: gcpColor(i) })
    }
    return out
  }, [marks, filteredImageNames, catalog])

  // ── Save flow ─────────────────────────────────────────────────────────────
  // Match main's gate: save as long as at least one GCP has at least
  // one mark. A CSV often lists more candidate GCPs than are visible
  // on a given flight; unmarked rows are silently omitted from
  // gcp_list.txt rather than blocking save. ODM uses whatever marks
  // it gets and ignores the rest.
  const labelsCovered = useMemo(
    () => new Set(marks.map((m) => m.label)),
    [marks],
  )
  const unmarkedLabels = useMemo(
    () =>
      catalog.filter((g) => !labelsCovered.has(g.label)).map((g) => g.label),
    [catalog, labelsCovered],
  )
  const canSave = labelsCovered.size > 0

  // ── Catalog mutations: append a row, write groups sidecar ─────────────────
  // Each method (Manual/Map-discover/inline coord-add) calls these to
  // persist immediately so the user's work survives without relying on
  // the final save click.
  async function uploadText(
    text: string,
    objectName: string,
    contentType: string,
  ): Promise<void> {
    const file = new File([text], objectName.split("/").pop() ?? "file", {
      type: contentType,
    })
    await FilesService.apiFilesUploadUploadFile({
      formData: {
        file,
        bucket_name: DEFAULT_BUCKET,
        object_name: objectName,
      },
    })
  }

  const deleteCatalogEntry = useMutation({
    mutationFn: async (label: string) => {
      // 1. Remove from gcp_locations.csv if present.
      if (csvExists) {
        const text = await fetchObjectAsText(csvObjectName)
        const rows = parseGcpLocationsCsv(text)
        const next = rows.filter((r) => r.label !== label)
        if (next.length !== rows.length) {
          await uploadText(
            serializeGcpLocationsCsv(next),
            csvObjectName,
            "text/csv",
          )
        }
      }
      // 2. Remove from groups sidecar if present.
      if (gcpImageGroups[label]) {
        const next = { ...gcpImageGroups }
        delete next[label]
        await uploadText(
          serializeGcpImageGroups(next),
          groupsObjectName,
          "application/json",
        )
        setGcpImageGroups(next)
      }
      // 3. Drop any marks pointing at this label so the slider/save flow
      //    don't reference a deleted GCP.
      setMarks((prev) => prev.filter((m) => m.label !== label))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["files", "list", imagesPrefix],
      })
      queryClient.invalidateQueries({
        queryKey: ["gcp-csv", imagesPrefix],
      })
      queryClient.invalidateQueries({
        queryKey: ["gcp-image-groups", imagesPrefix],
      })
    },
    onError: (err) =>
      showErrorToast(err instanceof Error ? err.message : "Failed to delete"),
  })

  const confirm = useConfirm()
  async function handleDeleteActiveGcp() {
    if (!activeGcp) return
    const label = activeGcp.label
    const groupSize = gcpImageGroups[label]?.length ?? 0
    const markCount = marks.filter((m) => m.label === label).length
    const lossSummary: string[] = []
    if (activeGcp.lat != null && activeGcp.lon != null) {
      lossSummary.push("its row in gcp_locations.csv")
    }
    if (groupSize > 0) {
      lossSummary.push(
        `its image group (${groupSize} image${groupSize === 1 ? "" : "s"})`,
      )
    }
    if (markCount > 0) {
      lossSummary.push(`${markCount} pixel mark${markCount === 1 ? "" : "s"}`)
    }
    await confirm({
      title: `Delete ${label}?`,
      description:
        lossSummary.length > 0
          ? `Removes ${lossSummary.join(", ")}. This cannot be undone.`
          : "Removes the catalog entry. This cannot be undone.",
      confirmLabel: "Delete GCP",
      action: () => deleteCatalogEntry.mutateAsync(label),
    })
  }

  const writeGroupsSidecar = useMutation({
    mutationFn: async (next: Record<string, string[]>) => {
      await uploadText(
        serializeGcpImageGroups(next),
        groupsObjectName,
        "application/json",
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["files", "list", imagesPrefix],
      })
      queryClient.invalidateQueries({
        queryKey: ["gcp-image-groups", imagesPrefix],
      })
    },
    onError: (err) =>
      showErrorToast(err instanceof Error ? err.message : "Failed to save"),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (catalog.length === 0)
        throw new Error("Add at least one GCP first (CSV, manual, or map).")
      if (!canSave) {
        throw new Error("Mark at least one GCP on at least one image.")
      }
      // Drop marks on images that the Image Exclusion step removed —
      // ODM never sees those images, so any rows in gcp_list.txt that
      // reference them are dead weight at best and cause "missing image"
      // warnings at worst.
      const marksAfterExclusion = excludedNames.size
        ? marks.filter((m) => !excludedNames.has(m.image))
        : marks
      // Cull GCPs whose surveyed coordinates fall well outside the image
      // GPS bbox — almost always a typo (decimal slip, swapped lat/lon,
      // wrong field). They'd anchor ODM's bundle adjustment to a phantom
      // location and warp the reconstruction. The CSV keeps them so the
      // user can fix the values; only gcp_list.txt is filtered.
      const { kept: keptCatalog, culled: culledGcps } = cullDistantGcps(
        catalog,
        gpsMap,
      )
      const culledLabels = new Set(culledGcps.map((g) => g.label))
      const includedMarks = culledLabels.size
        ? marksAfterExclusion.filter((m) => !culledLabels.has(m.label))
        : marksAfterExclusion
      const gcpText = serializeGcpList(keptCatalog, includedMarks)
      const geoText = serializeGeoTxt(imageNames, gpsMap)
      await uploadText(gcpText, `${imagesPrefix}${GCP_FILENAME}`, "text/plain")
      await uploadText(geoText, `${imagesPrefix}${GEO_FILENAME}`, "text/plain")
      if (culledGcps.length > 0) {
        showErrorToast(
          `Excluded ${culledGcps.length} GCP(s) more than ${GCP_BBOX_CULL_BUFFER_M} m outside the image area: ${culledGcps
            .map((g) => g.label)
            .join(", ")}. Fix their Lat/Lon in the catalog and re-save to include them.`,
        )
      }
      // Always persist groups sidecar — Map-discovery may have already
      // written it during the session, but in-flow Map-tab edits to
      // existing GCPs are only mirrored here on save.
      if (Object.keys(gcpImageGroups).length > 0) {
        await uploadText(
          serializeGcpImageGroups(gcpImageGroups),
          groupsObjectName,
          "application/json",
        )
      }
    },
    onSuccess: () => {
      setStepState(run.id, "gcp_selection", {
        status: "completed",
        completedAt: new Date().toISOString(),
        manualMarks: marks,
        outputs: {
          ...(run.steps.gcp_selection?.outputs ?? {}),
          gcpListPath: `${imagesPrefix}${GCP_FILENAME}`,
          geoTxtPath: `${imagesPrefix}${GEO_FILENAME}`,
          gcpLocationsCsvPath: csvObjectName,
          gcpImageGroupsPath: groupsObjectName,
          gcpCount: catalog.length,
          markCount: excludedNames.size
            ? marks.filter((m) => !excludedNames.has(m.image)).length
            : marks.length,
          gcpImageGroups,
          gcpModes,
          gcpRadii,
        },
      })
      queryClient.invalidateQueries({
        queryKey: ["files", "list", imagesPrefix],
      })
      showSuccessToast(
        `Uploaded ${GCP_FILENAME} (${marks.length} marks) and ${GEO_FILENAME}`,
      )
      onSaved?.()
    },
    onError: (err) =>
      showErrorToast(err instanceof Error ? err.message : "Failed to save"),
  })

  function handleSkip() {
    setStepState(run.id, "gcp_selection", {
      status: "skipped",
      completedAt: new Date().toISOString(),
      manualMarks: marks,
    })
    showSuccessToast("Skipped GCP selection")
    onSaved?.()
  }

  // ── Replace-CSV mode ──────────────────────────────────────────────────────
  // Re-uploading the CSV overwrites it in MinIO. Image groups in the
  // sidecar are preserved unless the user removes them explicitly.
  const [replaceMode, setReplaceMode] = useState(false)
  function onCsvLoaded() {
    setReplaceMode(false)
    queryClient.invalidateQueries({
      queryKey: ["files", "list", imagesPrefix],
    })
    queryClient.invalidateQueries({ queryKey: ["gcp-csv", imagesPrefix] })
  }

  // ── Inline coordinate editor (next to the Active GCP dropdown) ────────────
  // The user types Lat/Lon/Alt for the active GCP directly here. When they
  // select "+ Add new GCP" from the dropdown the boxes blank out and Save
  // creates a fresh entry.
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [coordsLatS, setCoordsLatS] = useState("")
  const [coordsLonS, setCoordsLonS] = useState("")
  const [coordsAltS, setCoordsAltS] = useState("")

  // Reflect the active GCP's coords into the inline inputs whenever it
  // changes. Skipped while adding a new GCP so the user's typing isn't
  // wiped by a refetch landing in the middle of the form.
  useEffect(() => {
    if (isAddingNew) return
    if (activeGcp) {
      setCoordsLatS(activeGcp.lat == null ? "" : String(activeGcp.lat))
      setCoordsLonS(activeGcp.lon == null ? "" : String(activeGcp.lon))
      setCoordsAltS(String(activeGcp.alt ?? 0))
    } else {
      setCoordsLatS("")
      setCoordsLonS("")
      setCoordsAltS("")
    }
  }, [activeGcp?.label, activeGcp?.lat, activeGcp?.lon, activeGcp?.alt, isAddingNew])

  /** Smallest unused "GCP{n}" so a new entry has a sensible default label. */
  function nextNewGcpLabel(): string {
    const used = new Set(existingLabels)
    let i = 1
    while (used.has(`GCP${i}`)) i++
    return `GCP${i}`
  }

  // Upsert the active (or newly-being-added) GCP's coords into the CSV.
  // Insert when the label isn't in the CSV yet (new GCP, or coord-less
  // label transitioning to coord-ful); replace when it already has a row.
  const upsertCsvRow = useMutation({
    mutationFn: async (entry: GcpCatalogEntry) => {
      if (entry.lat == null || entry.lon == null) {
        throw new Error("Internal: upsertCsvRow requires lat/lon.")
      }
      let rows: GcpCatalogEntry[] = []
      if (csvExists) {
        const text = await fetchObjectAsText(csvObjectName)
        rows = parseGcpLocationsCsv(text)
      }
      const newRow: GcpCatalogEntry = {
        label: entry.label,
        lat: entry.lat,
        lon: entry.lon,
        alt: entry.alt ?? 0,
      }
      const idx = rows.findIndex((r) => r.label === entry.label)
      const next = [...rows]
      if (idx >= 0) next[idx] = newRow
      else next.push(newRow)
      await uploadText(
        serializeGcpLocationsCsv(next),
        csvObjectName,
        "text/csv",
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["files", "list", imagesPrefix],
      })
      queryClient.invalidateQueries({
        queryKey: ["gcp-csv", imagesPrefix],
      })
    },
    onError: (err) =>
      showErrorToast(err instanceof Error ? err.message : "Failed to save"),
  })

  // Save button enables only when the inputs are valid AND differ from
  // what's already on disk. Numeric (not string) comparison so trailing
  // zeros in the input don't read as a change.
  const parsedInputLat =
    coordsLatS.trim() === "" ? null : Number(coordsLatS)
  const parsedInputLon =
    coordsLonS.trim() === "" ? null : Number(coordsLonS)
  const parsedInputAlt =
    coordsAltS.trim() === "" ? 0 : Number(coordsAltS)
  const inputsValid =
    parsedInputLat != null &&
    Number.isFinite(parsedInputLat) &&
    parsedInputLon != null &&
    Number.isFinite(parsedInputLon) &&
    Number.isFinite(parsedInputAlt)
  const coordsAreDirty = (() => {
    if (!inputsValid) return false
    if (isAddingNew) return true
    if (!activeGcp) return false
    return (
      parsedInputLat !== (activeGcp.lat ?? null) ||
      parsedInputLon !== (activeGcp.lon ?? null) ||
      parsedInputAlt !== (activeGcp.alt ?? 0)
    )
  })()

  async function handleSaveCoords() {
    const lat = coordsLatS.trim() === "" ? null : Number(coordsLatS)
    const lon = coordsLonS.trim() === "" ? null : Number(coordsLonS)
    const alt = coordsAltS.trim() === "" ? 0 : Number(coordsAltS)
    const label = isAddingNew
      ? nextNewGcpLabel()
      : (activeGcp?.label ?? "")
    try {
      validateGcpEntry(
        { label, lat, lon, alt },
        // For an existing entry, exclude its own label from the
        // duplicate-check so editing-and-saving doesn't trip the rule.
        isAddingNew
          ? existingLabels
          : existingLabels.filter((l) => l !== label),
        /* coordsRequired */ true,
      )
      await upsertCsvRow.mutateAsync({
        label,
        lat,
        lon,
        alt,
      } as GcpCatalogEntry)
      showSuccessToast(
        isAddingNew
          ? `Added GCP "${label}".`
          : `Updated coordinates for ${label}.`,
      )
      setActiveLabel(label)
      setIsAddingNew(false)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (filesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    )
  }
  if (images.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No images found</CardTitle>
          <CardDescription>
            Expected images at <code>{imagesPrefix}</code>. Upload drone images
            via the Files page first.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (replaceMode) {
    return (
      <CsvUploadPanel
        imagesPrefix={imagesPrefix}
        hasExisting={csvExists}
        onLoaded={onCsvLoaded}
        onCancel={() => setReplaceMode(false)}
      />
    )
  }

  if (csvQuery.isLoading || groupsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    )
  }
  if (csvQuery.error) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="text-destructive h-5 w-5" />
            <CardTitle className="text-base">
              Couldn't read {CSV_FILENAME}
            </CardTitle>
          </div>
          <CardDescription>{csvQuery.error.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReplaceMode(true)}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Replace CSV
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (groupsQuery.error) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="text-destructive h-5 w-5" />
            <CardTitle className="text-base">
              Couldn't read {GROUPS_FILENAME}
            </CardTitle>
          </div>
          <CardDescription>{groupsQuery.error.message}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Catalog + controls */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">GCP catalog</CardTitle>
            <CardDescription>
              {catalog.length === 0 ? (
                "No GCPs yet — load a CSV or add one with the dropdown below."
              ) : (
                <>
                  {catalog.length} GCP{catalog.length === 1 ? "" : "s"}
                  {csvExists ? (
                    <>
                      {" from "}
                      <code className="text-xs">{CSV_FILENAME}</code>
                    </>
                  ) : null}
                  .
                </>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReplaceMode(true)}
              data-testid="gcp-load-csv"
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Load GCPs from CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              data-testid="gcp-skip-top"
            >
              <SkipForward className="mr-1.5 h-3.5 w-3.5" />
              Skip
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Active GCP</Label>
              <div className="flex items-center gap-1.5">
                <Select
                  value={isAddingNew ? ADD_GCP_SENTINEL : (activeLabel ?? "")}
                  onValueChange={(v) => {
                    if (v === ADD_GCP_SENTINEL) {
                      setIsAddingNew(true)
                      setCoordsLatS("")
                      setCoordsLonS("")
                      setCoordsAltS("")
                      return
                    }
                    setIsAddingNew(false)
                    setActiveLabel(v)
                  }}
                >
                  <SelectTrigger
                    className="w-64"
                    data-testid="gcp-active-select"
                  >
                    <SelectValue
                      placeholder={
                        catalog.length === 0
                          ? "No GCPs — open dropdown to add"
                          : "Select a GCP"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.map((g, i) => {
                      const count = marks.filter(
                        (m) => m.label === g.label,
                      ).length
                      const noCoords = g.lat == null || g.lon == null
                      return (
                        <SelectItem key={g.label} value={g.label}>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ background: gcpColor(i) }}
                            />
                            {g.label}
                            {noCoords ? (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                                no coords
                              </span>
                            ) : null}
                            <span className="text-muted-foreground text-xs">
                              ({count} mark{count === 1 ? "" : "s"})
                            </span>
                          </span>
                        </SelectItem>
                      )
                    })}
                    <SelectItem
                      value={ADD_GCP_SENTINEL}
                      data-testid="gcp-add-new-item"
                    >
                      <span className="text-primary font-medium">
                        + Add new GCP
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
                  disabled={
                    !activeGcp || isAddingNew || deleteCatalogEntry.isPending
                  }
                  onClick={handleDeleteActiveGcp}
                  data-testid="gcp-delete-active"
                  aria-label={
                    activeGcp
                      ? `Delete ${activeGcp.label}`
                      : "Delete active GCP"
                  }
                  title={
                    activeGcp
                      ? `Delete ${activeGcp.label}`
                      : "Select a GCP to delete"
                  }
                >
                  {deleteCatalogEntry.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="gcp-coords-lat">
                Lat (decimal °)
              </Label>
              <Input
                id="gcp-coords-lat"
                value={coordsLatS}
                onChange={(e) => setCoordsLatS(e.target.value)}
                placeholder="e.g. 38.5402"
                disabled={!isAddingNew && !activeGcp}
                className="h-9 w-32"
                data-testid="gcp-coords-lat"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="gcp-coords-lon">
                Lon (decimal °)
              </Label>
              <Input
                id="gcp-coords-lon"
                value={coordsLonS}
                onChange={(e) => setCoordsLonS(e.target.value)}
                placeholder="e.g. -121.7501"
                disabled={!isAddingNew && !activeGcp}
                className="h-9 w-32"
                data-testid="gcp-coords-lon"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="gcp-coords-alt">
                Elevation (m)
              </Label>
              <Input
                id="gcp-coords-alt"
                value={coordsAltS}
                onChange={(e) => setCoordsAltS(e.target.value)}
                placeholder="0"
                disabled={!isAddingNew && !activeGcp}
                className="h-9 w-24"
                data-testid="gcp-coords-alt"
              />
            </div>
            <Button
              size="sm"
              onClick={handleSaveCoords}
              disabled={upsertCsvRow.isPending || !coordsAreDirty}
              data-testid="gcp-coords-save"
            >
              {upsertCsvRow.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {isAddingNew ? "Add GCP" : "Save coords"}
            </Button>
            {isAddingNew ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsAddingNew(false)
                  // useEffect will repopulate inputs from the previous
                  // activeGcp (or clear them if there is none).
                }}
                data-testid="gcp-coords-cancel"
              >
                Cancel
              </Button>
            ) : null}
            {activeGcp ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Filter mode</Label>
                <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
                  <button
                    type="button"
                    className={`px-2.5 py-1 text-xs rounded-sm ${
                      activeMode === "radius"
                        ? "bg-background shadow-sm font-medium"
                        : "text-muted-foreground"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    onClick={() =>
                      setGcpModes((prev) => ({
                        ...prev,
                        [activeGcp.label]: "radius",
                      }))
                    }
                    disabled={activeGcp.lat == null || activeGcp.lon == null}
                    data-testid="gcp-mode-radius"
                  >
                    Radius
                  </button>
                  <button
                    type="button"
                    className={`px-2.5 py-1 text-xs rounded-sm ${
                      activeMode === "map"
                        ? "bg-background shadow-sm font-medium"
                        : "text-muted-foreground"
                    }`}
                    onClick={() =>
                      setGcpModes((prev) => ({
                        ...prev,
                        [activeGcp.label]: "map",
                      }))
                    }
                    data-testid="gcp-mode-map"
                  >
                    Map-picker
                  </button>
                </div>
              </div>
            ) : null}
            {activeGcp && activeMode === "radius" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Radius (m)</Label>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  value={activeRadius}
                  onChange={(e) => {
                    const v = Math.max(1, Number(e.target.value) || 0)
                    setGcpRadii((prev) => ({
                      ...prev,
                      [activeGcp.label]: v,
                    }))
                  }}
                  className="h-8 w-24 text-sm"
                  data-testid="gcp-radius-input"
                />
              </div>
            ) : null}
            <div
              className="text-muted-foreground flex flex-col gap-0.5 text-xs"
              data-testid="gcp-gps-diagnostics"
            >
              {gpsError ? (
                <span className="text-destructive" data-testid="gcp-gps-error">
                  Failed to read image GPS: {gpsError.message}
                </span>
              ) : gpsLoading ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Reading EXIF GPS… ({gpsReadyCount}/{imageNames.length})
                </span>
              ) : (
                <span>
                  GPS:{" "}
                  <span
                    className={
                      filteredGpsCount > 0 ? "" : "text-destructive"
                    }
                  >
                    {filteredGpsCount}/{imageNames.length} images
                  </span>
                </span>
              )}
              {filterExists && excludedNames.size > 0 ? (
                <span>
                  {excludedNames.size} image
                  {excludedNames.size === 1 ? "" : "s"} excluded by Image
                  Exclusion
                </span>
              ) : null}
              {activeGcp && closestImageStat && activeMode === "radius" && (
                <span>
                  closest image to{" "}
                  <span className="font-medium">{activeGcp.label}</span>:{" "}
                  <span
                    className={
                      closestImageStat.distM > activeRadius
                        ? "text-amber-600"
                        : "text-green-600"
                    }
                  >
                    {closestImageStat.distM < 1000
                      ? `${closestImageStat.distM.toFixed(1)} m`
                      : `${(closestImageStat.distM / 1000).toFixed(1)} km`}
                  </span>{" "}
                  ({closestImageStat.name})
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Always-visible map: image dots colored per owning GCP, GCP markers
          shown as ringed pins. Lasso (shift-drag / shift-click) edits the
          active GCP's image group when its mode is "map"; in radius mode
          the map is read-only (the lasso is a no-op). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Image map</CardTitle>
          <CardDescription>
            {activeGcp && activeMode === "map" ? (
              <>
                Shift-drag a box (or shift-click a dot) to assign images to{" "}
                <span
                  className="font-medium"
                  style={{ color: gcpColor(activeIdx) }}
                >
                  {activeGcp.label}
                </span>
                . Click a dot (no shift) for a preview.
              </>
            ) : activeGcp && activeMode === "radius" ? (
              <>
                Image dots within{" "}
                <span className="font-medium">{activeRadius} m</span> of{" "}
                <span
                  className="font-medium"
                  style={{ color: gcpColor(activeIdx) }}
                >
                  {activeGcp.label}
                </span>{" "}
                are highlighted. Switch to <em>Map-picker</em> to edit by lasso
                instead.
              </>
            ) : (
              <>
                Add a GCP above to start grouping images. Image dots will be
                colored by the GCP that claims them.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImageDotMap
            gpsMap={filteredGpsMap}
            imagesPrefix={imagesPrefix}
            selected={
              activeGcp && activeMode === "map"
                ? new Set(gcpImageGroups[activeGcp.label] ?? [])
                : new Set()
            }
            onSelectionChange={
              activeGcp && activeMode === "map"
                ? (next) => {
                    const sorted = Array.from(next).sort()
                    setGcpImageGroups((prev) => {
                      const updated = { ...prev, [activeGcp.label]: sorted }
                      // Mirror to sidecar for durable persistence.
                      void writeGroupsSidecar.mutateAsync(updated)
                      return updated
                    })
                  }
                : NOOP_SELECTION_CHANGE
            }
            mode="group"
            accentColor={activeGcp ? gcpColor(activeIdx) : undefined}
            extraMarkers={catalog
              .map((g, i) => ({ g, i }))
              .filter(({ g }) => g.lat != null && g.lon != null)
              .map(({ g, i }) => ({
                lat: g.lat as number,
                lon: g.lon as number,
                label: g.label,
                color: gcpColor(i),
              }))}
            dotColors={dotColors}
          />
        </CardContent>
      </Card>

      {/* Image viewer + slider */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Mark{" "}
            {activeGcp ? (
              <span className="text-muted-foreground text-sm font-normal">
                {activeGcp.label}
              </span>
            ) : null}{" "}
            on image
          </CardTitle>
          <CardDescription>
            Click to set the active GCP's pixel coordinate. Right-click a mark
            to remove it. One mark per (GCP × image); clicking again replaces
            the previous mark on the same pair.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {activeGcp && (activeGcp.lat == null || activeGcp.lon == null) ? (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              <span className="font-medium">{activeGcp.label}</span> has no
              survey coordinates yet. Enter Lat / Lon / Elevation in the boxes
              above and click <em>Save coords</em> before marking — they're
              required for ODM's bundle adjustment.
            </div>
          ) : null}
          {filteredImageNames.length === 0 ? (
            <div className="rounded border bg-muted/40 p-4 text-sm space-y-2">
              {activeGcp && activeMode === "map" ? (
                <p>
                  No images assigned to{" "}
                  <span className="font-medium">{activeGcp.label}</span> yet.
                  Shift-drag a box on the map above to add images, or switch
                  back to <em>Radius</em> mode if this GCP has coordinates.
                </p>
              ) : (
                <>
                  <p>
                    No images within{" "}
                    <span className="font-medium">{activeRadius} m</span> of{" "}
                    <span className="font-medium">
                      {activeGcp?.label ?? "this GCP"}
                    </span>
                    .
                  </p>
                  {closestImageStat && (
                    <p
                      className={
                        closestImageStat.distM > 1000
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }
                    >
                      Nearest image is{" "}
                      <span className="font-medium">
                        {closestImageStat.distM < 1000
                          ? `${closestImageStat.distM.toFixed(1)} m`
                          : `${(closestImageStat.distM / 1000).toFixed(1)} km`}
                      </span>{" "}
                      away ({closestImageStat.name}).{" "}
                      {closestImageStat.distM > 1000 &&
                        "That's huge — your CSV's Lat/Lon may be swapped or in the wrong CRS."}
                    </p>
                  )}
                  {activeGcp &&
                    closestImageStat &&
                    closestImageStat.distM < 10000 && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="text-primary underline"
                          onClick={() => {
                            const next = Math.max(
                              activeRadius * 2,
                              Math.ceil(closestImageStat.distM / 5) * 5,
                            )
                            setGcpRadii((prev) => ({
                              ...prev,
                              [activeGcp.label]: next,
                            }))
                          }}
                          data-testid="gcp-radius-double"
                        >
                          Bump radius to{" "}
                          {Math.max(
                            activeRadius * 2,
                            Math.ceil(closestImageStat.distM / 5) * 5,
                          )}{" "}
                          m
                        </button>
                      </div>
                    )}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={imageIndex === 0}
                  onClick={() => setImageIndex((i) => Math.max(0, i - 1))}
                  aria-label="Previous image"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1">
                  <div className="relative">
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, filteredImageNames.length - 1)}
                      value={imageIndex}
                      onChange={(e) => setImageIndex(Number(e.target.value))}
                      className="w-full"
                      data-testid="gcp-image-slider"
                      aria-label="Image slider"
                    />
                    {/* Diamond markers */}
                    <div className="pointer-events-none absolute top-full left-0 right-0 h-4">
                      {sliderDiamonds.map((d, i) => {
                        const pct =
                          filteredImageNames.length <= 1
                            ? 0
                            : (d.idx / (filteredImageNames.length - 1)) * 100
                        return (
                          <div
                            key={`${d.label}-${d.idx}-${i}`}
                            className="absolute -translate-x-1/2"
                            style={{ left: `${pct}%` }}
                            title={`${d.label} on ${filteredImageNames[d.idx]}`}
                          >
                            <div
                              className="h-2 w-2 rotate-45"
                              style={{ background: d.color }}
                            />
                            <div
                              className="text-[10px] leading-none"
                              style={{ color: d.color }}
                            >
                              {gcpShortLabel(d.label)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div className="text-muted-foreground mt-3 text-center text-xs">
                    {activeImageName} · image {imageIndex + 1} of{" "}
                    {filteredImageNames.length}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={imageIndex >= filteredImageNames.length - 1}
                  onClick={() =>
                    setImageIndex((i) =>
                      Math.min(filteredImageNames.length - 1, i + 1),
                    )
                  }
                  aria-label="Next image"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div
                className="relative bg-muted rounded border overflow-hidden"
                style={{ minHeight: 320 }}
                data-testid="gcp-image-viewer"
              >
                {imageBlobUrl ? (
                  <img
                    ref={imgRef}
                    src={imageBlobUrl}
                    alt={activeImageName}
                    className="block max-h-[60vh] w-full cursor-crosshair object-contain"
                    onClick={handleImageClick}
                    onContextMenu={handleImageContextMenu}
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-[40vh] items-center justify-center">
                    <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
                  </div>
                )}
                {/* Crosshair marks */}
                {imgRef.current &&
                  marksForActiveImage.map((m) => {
                    const i = catalog.findIndex((g) => g.label === m.label)
                    if (i < 0 || !imgRef.current) return null
                    const color = gcpColor(i)
                    const img = imgRef.current
                    const rect = img.getBoundingClientRect()
                    const containerRect =
                      img.parentElement?.getBoundingClientRect()
                    if (!containerRect) return null
                    const sx = rect.width / img.naturalWidth
                    const sy = rect.height / img.naturalHeight
                    const x = m.pixel_x * sx + (rect.left - containerRect.left)
                    const y = m.pixel_y * sy + (rect.top - containerRect.top)
                    return (
                      <div
                        key={m.label}
                        className="pointer-events-none absolute"
                        style={{ left: 0, top: 0 }}
                      >
                        {/* vertical line */}
                        <div
                          className="absolute"
                          style={{
                            left: x,
                            top: rect.top - containerRect.top,
                            width: 1,
                            height: rect.height,
                            background: color,
                            opacity: 0.6,
                          }}
                        />
                        {/* horizontal line */}
                        <div
                          className="absolute"
                          style={{
                            left: rect.left - containerRect.left,
                            top: y,
                            width: rect.width,
                            height: 1,
                            background: color,
                            opacity: 0.6,
                          }}
                        />
                        {/* ring */}
                        <div
                          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                          style={{
                            left: x,
                            top: y,
                            width: 14,
                            height: 14,
                            borderColor: color,
                          }}
                        />
                        {/* label badge */}
                        <div
                          className="absolute -translate-y-full rounded px-1 text-[10px] font-semibold text-white"
                          style={{
                            left: x + 8,
                            top: y - 4,
                            background: color,
                          }}
                        >
                          {gcpShortLabel(m.label)}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Footer: progress + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5 text-xs">
          <p className="text-muted-foreground">
            {marks.length} mark{marks.length === 1 ? "" : "s"} ·{" "}
            {labelsCovered.size}/{catalog.length} GCPs covered
          </p>
          {unmarkedLabels.length > 0 && labelsCovered.size > 0 && (
            <p className="text-amber-600">
              {unmarkedLabels.length} GCP
              {unmarkedLabels.length === 1 ? "" : "s"} will be skipped (no
              marks): {unmarkedLabels.slice(0, 4).join(", ")}
              {unmarkedLabels.length > 4
                ? `, +${unmarkedLabels.length - 4} more`
                : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button variant="outline" onClick={handleSkip} data-testid="gcp-skip">
            <SkipForward className="mr-1.5 h-3.5 w-3.5" />
            Skip
          </Button>
          <Button
            data-testid="gcp-save-and-complete"
            onClick={() => saveMutation.mutate()}
            disabled={!canSave || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save & complete
          </Button>
        </div>
      </div>
    </div>
  )
}
