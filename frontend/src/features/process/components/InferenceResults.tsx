/**
 * InferenceResults — every inference job recorded on a run, from this screen
 * or from the agent, grouped by the model that ran it.
 *
 * For each model: how many plots it counted and the average count of its
 * latest finished job, earlier jobs below it, and a button that opens a job's
 * results right under it (InferenceJobView). A model the pipeline does not list yet (one
 * the agent chose) can be added to it in one click, so it can be run again
 * by hand.
 */
import { useQueries } from "@tanstack/react-query"
import { Bot, Eye, EyeOff, Plus } from "lucide-react"
import { useState } from "react"

import { type JobOutput, JobsService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { InferenceJobView } from "@/features/process/components/InferenceJobView"
import {
  type InferenceModel,
  modelDisplayName,
  modelFromJobParams,
  modelKey,
  sameModel,
  sourceLabel,
} from "@/features/process/lib/inferenceModels"
import {
  isBatchInferenceResult,
  summaryRows,
} from "@/features/process/lib/inferenceSummary"
import type { Run } from "@/features/process/lib/runStore"

interface Group {
  model: InferenceModel | null
  name: string
  jobs: JobOutput[]
}

function when(j: JobOutput): string {
  const t = (j as { created_at?: string }).created_at
  return t ? new Date(t).toLocaleString() : ""
}

function counted(j: JobOutput): string {
  const r = (j as { result?: unknown }).result
  if (!isBatchInferenceResult(r)) {
    const p = (j.parameters ?? {}) as { image_path?: string }
    return p.image_path ? `one image (${p.image_path.split("/").pop()})` : ""
  }
  const rows = summaryRows(r).filter((x) => x.count != null)
  if (!rows.length) return "no plots counted"
  const task = (j.parameters as { task_type?: string } | null)?.task_type
  if (task === "classification") return `${rows.length} plots labelled`
  const mean = rows.reduce((a, x) => a + (x.count ?? 0), 0) / rows.length
  return `${rows.length} plots, mean ${mean.toFixed(1)} per plot`
}

const STATUS: Record<string, string> = {
  COMPLETED: "bg-green-500/10 text-green-700",
  FAILED: "bg-red-500/10 text-red-700",
  RUNNING: "bg-blue-500/10 text-blue-700",
  PENDING: "bg-gray-500/10 text-gray-700",
}

export function InferenceResults({
  run,
  configured,
  onAddModel,
}: {
  run: Run
  /** The pipeline's models; others found in jobs get "Add to pipeline". */
  configured: InferenceModel[]
  onAddModel: (m: InferenceModel) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const ids = run.steps.inference?.jobIds ?? []
  const jobs = useQueries({
    queries: ids.map((jobId) => ({
      queryKey: ["jobs", jobId],
      queryFn: async () =>
        (await JobsService.apiJobsJobIdGetJob({ jobId })) as JobOutput,
      staleTime: 30_000,
    })),
  })
  const loaded = jobs
    .map((q) => q.data)
    .filter((j): j is JobOutput => Boolean(j))
    .sort((a, b) => when(b).localeCompare(when(a)))

  if (ids.length === 0) return null

  const groups: Group[] = []
  for (const j of loaded) {
    const m = modelFromJobParams(
      (j.parameters ?? {}) as Record<string, unknown>,
    )
    const g = groups.find((x) =>
      m && x.model ? sameModel(m, x.model) : !m && !x.model,
    )
    if (g) g.jobs.push(j)
    else
      groups.push({
        model: m,
        name: m ? modelDisplayName(m) : "Unknown model",
        jobs: [j],
      })
  }

  return (
    <Card data-testid="inference-results">
      <CardHeader>
        <CardTitle className="text-base">Results on this run</CardTitle>
        <CardDescription>
          {groups.length} model{groups.length === 1 ? "" : "s"} · {ids.length}{" "}
          job{ids.length === 1 ? "" : "s"}, newest first. Per-plot counts are
          also in Analyze, one trait per model.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loaded.length < ids.length && (
          <p className="text-muted-foreground text-xs">Loading jobs…</p>
        )}
        {groups.map((g) => {
          const listed = g.model
            ? configured.some((c) => sameModel(c, g.model as InferenceModel))
            : true
          return (
            <div
              key={`${g.name}-${g.model ? modelKey(g.model) : ""}`}
              className="rounded-md border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{g.name}</span>
                {g.model && (
                  <span className="text-muted-foreground text-xs">
                    {sourceLabel(g.model.source)} · {g.model.task_type}
                  </span>
                )}
                {!listed && g.model && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-7"
                    data-testid="inference-add-model"
                    title="Not in this pipeline's model list (the agent chose it). Add it to run it again from here."
                    onClick={() => onAddModel(g.model as InferenceModel)}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    <Plus className="h-3.5 w-3.5" /> Add to pipeline
                  </Button>
                )}
              </div>
              <ul className="mt-2 space-y-1">
                {g.jobs.map((j) => (
                  <li key={j.id}>
                    <div
                      className={`flex flex-wrap items-center gap-2 rounded px-1 text-xs ${
                        open === String(j.id) ? "bg-primary/10" : ""
                      }`}
                    >
                      <Badge
                        variant="secondary"
                        className={STATUS[String(j.status)] ?? ""}
                      >
                        {String(j.status).toLowerCase()}
                      </Badge>
                      <span className="text-muted-foreground">{when(j)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {j.status === "FAILED"
                          ? String(
                              (j as { error_message?: string | null })
                                .error_message ?? "failed",
                            ).slice(0, 160)
                          : counted(j)}
                      </span>
                      {j.status === "COMPLETED" && (
                        <Button
                          size="sm"
                          variant={
                            open === String(j.id) ? "secondary" : "outline"
                          }
                          className="h-6 px-2"
                          data-testid="inference-show-job"
                          onClick={() =>
                            setOpen((o) =>
                              o === String(j.id) ? null : String(j.id),
                            )
                          }
                        >
                          {open === String(j.id) ? (
                            <>
                              <EyeOff className="h-3.5 w-3.5" /> Hide
                            </>
                          ) : (
                            <>
                              <Eye className="h-3.5 w-3.5" /> View results
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                    {open === String(j.id) && (
                      <InferenceJobView
                        job={j}
                        modelName={g.name}
                        onClose={() => setOpen(null)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
