/**
 * InferenceJobView — the results of one finished inference job, on their own.
 *
 * Opens under the job in "Results on this run". Works whatever the pipeline's
 * model list says (a job the agent ran with a model the pipeline does not
 * list shows the same way), and for both job kinds:
 *   - batch (every plot image): the worker's predictions file maps plot →
 *     { object_name, predictions }. Plots are listed with their count at the
 *     chosen confidence; the selected plot's image shows its detections.
 *   - one image: the predictions file is a plain list for `image_path`.
 */
import { useQuery } from "@tanstack/react-query"
import {
  ArrowDownWideNarrow,
  ChevronLeft,
  ChevronRight,
  Download,
  ListOrdered,
  Loader2,
  PenLine,
  X,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import type { JobOutput } from "@/client"
import { authHeaders } from "@/components/Common/PlotImage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { apiUrl, DEFAULT_BUCKET } from "@/features/files/lib/download"
import { LabelingWorkspace } from "@/features/process/components/LabelingWorkspace"
import {
  classColour,
  hasBox,
  type Prediction,
  PredictionOverlay,
  useAuthedBlobUrl,
} from "@/features/process/components/predictionView"

interface PlotResult {
  plot: string
  objectName: string
  accession: string | null
  predictions: Prediction[]
  error: string | null
}

interface JobParams {
  output_predictions_path?: string
  image_path?: string
  task_type?: string
  confidence_threshold?: number
}

/** "…/plot_1001_accession_MOCK-02.png" → "MOCK-02". */
function accessionOf(objectName: string): string | null {
  const m = /_accession_(.+?)\.[^.]+$/.exec(objectName)
  return m ? m[1] : null
}

function byPlotNumber(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  return a.localeCompare(b)
}

/** The predictions file in either shape, as one row per image. */
export function plotResults(
  raw: unknown,
  params: JobParams,
  errors: Record<string, string> = {},
): PlotResult[] {
  if (Array.isArray(raw)) {
    const objectName = params.image_path ?? ""
    const name = objectName.split("/").pop() ?? "image"
    return [
      {
        plot: name,
        objectName,
        accession: accessionOf(objectName),
        predictions: raw as Prediction[],
        error: null,
      },
    ]
  }
  if (!raw || typeof raw !== "object") return []
  const rows: PlotResult[] = Object.entries(
    raw as Record<
      string,
      { object_name?: string; predictions?: Prediction[] } | null
    >,
  ).map(([plot, v]) => ({
    plot,
    objectName: v?.object_name ?? "",
    accession: accessionOf(v?.object_name ?? ""),
    predictions: Array.isArray(v?.predictions) ? v.predictions : [],
    error: errors[plot] ?? null,
  }))
  for (const [plot, error] of Object.entries(errors)) {
    if (!rows.some((r) => r.plot === plot))
      rows.push({
        plot,
        objectName: "",
        accession: null,
        predictions: [],
        error,
      })
  }
  return rows.sort((a, b) => byPlotNumber(a.plot, b.plot))
}

/** Best label of a classification result. */
function topLabel(preds: Prediction[]): Prediction | null {
  let best: Prediction | null = null
  for (const p of preds) if (!best || p.confidence > best.confidence) best = p
  return best
}

export function InferenceJobView({
  job,
  modelName,
  onClose,
}: {
  job: JobOutput
  modelName: string
  onClose: () => void
}) {
  const params = (job.parameters ?? {}) as JobParams
  const result = ((job as { result?: unknown }).result ?? {}) as {
    errors?: Record<string, string>
    total_detections?: number
  }
  const path = params.output_predictions_path ?? null

  const predsQuery = useQuery({
    queryKey: ["inference-predictions", path],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${path}`),
        { headers: authHeaders() },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as unknown
    },
    enabled: Boolean(path),
    staleTime: Number.POSITIVE_INFINITY,
  })

  const errors = result.errors
  const imagePath = params.image_path
  const rows = useMemo(
    () => plotResults(predsQuery.data, { image_path: imagePath }, errors),
    [predsQuery.data, imagePath, errors],
  )
  // The job says what it was; older jobs without a task type are judged by
  // their predictions (labels without boxes = classification).
  const classification = params.task_type
    ? params.task_type === "classification"
    : rows.some((r) => r.predictions.some((p) => !hasBox(p)))

  const [threshold, setThreshold] = useState(
    classification ? 0 : (params.confidence_threshold ?? 0.25),
  )
  const [sortByCount, setSortByCount] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  // Labelling these images by hand (for training), from this model's results.
  const [labeling, setLabeling] = useState(false)
  // Ground plot images are long strips: show them at a readable height and
  // scroll sideways, rather than squeezed to the panel's width.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const aspect = natural?.h ? natural.w / natural.h : null
  const [zoom, setZoom] = useState<boolean | null>(null)
  const zoomed = zoom ?? (aspect != null && aspect > 4)

  const counted = useMemo(
    () =>
      rows.map((r) => {
        const kept = r.predictions.filter((p) => p.confidence >= threshold)
        return {
          ...r,
          kept,
          count: kept.length,
          label: classification ? topLabel(r.predictions) : null,
        }
      }),
    [rows, threshold, classification],
  )
  const ordered = useMemo(
    () =>
      sortByCount && !classification
        ? [...counted].sort((a, b) => b.count - a.count)
        : counted,
    [counted, sortByCount, classification],
  )
  const maxCount = Math.max(1, ...counted.map((r) => r.count))
  const current = ordered.find((r) => r.plot === selected) ?? ordered[0] ?? null
  const idx = current ? ordered.indexOf(current) : -1

  const classTotals = useMemo(() => {
    const t: Record<string, number> = {}
    for (const r of counted) {
      if (classification) {
        if (r.label) t[r.label.class] = (t[r.label.class] ?? 0) + 1
      } else for (const p of r.kept) t[p.class] = (t[p.class] ?? 0) + 1
    }
    return Object.entries(t).sort((a, b) => b[1] - a[1])
  }, [counted, classification])
  const total = counted.reduce((a, r) => a + r.count, 0)
  const failed = counted.filter((r) => r.error).length

  const go = (d: number) => {
    const next = ordered[idx + d]
    if (next) setSelected(next.plot)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.key === "ArrowRight" || e.key === "ArrowDown") go(1)
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const imageUrl = useAuthedBlobUrl(
    current?.objectName ? `${DEFAULT_BUCKET}/${current.objectName}` : null,
  )

  const downloadCsv = () => {
    const head = classification
      ? "plot,accession,label,confidence,error"
      : `plot,accession,detections_at_${threshold.toFixed(2)},error`
    const lines = counted.map((r) =>
      [
        r.plot,
        r.accession ?? "",
        ...(classification
          ? [r.label?.class ?? "", r.label ? r.label.confidence.toFixed(3) : ""]
          : [String(r.count)]),
        (r.error ?? "").replace(/[\n,]/g, " "),
      ].join(","),
    )
    const url = URL.createObjectURL(
      new Blob([`${[head, ...lines].join("\n")}\n`], { type: "text/csv" }),
    )
    try {
      const a = document.createElement("a")
      a.href = url
      a.download = `${modelName.replace(/[^\w.-]+/g, "_")}-${String(job.id).slice(0, 8)}.csv`
      a.click()
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  if (labeling)
    return (
      <div className="bg-muted/20 mt-2 rounded-md border p-2">
        <LabelingWorkspace
          images={rows.filter((r) => r.objectName).map((r) => r.objectName)}
          initial={
            classification
              ? undefined
              : Object.fromEntries(
                  rows
                    .filter((r) => r.objectName)
                    .map((r) => [
                      r.objectName,
                      r.predictions.filter(
                        (p) => p.confidence >= threshold,
                      ) as never,
                    ]),
                )
          }
          experimentId={
            ((job as { experiment_id?: string | number | null })
              .experiment_id ?? undefined) as string | undefined
          }
          onClose={() => setLabeling(false)}
        />
      </div>
    )

  return (
    <div
      className="bg-muted/20 mt-2 rounded-md border"
      data-testid="inference-job-view"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{modelName}</p>
          <p className="text-muted-foreground text-xs">
            {Array.isArray(predsQuery.data)
              ? "One image"
              : `${rows.length} plots`}
            {classification
              ? " · one label per plot"
              : ` · ${total} detections at ≥ ${threshold.toFixed(2)}`}
            {failed > 0 && ` · ${failed} failed`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {classTotals.map(([cls, n]) => (
            <span
              key={cls}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: classColour(cls) }}
              />
              {cls} <span className="font-mono">{n}</span>
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!classification && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Confidence</span>
              <Input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="h-4 w-28 p-0"
                aria-label="Confidence threshold"
                data-testid="inference-job-threshold"
              />
              <span className="w-8 font-mono">{threshold.toFixed(2)}</span>
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => setLabeling(true)}
            disabled={rows.length === 0}
            title="Correct these detections by hand and build a labelled set for training"
            data-testid="inference-label"
          >
            <PenLine className="mr-1 h-3.5 w-3.5" /> Label
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={downloadCsv}
            disabled={rows.length === 0}
          >
            <Download className="mr-1 h-3.5 w-3.5" /> CSV
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={onClose}
            aria-label="Close results"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {predsQuery.isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading results…
        </div>
      ) : predsQuery.isError || !path ? (
        <p className="text-muted-foreground p-4 text-sm">
          This job's predictions file could not be read
          {path ? ` (${path})` : ""}. Its per-plot counts are still in Analyze.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm">
          The job finished without results for any image.
        </p>
      ) : (
        <div className="grid gap-0 md:grid-cols-[15rem_1fr]">
          <div className="border-b md:border-r md:border-b-0">
            {!classification && rows.length > 1 && (
              <div className="flex items-center gap-1 border-b px-2 py-1 text-xs">
                <span className="text-muted-foreground mr-auto">Sort</span>
                <Button
                  size="sm"
                  variant={sortByCount ? "ghost" : "secondary"}
                  className="h-6 px-2 text-xs"
                  onClick={() => setSortByCount(false)}
                >
                  <ListOrdered className="mr-1 h-3 w-3" /> Plot
                </Button>
                <Button
                  size="sm"
                  variant={sortByCount ? "secondary" : "ghost"}
                  className="h-6 px-2 text-xs"
                  onClick={() => setSortByCount(true)}
                >
                  <ArrowDownWideNarrow className="mr-1 h-3 w-3" /> Count
                </Button>
              </div>
            )}
            <ul
              className="max-h-[26rem] overflow-auto py-1 text-xs"
              data-testid="inference-job-plots"
            >
              {ordered.map((r) => (
                <li key={r.plot}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.plot)}
                    className={`flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-muted ${
                      r.plot === current?.plot ? "bg-primary/10" : ""
                    }`}
                  >
                    <span className="w-12 shrink-0 font-medium">{r.plot}</span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate">
                      {r.error
                        ? "failed"
                        : classification
                          ? (r.label?.class ?? "—")
                          : (r.accession ?? "")}
                    </span>
                    {!classification && !r.error && (
                      <span className="flex w-16 shrink-0 items-center gap-1">
                        <span className="bg-muted h-1.5 flex-1 overflow-hidden rounded">
                          <span
                            className="bg-primary block h-full"
                            style={{ width: `${(r.count / maxCount) * 100}%` }}
                          />
                        </span>
                        <span className="w-6 text-right font-mono">
                          {r.count}
                        </span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0 space-y-2 p-3">
            {current && (
              <>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0"
                    disabled={idx <= 0}
                    onClick={() => go(-1)}
                    aria-label="Previous plot"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <p className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium">
                      {rows.length > 1 ? `Plot ${current.plot}` : current.plot}
                    </span>
                    {current.accession && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {current.accession}
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {" "}
                      ·{" "}
                      {current.error
                        ? "failed"
                        : classification
                          ? current.label
                            ? `${current.label.class} (${Math.round(current.label.confidence * 100)}%)`
                            : "no label"
                          : `${current.count} detection${current.count === 1 ? "" : "s"}`}
                    </span>
                  </p>
                  <span className="text-muted-foreground text-xs">
                    {idx + 1} / {ordered.length}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0"
                    disabled={idx >= ordered.length - 1}
                    onClick={() => go(1)}
                    aria-label="Next plot"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                {current.error ? (
                  <p className="rounded border border-red-300 bg-red-500/10 px-2 py-1.5 text-xs text-red-700">
                    {current.error}
                  </p>
                ) : !current.objectName ? (
                  <p className="text-muted-foreground text-sm">
                    No image recorded for this plot.
                  </p>
                ) : imageUrl ? (
                  <div className="overflow-x-auto rounded border bg-black">
                    <PredictionOverlay
                      src={imageUrl}
                      alt={`Plot ${current.plot}`}
                      imgClassName={
                        zoomed
                          ? "block h-72 w-auto max-w-none"
                          : "block h-auto w-full"
                      }
                      onNaturalSize={(w, h) => setNatural({ w, h })}
                      predictions={
                        classification
                          ? current.predictions
                              .slice()
                              .sort((a, b) => b.confidence - a.confidence)
                          : current.kept
                      }
                    />
                  </div>
                ) : (
                  <div className="flex h-48 items-center justify-center rounded border">
                    <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
                  </div>
                )}
                {natural &&
                  !classification &&
                  (() => {
                    const outside = current.kept.filter(
                      (p) =>
                        hasBox(p) &&
                        (p.y - p.height / 2 >= natural.h ||
                          p.x - p.width / 2 >= natural.w),
                    ).length
                    return outside > 0 ? (
                      <p
                        className="rounded border border-amber-400/60 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300"
                        data-testid="inference-boxes-outside"
                      >
                        {outside} of {current.count} detections lie outside this
                        image (the model saw padding, not plants), so this
                        plot's count is too high.
                      </p>
                    ) : null
                  })()}
                <p className="text-muted-foreground text-[11px]">
                  {aspect != null && aspect > 1.5 && (
                    <button
                      type="button"
                      className="text-primary mr-2 underline underline-offset-2"
                      onClick={() => setZoom(!zoomed)}
                    >
                      {zoomed ? "Fit to width" : "Zoom in"}
                    </button>
                  )}
                  {zoomed && "Scroll sideways to see the whole plot. "}
                  Arrow keys step through the plots.
                  {result.total_detections != null &&
                    !classification &&
                    ` The job saved ${result.total_detections} detections at its own threshold (${(params.confidence_threshold ?? 0).toFixed(2)}).`}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
