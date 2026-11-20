/**
 * One model entry in the pipeline's inference step. It starts from what kind
 * of model it is, not where it is hosted:
 *   - Describe it: a zero-shot model finds objects from a written description
 *     (SAM 3 recommended, OWLv2 without a token), with brief prompting tips.
 *   - Your weights: a .pt / .onnx you trained (here or elsewhere), chosen from
 *     the ones in storage or uploaded.
 *   - Hugging Face: a trained model from the Hub, by its ID.
 *   - Roboflow: a hosted Roboflow model.
 * Local weights are uploaded straight into storage; the entry keeps the object
 * path, which the ML worker downloads and caches.
 */
import { Lightbulb, Upload, X } from "lucide-react"
import { useRef, useState } from "react"
import { FilesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  type InferenceModel,
  modelDisplayName,
  modelProblem,
  sameModel,
  sourceLabel,
  type TaskType,
  tasksFor,
  WEIGHTS_EXTENSIONS,
  weightsFileProblem,
  weightsObjectPath,
} from "@/features/process/lib/inferenceModels"
import {
  type KnownModel,
  useUploadedWeights,
  weightsName,
} from "@/features/process/lib/knownModels"
import {
  PROMPT_PLACEHOLDER,
  PROMPT_TIPS,
  presetFor,
  promptClasses,
  ZERO_SHOT_PRESETS,
} from "@/features/process/lib/zeroShot"
import { uploadFileChunked } from "@/lib/chunkedUpload"
import { useCredentials } from "@/lib/credentials"

interface Props {
  model: InferenceModel
  index: number
  onChange: (next: InferenceModel) => void
  onRemove: () => void
  canRemove: boolean
}

type Kind = "describe" | "weights" | "huggingface" | "roboflow" | "other"

const KINDS: { kind: Exclude<Kind, "other">; label: string; hint: string }[] = [
  {
    kind: "describe",
    label: "Describe it",
    hint: "No training: write what to find (zero-shot)",
  },
  {
    kind: "weights",
    label: "Your weights",
    hint: "A model you trained (.pt / .onnx)",
  },
  {
    kind: "huggingface",
    label: "Hugging Face",
    hint: "A trained model from the Hub",
  },
  {
    kind: "roboflow",
    label: "Roboflow",
    hint: "Roboflow's cloud or your own server",
  },
]

export function kindOf(m: InferenceModel): Kind {
  if (m.source === "huggingface")
    return m.hf_zero_shot ? "describe" : "huggingface"
  if (m.source === "local_weights") return "weights"
  if (m.source === "roboflow") return "roboflow"
  return "other"
}

