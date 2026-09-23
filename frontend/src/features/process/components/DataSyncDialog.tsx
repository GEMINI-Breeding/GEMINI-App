/**
 * DataSyncDialog — how the run's images get their positions (main's Data
 * Sync dialog):
 *
 *   Use own metadata     each image's EXIF GPS + time, refined by any
 *                        ArduPilot logs uploaded to Metadata/
 *   Sync from another    positions interpolated from another sensor's
 *   sensor               synced track (same date and population) at each
 *                        image's capture time
 */
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { type FileMetadata, FilesService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DEFAULT_BUCKET } from "@/features/files/lib/download"
import { type AerialScope, rawScopePrefix } from "@/features/process/lib/paths"
import { isLoggedIn } from "@/lib/auth"

export interface SyncSource {
  path: string
  label: string
}

/** Synced tracks for the same date + population, not this scope's own. */
export function syncSources(
  files: FileMetadata[],
  scope: AerialScope,
): SyncSource[] {
  const datePrefix = `Raw/${scope.year}/${scope.experiment}/${scope.location}/${scope.population}/${scope.date}/`
  const own = rawScopePrefix(scope)
  return files
    .map((f) => f.object_name ?? "")
    .filter(
      (n) =>
        n.startsWith(datePrefix) &&
        !n.startsWith(own) &&
        n.endsWith("/msgs_synced.csv"),
    )
    .map((path) => {
      const [platform, sensor, dataset] = path
        .slice(datePrefix.length)
        .split("/")
      return { path, label: `${platform} / ${sensor} · dataset ${dataset}` }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

export interface DataSyncChoice {
  mode: "own_metadata" | "cross_sensor"
  sourceTrackPath?: string
  maxExtrapolationSec: number
}

export function DataSyncDialog({
  open,
  scope,
  busy,
  onClose,
  onStart,
}: {
  open: boolean
  scope: AerialScope | null
  busy: boolean
  onClose: () => void
  onStart: (choice: DataSyncChoice) => void
}) {
  const datePrefix = scope
    ? `Raw/${scope.year}/${scope.experiment}/${scope.location}/${scope.population}/${scope.date}/`
    : null
  const listing = useQuery<FileMetadata[]>({
    queryKey: ["files", "list", datePrefix],
    queryFn: async () =>
      ((await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${datePrefix}`,
      })) as FileMetadata[] | null) ?? [],
    enabled: open && isLoggedIn() && Boolean(datePrefix),
  })
  const sources = scope ? syncSources(listing.data ?? [], scope) : []
  const [mode, setMode] = useState<DataSyncChoice["mode"]>("own_metadata")
  const [source, setSource] = useState("")
  const [maxExt, setMaxExt] = useState(30)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="data-sync-dialog">
        <DialogHeader>
          <DialogTitle>Data Sync</DialogTitle>
          <DialogDescription>
            Choose how to assign GPS coordinates to your images.
          </DialogDescription>
        </DialogHeader>

        <label className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-lg border p-4">
          <input
            type="radio"
            name="syncMode"
            checked={mode === "own_metadata"}
            onChange={() => setMode("own_metadata")}
            className="accent-primary mt-0.5"
            aria-label="Use own metadata"
          />
          <div>
            <p className="font-medium text-sm">Use own metadata</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Each image's own EXIF GPS and capture time. ArduPilot logs
              uploaded to this date's Metadata refine the positions (and give
              height above ground when the drone has a rangefinder).
            </p>
          </div>
        </label>

        <label className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-lg border p-4">
          <input
            type="radio"
            name="syncMode"
            checked={mode === "cross_sensor"}
            onChange={() => setMode("cross_sensor")}
            disabled={sources.length === 0}
            className="accent-primary mt-0.5"
            aria-label="Sync from another sensor"
          />
          <div className="flex-1">
            <p
              className={`font-medium text-sm ${sources.length ? "" : "text-muted-foreground"}`}
            >
              Sync from another sensor
              {sources.length === 0 && (
                <span className="text-muted-foreground ml-2 font-normal text-xs">
                  {listing.isLoading
                    ? "(looking…)"
                    : "(no synced track on this date)"}
                </span>
              )}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Interpolate positions from another sensor's synced track (e.g. the
              Amiga's RTK GPS) at each image's capture time. No images are
              dropped.
            </p>
            {mode === "cross_sensor" && sources.length > 0 && (
              <div className="mt-3 space-y-2">
                <select
                  aria-label="Source track"
                  data-testid="data-sync-source"
                  className="border-input bg-background w-full rounded-md border px-3 py-1.5 text-sm"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="">— Select a source track —</option>
                  {sources.map((s) => (
                    <option key={s.path} value={s.path}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <label
                    className="text-muted-foreground whitespace-nowrap text-xs"
                    htmlFor="data-sync-max-ext"
                  >
                    Out-of-range threshold
                  </label>
                  <input
                    id="data-sync-max-ext"
                    type="number"
                    min={0}
                    max={3600}
                    step={5}
                    value={maxExt}
                    onChange={(e) => setMaxExt(Number(e.target.value))}
                    className="border-input bg-background w-20 rounded-md border px-2 py-1 text-sm"
                  />
                  <span className="text-muted-foreground text-xs">seconds</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  Images within this window of the track's start or end get its
                  nearest position; images beyond it keep their own EXIF GPS.
                </p>
              </div>
            )}
          </div>
        </label>

        {mode === "cross_sensor" && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 text-xs">
            Works best when both sensors rode the same platform during the same
            pass, with clocks in agreement.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="data-sync-start"
            disabled={busy || (mode === "cross_sensor" && !source)}
            onClick={() =>
              onStart({
                mode,
                sourceTrackPath: mode === "cross_sensor" ? source : undefined,
                maxExtrapolationSec: maxExt,
              })
            }
          >
            Start Sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
