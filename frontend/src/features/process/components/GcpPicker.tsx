/**
 * GcpPicker — interactive tool for marking ground control points.
 *
 * R5b MVP. Differences vs main's 1,308-LOC version:
 *   - GCP catalog (id, lon, lat, alt) lives client-side in runStore at
 *     the workspace level so it's reusable across runs. Main expected an
 *     auto-discovered `gcp_locations.csv`.
 *   - Per-image marks (pixel_x, pixel_y per GCP per image) live on the
 *     run's gcp_selection step (manualMarks).
 *   - Save serializes `gcp_list.txt` and uploads it to
 *     `Raw/{scope}/Images/gcp_list.txt` via FilesService.
 *   - Image candidate filtering (by GCP proximity to image GPS) is
 *     deferred — show all images.
 *
 * Important caveat: NodeODM auto-detects `gcp_list.txt` in its input
 * directory, but the GEMINIbase ODM worker's `_download_images` filters
 * for image extensions only, so the file is uploaded but **not yet
 * forwarded to NodeODM**. The marks will activate once the ODM worker
 * is updated to pass through `gcp_list.txt`. Until then this is a data-
 * collection step that survives client-side and lands in MinIO ready for
 * the worker change.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { type FileMetadata, FilesService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { AerialScope } from "@/features/process/lib/paths"
import { rawImagesPrefix } from "@/features/process/lib/paths"
import {
  type Run,
  setStepState,
  type Workspace,
} from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"
import { isLoggedIn } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"
const GCP_FILENAME = "gcp_list.txt"
const COLORS = [
  "#ef4444",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
] as const

export interface GcpCatalogEntry {
  id: string
  label: string
  lon: number
  lat: number
  alt: number
  color: string
}

export interface GcpMark {
  /** id in the workspace's GcpCatalog. */
  gcpId: string
  /** image filename (basename, no path). */
  image: string
  /** Pixel coordinate, top-left origin. */
  pixelX: number
  pixelY: number
}

interface GcpPickerProps {
  workspace: Workspace
  run: Run
  scope: AerialScope
  onSaved?: () => void
  onCancel?: () => void
}

// ── Catalog persistence (per workspace, separate from runStore) ─────────────

const CATALOG_KEY = (workspaceId: string) =>
  `gemini.process.workspace.${workspaceId}.gcpCatalog`

