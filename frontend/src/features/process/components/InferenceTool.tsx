/**
 * InferenceTool — submit LOCATE_PLANTS on a single image and view results.
 *
 * Differences vs main's 1,340-LOC version:
 *   - Per-plot fan-out is now supported ("Run on: every image at this
 *     source"). LOCATE_PLANTS gained an `images_prefix` mode so the
 *     worker loops server-side and returns counts keyed by plot number —
 *     one job per field, as the old backend did. Submitting a job per
 *     plot from the client would mean hundreds of jobs each paying
 *     container + model startup.
 *   - Model list comes from the pipeline's saved model config (set in
 *     the R3 wizard's step 3). No extra fetch required.
 *   - Threshold slider does client-side NMS / filtering on the cached
 *     predictions JSON; no /apply-inference-threshold endpoint needed.
 *   - Past inference jobs for this run + image are listed below the
 *     viewer using runStore's step jobIds.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight, Loader2, Play, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
  type FileMetadata,
  FilesService,
  type JobOutput,
  JobsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { apiUrl } from "@/features/files/lib/download"
import { InferenceResults } from "@/features/process/components/InferenceResults"
import { LabelingWorkspace } from "@/features/process/components/LabelingWorkspace"
import {
  classColour,
  OverlayControls,
  type Prediction,
  readOverlayLook,
  useAuthedBlobUrl,
} from "@/features/process/components/predictionView"
import { ZoomableOverlay } from "@/features/process/components/ZoomableOverlay"
import { loadActiveBoundaries } from "@/features/process/lib/activeBoundaries"
import { groundFramesPlots } from "@/features/process/lib/groundFrames"
import {
  type InferenceModel,
  modelDisplayName,
  modelJobParams,
  modelKey,
  modelProblem,
  normalizeModel,
  sourceLabel,
  TASK_LABELS,
} from "@/features/process/lib/inferenceModels"
import {
  type BatchInferenceResult,
  isBatchInferenceResult,
  summaryCsv,
  summaryRows,
} from "@/features/process/lib/inferenceSummary"
import type { AerialScope } from "@/features/process/lib/paths"
import {
  plotFramesPrefix,
  plotImagesPrefix,
  processedPrefix,
  rawImagesPrefix,
  rawScopePrefix,
} from "@/features/process/lib/paths"
import { executeStep } from "@/features/process/lib/runApi"
import {
  useDeleteRunResults,
  useExperimentDatasetNames,
} from "@/features/process/lib/runResults"
import {
  type Pipeline,
  type Run,
  updatePipeline,
} from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"
import { isLoggedIn } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"

/** Per-plot counts from a batch run, with a CSV download. */
function BatchInferenceSummary({
  result,
  fileStem,
  experiment,
}: {
  result: BatchInferenceResult
  fileStem: string
  experiment?: string
}) {
  const rows = summaryRows(result)
  // Saved counts are one dataset per run; a later run with the same label
  // replaces them, and deleting removes them from Analyze.
  const datasetNames = useExperimentDatasetNames(experiment, [fileStem])
  const deleteRunResults = useDeleteRunResults()
  const confirm = useConfirm()
  const { showSuccessToast, showErrorToastWithCopy } = useCustomToast()
  const savedLive =
    !!result.dataset_name &&
    datasetNames.data?.has(result.dataset_name) === true
  const deleteCounts = async () => {
    if (!experiment || !result.dataset_name) return
    const ok = await confirm({
      title: "Delete the saved counts from this run?",
      description: (
        <span>
          Removes the detection-count traits this run saved, so Analyze no
          longer uses them. The per-plot table and CSV here are unaffected.{" "}
          <strong>This cannot be undone.</strong>
        </span>
      ),
      confirmLabel: "Delete counts",
      variant: "destructive",
    })
    if (!ok) return
    try {
      await deleteRunResults(experiment, result.dataset_name)
      showSuccessToast("Saved counts deleted")
    } catch (e) {
      showErrorToastWithCopy(e instanceof Error ? e.message : "Delete failed")
    }
  }
  const failed = rows.filter((r) => r.error).length
  const ingested = Object.values(result.ingested ?? {})[0]
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([summaryCsv(result)], { type: "text/csv" }),
    )
    try {
      const a = document.createElement("a")
      a.href = url
      a.download = `${fileStem}.csv`
      a.click()
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  return (
    <Card data-testid="inference-batch-summary">
      <CardHeader>
        <CardTitle className="text-base">Per-plot results</CardTitle>
        <CardDescription>
          {result.plots_processed ?? 0} of {result.images_found ?? rows.length}{" "}
          images inferred · {result.total_detections ?? 0} detections
          {failed > 0 ? ` · ${failed} failed` : ""}
          {typeof ingested === "number"
            ? savedLive || datasetNames.isLoading || !result.dataset_name
              ? ` · counts saved as traits for ${ingested} plots`
              : " · saved counts were replaced or deleted"
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          variant="outline"
          size="sm"
          onClick={download}
          data-testid="inference-batch-csv"
        >
          Download CSV
        </Button>
        {savedLive && (
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={deleteCounts}
            data-testid="inference-delete-counts"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete saved counts
          </Button>
        )}
        <div className="max-h-64 overflow-auto rounded border text-xs">
          <table className="w-full">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left">Plot</th>
                <th className="px-2 py-1 text-right">Detections</th>
                <th className="px-2 py-1 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.plot} className="border-t">
                  <td className="px-2 py-1">{r.plot}</td>
                  <td className="px-2 py-1 text-right font-mono">
                    {r.count ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-red-700">{r.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

interface InferenceToolProps {
  pipeline: Pipeline
  run: Run
  scope: AerialScope
  onSaved?: () => void
  onCancel?: () => void
}

export function InferenceTool({
  pipeline,
  run,
  scope,
  // The page's back arrow leaves the tool; no "Done" at the bottom.
  onCancel: _onCancel,
}: InferenceToolProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()

  // Models from the pipeline config (wizard step 3). The self-hosted
  // server URL applies to Roboflow models only.
  const localServerUrl =
    pipeline.params.inference_mode === "local"
      ? (
          (pipeline.params.local_server_url as string | undefined) ?? ""
        ).trim() || undefined
      : undefined
  const models = useMemo<InferenceModel[]>(() => {
    const arr = (pipeline.params.roboflow_models as unknown[]) ?? []
    return arr.map(normalizeModel).filter((m) => modelKey(m))
  }, [pipeline.params.roboflow_models])

  const navigate = useNavigate()
  const [labeling, setLabeling] = useState(false)
  const [activeModelIdx, setActiveModelIdx] = useState(0)
  const activeModel = models[activeModelIdx]
  // Zero-shot labels for the next run only, pre-filled from the pipeline's
  // saved prompt — lets a researcher try prompts without editing the pipeline.
  const [promptOverrides, setPromptOverrides] = useState<
    Record<number, string>
  >({})
  const activePrompt =
    promptOverrides[activeModelIdx] ?? activeModel?.hf_prompt ?? ""

  // Image source: prefer plot-image crops if SPLIT_ORTHOMOSAIC has run;
  // otherwise fall back to raw images for a single-image smoke test.
  // Raw images: when the run targets exactly one dataset, point at its
  // per-dataset prefix; otherwise list the scope root recursively (the
  // backend listing endpoint walks subdirs and the picker filters to
  // /Images/ entries).
  const datasetShortIds = run.uploadScope?.datasetShortIds ?? []
  const sources = useMemo(() => {
    const rawPrefix =
      datasetShortIds.length === 1
        ? rawImagesPrefix(scope, datasetShortIds[0])
        : rawScopePrefix(scope)
    return [
      {
        label: "Plot images (split or associated)",
        prefix: plotImagesPrefix(scope),
        plots: true,
      },
      { label: "Raw images", prefix: rawPrefix, plots: false },
      // From the raw frames (placed by camera positions): each plot's frame crops
      // and its best frame straightened to a top-down view.
      {
        label: "Plot crops from the raw frames",
        prefix: `${plotFramesPrefix(scope, run.uploadScope?.batchLabel)}crops/`,
        plots: true,
      },
      {
        label: "Straightened plot views from the raw frames",
        prefix: `${plotFramesPrefix(scope, run.uploadScope?.batchLabel)}straightened/`,
        plots: true,
      },
      // A ground track's raw frames: each plot's frames that do not
      // overlap, so a model's counts on them add up to the plot's count.
      {
        label: "Every frame of each plot, no overlap (counts summed)",
        prefix: `${plotFramesPrefix(scope, run.uploadScope?.batchLabel)}tiles/`,
        plots: true,
      },
    ]
  }, [scope, datasetShortIds, run.uploadScope?.batchLabel])
  // The pipeline's preferred order of image sources (set in "Run across
  // dates"): start on the first, and move on while a source has no images,
  // until the person picks one.
  const preferred = useMemo(() => {
    const index: Record<string, number> = {
      ortho: 0,
      crops: 2,
      straightened: 3,
    }
    const saved = (pipeline.params.inference_sources as
      | string[]
      | undefined) ?? ["ortho", "straightened", "crops"]
    return saved.map((s) => index[s]).filter((i) => i != null)
  }, [pipeline.params.inference_sources])
  const [sourceIdx, setSourceIdxRaw] = useState(() => preferred[0] ?? 0)
  const [sourcePicked, setSourcePicked] = useState(false)
  const setSourceIdx = (i: number) => {
    setSourcePicked(true)
    setSourceIdxRaw(i)
  }
  const activePrefix = sources[sourceIdx].prefix
  // "single" infers the previewed image; "all" hands the whole prefix to
  // one job that loops server-side and keys results by plot number.
  const [mode, setMode] = useState<"single" | "all">("single")

  const imagesQuery = useQuery<FileMetadata[], Error>({
    queryKey: ["files", "list", activePrefix, "inference"],
    queryFn: async () => {
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${activePrefix}`,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: isLoggedIn(),
  })
  const images = useMemo(
    () =>
      (imagesQuery.data ?? []).filter((f) =>
        /\.(jpe?g|png)$/i.test(f.object_name ?? ""),
      ),
    [imagesQuery.data],
  )
  useEffect(() => {
    if (sourcePicked || !imagesQuery.isSuccess || images.length) return
    const at = preferred.indexOf(sourceIdx)
    const next = at >= 0 ? preferred[at + 1] : undefined
    if (next != null) setSourceIdxRaw(next)
  }, [sourcePicked, imagesQuery.isSuccess, images.length, preferred, sourceIdx])
  const [imageIdx, setImageIdx] = useState(0)
  const activeImage = images[imageIdx] ?? null
  const activeImageName = activeImage?.object_name?.split("/").pop() ?? ""
  const activeImageBlob = useAuthedBlobUrl(
    activeImage ? `${DEFAULT_BUCKET}/${activeImage.object_name}` : null,
  )

  // Reset image index when source flips so we don't try to render a stale index.
  useEffect(() => setImageIdx(0), [])

  // Submit + polling.
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null)
  const submit = useMutation({
    mutationFn: async () => {
      if (!activeModel) throw new Error("Pick a model first")
      const problem = modelProblem({ ...activeModel, hf_prompt: activePrompt })
      if (problem) throw new Error(problem)
      if (mode === "single" && !activeImage) {
        throw new Error("Pick an image first")
      }
      if (mode === "all" && images.length === 0) {
        throw new Error("No images at this source to run inference on")
      }
      const experimentId = run.uploadScope?.experimentId
      if (!experimentId) {
        throw new Error(
          "This run is missing its experiment binding. Re-create it from the workspace page.",
        )
      }
      const imagePath = activeImage?.object_name ?? ""
      const stem =
        mode === "all" ? "all-plots" : activeImageName.replace(/\.[^.]+$/, "")
      const outputPath = `${plotImagesPrefix(scope)}inference/${stem}-${activeModelIdx}-${Date.now()}.json`
      // Batch over per-plot images (cut from the orthomosaic, or from the
      // raw frames): send the active boundary version so the worker can
      // write per-plot counts to trait_records. Both are named by the plot
      // numbers of those boundaries. Raw drone frames have no plot
      // identity, so nothing is ingested for them.
      let boundaries: GeoJSON.FeatureCollection | undefined
      if (mode === "all" && sources[sourceIdx].plots) {
        boundaries = await loadActiveBoundaries(processedPrefix(scope))
        // Ground frames named from a field design (no GPS, no boundaries):
        // the plots' properties come from the frames' manifest.
        if (!boundaries && activePrefix.includes("/PlotFrames/")) {
          boundaries = await groundFramesPlots(
            `${plotFramesPrefix(scope, run.uploadScope?.batchLabel)}manifest.json`,
          )
        }
      }
      const result = await executeStep({
        runId: run.id,
        stepKey: "inference",
        scope,
        experimentId,
        inference: {
          ...(mode === "all" ? { imagesPrefix: activePrefix } : { imagePath }),
          ...(boundaries ? { boundaries } : {}),
          countLabel: modelDisplayName(activeModel),
          model: modelJobParams(activeModel, {
            localServerUrl,
            prompt: activePrompt,
          }),
          outputPredictionsPath: outputPath,
        },
      })
      return result.jobId
    },
    onSuccess: (jobId) => {
      if (jobId) {
        setSubmittedJobId(jobId)
        showSuccessToast("Inference job submitted")
        // Poll the job until terminal so the predictions panel updates.
        const tick = setInterval(async () => {
          try {
            const j = (await JobsService.apiJobsJobIdGetJob({
              jobId,
            })) as JobOutput
            if (
              j?.status === "COMPLETED" ||
              j?.status === "FAILED" ||
              j?.status === "CANCELLED"
            ) {
              clearInterval(tick)
              queryClient.invalidateQueries({ queryKey: ["jobs", jobId] })
            }
          } catch {
            clearInterval(tick)
          }
        }, 2_000)
      }
    },
    onError: (err) =>
      showErrorToast(
        err instanceof Error ? err.message : "Failed to submit inference",
      ),
  })

  // Fetch the job once we have an id (for output_predictions_path).
  const jobQuery = useQuery<JobOutput | null, Error>({
    queryKey: ["jobs", submittedJobId],
    queryFn: async () => {
      if (!submittedJobId) return null
      try {
        return (await JobsService.apiJobsJobIdGetJob({
          jobId: submittedJobId,
        })) as JobOutput
      } catch {
        return null
      }
    },
    enabled: Boolean(submittedJobId),
    refetchInterval: (q) =>
      q.state.data?.status === "COMPLETED" ||
      q.state.data?.status === "FAILED" ||
      q.state.data?.status === "CANCELLED"
        ? false
        : 2_000,
  })

  const predictionsPath =
    (
      jobQuery.data?.parameters as
        | { output_predictions_path?: string }
        | null
        | undefined
    )?.output_predictions_path ?? null

  // Download predictions JSON once the job is COMPLETED and we know the path.
  const [predictions, setPredictions] = useState<Prediction[] | null>(null)
  useEffect(() => {
    if (jobQuery.data?.status !== "COMPLETED" || !predictionsPath) {
      setPredictions(null)
      return
    }
    let cancelled = false
    const token = localStorage.getItem("gemini.auth.token") ?? ""
    fetch(apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${predictionsPath}`), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return
        setPredictions(Array.isArray(j) ? (j as Prediction[]) : null)
      })
      .catch(() => {
        if (!cancelled) setPredictions(null)
      })
    return () => {
      cancelled = true
    }
  }, [jobQuery.data?.status, predictionsPath])

  const [confThreshold, setConfThreshold] = useState(0.5)
  const filteredPredictions = useMemo(
    () => (predictions ?? []).filter((p) => p.confidence >= confThreshold),
    [predictions, confThreshold],
  )

  const addModel = (m: InferenceModel) => {
    const arr = (pipeline.params.roboflow_models as unknown[]) ?? []
    updatePipeline(pipeline.id, {
      params: { ...pipeline.params, roboflow_models: [...arr, m] },
    })
    showSuccessToast(`Added ${modelDisplayName(m)} to this pipeline`)
  }
  // Running a model opens beside the results; on a run with no results yet
  // it opens straight away.
  const [look, setLook] = useState(readOverlayLook)
  const [runPanel, setRunPanel] = useState(
    () => !(run.steps.inference?.jobIds?.length ?? 0),
  )

  const openModelSetup = () =>
    navigate({
      to: "/process/$workspaceId/pipeline",
      params: { workspaceId: String(pipeline.workspaceId) },
      search: {
        type: pipeline.type === "ground" ? "ground" : "aerial",
        pipelineId: String(pipeline.id),
        step: 3,
        returnRunId: String(run.id),
      },
    })
  const plotImageNames = sources[sourceIdx].plots
    ? images.map((f) => f.object_name ?? "").filter(Boolean)
    : []

  // Running a model, labelling, model setup: on the results' title line.
  const resultActions = (
    <>
      <button
        type="button"
        className="text-muted-foreground self-center text-xs underline underline-offset-2"
        onClick={() => openModelSetup()}
        title={`${models.length} model${models.length === 1 ? "" : "s"} on this pipeline`}
      >
        Set up models
      </button>
      <Button
        size="sm"
        className="h-7"
        onClick={() => setRunPanel(true)}
        data-testid="inference-run-open"
      >
        <Play className="mr-1.5 h-3.5 w-3.5" />
        Run a model
      </Button>
    </>
  )
  // Without results yet (the bare actions row): labelling starts blank.
  const labelBlankButton = (
    <Button
      size="sm"
      variant="outline"
      className="h-7"
      disabled={plotImageNames.length === 0}
      title="Label objects on the plot images (by hand, by example or by description) and train a model from them"
      onClick={() => setLabeling(true)}
    >
      Label &amp; train
    </Button>
  )
  const results = (
    <InferenceResults
      run={run}
      configured={models}
      onAddModel={addModel}
      actions={resultActions}
      onLabelBlank={
        plotImageNames.length > 0 ? () => setLabeling(true) : undefined
      }
    />
  )

  if (labeling && plotImageNames.length > 0) {
    return (
      <LabelingWorkspace
        images={plotImageNames}
        experimentId={run.uploadScope?.experimentId}
        onClose={() => setLabeling(false)}
        onUseTrained={(m) =>
          updatePipeline(pipeline.id, {
            params: {
              ...pipeline.params,
              roboflow_models: [
                ...((pipeline.params.roboflow_models as unknown[]) ?? []),
                m,
              ],
            },
          })
        }
      />
    )
  }

  if (models.length === 0) {
    return (
      <div className="space-y-4">
        {results}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No models yet</CardTitle>
            <CardDescription>
              {run.steps.inference?.jobIds?.length
                ? "Models were run on this run (below) but are not in this pipeline's list. Add one with its button to run it again, or set up another."
                : "Add a model to run on the plot images (Roboflow, Hugging Face, your own weights, or another provider), or start by labelling plot images yourself to build a training set."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button onClick={openModelSetup}>Set up a model</Button>
            <Button
              variant="outline"
              disabled={plotImageNames.length === 0}
              onClick={() => setLabeling(true)}
            >
              Label plot images
            </Button>
            <span className="text-muted-foreground text-xs">
              {imagesQuery.isLoading
                ? "Finding plot images…"
                : plotImageNames.length === 0
                  ? "No plot images yet: split the orthomosaic into plot images first."
                  : `${plotImageNames.length} plot images`}
            </span>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {(run.steps.inference?.jobIds?.length ?? 0) === 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {resultActions}
          {labelBlankButton}
        </div>
      )}
      {results}
      <Sheet open={runPanel} onOpenChange={setRunPanel}>
        <SheetContent
          side="right"
          className="w-[min(94vw,60rem)] overflow-y-auto sm:max-w-none"
          data-testid="inference-run-panel"
        >
          <SheetHeader className="pb-0">
            <SheetTitle>Run a model</SheetTitle>
            <SheetDescription>
              Try a model on the image shown, or on every image of this date.
              For every date at once, use "Run across dates" on the run list.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-6">
            {/* The choices on the left, the image they apply to on the right. */}
            <Card className="border-0 py-0 shadow-none">
              <CardContent className="grid gap-4 px-0 md:grid-cols-[minmax(15rem,20rem)_1fr]">
                <div className="space-y-3">
                  <div>
                    <Label className="mb-1.5 text-xs" htmlFor="inference-model">
                      Model
                    </Label>
                    <Select
                      value={String(activeModelIdx)}
                      onValueChange={(v) => setActiveModelIdx(Number(v))}
                    >
                      <SelectTrigger
                        id="inference-model"
                        data-testid="inference-model"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((m, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {modelDisplayName(m)} · {sourceLabel(m.source)},{" "}
                            {TASK_LABELS[m.task_type].toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p
                      className="text-muted-foreground mt-1 text-xs"
                      data-testid="inference-endpoint"
                    >
                      {endpointDescription(activeModel, localServerUrl)}
                    </p>
                  </div>
                  {activeModel?.source === "huggingface" &&
                    activeModel.hf_zero_shot && (
                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor="inference-prompt">
                          What to find (this run only)
                        </Label>
                        <Textarea
                          id="inference-prompt"
                          data-testid="inference-prompt"
                          rows={2}
                          className="font-mono text-xs"
                          value={activePrompt}
                          placeholder="pod: one green cowpea pod, not a leaf"
                          onChange={(e) =>
                            setPromptOverrides((o) => ({
                              ...o,
                              [activeModelIdx]: e.target.value,
                            }))
                          }
                        />
                      </div>
                    )}
                  <div>
                    <Label
                      className="mb-1.5 text-xs"
                      htmlFor="inference-source"
                    >
                      Image source
                    </Label>
                    <Select
                      value={String(sourceIdx)}
                      onValueChange={(v) => setSourceIdx(Number(v))}
                    >
                      <SelectTrigger
                        id="inference-source"
                        data-testid="inference-source"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sources.map((s, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <code
                      className="text-muted-foreground mt-1 block truncate text-[11px]"
                      title={activePrefix}
                    >
                      {activePrefix}
                    </code>
                  </div>
                  <div>
                    <Label className="mb-1.5 text-xs" htmlFor="inference-mode">
                      Run on
                    </Label>
                    <Select
                      value={mode}
                      onValueChange={(v) => setMode(v as "single" | "all")}
                    >
                      <SelectTrigger
                        id="inference-mode"
                        data-testid="inference-mode"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="single">The image shown</SelectItem>
                        <SelectItem value="all">
                          Every image at this source
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {mode === "all" && (
                      <p
                        className="text-muted-foreground mt-1 text-xs"
                        data-testid="inference-mode-all-note"
                      >
                        {images.length} image{images.length === 1 ? "" : "s"} in
                        one job, counted per plot.
                        {sourceIdx === 0
                          ? " Counts are saved as traits, so they appear in Analyze."
                          : sources[sourceIdx].plots
                            ? " Counts from the raw frames are kept with the results; traits come from the orthomosaic's plot images."
                            : " Raw frames have no plot identity, so counts aren't saved as traits."}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      data-testid="inference-submit"
                      onClick={() => submit.mutate()}
                      disabled={!activeImage || submit.isPending}
                    >
                      {submit.isPending ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {mode === "all"
                        ? "Run on every image"
                        : "Run on this image"}
                    </Button>
                    {submittedJobId && (
                      <span className="text-muted-foreground text-xs">
                        Job {submittedJobId.slice(0, 8)} ·{" "}
                        {jobQuery.data?.status ?? "submitting…"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="min-w-0 space-y-2">
                  {imagesQuery.isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
                    </div>
                  ) : images.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No images at this source.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={imageIdx === 0}
                          onClick={() => setImageIdx((i) => Math.max(0, i - 1))}
                          aria-label="Previous image"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-muted-foreground truncate text-xs">
                          {activeImageName} · {imageIdx + 1} of {images.length}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={imageIdx >= images.length - 1}
                          onClick={() =>
                            setImageIdx((i) =>
                              Math.min(images.length - 1, i + 1),
                            )
                          }
                          aria-label="Next image"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                      <div
                        className="bg-muted relative overflow-hidden rounded border"
                        data-testid="inference-image-viewer"
                      >
                        {activeImageBlob ? (
                          <ZoomableOverlay
                            src={activeImageBlob}
                            alt={activeImageName}
                            predictions={filteredPredictions}
                            className="h-[min(70svh,44rem)]"
                            showBoxes={look.showBoxes}
                            showLabels={look.showLabels}
                            opacity={look.opacity}
                          />
                        ) : (
                          <div className="flex h-[40vh] items-center justify-center">
                            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
                          </div>
                        )}
                      </div>
                      {filteredPredictions.length > 0 && (
                        <OverlayControls look={look} onChange={setLook} />
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {jobQuery.data?.status === "FAILED" && (
              <p
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-800 text-sm"
                data-testid="inference-job-failed"
              >
                Inference failed:{" "}
                {String(
                  (jobQuery.data as { error_message?: string | null })
                    .error_message ?? "unknown error",
                )}
              </p>
            )}

            {jobQuery.data?.status === "COMPLETED" &&
              isBatchInferenceResult(jobQuery.data.result) && (
                <BatchInferenceSummary
                  result={jobQuery.data.result}
                  fileStem={`inference-${submittedJobId?.slice(0, 8) ?? "run"}`}
                  experiment={run.uploadScope?.experiment}
                />
              )}

            {predictions && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Results</CardTitle>
                  <CardDescription>
                    {predictions.length} raw detection
                    {predictions.length === 1 ? "" : "s"}; showing{" "}
                    {filteredPredictions.length} above threshold.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm" htmlFor="inference-threshold">
                        Confidence threshold
                      </Label>
                      <span className="text-muted-foreground font-mono text-sm">
                        {confThreshold.toFixed(2)}
                      </span>
                    </div>
                    <Input
                      id="inference-threshold"
                      data-testid="inference-threshold"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={confThreshold}
                      onChange={(e) =>
                        setConfThreshold(parseFloat(e.target.value))
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {Object.entries(
                      filteredPredictions.reduce<Record<string, number>>(
                        (acc, p) => {
                          acc[p.class] = (acc[p.class] ?? 0) + 1
                          return acc
                        },
                        {},
                      ),
                    ).map(([cls, n]) => (
                      <span
                        key={cls}
                        className="inline-flex items-center gap-1 rounded border px-2 py-0.5"
                        style={{ borderColor: classColour(cls) }}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: classColour(cls) }}
                        />
                        {cls}: {n}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function endpointDescription(
  model: InferenceModel | undefined,
  localServerUrl: string | undefined,
): string {
  if (!model) return ""
  if (model.source === "huggingface") {
    return model.hf_mode === "cloud"
      ? `Using Hugging Face cloud inference for ${model.hf_model_id}.`
      : `Running ${model.hf_model_id} in the processing worker (downloaded on first use, then cached).`
  }
  if (model.source === "local_weights") {
    return `Running your uploaded weights (${modelDisplayName(model)}) in the processing worker.`
  }
  return localServerUrl
    ? `Using the local inference server at ${localServerUrl}.`
    : "Using Roboflow cloud inference."
}
