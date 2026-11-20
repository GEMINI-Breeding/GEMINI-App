/**
 * DataSyncPanel — what the last Data Sync did: per image folder, how many
 * images got a position and from where (EXIF, a platform log, the other
 * sensor's track…), and whether any altitudes had to be estimated.
 */
import { useQuery } from "@tanstack/react-query"

import { JobsService } from "@/client"

const SOURCE_LABELS: Record<string, string> = {
  exif: "own EXIF GPS",
  platform_log: "from the GPS log",
  interpolated: "interpolated from the source track",
  clamped: "clamped to the source track's end",
  own_gps: "own GPS (outside the track)",
  bundled: "the upload's own track",
  none: "no position",
}

interface SyncResult {
  mode?: string
  images?: number
  located?: number
  platform_log_fixes?: number
  /** GPS logs read (file name → fixes) and those that held no track. */
  gps_logs?: Record<string, number>
  gps_logs_unread?: string[]
  /** A ground run's photos with no GPS at all (paired with the field design). */
  no_positions?: boolean
  /** Per image folder: the camera clock shift applied to match the GPS. */
  clock_shift?: Record<string, { hours: number; how: string; images: number }>
  datasets?: Record<string, Record<string, number>>
  /** Located images whose altitude was estimated from the nearest image in
   * time, or that no image could supply (see sync.fill_missing_altitude). */
  altitude?: { estimated: number; missing: number }
}

export function DataSyncPanel({
  jobId,
  status,
}: {
  jobId: string | undefined
  /** The step's status — refetch once the job has finished. */
  status: string
}) {
  const job = useQuery({
    queryKey: ["job", jobId, "data-sync-result", status],
    queryFn: () => JobsService.apiJobsJobIdGetJob({ jobId: jobId as string }),
    enabled: Boolean(jobId),
  })
  const result = (job.data as { result?: SyncResult } | undefined)?.result
  if (!result?.datasets) return null
  return (
    <div className="space-y-1 text-xs" data-testid="data-sync-results">
      <p data-testid="data-sync-summary">
        {result.located} of {result.images} images have a position
        {result.mode === "cross_sensor" ? " (synced from another sensor)" : ""}
      </p>
      {result.gps_logs && Object.keys(result.gps_logs).length > 0 ? (
        <p data-testid="data-sync-gps-logs">
          GPS log
          {Object.keys(result.gps_logs).length === 1 ? "" : "s"}:{" "}
          {Object.entries(result.gps_logs)
            .map(([name, n]) => `${name} (${n} fixes)`)
            .join(", ")}
        </p>
      ) : result.platform_log_fixes ? (
        <p>{result.platform_log_fixes} GPS log fixes</p>
      ) : null}
      {result.gps_logs_unread?.length ? (
        <p className="text-amber-600">
          Not read as a GPS log (no times and positions found):{" "}
          {result.gps_logs_unread.join(", ")}
        </p>
      ) : null}
      {Object.values(result.clock_shift ?? {}).map((c, i) => (
        <p
          key={i}
          className="text-amber-600"
          data-testid="data-sync-clock-shift"
        >
          The camera's clock had no time zone: {c.images} photo
          {c.images === 1 ? "" : "s"} shifted by {c.hours > 0 ? "+" : ""}
          {c.hours} h ({c.how}) to line up with the GPS.
        </p>
      ))}
      {result.no_positions ? (
        <p
          className="text-sky-700 dark:text-sky-300"
          data-testid="data-sync-no-gps"
        >
          These photos have no GPS. That is fine: pair them with the field
          design in the Plot Images step — one photo per plot, or mark the
          walked plots first and use their raw frames with the field design.
        </p>
      ) : result.images &&
        result.located !== undefined &&
        result.located < result.images ? (
        <p className="text-amber-600" data-testid="data-sync-unlocated">
          {result.images - result.located} image
          {result.images - result.located === 1 ? " has" : "s have"} no
          position. Their own GPS is missing (on a phone, turn on location for
          the camera) and no GPS log covers their capture time: upload one as
          GPS Logs for this date and camera, then run Data Sync again.
        </p>
      ) : null}
      {result.altitude && result.altitude.missing > 0 ? (
        <p className="text-amber-600" data-testid="data-sync-altitude">
          No image has an altitude, so the orthomosaic places every camera at 0
          m: consistent, but its heights are relative, not above sea level.
        </p>
      ) : result.altitude && result.altitude.estimated > 0 ? (
        <p className="text-amber-600" data-testid="data-sync-altitude">
          {result.altitude.estimated} image
          {result.altitude.estimated === 1 ? " had" : "s had"} no altitude —
          estimated from the nearest image in time.
        </p>
      ) : null}
      {Object.entries(result.datasets).map(([prefix, counts]) => (
        <p key={prefix} className="text-muted-foreground">
          <span className="font-mono">
            {prefix.split("/").slice(-3, -1).join("/")}
          </span>
          :{" "}
          {Object.entries(counts)
            .filter(([k]) => k !== "images")
            // Stored as JSONB, whose key order isn't the worker's: biggest first.
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([k, n]) => `${n} ${SOURCE_LABELS[k] ?? k}`)
            .join(", ")}
        </p>
      ))}
    </div>
  )
}
