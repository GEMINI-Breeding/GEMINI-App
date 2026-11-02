/**
 * BatchRunDialog — "Run across dates" from a pipeline's run list: pick the
 * steps (a quick orthomosaic for raw-frame plot images, plot images, initial
 * trait extraction with its defaults, inference with a model per crop), see
 * for every date whether each is done, will run, runs after another, or
 * needs something from you first, and start them all at once. Dates where a
 * step is done are skipped unless "Run again where done" is ticked. Steps
 * waiting on another (inference after that date's plot images) start when it
 * finishes, while the app is open (BatchRunner).
 */
import { useQueries, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  Loader2,
  Play,
  TriangleAlert,
} from "lucide-react"
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"

import { type JobOutput, JobsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"
import {
  BATCH_STEPS,
  type BatchOptions,
  type BatchStep,
  type CellState,
  DEFAULT_SOURCES,
  type ImageSource,
  modelsToRun,
  planDate,
  SOURCE_LABELS,
  STEP_LABELS,
} from "../lib/batchPlan"
import {
  type QueuedStep,
  queueSnapshot,
  readQueue,
  subscribeQueue,
  writeQueue,
} from "../lib/batchQueue"
import { gatherFacts, runScope, startStep } from "../lib/batchSubmit"
import {
  type InferenceModel,
  modelDisplayName,
  modelKey,
  normalizeModel,
} from "../lib/inferenceModels"
import { type Pipeline, type Run, updatePipeline } from "../lib/runStore"
import { workBatchQueue } from "./BatchRunner"

const NONE = "__none__"

const STEP_HINTS: Record<BatchStep, string> = {
  quick_ortho:
    "A fast, low-resolution orthomosaic per flight, only to place the raw frames (camera positions) for raw-frame plot images. Not used for traits.",
  plot_images:
    "One image per plot, for inference and the plot viewer. Treatments flown apart: each plot from the orthomosaic that covers it.",
  trait_extraction:
    "Vegetation fraction, and canopy height where there is an elevation model, at ExG 0.10 with the active plot boundaries.",
  inference:
    "The model chosen for each crop, on the first image source available.",
}

function cellText(c: CellState): string {
  switch (c.kind) {
    case "done":
      return "done"
    case "ready":
      return "runs"
    case "after":
      return `after ${STEP_LABELS[c.step].toLowerCase()}`
    case "needs":
      return `needs ${c.reason}`
    default:
      return ""
  }
}

function Cell({ c }: { c: CellState }) {
  if (c.kind === "off") return <span className="text-muted-foreground">—</span>
  const cls =
    c.kind === "done"
      ? "text-muted-foreground"
      : c.kind === "needs"
        ? "text-amber-700 dark:text-amber-400"
        : "text-primary font-medium"
  const Icon =
    c.kind === "done"
      ? Check
      : c.kind === "needs"
        ? TriangleAlert
        : c.kind === "after"
          ? Clock
          : Play
  return (
    <span className={`inline-flex items-center gap-1 ${cls}`}>
      <Icon className="size-3 shrink-0" />
      {cellText(c)}
    </span>
  )
}

export function BatchRunDialog({
  pipeline,
  runs,
  workspaceId,
  open,
  onClose,
}: {
  pipeline: Pipeline
  runs: Run[]
  workspaceId: string
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const params = pipeline.params as Record<string, unknown>

  // The RGB flights (a thermal camera's runs are cut with the RGB ones).
  const dated = useMemo(
    () =>
      runs
        .filter(
          (r) => runScope(r) && !/thermal/i.test(r.uploadScope?.sensor ?? ""),
        )
        .sort((a, b) =>
          String(a.uploadScope?.date).localeCompare(
            String(b.uploadScope?.date),
          ),
        ),
    [runs],
  )
  const models = useMemo<InferenceModel[]>(
    () =>
      ((params.roboflow_models as unknown[]) ?? [])
        .map(normalizeModel)
        .filter((m) => modelKey(m)),
    [params.roboflow_models],
  )
  const populations = useMemo(
    () =>
      [...new Set(dated.map((r) => r.uploadScope?.population ?? ""))].sort(),
    [dated],
  )

  // Choices, saved on the pipeline when the batch starts.
  const [steps, setSteps] = useState<Set<BatchStep>>(
    () => new Set(["plot_images", "trait_extraction", "inference"]),
  )
  const [plotSource, setPlotSource] = useState<"ortho" | "frames">(
    (params.batch_plot_source as "ortho" | "frames") ?? "ortho",
  )
  const [rerun, setRerun] = useState(false)
  const [sources, setSources] = useState<ImageSource[]>(() => {
    const saved = params.inference_sources as ImageSource[] | undefined
    return saved?.length ? saved : DEFAULT_SOURCES
  })
  // Model keys per crop (an older save holds one key per crop).
  const [byPop, setByPop] = useState<Record<string, string[]>>(() => {
    const saved = (params.inference_by_population ?? {}) as Record<
      string,
      string | string[]
    >
    return Object.fromEntries(
      Object.entries(saved).map(([k, v]) => [
        k,
        (Array.isArray(v) ? v : [v]).filter((x) => x && x !== NONE),
      ]),
    )
  })
  // One model in the pipeline: that one, unless chosen otherwise.
  const modelsOf = (pop: string): InferenceModel[] => {
    const keys =
      byPop[pop] ?? (models.length === 1 ? [modelKey(models[0])] : [])
    return models.filter((m) => keys.includes(modelKey(m)))
  }
  const toggleModel = (pop: string, m: InferenceModel) => {
    const keys = modelsOf(pop).map(modelKey)
    const k = modelKey(m)
    setByPop({
      ...byPop,
      [pop]: keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k],
    })
  }

  const locate = useQuery({
    queryKey: ["jobs", "locate-completed"],
    queryFn: async () =>
      ((await JobsService.apiJobsAllGetAllJobs({
        jobType: "LOCATE_PLANTS",
        status: "COMPLETED",
        limit: 500,
      })) ?? []) as JobOutput[],
    enabled: open,
    staleTime: 30_000,
  })
  const factQueries = useQueries({
    queries: dated.map((r) => ({
      queryKey: ["batch-facts", r.id, locate.dataUpdatedAt],
      queryFn: async () =>
        (await gatherFacts(r, locate.data ?? []))?.facts ?? null,
      enabled: open && locate.isSuccess,
      staleTime: 30_000,
    })),
  })
  const loading = locate.isLoading || factQueries.some((q) => q.isLoading)

  const options: BatchOptions = {
    steps,
    plotSource,
    rerun,
    sources,
    modelsFor: (pop) => modelsOf(pop).map(modelDisplayName),
  }
  const plans = dated.map((r, i) => {
    const f = factQueries[i]?.data
    return { run: r, facts: f, plan: f ? planDate(f, options) : null }
  })
  // One entry per step to start; inference once per model still to run.
  type ToRun = {
    p: (typeof plans)[number]
    s: BatchStep
    model: InferenceModel | null
  }
  const toRun: ToRun[] = plans.flatMap((p): ToRun[] => {
    const plan = p.plan
    const facts = p.facts
    if (!plan || !facts) return []
    const pending = modelsToRun(facts, options)
    return BATCH_STEPS.filter(
      (s) => plan[s].kind === "ready" || plan[s].kind === "after",
    ).flatMap((s): ToRun[] =>
      s === "inference"
        ? modelsOf(facts.population)
            .filter((m) => pending.includes(modelDisplayName(m)))
            .map((m) => ({ p, s, model: m }))
        : [{ p, s, model: null }],
    )
  })
  const datesToRun = new Set(toRun.map((x) => x.p.run.id)).size
  const needing = plans.filter((p) =>
    p.plan ? BATCH_STEPS.some((s) => p.plan?.[s].kind === "needs") : false,
  )

  // This batch's progress, live.
  const queue = useSyncExternalStore(
    subscribeQueue,
    queueSnapshot,
    queueSnapshot,
  )
  const [batchId, setBatchId] = useState<string | null>(null)
  useEffect(() => {
    if (!open) setBatchId(null)
  }, [open])
  const mine = batchId ? queue.filter((q) => q.batchId === batchId) : []
  const [starting, setStarting] = useState(false)

  const start = async () => {
    setStarting(true)
    updatePipeline(pipeline.id, {
      params: {
        ...pipeline.params,
        inference_sources: sources,
        inference_by_population: byPop,
        batch_plot_source: plotSource,
      },
    })
    const id = `batch-${Date.now()}`
    const now = new Date().toISOString()
    const queued: QueuedStep[] = []
    for (const { p, s, model } of toRun) {
      const c = p.plan?.[s]
      if (!c) continue
      const prev =
        c.kind === "after"
          ? queued.find((q) => q.runId === p.run.id && q.step === c.step)
          : undefined
      queued.push({
        id: `${id}-${p.run.id}-${s}${model ? `-${modelKey(model)}` : ""}`,
        batchId: id,
        runId: p.run.id,
        date: p.facts?.date ?? "",
        population: p.facts?.population ?? "",
        step: s,
        options: {
          plotSource,
          model,
          sources,
          localServerUrl:
            params.inference_mode === "local"
              ? String(params.local_server_url ?? "").trim() || undefined
              : undefined,
        },
        after: prev ? [prev.id] : [],
        status: "waiting",
        jobIds: [],
        createdAt: now,
      })
    }
    writeQueue([...readQueue(), ...queued])
    setBatchId(id)
    // Start what can start now; the rest follows as its inputs land.
    let started = 0
    let failed = 0
    for (const q of queued.filter((x) => !x.after.length)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const jobIds = await startStep(q.runId, q.step, q.options)
        writeQueue(
          readQueue().map((x) =>
            x.id === q.id ? { ...x, status: "started", jobIds } : x,
          ),
        )
        started++
      } catch (e) {
        writeQueue(
          readQueue().map((x) =>
            x.id === q.id
              ? {
                  ...x,
                  status: "failed",
                  error: e instanceof Error ? e.message : String(e),
                }
              : x,
          ),
        )
        failed++
      }
    }
    setStarting(false)
    void workBatchQueue()
    if (failed)
      showErrorToast(`${failed} step(s) could not start: see the list.`)
    else
      showSuccessToast(
        `Started ${started} step(s)${queued.length > started ? `; ${queued.length - started} more start as their inputs finish` : ""}.`,
      )
  }

  const toggle = (s: BatchStep) => {
    const next = new Set(steps)
    if (next.has(s)) next.delete(s)
    else next.add(s)
    setSteps(next)
  }
  const move = (i: number, d: number) => {
    const next = [...sources]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    setSources(next)
  }
  const shownSteps = BATCH_STEPS.filter((s) => steps.has(s))

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Run across dates</DialogTitle>
          <DialogDescription>
            Start the same steps on every date of {pipeline.name}. Dates where a
            step is done are skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">Steps</p>
            {BATCH_STEPS.map((s) => (
              <label key={s} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary mt-0.5 size-4"
                  checked={steps.has(s)}
                  onChange={() => toggle(s)}
                  data-testid={`batch-step-${s}`}
                />
                <span>
                  {STEP_LABELS[s]}
                  {s === "plot_images" && steps.has(s) && (
                    <span className="ml-2 inline-flex rounded border text-xs">
                      {(["ortho", "frames"] as const).map((k) => (
                        <button
                          key={k}
                          type="button"
                          className={`px-2 py-0.5 ${plotSource === k ? "bg-muted font-medium" : ""}`}
                          onClick={(e) => {
                            e.preventDefault()
                            setPlotSource(k)
                          }}
                        >
                          {k === "ortho"
                            ? "from orthomosaic"
                            : "from raw frames"}
                        </button>
                      ))}
                    </span>
                  )}
                  <span className="text-muted-foreground block text-xs">
                    {STEP_HINTS[s]}
                  </span>
                </span>
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={rerun}
                onChange={(e) => setRerun(e.target.checked)}
              />
              Run again where already done
            </label>
          </div>

          {steps.has("inference") && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Models per crop</p>
                <p className="text-muted-foreground text-xs">
                  Pick any number for each crop: each runs on every date of it.
                </p>
                {models.length === 0 && (
                  <p className="text-muted-foreground text-xs">
                    No models in this pipeline yet: add one from a run's
                    Inference step or the pipeline settings.
                  </p>
                )}
                {populations.map((pop) => {
                  const chosen = modelsOf(pop).map(modelKey)
                  return (
                    <div key={pop} className="flex items-start gap-2 text-sm">
                      <span className="w-24 shrink-0 truncate pt-1">
                        {pop || "—"}
                      </span>
                      <div
                        className="flex flex-1 flex-wrap gap-1.5"
                        data-testid={`batch-models-${pop}`}
                      >
                        {models.map((m) => {
                          const on = chosen.includes(modelKey(m))
                          return (
                            <button
                              key={modelKey(m)}
                              type="button"
                              aria-pressed={on}
                              onClick={() => toggleModel(pop, m)}
                              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                                on
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "hover:bg-muted"
                              }`}
                            >
                              {modelDisplayName(m)}
                            </button>
                          )
                        })}
                        {chosen.length === 0 && models.length > 0 && (
                          <span className="text-muted-foreground pt-0.5 text-xs">
                            no inference
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Image source, in order</p>
                <p className="text-muted-foreground text-xs">
                  Each date uses the first one it has. Also the default in a
                  run's Inference step.
                </p>
                {sources.map((s, i) => (
                  <div key={s} className="flex items-center gap-1 text-sm">
                    <span className="text-muted-foreground w-4">{i + 1}.</span>
                    <span className="flex-1">{SOURCE_LABELS[s]}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label="Earlier"
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={i === sources.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Later"
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="max-h-[45vh] overflow-auto rounded-md border">
          <table className="w-full text-xs" data-testid="batch-plan">
            <thead className="bg-muted sticky top-0 z-10">
              <tr>
                <th className="px-2 py-1.5 text-left">Date</th>
                <th className="px-2 py-1.5 text-left">Crop</th>
                {shownSteps.map((s) => (
                  <th key={s} className="px-2 py-1.5 text-left">
                    {STEP_LABELS[s]}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {plans.map(({ run, facts, plan }, i) => (
                <tr key={run.id} className="border-t">
                  <td className="px-2 py-1 font-mono whitespace-nowrap">
                    {run.uploadScope?.date}
                    {run.uploadScope?.batchLabel
                      ? ` · ${run.uploadScope.batchLabel}`
                      : ""}
                  </td>
                  <td className="px-2 py-1">{run.uploadScope?.population}</td>
                  {shownSteps.map((s) => (
                    <td key={s} className="px-2 py-1 whitespace-nowrap">
                      {plan ? (
                        <Cell c={plan[s]} />
                      ) : factQueries[i]?.isError ? (
                        <span className="text-destructive">couldn't read</span>
                      ) : (
                        <Loader2 className="text-muted-foreground size-3 animate-spin" />
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right">
                    {plan &&
                      BATCH_STEPS.some((s) => plan[s].kind === "needs") &&
                      facts && (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() =>
                            navigate({
                              to: "/process/$workspaceId/run/$runId",
                              params: { workspaceId, runId: run.id },
                            })
                          }
                        >
                          Open
                        </Button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {needing.length > 0 && (
          <p className="text-amber-700 text-xs dark:text-amber-400">
            {needing.length} date{needing.length === 1 ? "" : "s"} need
            something first (shown in amber); the rest still run. Open a date to
            fix it, then run again.
          </p>
        )}

        {mine.length > 0 && (
          <div
            className="rounded-md border p-2 text-xs"
            data-testid="batch-progress"
          >
            <p className="mb-1 font-medium">
              This batch: {mine.filter((q) => q.status === "done").length} done
              · {mine.filter((q) => q.status === "started").length} running ·{" "}
              {mine.filter((q) => q.status === "waiting").length} waiting ·{" "}
              {mine.filter((q) => q.status === "failed").length} failed
            </p>
            <ul className="max-h-32 space-y-0.5 overflow-y-auto">
              {mine
                .filter((q) => q.status === "failed")
                .map((q) => (
                  <li key={q.id} className="text-destructive">
                    {q.date} · {STEP_LABELS[q.step]}: {q.error}
                  </li>
                ))}
            </ul>
            <p className="text-muted-foreground mt-1">
              Waiting steps start as their inputs finish, while the app is open.
              Jobs show in the panel at the bottom.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={() => void start()}
            disabled={loading || starting || toRun.length === 0}
            data-testid="batch-start"
          >
            {starting || loading ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : (
              <Play className="mr-1 size-4" />
            )}
            {loading
              ? "Checking dates…"
              : toRun.length
                ? `Run ${toRun.length} step${toRun.length === 1 ? "" : "s"} on ${datesToRun} date${datesToRun === 1 ? "" : "s"}`
                : "Nothing to run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
