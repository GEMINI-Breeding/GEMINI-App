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
 *   - Model list comes from the pipeline's saved Roboflow config (set in
 *     the R3 wizard's step 3). No extra fetch required.
 *   - Threshold slider does client-side NMS / filtering on the cached
 *     predictions JSON; no /apply-inference-threshold endpoint needed.
 *   - Past inference jobs for this run + image are listed below the
 *     viewer using runStore's step jobIds.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Loader2, Play, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  type FileMetadata,
  FilesService,
  type JobOutput,
  JobsService,
  PlotGeometryService,
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
import { apiUrl } from "@/features/files/lib/download"
import {
  type BatchInferenceResult,
  isBatchInferenceResult,
  summaryCsv,
  summaryRows,
} from "@/features/process/lib/inferenceSummary"
import type { AerialScope } from "@/features/process/lib/paths"
import {
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
import type { Pipeline, Run } from "@/features/process/lib/runStore"
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

/**
 * Plot polygons of the active plot-geometry version at `directory`, or
 * undefined when there is none. Absence isn't an error: inference still
 * runs, it just can't attribute counts to plots.
 */
async function loadActiveBoundaries(
  directory: string,
): Promise<GeoJSON.FeatureCollection | undefined> {
  const versions =
    ((await PlotGeometryService.apiPlotGeometryVersionsListListVersions({
      requestBody: { directory },
    })) ?? []) as Array<{ version: number; is_active?: boolean }>
  const active =
    versions.find((v) => v.is_active)?.version ?? versions[0]?.version
  if (active == null) return undefined
  const loaded =
    (await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion({
      requestBody: { directory, version: active },
    })) as unknown as {
      state_snapshot?: { boundaries?: GeoJSON.FeatureCollection }
    }
  const fc = loaded?.state_snapshot?.boundaries
  return fc?.features?.length ? fc : undefined
}

interface RoboflowModel {
  label: string
  roboflow_api_key: string
  roboflow_model_id: string
  task_type: string
}

export interface Prediction {
  image?: string
  class: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
  points?: Array<{ x: number; y: number }>
}

const CLASS_COLOURS = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
  "#6366f1",
]

function classColour(cls: string): string {
  let hash = 0
  for (let i = 0; i < cls.length; i += 1)
    hash = (hash * 31 + cls.charCodeAt(i)) | 0
  return CLASS_COLOURS[Math.abs(hash) % CLASS_COLOURS.length]
}