function loadCatalog(workspaceId: string): GcpCatalogEntry[] {
  try {
    const raw = localStorage.getItem(CATALOG_KEY(workspaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as GcpCatalogEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveCatalog(workspaceId: string, catalog: GcpCatalogEntry[]): void {
  try {
    localStorage.setItem(CATALOG_KEY(workspaceId), JSON.stringify(catalog))
  } catch {
    // Best-effort.
  }
}

// ── gcp_list.txt serialization ──────────────────────────────────────────────

/** OpenDroneMap GCP file format. Header is the EPSG code; rows follow. */
export function serializeGcpList(
  catalog: GcpCatalogEntry[],
  marks: GcpMark[],
): string {
  const lines: string[] = ["EPSG:4326"]
  const byId = new Map(catalog.map((g) => [g.id, g]))
  for (const m of marks) {
    const g = byId.get(m.gcpId)
    if (!g) continue
    // geo_x geo_y geo_z im_x im_y image_name gcp_label
    lines.push(
      `${g.lon} ${g.lat} ${g.alt} ${Math.round(m.pixelX)} ${Math.round(
        m.pixelY,
      )} ${m.image} ${g.label}`,
    )
  }
  return `${lines.join("\n")}\n`
}

// ── Component ───────────────────────────────────────────────────────────────

export function GcpPicker({
  workspace,
  run,
  scope,
  onSaved,
  onCancel,
}: GcpPickerProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()

  const [catalog, setCatalog] = useState<GcpCatalogEntry[]>(() =>
    loadCatalog(workspace.id),
  )
  useEffect(() => saveCatalog(workspace.id, catalog), [workspace.id, catalog])

  const [marks, setMarks] = useState<GcpMark[]>(
    () => ((run.steps.gcp_selection?.manualMarks ?? []) as GcpMark[]) ?? [],
  )
  // Persist marks on every change so a refresh keeps the work.
  useEffect(() => {
    const prev = (run.steps.gcp_selection?.manualMarks ?? []) as GcpMark[]
    if (JSON.stringify(prev) !== JSON.stringify(marks)) {
      setStepState(run.id, "gcp_selection", { manualMarks: marks })
    }
  }, [marks, run.id, run.steps.gcp_selection])

  const [activeGcpId, setActiveGcpId] = useState<string | null>(
    () => catalog[0]?.id ?? null,
  )
  const [imageIndex, setImageIndex] = useState(0)

  // Fetch the run's images.
  const imagesPrefix = rawImagesPrefix(scope)
  const imagesQuery = useQuery<FileMetadata[], Error>({
    queryKey: ["files", "list", imagesPrefix, "gcp-picker"],
    queryFn: async () => {
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${imagesPrefix}`,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: isLoggedIn(),
  })

  const images = useMemo(
    () =>
      (imagesQuery.data ?? []).filter((f) =>
        /\.(jpe?g|png|tif?f)$/i.test(f.object_name ?? ""),
      ),
    [imagesQuery.data],
  )
  const activeImage = images[imageIndex] ?? null
  const activeImageName = activeImage?.object_name?.split("/").pop() ?? ""

  // Authed image preview URL.
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!activeImage) {
      setImageBlobUrl(null)
      return
    }
    let cancelled = false
    let urlRef: string | null = null
    const token = localStorage.getItem("gemini.auth.token") ?? ""
    fetch(`/api/files/download/${DEFAULT_BUCKET}/${activeImage.object_name}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((b) => {
        if (cancelled) return
        urlRef = URL.createObjectURL(b)
        setImageBlobUrl(urlRef)
      })
      .catch(() => {
        if (!cancelled) setImageBlobUrl(null)
      })
    return () => {
      cancelled = true
      if (urlRef) URL.revokeObjectURL(urlRef)
    }
  }, [activeImage])

  // Catalog mutators.
  function addCatalogEntry() {
    const id = crypto.randomUUID()
    const color = COLORS[catalog.length % COLORS.length]
    const next: GcpCatalogEntry = {
      id,
      label: `GCP${catalog.length + 1}`,
      lon: 0,
      lat: 0,
      alt: 0,
      color,
    }
    setCatalog([...catalog, next])
    if (activeGcpId === null) setActiveGcpId(id)
  }
  function updateCatalogEntry(id: string, patch: Partial<GcpCatalogEntry>) {
    setCatalog(catalog.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  }
  function deleteCatalogEntry(id: string) {
    setCatalog(catalog.filter((g) => g.id !== id))
    setMarks(marks.filter((m) => m.gcpId !== id))
    if (activeGcpId === id) setActiveGcpId(null)
  }

  // Mark click.
  const imgRef = useRef<HTMLImageElement | null>(null)
  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!activeGcpId || !activeImageName) {
      showErrorToast("Pick a GCP from the catalog first.")
      return
    }
    const img = imgRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top) * scaleY
    // Replace any existing mark for this (gcpId, image) pair.
    setMarks([
      ...marks.filter(
        (m) => !(m.gcpId === activeGcpId && m.image === activeImageName),
      ),
      { gcpId: activeGcpId, image: activeImageName, pixelX: px, pixelY: py },
    ])
  }

  function deleteMarkAt(gcpId: string) {
    setMarks(
      marks.filter((m) => !(m.gcpId === gcpId && m.image === activeImageName)),
    )
  }

  const marksForActiveImage = useMemo(
    () => marks.filter((m) => m.image === activeImageName),
    [marks, activeImageName],
  )

  // Save: serialize, upload, mark step completed.
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (catalog.length === 0) {
        throw new Error("Add at least one GCP to the catalog first.")
      }
      if (marks.length === 0) {
        throw new Error("Mark at least one GCP location on an image.")
      }
      const text = serializeGcpList(catalog, marks)
      const blob = new Blob([text], { type: "text/plain" })
      const file = new File([blob], GCP_FILENAME, { type: "text/plain" })
      await FilesService.apiFilesUploadUploadFile({
        formData: {
          file,
          bucket_name: DEFAULT_BUCKET,
          object_name: `${imagesPrefix}${GCP_FILENAME}`,
        },
      })
    },
    onSuccess: () => {
      setStepState(run.id, "gcp_selection", {
        status: "completed",
        completedAt: new Date().toISOString(),
        manualMarks: marks,
        outputs: {
          ...(run.steps.gcp_selection?.outputs ?? {}),
          gcpListPath: `${imagesPrefix}${GCP_FILENAME}`,
          gcpCount: catalog.length,
          markCount: marks.length,
        },
      })
      queryClient.invalidateQueries({
        queryKey: ["files", "list", imagesPrefix],
      })
      showSuccessToast(`Uploaded gcp_list.txt with ${marks.length} marks`)
      onSaved?.()
    },
    onError: (err) =>
      showErrorToast(err instanceof Error ? err.message : "Failed to save"),
  })

  if (imagesQuery.isLoading) {
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">GCP catalog</CardTitle>
          <CardDescription>
            Each row is a real-world point. Rows persist per workspace and are
            reused across runs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="space-y-2" data-testid="gcp-catalog">
            {catalog.map((g) => (
              <div
                key={g.id}
                data-testid={`gcp-row-${g.id.slice(0, 8)}`}
                className={`grid grid-cols-[auto_1fr_1fr_1fr_1fr_auto_auto] items-center gap-2 rounded border p-2 ${
                  activeGcpId === g.id ? "border-primary bg-primary/5" : ""
                }`}
              >
                <button
                  type="button"
                  aria-label={`Activate ${g.label}`}
                  className="h-6 w-6 rounded-full border-2"
                  style={{ background: g.color, borderColor: g.color }}
                  onClick={() => setActiveGcpId(g.id)}
                />
                <Input
                  value={g.label}
                  onChange={(e) =>
                    updateCatalogEntry(g.id, { label: e.target.value })
                  }
                  className="h-8 text-sm"
                  aria-label={`${g.label} label`}
                />
                <Input
                  type="number"
                  step="0.000001"
                  value={g.lon}
                  onChange={(e) =>
                    updateCatalogEntry(g.id, {
                      lon: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="h-8 text-sm"
                  aria-label={`${g.label} lon`}
                  placeholder="lon"
                />
                <Input
                  type="number"
                  step="0.000001"
                  value={g.lat}
                  onChange={(e) =>
                    updateCatalogEntry(g.id, {
                      lat: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="h-8 text-sm"
                  aria-label={`${g.label} lat`}
                  placeholder="lat"
                />
                <Input
                  type="number"
                  step="0.01"
                  value={g.alt}
                  onChange={(e) =>
                    updateCatalogEntry(g.id, {
                      alt: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="h-8 text-sm"
                  aria-label={`${g.label} alt`}
                  placeholder="alt (m)"
                />
                <span className="text-muted-foreground text-xs">
                  {marks.filter((m) => m.gcpId === g.id).length} marks
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${g.label}`}
                  className="h-7 w-7 text-red-500"
                  onClick={() => deleteCatalogEntry(g.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={addCatalogEntry}
            data-testid="gcp-add"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add GCP
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Mark active GCP on image
            {activeGcpId && (
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                {catalog.find((g) => g.id === activeGcpId)?.label ?? ""}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            Click anywhere on the image to set the active GCP's pixel
            coordinate. One mark per (GCP × image); clicking again replaces the
            previous mark on the same pair.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={imageIndex === 0}
              onClick={() => setImageIndex((i) => Math.max(0, i - 1))}
              aria-label="Previous image"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex flex-col items-center gap-0.5">
              <Select
                value={String(imageIndex)}
                onValueChange={(v) => setImageIndex(Number(v))}
              >
                <SelectTrigger data-testid="gcp-image-select" className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {images.map((img, i) => {
                    const name = img.object_name?.split("/").pop() ?? ""
                    return (
                      <SelectItem key={img.object_name} value={String(i)}>
                        {name}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground text-xs">
                Image {imageIndex + 1} of {images.length}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={imageIndex >= images.length - 1}
              onClick={() =>
                setImageIndex((i) => Math.min(images.length - 1, i + 1))
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
                draggable={false}
              />
            ) : (
              <div className="flex h-[40vh] items-center justify-center">
                <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
              </div>
            )}
            {/* Overlay marks. Coordinates are in image pixels; rescale via
                the rendered image's bounding rect. */}
            {imgRef.current &&
              marksForActiveImage.map((m) => {
                const g = catalog.find((c) => c.id === m.gcpId)
                if (!g || !imgRef.current) return null
                const img = imgRef.current
                const rect = img.getBoundingClientRect()
                const containerRect = img.parentElement?.getBoundingClientRect()
                if (!containerRect) return null
                const scaleX = rect.width / img.naturalWidth
                const scaleY = rect.height / img.naturalHeight
                const x = m.pixelX * scaleX + (rect.left - containerRect.left)
                const y = m.pixelY * scaleY + (rect.top - containerRect.top)
                return (
                  <button
                    type="button"
                    key={m.gcpId}
                    aria-label={`Remove mark for ${g.label}`}
                    className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-background"
                    style={{
                      left: x,
                      top: y,
                      borderColor: g.color,
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteMarkAt(m.gcpId)
                    }}
                    title={`${g.label} — click to remove`}
                  />
                )
              })}
          </div>
          {marksForActiveImage.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">
                Marks on this image:
              </span>
              {marksForActiveImage.map((m) => {
                const g = catalog.find((c) => c.id === m.gcpId)
                if (!g) return null
                return (
                  <span
                    key={m.gcpId}
                    className="inline-flex items-center gap-1 rounded border px-2 py-0.5"
                    style={{ borderColor: g.color }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: g.color }}
                    />
                    {g.label} ({Math.round(m.pixelX)}, {Math.round(m.pixelY)})
                    <button
                      type="button"
                      onClick={() => deleteMarkAt(m.gcpId)}
                      aria-label={`Clear ${g.label} on this image`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {marks.length} mark{marks.length === 1 ? "" : "s"} across{" "}
          {new Set(marks.map((m) => m.image)).size} image(s).
        </p>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            data-testid="gcp-save-and-complete"
            onClick={() => saveMutation.mutate()}
            disabled={
              catalog.length === 0 ||
              marks.length === 0 ||
              saveMutation.isPending
            }
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save & complete step
          </Button>
        </div>
      </div>
    </div>
  )
}
