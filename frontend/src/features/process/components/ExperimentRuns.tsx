/**
 * ExperimentRuns — every run, grouped as a person thinks of them: by
 * experiment, then by collection date, newest first. Each row says the kind
 * of data (ground or drone), where the run stands in a few words (the step
 * now due, running, or failed), and carries the agent mark when the agent
 * started it. Workspaces and pipelines stay available as the other view; this
 * one needs neither to find a run.
 */
import { useNavigate } from "@tanstack/react-router"
import { Navigation, Plane } from "lucide-react"
import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { useProcess } from "@/contexts/ProcessContext"
import {
  runState,
  TAG_CLASS,
  TAG_HINT,
  TAG_LABEL,
} from "@/features/process/lib/runStatus"
import {
  type Pipeline,
  type Run,
  useAllPipelines,
  useAllRuns,
} from "@/features/process/lib/runStore"
import { AgentRunMark } from "./AgentRunMark"

export function ExperimentRuns() {
  const navigate = useNavigate()
  const runs = useAllRuns()
  const pipelines = useAllPipelines()
  const { queuedJobIds } = useProcess()
  const byId = useMemo(
    () => new Map<string, Pipeline>(pipelines.map((p) => [p.id, p])),
    [pipelines],
  )

  const groups = useMemo(() => {
    const exps = new Map<string, Map<string, Run[]>>()
    for (const r of runs) {
      const date = r.uploadScope?.date || r.createdAt.slice(0, 10)
      // An experiment runs over several seasons: one section per season.
      const exp = r.uploadScope?.experiment
        ? `${r.uploadScope.experiment} · ${date.slice(0, 4)}`
        : "Runs without an upload"
      const dates = exps.get(exp) ?? new Map<string, Run[]>()
      dates.set(date, [...(dates.get(date) ?? []), r])
      exps.set(exp, dates)
    }
    // Experiments with the most recent date first; dates newest first.
    return [...exps.entries()]
      .map(([exp, dates]) => ({
        exp,
        dates: [...dates.entries()].sort((a, b) => b[0].localeCompare(a[0])),
      }))
      .sort((a, b) => b.dates[0][0].localeCompare(a.dates[0][0]))
  }, [runs])

  if (runs.length === 0)
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No runs yet. Upload data in Files; each upload becomes a run here.
      </p>
    )

  return (
    <div className="space-y-6" data-testid="experiment-runs">
      {groups.map(({ exp, dates }) => (
        <section key={exp}>
          <h2 className="mb-2 text-base font-semibold">{exp}</h2>
          <div className="divide-y rounded-lg border bg-card">
            {dates.map(([date, rows]) => (
              <div key={date} className="flex gap-4 px-4 py-2">
                <div className="w-24 shrink-0 pt-1.5 text-sm text-muted-foreground">
                  {date}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  {rows.map((run) => {
                    const pipe = byId.get(run.pipelineId)
                    const type = pipe?.type === "ground" ? "ground" : "aerial"
                    const Icon = type === "ground" ? Navigation : Plane
                    const scope = run.uploadScope
                    const state = runState(run, type, queuedJobIds)
                    return (
                      <button
                        type="button"
                        key={run.id}
                        data-testid="experiment-run-row"
                        className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
                        onClick={() =>
                          navigate({
                            to: "/process/$workspaceId/run/$runId",
                            params: {
                              workspaceId: run.workspaceId,
                              runId: run.id,
                            },
                          })
                        }
                      >
                        <Icon
                          className={`h-4 w-4 shrink-0 ${type === "ground" ? "text-green-600" : "text-blue-600"}`}
                          aria-label={type === "ground" ? "Ground" : "Drone"}
                        />
                        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                          <span className="truncate">
                            {[
                              scope?.location,
                              scope?.platform,
                              scope?.sensor,
                              scope?.batchLabel,
                            ]
                              .filter(Boolean)
                              .join(" · ") ||
                              run.name ||
                              `Run ${run.id.slice(0, 8)}`}
                          </span>
                          <AgentRunMark run={run} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {state.detail}
                          {pipe ? ` · ${pipe.name}` : ""}
                        </span>
                        <Badge
                          variant="secondary"
                          className={TAG_CLASS[state.tag]}
                          title={TAG_HINT[state.tag]}
                        >
                          {TAG_LABEL[state.tag]}
                        </Badge>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