/** Authed fetch → blob URL for an arbitrary MinIO file. */
function useAuthedBlobUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) {
      setUrl(null)
      return
    }
    let cancelled = false
    let urlRef: string | null = null
    const token = localStorage.getItem("gemini.auth.token") ?? ""
    fetch(apiUrl(`/api/files/download/${path}`), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (cancelled || !b) return
        urlRef = URL.createObjectURL(b)
        setUrl(urlRef)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
      if (urlRef) URL.revokeObjectURL(urlRef)
    }
  }, [path])
  return url
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
  onCancel,
}: InferenceToolProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()

  // Roboflow models from the pipeline config (R3 wizard step 3).
  const localServerUrl =
    pipeline.params.inference_mode === "local"
      ? (
          (pipeline.params.local_server_url as string | undefined) ?? ""
        ).trim() || undefined
      : undefined
  const models = useMemo<RoboflowModel[]>(() => {
    const arr = (pipeline.params.roboflow_models as RoboflowModel[]) ?? []
    return arr.filter((m) => m.roboflow_model_id?.trim())
  }, [pipeline.params.roboflow_models])

  const [activeModelIdx, setActiveModelIdx] = useState(0)
  const activeModel = models[activeModelIdx]

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
      },
      { label: "Raw drone images", prefix: rawPrefix },
    ]
  }, [scope, datasetShortIds])
  const [sourceIdx, setSourceIdx] = useState(0)
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
      if (!activeModel) throw new Error("Pick a Roboflow model first")
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
      // Batch over plot images: send the active boundary version so the
      // worker can write per-plot counts to trait_records. Those are the
      // polygons the split used, so plot numbers line up with the PNGs.
      // Raw drone frames have no plot identity, so nothing is ingested.
      let boundaries: GeoJSON.FeatureCollection | undefined
      if (mode === "all" && sourceIdx === 0) {
        boundaries = await loadActiveBoundaries(processedPrefix(scope))
      }
      const result = await executeStep({
        runId: run.id,
        stepKey: "inference",
        scope,
        experimentId,
        inference: {
          ...(mode === "all" ? { imagesPrefix: activePrefix } : { imagePath }),
          ...(boundaries ? { boundaries } : {}),
          countLabel: activeModel.label || activeModel.roboflow_model_id,
          // The pipeline form has always collected these; until now nothing
          // read them, so choosing "local" silently still used the cloud.
          ...(localServerUrl ? { apiUrl: localServerUrl } : {}),
          apiKey: activeModel.roboflow_api_key,
          modelId: activeModel.roboflow_model_id,
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

  if (models.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            No Roboflow models configured
          </CardTitle>
          <CardDescription>
            Open the pipeline settings (Step 3 of the wizard) and add at least
            one Roboflow model entry. Then return here to run inference.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inference setup</CardTitle>
          <CardDescription>
            Pick a model + a sample image to test detection. Predictions are
            written to MinIO and rendered below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 text-xs" htmlFor="inference-model">
                Roboflow model
              </Label>
              <Select
                value={String(activeModelIdx)}
                onValueChange={(v) => setActiveModelIdx(Number(v))}
              >
                <SelectTrigger
                  id="inference-model"
                  data-testid="inference-model"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {m.label || m.roboflow_model_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 text-xs" htmlFor="inference-source">
                Image source
              </Label>
              <Select
                value={String(sourceIdx)}
                onValueChange={(v) => setSourceIdx(Number(v))}
              >
                <SelectTrigger
                  id="inference-source"
                  data-testid="inference-source"
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
            </div>
            <div>
              <Label className="mb-1.5 text-xs" htmlFor="inference-mode">
                Run on
              </Label>
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as "single" | "all")}
              >
                <SelectTrigger id="inference-mode" data-testid="inference-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">
                    The previewed image only
                  </SelectItem>
                  <SelectItem value="all">
                    Every image at this source
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <code className="bg-muted block break-all rounded px-2 py-1 text-xs">
            {activePrefix}
          </code>
          <p
            className="text-muted-foreground text-xs"
            data-testid="inference-endpoint"
          >
            {localServerUrl
              ? `Using the local inference server at ${localServerUrl}.`
              : "Using Roboflow cloud inference."}
          </p>
          {mode === "all" && (
            <p
              className="text-muted-foreground text-xs"
              data-testid="inference-mode-all-note"
            >
              {images.length} image{images.length === 1 ? "" : "s"} will be
              inferred in a single job, with detections counted per plot.
              {sourceIdx === 0
                ? " Counts are saved as traits for this plot layout, so they appear in Analyze."
                : " Raw frames have no plot identity, so counts aren't saved as traits."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Image
            {images.length > 0 && (
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                {imageIdx + 1} of {images.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {imagesQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : images.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No images at this prefix.
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
                <span className="text-muted-foreground text-xs">
                  {activeImageName}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={imageIdx >= images.length - 1}
                  onClick={() =>
                    setImageIdx((i) => Math.min(images.length - 1, i + 1))
                  }
                  aria-label="Next image"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div
                className="relative bg-muted rounded border overflow-hidden"
                data-testid="inference-image-viewer"
              >
                {activeImageBlob ? (
                  <PredictionOverlay
                    src={activeImageBlob}
                    alt={activeImageName}
                    predictions={filteredPredictions}
                  />
                ) : (
                  <div className="flex h-[40vh] items-center justify-center">
                    <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex items-center justify-between gap-3">
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
              Run inference
            </Button>
            {submittedJobId && (
              <span className="text-muted-foreground text-xs">
                Job {submittedJobId.slice(0, 8)} ·{" "}
                {jobQuery.data?.status ?? "submitting…"}
              </span>
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
                onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
              />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(
                filteredPredictions.reduce<Record<string, number>>((acc, p) => {
                  acc[p.class] = (acc[p.class] ?? 0) + 1
                  return acc
                }, {}),
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

      {onCancel && (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onCancel}>
            Done
          </Button>
        </div>
      )}
    </div>
  )
}

function PredictionOverlay({
  src,
  alt,
  predictions,
}: {
  src: string
  alt: string
  predictions: Prediction[]
}) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    function onResize() {
      if (imgRef.current) setRect(imgRef.current.getBoundingClientRect())
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  return (
    <div className="relative">
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="block max-h-[60vh] w-full object-contain"
        onLoad={() => {
          if (imgRef.current) setRect(imgRef.current.getBoundingClientRect())
        }}
        draggable={false}
      />
      {imgRef.current &&
        predictions.map((p, i) => {
          const img = imgRef.current
          if (!img) return null
          const w = img.clientWidth
          const h = img.clientHeight
          const sx = w / img.naturalWidth
          const sy = h / img.naturalHeight
          const left = (p.x - p.width / 2) * sx
          const top = (p.y - p.height / 2) * sy
          const width = p.width * sx
          const height = p.height * sy
          const colour = classColour(p.class)
          return (
            <div
              key={i}
              className="pointer-events-none absolute border-2"
              style={{ left, top, width, height, borderColor: colour }}
              title={`${p.class} (${(p.confidence * 100).toFixed(0)}%)`}
            >
              <span
                className="absolute -top-4 left-0 rounded-sm px-1 text-[10px] font-medium text-white"
                style={{ background: colour }}
              >
                {p.class} {(p.confidence * 100).toFixed(0)}%
              </span>
            </div>
          )
        })}
    </div>
  )
}
