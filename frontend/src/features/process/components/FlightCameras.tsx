/**
 * FlightCameras — one flight, several cameras, processed as one run.
 *
 * On an RGB run: the other cameras of the same flight (thermal beside RGB),
 * whose uploads fold into this run. Their frames go into this run's plot
 * images from the raw frames, with nothing else to do; each can also have its
 * own orthomosaic, built from here.
 *
 * On another camera's run that folds into an RGB run: says so, links to that
 * run, and that the steps here only build this camera's orthomosaic.
 */
import { useNavigate } from "@tanstack/react-router"
import { Camera, Info, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useBatchLabels } from "@/features/process/hooks/useBatchLabels"
import {
  companionRunsOf,
  primaryRunOf,
} from "@/features/process/lib/companionRuns"
import { type Run, useAllRuns } from "@/features/process/lib/runStore"

/** Frames a run's upload holds, when the upload recorded it. */
function uploadedFiles(run: Run): number | null {
  const n = run.steps?.data_sync?.outputs?.files
  return typeof n === "number" ? n : null
}

const ORTHO_STATUS: Record<string, string> = {
  completed: "orthomosaic built",
  running: "orthomosaic building…",
  failed: "orthomosaic failed",
  skipped: "no orthomosaic",
}

export function FlightCameras({
  run,
  building,
  onBuildOrtho,
}: {
  run: Run
  /** The run whose orthomosaic is being started (one at a time). */
  building?: string | null
  /** Start another camera's orthomosaic (its own run records the job). */
  onBuildOrtho: (companion: Run) => void
}) {
  const navigate = useNavigate()
  const runs = useAllRuns()
  const labels = useBatchLabels(run.uploadScope?.experiment)
  const open = (r: Run) =>
    navigate({
      to: "/process/$workspaceId/run/$runId",
      params: { workspaceId: r.workspaceId, runId: r.id },
    })

  const primary = primaryRunOf(run, runs, labels)
  if (primary)
    return (
      <div
        className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/40"
        data-testid="flight-cameras-folded"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <div className="space-y-1">
          <p>
            These {run.uploadScope?.sensor} frames belong to the flight of the{" "}
            <button
              type="button"
              className="font-medium underline"
              onClick={() => open(primary)}
            >
              {primary.uploadScope?.sensor} run
              {primary.uploadScope?.batchLabel
                ? ` (${primary.uploadScope.batchLabel})`
                : ""}
            </button>
            , and are processed there: its plot images from the raw frames
            include them, matched by capture time (a thermal camera also gives
            each plot's canopy temperature).
          </p>
          <p className="text-muted-foreground">
            Nothing here needs doing for that. The steps below only build a{" "}
            {run.uploadScope?.sensor} orthomosaic, if you want one.
          </p>
        </div>
      </div>
    )

  const companions = companionRunsOf(run, runs, labels)
  if (companions.length === 0) return null

  // One row per camera. A flight split by treatment uploads each camera once
  // per treatment: those uploads are parts of one camera, listed in its row.
  const bySensor = new Map<string, Run[]>()
  for (const c of companions) {
    const key = c.uploadScope?.sensor ?? "Other camera"
    bySensor.set(key, [...(bySensor.get(key) ?? []), c])
  }
  const total = (rs: Run[]) => {
    const ns = rs.map(uploadedFiles)
    return ns.every((n) => n != null)
      ? ns.reduce<number>((a, n) => a + (n ?? 0), 0)
      : null
  }
  const thisSensor = run.uploadScope?.sensor ?? "RGB"
  const thisFiles = uploadedFiles(run)
  const treatments = Array.from(
    new Set(companions.map((c) => c.uploadScope?.batchLabel).filter(Boolean)),
  ) as string[]

  return (
    <div
      className="rounded-md border px-3 py-2 text-xs"
      data-testid="flight-cameras"
    >
      <div
        className="mb-1.5 flex items-center gap-1.5 font-medium"
        title="Processed as one run. The other cameras' frames go into the plot images from the raw frames (matched to these frames by capture time, cut per plot; a thermal camera also gives canopy temperature). An orthomosaic of each is optional."
      >
        <Camera className="h-3.5 w-3.5" /> Cameras of this flight
        <span className="font-normal text-muted-foreground">
          · processed together as this run
          {treatments.length > 1
            ? ` · flown in ${treatments.length} parts (${treatments.join(", ")})`
            : ""}
        </span>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
        <span className="font-medium">{thisSensor}</span>
        <span className="text-muted-foreground">
          this run{thisFiles != null ? ` · ${thisFiles} images` : ""} ·
          orthomosaic, plot boundaries and traits below
        </span>
        {Array.from(bySensor.entries()).map(([sensor, parts]) => {
          const n = total(parts)
          return (
            <div key={sensor} className="contents" data-testid="flight-camera">
              <span className="font-medium">{sensor}</span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-muted-foreground">
                  {n != null ? `${n} frames` : "uploaded"} · matched by time
                  into the plot images
                  {/thermal/i.test(sensor) ? " and canopy temperature" : ""}
                </span>
                <span className="text-muted-foreground">
                  Orthomosaic (optional):
                </span>
                {parts.map((c) => {
                  const ortho = c.steps?.orthomosaic?.status
                  const label = c.uploadScope?.batchLabel
                  const busy = building === c.id || ortho === "running"
                  return (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5"
                      data-testid="flight-camera-part"
                      title={`${uploadedFiles(c) ?? "?"} frames${label ? ` · ${label}` : ""}${ortho && ORTHO_STATUS[ortho] ? ` · ${ORTHO_STATUS[ortho]}` : ""}`}
                    >
                      {parts.length > 1 && (
                        <span>
                          {label ?? "part"}
                          {uploadedFiles(c) != null && (
                            <span className="text-muted-foreground">
                              {" "}
                              {uploadedFiles(c)}
                            </span>
                          )}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-xs"
                        disabled={busy}
                        onClick={() => onBuildOrtho(c)}
                      >
                        {busy && (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        )}
                        {ortho === "completed"
                          ? "Rebuild"
                          : ortho === "running"
                            ? "Building…"
                            : "Build"}
                      </Button>
                      {ortho === "completed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-xs"
                          onClick={() => open(c)}
                        >
                          View
                        </Button>
                      )}
                    </span>
                  )
                })}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
