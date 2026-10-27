/**
 * ExperimentRuns — every run, grouped as a person thinks of them: by
 * experiment and season, then one row per flight day (date, site, population,
 * platform, with every sensor flown), newest first. A day with several runs
 * (diurnal flights, treatments, thermal beside RGB) expands to them
 * (RunGroupList). Workspaces and pipelines stay available as the other view;
 * this one needs neither to find a run.
 */
import { useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"
import {
  type Pipeline,
  type Run,
  useAllPipelines,
  useAllRuns,
} from "@/features/process/lib/runStore"
import { RunGroupList } from "./RunGroupList"

export function ExperimentRuns() {
  const navigate = useNavigate()
  const runs = useAllRuns()
  const pipelines = useAllPipelines()
  const byId = useMemo(
    () => new Map<string, Pipeline>(pipelines.map((p) => [p.id, p])),
    [pipelines],
  )

  const sections = useMemo(() => {
    const exps = new Map<string, { experiment?: string; runs: Run[] }>()
    for (const r of runs) {
      const date = r.uploadScope?.date || r.createdAt.slice(0, 10)
      // An experiment runs over several seasons: one section per season.
      const key = r.uploadScope?.experiment
        ? `${r.uploadScope.experiment} · ${date.slice(0, 4)}`
        : "Runs without an upload"
      const e = exps.get(key) ?? {
        experiment: r.uploadScope?.experiment,
        runs: [],
      }
      e.runs.push(r)
      exps.set(key, e)
    }
    const latest = (rs: Run[]) =>
      rs
        .map((r) => r.uploadScope?.date || r.createdAt.slice(0, 10))
        .sort()
        .at(-1) ?? ""
    return [...exps.entries()].sort((a, b) =>
      latest(b[1].runs).localeCompare(latest(a[1].runs)),
    )
  }, [runs])

  if (runs.length === 0)
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No runs yet. Upload data in Files; each upload becomes a run here.
      </p>
    )

  return (
    <div className="space-y-6" data-testid="experiment-runs">
      {sections.map(([title, { experiment, runs: rs }]) => (
        <section key={title}>
          <h2 className="mb-2 text-base font-semibold">{title}</h2>
          <div className="rounded-lg border bg-card px-2 py-1">
            <RunGroupList
              runs={rs}
              experiment={experiment}
              typeOf={(r) =>
                byId.get(r.pipelineId)?.type === "ground" ? "ground" : "aerial"
              }
              onOpen={(r) =>
                navigate({
                  to: "/process/$workspaceId/run/$runId",
                  params: { workspaceId: r.workspaceId, runId: r.id },
                })
              }
            />
          </div>
        </section>
      ))}
    </div>
  )
}
