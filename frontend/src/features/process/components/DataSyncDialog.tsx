/**
 * DataSyncDialog — how the run's images get their positions (main's Data
 * Sync dialog):
 *
 *   Use own metadata     each image's EXIF GPS + time, replaced by a GPS
 *                        log uploaded for the same date and camera (a
 *                        drone's ArduPilot log, or a handheld GPS's GPX /
 *                        NMEA / CSV / RTK .pos track) at each capture time
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

/** File endings Data Sync reads as GPS logs (gemini/workers/geo/sync.py). */
const GPS_LOG = /\.(bin|log|tlog|gpx|nmea|pos|csv|txt)$/i
const NOT_LOGS = new Set(["msgs_synced.csv"])

/** GPS logs uploaded for these photos: files in the scope's Metadata/ folders. */
export function gpsLogs(files: FileMetadata[], scope: AerialScope): string[] {
  const own = rawScopePrefix(scope)
  return files
    .map((f) => f.object_name ?? "")
    .filter((n) => n.startsWith(own) && n.includes("/Metadata/"))
    .map((n) => n.split("/").pop() ?? "")
    .filter((name) => GPS_LOG.test(name) && !NOT_LOGS.has(name.toLowerCase()))
    .sort()
}

/** The camera clock's zone choices: hours ahead of UTC, or automatic. */
const CLOCK_ZONES = [
  -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 5.5, 6, 7, 8, 9,
  9.5, 10, 11, 12,
]
const zoneLabel = (h: number) =>
  h === 0
    ? "UTC"
    : `UTC${h > 0 ? "+" : "−"}${Math.floor(Math.abs(h))}${Math.abs(h) % 1 ? ":30" : ""}`

export interface DataSyncChoice {
  mode: "own_metadata" | "cross_sensor"
  sourceTrackPath?: string
  maxExtrapolationSec: number
  /** Seconds to add to capture times with no time zone; undefined = fitted. */
  clockOffsetSec?: number
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
  const logs = scope ? gpsLogs(listing.data ?? [], scope) : []
  const [mode, setMode] = useState<DataSyncChoice["mode"]>("own_metadata")
  const [source, setSource] = useState("")
  const [maxExt, setMaxExt] = useState(30)
  // "auto", or the camera clock's zone in hours ahead of UTC.
  const [clock, setClock] = useState<string>("auto")
  const matchesByTime =
    (mode === "own_metadata" && logs.length > 0) || mode === "cross_sensor"

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="data-sync-dialog">
        <DialogHeader>
          <DialogTitle>Data Sync</DialogTitle>
          <DialogDescription>
            Where each photo's position comes from. Plot marking, stitching and
            matching plots to their boundaries all use it.
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
            <p className="font-medium text-sm">
              The photos' own GPS, and GPS logs
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Each photo's GPS and capture time, as the camera wrote them (a
              phone does when location is on for its camera). A GPS log of the
              same date and camera, uploaded as GPS Logs, gives the position at
              each photo's capture time instead: a drone's ArduPilot log, or a
              GPX, NMEA, CSV or RTK .pos track from a phone app or a GPS
              receiver carried on the walk.
            </p>
            <p className="mt-1.5 text-xs" data-testid="data-sync-logs">
              {listing.isLoading ? (
                <span className="text-muted-foreground">
                  Looking for GPS logs…
                </span>
              ) : logs.length ? (
                <>
                  <span className="font-medium">
                    GPS log{logs.length === 1 ? "" : "s"} found:
                  </span>{" "}
                  {logs.join(", ")}
                </>
              ) : (
                <span className="text-muted-foreground">
                  No GPS log for these photos: their own GPS is used.
                </span>
              )}
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

        {matchesByTime && (
          <div
            className="flex flex-wrap items-center gap-2 text-xs"
            data-testid="data-sync-clock"
          >
            <label htmlFor="data-sync-clock" className="font-medium">
              Camera clock
            </label>
            <select
              id="data-sync-clock"
              className="border-input bg-background rounded-md border px-2 py-1 text-sm"
              value={clock}
              onChange={(e) => setClock(e.target.value)}
            >
              <option value="auto">Match to the GPS automatically</option>
              {CLOCK_ZONES.map((h) => (
                <option key={h} value={String(h)}>
                  Set to {zoneLabel(h)}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground basis-full">
              Photos are matched to the GPS by time. Phones record their time
              zone; many cameras keep local time without it, and are then
              shifted by the whole hours that line them up with the GPS.
            </span>
          </div>
        )}

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
                // A camera at UTC+h reads h hours ahead: take them off.
                clockOffsetSec:
                  matchesByTime && clock !== "auto"
                    ? -Number(clock) * 3600
                    : undefined,
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
