/**
 * DataSyncPanel — what the last Data Sync did: per image folder, how many
 * images got a position and from where (EXIF, a platform log, the other
 * sensor's track…).
 */
import { useQuery } from "@tanstack/react-query"

import { JobsService } from "@/client"

const SOURCE_LABELS: Record<string, string> = {
  exif: "own EXIF GPS",
  platform_log: "ArduPilot log",
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
  datasets?: Record<string, Record<string, number>>
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
        {result.platform_log_fixes
          ? ` · ${result.platform_log_fixes} ArduPilot log fixes`
          : ""}
      </p>
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
