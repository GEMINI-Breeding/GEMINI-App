/**
 * Train a detector from a labelled set (TRAIN_MODEL on the ML worker).
 *
 * The person picks a name, what to start from and how much they labelled;
 * the set goes up as COCO JSON and the worker fine-tunes an Ultralytics YOLO
 * model on it (training.py). The result lands with the other weights, so it
 * can be picked in any pipeline ("Your weights") or added here straight away.
 */
import { useQuery } from "@tanstack/react-query"
import { GraduationCap, Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { type JobOutput, JobsService, PlotGeometryService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  emptyModel,
  type InferenceModel,
} from "@/features/process/lib/inferenceModels"
import {
  BASE_MODELS_PREFIX,
  useUploadedWeights,
  weightsName,
} from "@/features/process/lib/knownModels"
import { type LabelSet, toCoco } from "@/features/process/lib/labelSet"
import { uploadFileChunked } from "@/lib/chunkedUpload"

const BASES = [
  { id: "yolo11n", label: "YOLO11 nano — fastest", outlines: false },
  { id: "yolo11s", label: "YOLO11 small — balanced", outlines: false },
  { id: "yolo11m", label: "YOLO11 medium — most accurate", outlines: false },
  { id: "yolo11n-seg", label: "YOLO11 nano, outlines", outlines: true },
  { id: "yolo11s-seg", label: "YOLO11 small, outlines", outlines: true },
]

const PRESETS = [
  {
    id: "few",
    label: "Few labels (under ~30 images)",
    note: "Keeps the pretrained layers, augments hard, trains longer.",
  },
  {
    id: "standard",
    label: "Many labels",
    note: "Trains every layer.",
  },
  {
    id: "quick",
    label: "Quick check (30 epochs)",
    note: "To see whether the labels are enough before a full run.",
  },
]

/** The same set on other dates of the run's scope: the directory differs
 *  only in its date segment (Processed/{year}/{exp}/{site}/{crop}/{date}/…). */
export function siblingSets(directory: string, all: string[]): string[] {
  const mine = directory.split("/")
  if (mine.length < 9 || mine[0] !== "Processed") return []
  return [...new Set(all)].filter((d) => {
    const o = d.split("/")
    return (
      d !== directory &&
      o.length === mine.length &&
      o.every((seg, i) => i === 5 || seg === mine[i])
    )
  })
}

/** One set from several dates' sets (their done images). */
export function mergeSets(sets: LabelSet[]): LabelSet {
  const classes = new Set<string>()
  const images: LabelSet["images"] = {}
  for (const s of sets) {
    for (const c of s.classes) classes.add(c)
    for (const [k, v] of Object.entries(s.images)) if (v.done) images[k] = v
  }
  return { classes: [...classes], images }
}

export function TrainModelDialog({
  open,
  onOpenChange,
  set: ownSet,
  directory,
  experimentId,
  defaultName,
  onUse,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  set: LabelSet
  /** Where this set is kept: the same set on other dates can join the training. */
  directory?: string
  experimentId?: string
  defaultName: string
  /** Add the trained model to the pipeline (when the caller can). */
  onUse?: (m: InferenceModel) => void
}) {
  // The same set on the scope's other dates (labelled there by a person or
  // the agent): a model for the whole season learns from all of them.
  const others = useQuery({
    queryKey: ["label-set-siblings", directory],
    enabled: open && Boolean(directory),
    queryFn: async () => {
      const all =
        ((await PlotGeometryService.apiPlotGeometryVersionsAllListAllVersions().catch(
          () => [],
        )) ?? []) as { directory?: string }[]
      const dirs = siblingSets(
        directory as string,
        all.map((v) => String(v.directory ?? "")),
      )
      const loaded = await Promise.all(
        dirs.map(async (d) => {
          try {
            const r =
              (await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion(
                {
                  requestBody: { directory: d },
                },
              )) as { state_snapshot?: LabelSet }
            return { directory: d, set: r.state_snapshot ?? null }
          } catch {
            return { directory: d, set: null }
          }
        }),
      )
      return loaded
        .filter((x): x is { directory: string; set: LabelSet } =>
          Boolean(
            x.set && Object.values(x.set.images ?? {}).some((i) => i.done),
          ),
        )
        .map((x) => ({ ...x, date: x.directory.split("/")[5] ?? x.directory }))
        .sort((a, b) => a.date.localeCompare(b.date))
    },
    staleTime: 30_000,
  })
  const [left, setLeft] = useState<Set<string>>(new Set())
  const joined = (others.data ?? []).filter((o) => !left.has(o.directory))
  const set = mergeSets([ownSet, ...joined.map((o) => o.set)])
  const images = Object.values(set.images).filter((i) => i.done)
  const objects = images.reduce(
    (n, i) => n + i.annotations.filter((a) => a.status === "kept").length,
    0,
  )
  const hasOutlines = images.some((i) =>
    i.annotations.some((a) => a.status === "kept" && a.points?.length),
  )
  const [name, setName] = useState(defaultName)
  const [base, setBase] = useState("yolo11n")
  const [preset, setPreset] = useState(images.length < 30 ? "few" : "standard")
  const [jobId, setJobId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const own = useUploadedWeights()
  const ag = useUploadedWeights(BASE_MODELS_PREFIX)

  const job = useQuery({
    queryKey: ["train-job", jobId],
    queryFn: () =>
      JobsService.apiJobsJobIdGetJob({ jobId: jobId as string }) as Promise<
        JobOutput & {
          progress?: number
          progress_detail?: Record<string, unknown>
          result?: Record<string, unknown>
          error_message?: string
        }
      >,
    enabled: Boolean(jobId),
    refetchInterval: (q) =>
      ["COMPLETED", "FAILED", "CANCELLED"].includes(
        String(q.state.data?.status ?? ""),
      )
        ? false
        : 5000,
  })

  const start = async () => {
    setStarting(true)
    try {
      const stamp = Date.now()
      const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_") || "labels"
      const objectName = `Models/training/sets/${stamp}-${safe}.json`
      const blob = new Blob([JSON.stringify(toCoco(set))], {
        type: "application/json",
      })
      await uploadFileChunked({
        file: new File([blob], `${safe}.json`, { type: "application/json" }),
        fileIdentifier: `${objectName}-${blob.size}`,
        objectName,
      })
      const fromStorage = base.startsWith("Models/")
      const submitted = (await JobsService.apiJobsSubmitSubmitJob({
        requestBody: {
          job_type: "TRAIN_MODEL",
          parameters: {
            coco_path: objectName,
            name,
            preset,
            ...(fromStorage ? { base_weights_path: base } : { base }),
          },
          ...(experimentId ? { experiment_id: experimentId } : {}),
        },
      })) as { id?: string }
      setJobId(String(submitted.id ?? ""))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start training")
    } finally {
      setStarting(false)
    }
  }

  const j = job.data
  const status = String(j?.status ?? "")
  const detail = (j?.progress_detail ?? {}) as Record<string, unknown>
  const result = (j?.result ?? {}) as Record<string, unknown>
  const metrics = (result.metrics ?? {}) as Record<string, number>
  const trained: InferenceModel | null =
    status === "COMPLETED" && typeof result.weights_path === "string"
      ? {
          ...emptyModel("local_weights"),
          label: String(result.name ?? name),
          weights_path: result.weights_path,
          weights_name: String(result.weights_name ?? ""),
          task_type:
            result.task_type === "segmentation" ? "segmentation" : "detection",
        }
      : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="train-dialog">
        <DialogHeader>
          <DialogTitle>Train a model from these labels</DialogTitle>
          <DialogDescription>
            {images.length} saved image{images.length === 1 ? "" : "s"} ·{" "}
            {objects} object{objects === 1 ? "" : "s"} ·{" "}
            {set.classes.join(", ") || "no classes"}. Runs on the ML worker (a
            GPU worker trains in minutes; a CPU one is capped at 40 epochs).
          </DialogDescription>
        </DialogHeader>

        {!jobId ? (
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <Label htmlFor="train-name" className="text-xs">
                Name (also the trait name in Analyze)
              </Label>
              <Input
                id="train-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Start from</Label>
              <Select value={base} onValueChange={setBase}>
                <SelectTrigger data-testid="train-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BASES.filter((b) => !b.outlines || hasOutlines).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.label}
                    </SelectItem>
                  ))}
                  {(ag.data ?? []).map((f) => (
                    <SelectItem key={f.object_name} value={f.object_name ?? ""}>
                      Ag model: {weightsName(f.object_name ?? "")}
                    </SelectItem>
                  ))}
                  {(own.data ?? []).map((f) => (
                    <SelectItem key={f.object_name} value={f.object_name ?? ""}>
                      Your weights: {weightsName(f.object_name ?? "")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                A model already trained on similar plants learns faster from few
                labels. Outline models need outlines on the labels
                {hasOutlines ? "" : " (none yet: use Masks)"}.
              </p>
            </div>
            {(others.data?.length ?? 0) > 0 && (
              <div className="space-y-1" data-testid="train-other-dates">
                <Label className="text-xs">
                  The same set on other dates (a model for the whole season)
                </Label>
                {(others.data ?? []).map((o) => {
                  const n = Object.values(o.set.images).filter(
                    (i) => i.done,
                  ).length
                  return (
                    <label
                      key={o.directory}
                      className="flex items-center gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={!left.has(o.directory)}
                        onChange={(e) =>
                          setLeft((cur) => {
                            const next = new Set(cur)
                            if (e.target.checked) next.delete(o.directory)
                            else next.add(o.directory)
                            return next
                          })
                        }
                      />
                      {o.date} · {n} image{n === 1 ? "" : "s"}
                    </label>
                  )
                })}
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">How many labels you have</Label>
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger data-testid="train-preset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {PRESETS.find((p) => p.id === preset)?.note}{" "}
                {images.length < 5 &&
                  "With under 5 images there is nothing to hold back for checking, so the scores will look better than the model is."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm" data-testid="train-progress">
            {status === "FAILED" || status === "CANCELLED" ? (
              <p className="text-destructive">
                {j?.error_message ?? "Training failed."}
              </p>
            ) : trained ? (
              <>
                <p>
                  Trained: <span className="font-medium">{trained.label}</span>
                  {metrics.map50 != null &&
                    ` · mAP50 ${metrics.map50.toFixed(2)}`}
                  {metrics.precision != null &&
                    ` · precision ${metrics.precision.toFixed(2)}`}
                  {metrics.recall != null &&
                    ` · recall ${metrics.recall.toFixed(2)}`}
                </p>
                <p className="text-muted-foreground text-xs">
                  Saved with your weights: pick it in any pipeline under “Your
                  weights”.
                  {result.validation_is_training
                    ? " Scored on its own training images (too few to hold any back)."
                    : ""}
                </p>
              </>
            ) : (
              <p className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                {status === "PENDING"
                  ? "Waiting for an ML worker…"
                  : String(detail.stage ?? "Training…")}
                {typeof detail.map50 === "number" &&
                  ` · mAP50 ${(detail.map50 as number).toFixed(2)}`}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {!jobId ? (
            <Button
              onClick={() => void start()}
              disabled={starting || !images.length || !objects || !name.trim()}
              data-testid="train-start"
            >
              {starting ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <GraduationCap className="mr-1.5 size-4" />
              )}
              Start training
            </Button>
          ) : trained && onUse ? (
            <Button
              onClick={() => {
                onUse(trained)
                onOpenChange(false)
              }}
            >
              Add to this pipeline
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {status === "COMPLETED"
                ? "Close"
                : "Keep training in the background"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
