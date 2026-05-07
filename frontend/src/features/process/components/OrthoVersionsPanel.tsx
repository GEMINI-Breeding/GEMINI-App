/**
 * OrthoVersionsPanel — restored ortho version-management UI for RunDetail.
 *
 * Mirrors main's per-version table (Name / Created / Actions). Differences
 * from main, all driven by the GEMINIbase API surface:
 *   - Versions are derived client-side via buildOrthoVersions: each
 *     completed RUN_ODM job and each "import" registration becomes one row.
 *   - Rename labels live in runStore (`Run.steps.orthomosaic.outputs.versions[i].label`).
 *     There is no server-side rename endpoint.
 *   - Delete calls FilesService.delete on the underlying TIF (and the
 *     -Pyramid COG if present) rather than a pipeline-runs endpoint.
 *   - Preview shows download buttons; an embedded raster preview would
 *     need TiTiler integration which is deferred.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  Download,
  Eye,
  Loader2,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"
import type { FileMetadata } from "@/client"
import { FilesService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { OrthoMapView } from "@/features/process/components/OrthoMapView"
import {
  buildTitilerTileUrl,
  s3UrlForOrtho,
  tilejsonBoundsToLeaflet,
} from "@/features/process/lib/activeOrtho"
import {
  buildOrthoVersions,
  type OrthoVersion,
  type OrthoVersionMeta,
  readOrthoOutputs,
} from "@/features/process/lib/orthoVersions"
import type { AerialScope } from "@/features/process/lib/paths"
import { type Run, setStepState } from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"

const COG_SUFFIX = "-Pyramid.tif"
const DEFAULT_BUCKET = "gemini"

function downloadAuthed(filePath: string, suggestedName: string) {
  const token = localStorage.getItem("gemini.auth.token") ?? ""
  const url = `/api/files/download/${filePath}`
  // Use a transient anchor so Chrome triggers a save dialog with the
  // suggested filename. The bearer token can't be set on a plain GET via
  // <a>, so we fetch as Blob and rebuild the link. Acceptable for files
  // up to a few hundred MB; large GeoTIFFs may need a streaming path
  // later.
  void (async () => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Download failed: ${res.status}`)
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = objUrl
    a.download = suggestedName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objUrl)
  })()
}

function OrthoViewerDialog({
  open,
  onClose,
  version,
}: {
  open: boolean
  onClose: () => void
  version: OrthoVersion | null
}) {
  const v = version
  const s3Url = useMemo(() => (v ? s3UrlForOrtho(v) : null), [v])

  // TiTiler 2.0.1 tilejson endpoint. Same query key shape as
  // PlotBoundaryPrep so a user who already opened the boundary editor for
  // this ortho gets a cache hit when they re-open the viewer dialog.
  const tilejsonQuery = useQuery({
    queryKey: ["titiler", "tilejson", s3Url],
    queryFn: async () => {
      const res = await fetch(
        `/titiler/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(s3Url!)}&tilesize=256`,
      )
      if (!res.ok) throw new Error(`TiTiler tilejson failed: ${res.status}`)
      return res.json() as Promise<{
        tiles: string[]
        bounds: [number, number, number, number]
      }>
    },
    enabled: !!s3Url && open,
    staleTime: 5 * 60_000,
  })

  const orthoTileUrl = s3Url ? buildTitilerTileUrl(s3Url) : undefined
  const orthoBounds = useMemo(
    () =>
      tilejsonQuery.data?.bounds
        ? tilejsonBoundsToLeaflet(tilejsonQuery.data.bounds)
        : undefined,
    [tilejsonQuery.data],
  )

  if (!v) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {v.label ?? `Orthomosaic v${v.version}`}
            {v.label && (
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                v{v.version}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {v.createdAt
              ? `Generated ${new Date(v.createdAt).toLocaleString()}`
              : "Orthomosaic"}
            {v.source === "imported" && " · imported from upload"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {tilejsonQuery.isPending ? (
            <div
              className="bg-muted/30 flex h-[480px] w-full items-center justify-center rounded border text-sm"
              data-testid="ortho-viewer-loading"
            >
              <Loader2 className="text-muted-foreground mr-2 h-4 w-4 animate-spin" />
              <span className="text-muted-foreground">
                Building tile preview…
              </span>
            </div>
          ) : tilejsonQuery.isError ? (
            <Alert variant="destructive" data-testid="ortho-viewer-error">
              <AlertTitle>Couldn't load preview</AlertTitle>
              <AlertDescription>
                {tilejsonQuery.error instanceof Error
                  ? tilejsonQuery.error.message
                  : "Unknown error"}
                . The Download buttons below still work.
              </AlertDescription>
            </Alert>
          ) : (
            <OrthoMapView
              orthoTileUrl={orthoTileUrl}
              orthoBounds={orthoBounds}
            />
          )}
          <code className="bg-muted/40 block break-all rounded px-2 py-1 text-xs">
            {v.path}
          </code>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => downloadAuthed(v.path, v.filename)}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download GeoTIFF
          </Button>
          {v.hasCog && (
            <Button
              variant="outline"
              onClick={() => {
                const cogFilename = v.filename.replace(/\.tiff?$/i, COG_SUFFIX)
                const cogPath = v.path.replace(/\.tiff?$/i, COG_SUFFIX)
                downloadAuthed(cogPath, cogFilename)
              }}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download COG
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface OrthoVersionsPanelProps {
  run: Run
  scope: AerialScope | null
  files: FileMetadata[]
  onOpenImport: () => void
}

export function OrthoVersionsPanel({
  run,
  scope,
  files,
  onOpenImport,
}: OrthoVersionsPanelProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [editingName, setEditingName] = useState("")
  const [viewing, setViewing] = useState<OrthoVersion | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<OrthoVersion | null>(null)

  const versions = buildOrthoVersions(run, scope, files)

  function commitRename() {
    if (editingVersion === null) return
    const target = versions.find((v) => v.version === editingVersion)
    if (!target) {
      setEditingVersion(null)
      return
    }
    const meta: OrthoVersionMeta[] = readOrthoOutputs(run).map((m) => ({
      ...m,
    }))
    const idx = meta.findIndex((m) => m.filename === target.filename)
    const trimmed = editingName.trim()
    if (idx >= 0) {
      meta[idx].label = trimmed || undefined
    } else {
      // Legacy on-disk file with no metadata yet — register it.
      meta.push({
        filename: target.filename,
        label: trimmed || undefined,
        source: target.source,
        jobId: target.jobId,
        createdAt: target.createdAt ?? new Date().toISOString(),
      })
    }
    setStepState(run.id, "orthomosaic", {
      outputs: { ...(run.steps.orthomosaic?.outputs ?? {}), versions: meta },
    })
    setEditingVersion(null)
  }

  const deleteMutation = useMutation({
    mutationFn: async (v: OrthoVersion) => {
      // Delete the TIF.
      await FilesService.apiFilesDeleteFilePathDeleteFile({
        filePath: v.path,
      })
      // Best-effort: also delete the sibling COG. Failure is non-fatal —
      // the COG worker will be re-triggered if a new ortho lands.
      if (v.hasCog) {
        const cogPath = v.path.replace(/\.tiff?$/i, COG_SUFFIX)
        try {
          await FilesService.apiFilesDeleteFilePathDeleteFile({
            filePath: cogPath,
          })
        } catch {
          // ignore
        }
      }
    },
    onSuccess: (_, v) => {
      // Drop the metadata entry (if any) so we don't keep a dangling
      // label after the file is gone.
      const meta = readOrthoOutputs(run).filter(
        (m) => m.filename !== v.filename,
      )
      setStepState(run.id, "orthomosaic", {
        outputs: { ...(run.steps.orthomosaic?.outputs ?? {}), versions: meta },
        // If we just deleted the last version, flip the step back to pending
        // so the user can re-run / re-import. Otherwise leave it completed.
        ...(meta.length === 0
          ? { status: "pending" as const, completedAt: undefined }
          : {}),
      })
      queryClient.invalidateQueries({
        queryKey: [
          "files",
          "list",
          scope
            ? `${DEFAULT_BUCKET}/${v.path.split("/").slice(1, -1).join("/")}/`
            : null,
        ],
      })
      showSuccessToast(`Deleted ${v.label ?? v.filename}`)
      setConfirmDelete(null)
    },
    onError: (err) =>
      showErrorToast(
        err instanceof Error
          ? `Failed to delete: ${err.message}`
          : "Failed to delete",
      ),
  })

  if (versions.length === 0) {
    return (
      <div className="bg-muted/30 mt-2 flex items-center justify-between rounded border p-3 text-sm">
        <p className="text-muted-foreground">
          No orthomosaic on disk yet. Re-run the step or import an existing
          orthomosaic uploaded to this scope.
        </p>
        <Button size="sm" variant="outline" onClick={onOpenImport}>
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Import existing
        </Button>
      </div>
    )
  }

  return (
    <>
      <div
        className="mt-2 rounded-lg border"
        data-testid="ortho-versions-panel"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow
                key={v.filename}
                data-testid={`ortho-version-row-${v.version}`}
              >
                <TableCell className="font-medium">
                  {editingVersion === v.version ? (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        className="h-7 w-40 text-sm"
                        value={editingName}
                        placeholder={`v${v.version}`}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename()
                          if (e.key === "Escape") setEditingVersion(null)
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Save name"
                        className="h-6 w-6"
                        onClick={commitRename}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Cancel"
                        className="h-6 w-6"
                        onClick={() => setEditingVersion(null)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:underline"
                      onClick={() => {
                        setEditingVersion(v.version)
                        setEditingName(v.label ?? "")
                      }}
                      title="Click to rename"
                    >
                      <span>{v.label ?? `v${v.version}`}</span>
                      {v.label && (
                        <span className="text-muted-foreground text-xs">
                          v{v.version}
                        </span>
                      )}
                    </button>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {v.source === "imported" ? "imported" : "RUN_ODM"}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {v.createdAt ? new Date(v.createdAt).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`View ${v.label ?? `v${v.version}`}`}
                      className="h-7 w-7"
                      onClick={() => setViewing(v)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Rename ${v.label ?? `v${v.version}`}`}
                      className="h-7 w-7"
                      onClick={() => {
                        setEditingVersion(v.version)
                        setEditingName(v.label ?? "")
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${v.label ?? `v${v.version}`}`}
                      className="h-7 w-7 text-red-500 hover:text-red-600"
                      disabled={deleteMutation.isPending}
                      onClick={() => setConfirmDelete(v)}
                    >
                      {deleteMutation.isPending &&
                      deleteMutation.variables?.filename === v.filename ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="border-t p-2 text-right">
          <Button size="sm" variant="ghost" onClick={onOpenImport}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Import existing
          </Button>
        </div>
      </div>

      <OrthoViewerDialog
        open={viewing !== null}
        onClose={() => setViewing(null)}
        version={viewing}
      />

      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete orthomosaic version</DialogTitle>
            <DialogDescription>
              This will remove{" "}
              <strong>
                {confirmDelete?.label ?? `v${confirmDelete?.version}`}
              </strong>{" "}
              ({confirmDelete?.filename}) from MinIO. The COG sibling will be
              removed too. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() =>
                confirmDelete && deleteMutation.mutate(confirmDelete)
              }
            >
              {deleteMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