export function InferenceModelEditor({
  model,
  index,
  onChange,
  onRemove,
  canRemove,
}: Props) {
  const set = (patch: Partial<InferenceModel>) => {
    const next = { ...model, ...patch }
    // Keep the task valid when the kind or model changes.
    if (!tasksFor(next).includes(next.task_type)) next.task_type = "detection"
    onChange(next)
  }
  const kind = kindOf(model)
  const savedRoboflow = Boolean(useCredentials().data?.roboflow_api_key)
  const pickKind = (k: Kind) => {
    if (k === kind) return
    if (k === "describe")
      set({
        source: "huggingface",
        hf_zero_shot: true,
        hf_mode: "local",
        hf_model_id: presetFor(model.hf_model_id)
          ? model.hf_model_id
          : ZERO_SHOT_PRESETS[0].hf_model_id,
      })
    else if (k === "huggingface")
      set({
        source: "huggingface",
        hf_zero_shot: false,
        hf_model_id: presetFor(model.hf_model_id) ? "" : model.hf_model_id,
      })
    else if (k === "weights") set({ source: "local_weights" })
    else if (k === "roboflow") set({ source: "roboflow" })
  }
  const id = (field: string) => `model-${index}-${field}`
  const problem = modelProblem(model)
  const started =
    model.roboflow_model_id ||
    model.hf_model_id ||
    model.weights_path ||
    model.label
  const tasks = tasksFor(model)

  return (
    <div
      className="space-y-3 rounded-lg border p-3"
      data-testid={`inference-model-${index}`}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Label className="text-muted-foreground text-xs">
            What kind of model?
          </Label>
          <div
            className="flex flex-wrap gap-1.5"
            data-testid={`inference-model-${index}-source`}
          >
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                aria-pressed={kind === k.kind}
                title={k.hint}
                onClick={() => pickKind(k.kind)}
                data-testid={`inference-model-${index}-kind-${k.kind}`}
                className={`rounded-md border px-3 py-1.5 text-left text-sm ${
                  kind === k.kind
                    ? "border-primary bg-primary/10"
                    : "hover:bg-muted"
                }`}
              >
                <span className="font-medium">{k.label}</span>
                <span className="text-muted-foreground block text-[11px] leading-tight">
                  {k.hint}
                </span>
              </button>
            ))}
            {kind === "other" && (
              <span className="rounded-md border px-3 py-1.5 text-sm">
                {sourceLabel(model.source)} (added by the agent)
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Remove model"
        >
          <X className="text-muted-foreground h-4 w-4" />
        </Button>
      </div>

      {kind === "describe" && (
        <ZeroShotFields model={model} set={set} id={id} />
      )}

      {kind === "roboflow" && (
        <div className="grid grid-cols-2 gap-2">
          <p className="text-muted-foreground col-span-2 text-xs">
            Runs on Roboflow's cloud, or on a Roboflow inference server you run
            yourself (no images leave your network): choose under “Roboflow
            inference mode” below the models.
          </p>
          <div className="space-y-1">
            <Label
              htmlFor={id("rf-model")}
              className="text-muted-foreground text-xs"
            >
              Model ID
            </Label>
            <Input
              id={id("rf-model")}
              placeholder="my-project/3"
              value={model.roboflow_model_id}
              onChange={(e) => set({ roboflow_model_id: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor={id("rf-key")}
              className="text-muted-foreground text-xs"
            >
              API key
            </Label>
            <Input
              id={id("rf-key")}
              type="password"
              placeholder={
                savedRoboflow
                  ? "Using the key saved in Settings → Keys & tokens"
                  : "rf_xxxxxxxxxxxx (or save one in Settings)"
              }
              value={model.roboflow_api_key}
              onChange={(e) => set({ roboflow_api_key: e.target.value })}
            />
          </div>
        </div>
      )}

      {kind === "huggingface" && (
        <HuggingFaceFields model={model} set={set} id={id} />
      )}

      {kind === "weights" && (
        <LocalWeightsField model={model} set={set} index={index} />
      )}

      <div className="grid grid-cols-[1fr_11rem] items-end gap-2">
        <div className="space-y-1">
          <Label
            htmlFor={id("label")}
            className="text-muted-foreground text-xs"
          >
            Name in results and Analyze{" "}
            <span className="font-normal">(optional)</span>
          </Label>
          <Input
            id={id("label")}
            placeholder={modelDisplayName({ ...model, label: "" })}
            value={model.label}
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Finds</Label>
          <Select
            value={model.task_type}
            onValueChange={(v) => set({ task_type: v as TaskType })}
            disabled={tasks.length < 2}
          >
            <SelectTrigger data-testid={`inference-model-${index}-task`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((t) => (
                <SelectItem key={t} value={t}>
                  {TASK_FINDS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {started && problem && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>
      )}
    </div>
  )
}

/** The task as what the person gets. */
const TASK_FINDS: Record<TaskType, string> = {
  detection: "Boxes (counts)",
  segmentation: "Outlines (counts + area)",
  classification: "A label per image",
}

function ZeroShotFields({
  model,
  set,
  id,
}: {
  model: InferenceModel
  set: (p: Partial<InferenceModel>) => void
  id: (f: string) => string
}) {
  const preset = presetFor(model.hf_model_id)
  const classes = promptClasses(model.hf_prompt)
  const savedToken = Boolean(useCredentials().data?.hf_token)
  const [showTips, setShowTips] = useState(!model.hf_prompt.trim())
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[14rem_1fr] gap-2">
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Model</Label>
          <Select
            value={preset ? preset.id : "other"}
            onValueChange={(v) => {
              const p = ZERO_SHOT_PRESETS.find((x) => x.id === v)
              set({
                hf_model_id: p ? p.hf_model_id : "",
                task_type: p?.outlines ? "segmentation" : "detection",
              })
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ZERO_SHOT_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
              <SelectItem value="other">Another Hub model…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {preset ? (
          <p className="text-muted-foreground self-end pb-1 text-xs">
            {preset.note} Start the confidence near {preset.threshold}.
          </p>
        ) : (
          <div className="space-y-1">
            <Label
              htmlFor={id("hf-model")}
              className="text-muted-foreground text-xs"
            >
              Hugging Face model ID (zero-shot detection)
            </Label>
            <Input
              id={id("hf-model")}
              placeholder="google/owlvit-base-patch32"
              value={model.hf_model_id}
              onChange={(e) => set({ hf_model_id: e.target.value })}
            />
          </div>
        )}
      </div>
      {(preset?.needsToken || !preset) && (
        <div className="space-y-1">
          <Label
            htmlFor={id("hf-token")}
            className="text-muted-foreground text-xs"
          >
            Hugging Face access token{" "}
            {preset?.needsToken ? (
              <a
                href="https://huggingface.co/facebook/sam3"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                (request access to facebook/sam3, then create a read token)
              </a>
            ) : (
              "(gated models only)"
            )}
          </Label>
          <Input
            id={id("hf-token")}
            type="password"
            placeholder={
              savedToken
                ? "Using the token saved in Settings → Keys & tokens"
                : "hf_xxxxxxxxxxxx (or save one in Settings → Keys & tokens)"
            }
            value={model.hf_token}
            onChange={(e) => set({ hf_token: e.target.value })}
          />
        </div>
      )}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label
            htmlFor={id("hf-prompt")}
            className="text-muted-foreground text-xs"
          >
            What to find — one object per line, as name: description
          </Label>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
            onClick={() => setShowTips((v) => !v)}
          >
            <Lightbulb className="size-3.5" />
            {showTips ? "Hide tips" : "Prompt tips"}
          </button>
        </div>
        <Textarea
          id={id("hf-prompt")}
          rows={2}
          className="font-mono text-xs"
          placeholder={PROMPT_PLACEHOLDER}
          value={model.hf_prompt}
          onChange={(e) => set({ hf_prompt: e.target.value })}
          data-testid="zero-shot-prompt"
        />
        {classes.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Classes: {classes.map((c) => c.name).join(", ")}
          </p>
        )}
        {showTips && (
          <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
            {PROMPT_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function HuggingFaceFields({
  model,
  set,
  id,
}: {
  model: InferenceModel
  set: (p: Partial<InferenceModel>) => void
  id: (f: string) => string
}) {
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_1fr_10rem] gap-2">
        <div className="space-y-1">
          <Label
            htmlFor={id("hf-model")}
            className="text-muted-foreground text-xs"
          >
            Model ID
          </Label>
          <Input
            id={id("hf-model")}
            placeholder="facebook/detr-resnet-50"
            value={model.hf_model_id}
            onChange={(e) => set({ hf_model_id: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label
            htmlFor={id("hf-token")}
            className="text-muted-foreground text-xs"
          >
            Access token {model.hf_mode === "local" && "(gated models only)"}
          </Label>
          <Input
            id={id("hf-token")}
            type="password"
            placeholder="hf_xxxxxxxxxxxx"
            value={model.hf_token}
            onChange={(e) => set({ hf_token: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Runs</Label>
          <Select
            value={model.hf_mode}
            onValueChange={(v) => set({ hf_mode: v as "local" | "cloud" })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">On the processing worker</SelectItem>
              <SelectItem value="cloud">Hugging Face cloud</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        A model already trained for your objects. To find objects from a
        description instead, choose “Describe it”.
      </p>
    </div>
  )
}

function LocalWeightsField({
  model,
  set,
  index,
}: {
  model: InferenceModel
  set: (p: Partial<InferenceModel>) => void
  index: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const weights = useUploadedWeights()
  const uploaded = weights.data ?? []

  const upload = async (file: File) => {
    const lower = file.name.toLowerCase()
    if (!WEIGHTS_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      setError("Pick an Ultralytics .pt checkpoint or an .onnx export.")
      return
    }
    setError(null)
    // A file cut short would only fail later, on the worker.
    const problem = await weightsFileProblem(file)
    if (problem) {
      setError(problem)
      return
    }
    setProgress(0)
    const objectName = weightsObjectPath(file.name)
    try {
      await uploadFileChunked({
        file,
        fileIdentifier: `${objectName}-${file.size}`,
        objectName,
        onProgress: (p) => setProgress(p.fraction),
      })
      // What the worker will download must be the whole file.
      const stored = await FilesService.apiFilesMetadataFilePathGetFileMetadata(
        { filePath: `gemini/${objectName}` },
      ).catch(() => null)
      if (stored && stored.size != null && Number(stored.size) !== file.size) {
        setError(
          `The upload arrived incomplete (${Number(stored.size).toLocaleString()} of ${file.size.toLocaleString()} bytes). Upload it again.`,
        )
        return
      }
      set({ weights_path: objectName, weights_name: file.name })
      void weights.refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="space-y-1">
      <Label className="text-muted-foreground text-xs">
        Weights file (.pt, or .onnx exported by Ultralytics)
      </Label>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={WEIGHTS_EXTENSIONS.join(",")}
          className="hidden"
          data-testid={`inference-model-${index}-weights-input`}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) void upload(f)
          }}
        />
        <Select
          value={
            uploaded.some((f) => f.object_name === model.weights_path)
              ? model.weights_path
              : ""
          }
          onValueChange={(v) =>
            set({ weights_path: v, weights_name: weightsName(v) })
          }
          disabled={progress !== null || uploaded.length === 0}
        >
          <SelectTrigger
            className="h-8 w-56"
            data-testid={`inference-model-${index}-weights-pick`}
          >
            <SelectValue
              placeholder={
                weights.isLoading
                  ? "Loading uploaded files…"
                  : uploaded.length
                    ? "Choose an uploaded file…"
                    : "No files uploaded yet"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {uploaded.map((f) => (
              <SelectItem key={f.object_name} value={f.object_name ?? ""}>
                {weightsName(f.object_name ?? "")}
                {f.size != null && (
                  <span className="text-muted-foreground ml-1.5 text-xs">
                    {(Number(f.size) / 1e6).toFixed(0)} MB
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-xs">or</span>
        <Button
          variant="outline"
          size="sm"
          disabled={progress !== null}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-1 h-4 w-4" />
          Upload new…
        </Button>
        {progress !== null && (
          <span className="text-muted-foreground text-sm">
            Uploading… {Math.round(progress * 100)}%
          </span>
        )}
      </div>
      <div
        className="text-muted-foreground truncate text-xs"
        data-testid={`inference-model-${index}-weights-name`}
      >
        {model.weights_path
          ? `Using ${model.weights_name || model.weights_path}`
          : "No file chosen"}
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

/**
 * Pick a model set up before (in any pipeline, or a weights file already
 * uploaded) instead of entering it again. Its name is kept, so its counts
 * land under the same trait as before.
 */
export function ReuseModelPicker({
  known,
  current,
  onPick,
}: {
  known: KnownModel[]
  current: InferenceModel[]
  onPick: (m: InferenceModel) => void
}) {
  const options = known.filter(
    (k) => !current.some((c) => sameModel(c, k.model)),
  )
  if (options.length === 0) return null
  return (
    <Select
      value=""
      onValueChange={(v) => {
        const k = options[Number(v)]
        if (k) onPick({ ...k.model, extra: { ...k.model.extra } })
      }}
    >
      <SelectTrigger
        className="h-8 w-auto min-w-64"
        data-testid="inference-model-reuse"
      >
        <SelectValue placeholder="Use a model set up before…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((k, i) => (
          <SelectItem key={i} value={String(i)}>
            <span>{modelDisplayName(k.model)}</span>
            <span className="text-muted-foreground ml-1.5 text-xs">
              {sourceLabel(k.model.source)}
              {k.model.hf_zero_shot && k.model.hf_prompt.trim()
                ? ` · finds "${k.model.hf_prompt.trim()}"`
                : ""}
              {" · "}
              {k.usedIn.length
                ? `in ${k.usedIn.slice(0, 2).join(", ")}${k.usedIn.length > 2 ? ` +${k.usedIn.length - 2}` : ""}`
                : "uploaded, not used yet"}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
