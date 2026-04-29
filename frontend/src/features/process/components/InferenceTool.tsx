/**
 * InferenceTool — submit LOCATE_PLANTS on a single image and view results.
 *
 * R5c MVP. Differences vs main's 1,340-LOC version:
 *   - Single-image inference instead of "every plot image" fan-out. The
 *     GEMINIbase LOCATE_PLANTS worker is single-image; per-plot fan-out
 *     would need either a worker change or hundreds of jobs submitted in
 *     parallel from the client. Defer the fan-out to a later pass.
 *   - Model list comes from the pipeline's saved Roboflow config (set in
 *     the R3 wizard's step 3). No extra fetch required.
 *   - Threshold slider does client-side NMS / filtering on the cached
 *     predictions JSON; no /apply-inference-threshold endpoint needed.
 *   - Past inference jobs for this run + image are listed below the
 *     viewer using runStore's step jobIds.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Loader2, Play } from "lucide-react"

import { FilesService, JobsService, type FileMetadata, type JobOutput } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { executeStep } from "@/features/process/lib/runApi"
import {
  type Pipeline,
  type Run,
  type Workspace,
} from "@/features/process/lib/runStore"
import type { AerialScope } from "@/features/process/lib/paths"
import {
  plotImagesPrefix,
  rawImagesPrefix,
} from "@/features/process/lib/paths"
import useCustomToast from "@/hooks/useCustomToast"
import { isLoggedIn } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"

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
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
]

function classColour(cls: string): string {
  let hash = 0
  for (let i = 0; i < cls.length; i += 1) hash = (hash * 31 + cls.charCodeAt(i)) | 0
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
    fetch(`/api/files/download/${path}`, {
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
  workspace: Workspace
  pipeline: Pipeline
  run: Run
  scope: AerialScope
  onSaved?: () => void
  onCancel?: () => void
}

export function InferenceTool({
  workspace,
  pipeline,
  run,
  scope,
  onCancel,
}: InferenceToolProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()

  // Roboflow models from the pipeline config (R3 wizard step 3).
  const models = useMemo<RoboflowModel[]>(() => {
    const arr = (pipeline.params.roboflow_models as RoboflowModel[]) ?? []
    return arr.filter((m) => m.roboflow_model_id?.trim())
  }, [pipeline.params.roboflow_models])

  const [activeModelIdx, setActiveModelIdx] = useState(0)
  const activeModel = models[activeModelIdx]

  // Image source: prefer plot-image crops if SPLIT_ORTHOMOSAIC has run;
  // otherwise fall back to raw images for a single-image smoke test.
  const sources = useMemo(
    () => [
      { label: "Plot images (post-split)", prefix: plotImagesPrefix(scope) },
      { label: "Raw drone images", prefix: rawImagesPrefix(scope) },
    ],
    [scope],
  )
  const [sourceIdx, setSourceIdx] = useState(0)
  const activePrefix = sources[sourceIdx].prefix

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
  useEffect(() => setImageIdx(0), [sourceIdx])

  // Submit + polling.
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null)
  const submit = useMutation({
    mutationFn: async () => {
      if (!activeModel) throw new Error("Pick a Roboflow model first")
      if (!activeImage) throw new Error("Pick an image first")
      const imagePath = activeImage.object_name ?? ""
      const outputPath = `${plotImagesPrefix(scope)}inference/${
        activeImageName.replace(/\.[^.]+$/, "")
      }-${activeModelIdx}-${Date.now()}.json`
      const result = await executeStep({
        runId: run.id,
        stepKey: "inference",
        scope,
        experimentId: workspace.experimentId,
        inference: {
          imagePath,
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
            if (j?.status === "COMPLETED" || j?.status === "FAILED" || j?.status === "CANCELLED") {
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

  const predictionsPath = (jobQuery.data?.parameters as
    | { output_predictions_path?: string }
    | null
    | undefined)?.output_predictions_path ?? null

  // Download predictions JSON once the job is COMPLETED and we know the path.
  const [predictions, setPredictions] = useState<Prediction[] | null>(null)
  useEffect(() => {
    if (jobQuery.data?.status !== "COMPLETED" || !predictionsPath) {
      setPredictions(null)
      return
    }
    let cancelled = false
    const token = localStorage.getItem("gemini.auth.token") ?? ""
    fetch(`/api/files/download/${DEFAULT_BUCKET}/${predictionsPath}`, {
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
    () =>
      (predictions ?? []).filter((p) => p.confidence >= confThreshold),
    [predictions, confThreshold],
  )

  if (models.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No Roboflow models configured</CardTitle>
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
          </div>
          <code className="bg-muted block break-all rounded px-2 py-1 text-xs">
            {activePrefix}
          </code>
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
