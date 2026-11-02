/**
 * SaveThreshold — under a run's results: make the confidence threshold on
 * the slider the one its counts in Analyze use, and (in one click) the one
 * the same model's runs on the experiment's other dates use too.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Loader2, Save } from "lucide-react"
import { useMemo, useState } from "react"

import { type JobOutput, JobsService } from "@/client"
import { Button } from "@/components/ui/button"
import { loadActiveBoundaries } from "@/features/process/lib/activeBoundaries"
import {
  flightDate,
  flightDir,
  otherRuns,
  recountParams,
  thresholdOf,
} from "@/features/process/lib/recountThreshold"
import {
  appendStepJobId,
  findRunByJobId,
} from "@/features/process/lib/runStore"

type Params = Record<string, unknown>
const pathOf = (j: JobOutput) =>
  String(((j.parameters ?? {}) as Params).output_predictions_path ?? "")

export function SaveThreshold({
  job,
  threshold,
}: {
  job: JobOutput
  threshold: number
}) {
  const queryClient = useQueryClient()
  const t = Math.round(threshold * 100) / 100
  const ranAt = thresholdOf(job)
  const jobsQuery = useQuery({
    queryKey: ["jobs", "locate-completed"],
    queryFn: async () =>
      ((await JobsService.apiJobsAllGetAllJobs({
        jobType: "LOCATE_PLANTS",
        status: "COMPLETED",
        limit: 500,
      })) ?? []) as JobOutput[],
    staleTime: 30_000,
  })
  const others = useMemo(
    () => otherRuns(job, jobsQuery.data ?? []),
    [job, jobsQuery.data],
  )
  const [alsoOthers, setAlsoOthers] = useState(false)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "done"; sent: string[]; failed: string[] }
  >({ kind: "idle" })

  const targets = [
    job,
    ...(alsoOthers ? others.filter((j) => !skipped.has(String(j.id))) : []),
  ]
  const below = t < ranAt - 1e-9

  const save = async () => {
    setState({ kind: "saving" })
    const sent: string[] = []
    const failed: string[] = []
    for (const target of targets) {
      const date = flightDate(pathOf(target))
      try {
        const p = (target.parameters ?? {}) as Params
        const dir = flightDir(pathOf(target))
        const boundaries =
          (p.boundaries as GeoJSON.FeatureCollection | undefined) ??
          (dir ? await loadActiveBoundaries(dir) : undefined)
        if (!boundaries?.features?.length) {
          failed.push(`${date}: no plot boundaries saved for that flight`)
          continue
        }
        const res = (await JobsService.apiJobsSubmitSubmitJob({
          requestBody: {
            job_type: "LOCATE_PLANTS",
            parameters: recountParams(target, t, boundaries),
            experiment_id: target.experiment_id,
          } as Parameters<
            typeof JobsService.apiJobsSubmitSubmitJob
          >[0]["requestBody"],
        })) as JobOutput
        const id = String(res?.id ?? "")
        if (!id) throw new Error("no job id returned")
        // Listed with that date's run, beside the run it recounts.
        const run = findRunByJobId(String(target.id))
        if (run) appendStepJobId(run.id, "inference", id)
        sent.push(date)
      } catch (e) {
        failed.push(`${date}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    queryClient.invalidateQueries({ queryKey: ["jobs"] })
    setState({ kind: "done", sent, failed })
  }

  return (
    <div
      className="space-y-1.5 border-b px-3 py-2 text-xs"
      data-testid="save-threshold"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-muted-foreground">
          Counts in Analyze use ≥ {ranAt.toFixed(2)}.
        </span>
        <Button
          size="sm"
          className="h-7"
          disabled={state.kind === "saving"}
          onClick={() => void save()}
          data-testid="save-threshold-button"
        >
          {state.kind === "saving" ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-1 h-3.5 w-3.5" />
          )}
          Use ≥ {t.toFixed(2)} in Analyze
          {targets.length > 1 ? ` (${targets.length} dates)` : ""}
        </Button>
        {others.length > 0 && (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="accent-primary size-3.5"
              checked={alsoOthers}
              onChange={(e) => setAlsoOthers(e.target.checked)}
              data-testid="save-threshold-others"
            />
            Also this model's other {others.length} date
            {others.length === 1 ? "" : "s"} in the experiment
          </label>
        )}
      </div>
      {alsoOthers && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 pl-1">
          {others.map((j) => {
            const id = String(j.id)
            const at = thresholdOf(j)
            return (
              <label key={id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="accent-primary size-3.5"
                  checked={!skipped.has(id)}
                  onChange={(e) => {
                    const next = new Set(skipped)
                    if (e.target.checked) next.delete(id)
                    else next.add(id)
                    setSkipped(next)
                  }}
                />
                {flightDate(pathOf(j))}
                <span className="text-muted-foreground">
                  (now ≥ {at.toFixed(2)})
                </span>
              </label>
            )
          })}
        </div>
      )}
      {below && (
        <p className="text-amber-700 dark:text-amber-400">
          This run kept only detections ≥ {ranAt.toFixed(2)}: below that the
          count stays the same. Run the model again with a lower threshold to
          count more.
        </p>
      )}
      {state.kind === "done" && (
        <p
          className={
            state.failed.length
              ? "text-amber-700 dark:text-amber-400"
              : "text-green-700 dark:text-green-400"
          }
          data-testid="save-threshold-result"
        >
          {state.sent.length > 0 && (
            <>
              <Check className="mr-1 inline h-3.5 w-3.5" />
              Recounting at ≥ {t.toFixed(2)} for {state.sent.join(", ")}: the
              counts in Analyze are replaced when each finishes (it re-reads the
              saved detections; no model runs).{" "}
            </>
          )}
          {state.failed.length > 0 && `Not done: ${state.failed.join("; ")}.`}
        </p>
      )}
    </div>
  )
}
