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
import { Bot, ChevronDown, Eye, EyeOff, Plus } from "lucide-react"
import { type ReactNode, useState } from "react"

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  const p = (j.parameters ?? {}) as {
    recount?: boolean
    confidence_threshold?: number
  }
  const again = p.recount
    ? `recounted at ≥ ${(p.confidence_threshold ?? 0).toFixed(2)} · `
    : ""
  const task = (j.parameters as { task_type?: string } | null)?.task_type
  if (task === "classification") return `${rows.length} plots labelled`
  const mean = rows.reduce((a, x) => a + (x.count ?? 0), 0) / rows.length
  return `${again}${rows.length} plots, mean ${mean.toFixed(1)} per plot`
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
  actions,
  onLabelBlank,
}: {
  run: Run
  /** The pipeline's models; others found in jobs get "Add to pipeline". */
  configured: InferenceModel[]
  onAddModel: (m: InferenceModel) => void
  /** Controls on the card's title line (run a model, set up models). */
  actions?: ReactNode
  /** "Label & train" from a blank start (no model's detections). Without it,
   *  the card shows no Label & train control. */
  onLabelBlank?: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  // The job whose detections a labelling session starts from (opens its
  // results straight in labelling mode).
  const [labelFrom, setLabelFrom] = useState<string | null>(null)
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

  // Detection results over many plots: each can seed a labelling session
  // (correcting a model is quicker than labelling from nothing).
  const seeds = groups.flatMap((g) =>
    g.jobs
      .filter((j) => {
        const p = (j.parameters ?? {}) as { task_type?: string }
        return (
          j.status === "COMPLETED" &&
          p.task_type !== "classification" &&
          isBatchInferenceResult((j as { result?: unknown }).result)
        )
      })
      .map((j) => ({ job: j, name: g.name })),
  )
  const labelControl = !onLabelBlank ? null : seeds.length === 0 ? (
    <Button
      size="sm"
      variant="outline"
      className="h-7"
      title="Label objects on the plot images (by hand, by example or by description) and train a model from them"
      onClick={onLabelBlank}
    >
      Label &amp; train
    </Button>
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          data-testid="inference-label-menu"
          title="Label objects on the plot images and train a model from them: start from a model's detections (correct them) or from nothing"
        >
          Label &amp; train <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-sm">
        <DropdownMenuLabel className="text-xs">
          Start from a model's detections
        </DropdownMenuLabel>
        {seeds.slice(0, 8).map(({ job, name }) => (
          <DropdownMenuItem
            key={String(job.id)}
            className="text-xs"
            onSelect={() => {
              setLabelFrom(String(job.id))
              setOpen(String(job.id))
            }}
          >
            <span className="font-medium">{name}</span>
            <span className="text-muted-foreground ml-1 truncate">
              {when(job)} · {counted(job)}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs" onSelect={onLabelBlank}>
          Start blank (by hand, by example or by description)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <Card className="gap-2 py-3" data-testid="inference-results">
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <CardTitle className="text-base">Results on this run</CardTitle>
          <CardDescription>
            {groups.length} model{groups.length === 1 ? "" : "s"} · {ids.length}{" "}
            job{ids.length === 1 ? "" : "s"}, newest first · per-plot counts are
            in Analyze too
          </CardDescription>
          {(actions || labelControl) && (
            <div className="ml-auto flex gap-2">
              {actions}
              {labelControl}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
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
                          onClick={() => {
                            setLabelFrom(null)
                            setOpen((o) =>
                              o === String(j.id) ? null : String(j.id),
                            )
                          }}
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
                        key={`${j.id}-${labelFrom === String(j.id) ? "label" : "view"}`}
                        job={j}
                        modelName={g.name}
                        startLabeling={labelFrom === String(j.id)}
                        onClose={() => {
                          setOpen(null)
                          setLabelFrom(null)
                        }}
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
