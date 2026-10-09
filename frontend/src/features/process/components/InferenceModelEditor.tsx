/**
 * One model entry in the pipeline wizard's inference step: source picker
 * (Roboflow / Hugging Face / uploaded local weights) and that source's
 * fields. Local weights are uploaded straight into storage here; the entry
 * keeps the object path, which the ML worker downloads and caches.
 */
import { Upload, X } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  type InferenceModel,
  type ModelSource,
  modelProblem,
  SOURCE_LABELS,
  TASK_LABELS,
  type TaskType,
  tasksFor,
  WEIGHTS_EXTENSIONS,
  weightsObjectPath,
} from "@/features/process/lib/inferenceModels"
import { uploadFileChunked } from "@/lib/chunkedUpload"

interface Props {
  model: InferenceModel
  index: number
  onChange: (next: InferenceModel) => void
  onRemove: () => void
  canRemove: boolean
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
    // Keep the task valid when the source or zero-shot flag changes.
    if (!tasksFor(next).includes(next.task_type)) next.task_type = "detection"
    onChange(next)
  }
  const id = (field: string) => `model-${index}-${field}`
  const problem = modelProblem(model)
  const started =
    model.roboflow_model_id ||
    model.hf_model_id ||
    model.weights_path ||
    model.label

  return (
    <div
      className="space-y-3 rounded-lg border p-3"
      data-testid={`inference-model-${index}`}
    >
      <div className="grid grid-cols-[1fr_11rem_10rem_auto] items-end gap-2">
        <div className="space-y-1">
          <Label
            htmlFor={id("label")}
            className="text-muted-foreground text-xs"
          >
            Name
          </Label>
          <Input
            id={id("label")}
            placeholder="e.g. Wheat Detection"
            value={model.label}
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Source</Label>
          <Select
            value={model.source}
            onValueChange={(v) => set({ source: v as ModelSource })}
          >
            <SelectTrigger data-testid={`inference-model-${index}-source`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SOURCE_LABELS) as ModelSource[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Task</Label>
          <Select
            value={model.task_type}
            onValueChange={(v) => set({ task_type: v as TaskType })}
          >
            <SelectTrigger data-testid={`inference-model-${index}-task`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tasksFor(model).map((t) => (
                <SelectItem key={t} value={t}>
                  {TASK_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="mb-0.5"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Remove model"
        >
          <X className="text-muted-foreground h-4 w-4" />
        </Button>
      </div>

      {model.source === "roboflow" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label
              htmlFor={id("rf-key")}
              className="text-muted-foreground text-xs"
            >
              API Key
            </Label>
            <Input
              id={id("rf-key")}
              type="password"
              placeholder="rf_xxxxxxxxxxxx"
              value={model.roboflow_api_key}
              onChange={(e) => set({ roboflow_api_key: e.target.value })}
            />
          </div>
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
        </div>
      )}

      {model.source === "huggingface" && (
        <HuggingFaceFields model={model} set={set} id={id} />
      )}

      {model.source === "local_weights" && (
        <LocalWeightsField model={model} set={set} index={index} />
      )}

      {started && problem && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>
      )}
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
    <div className="space-y-2">
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
              <SelectItem value="local">On this machine</SelectItem>
              <SelectItem value="cloud">Hugging Face cloud</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <label
        htmlFor={id("hf-zs")}
        className="flex cursor-pointer items-center gap-2 text-sm"
      >
        <Checkbox
          id={id("hf-zs")}
          checked={model.hf_zero_shot}
          onCheckedChange={(c) => set({ hf_zero_shot: c === true })}
        />
        Zero-shot model (e.g. OWL-ViT, CLIP) — finds labels you type
      </label>
      {model.hf_zero_shot && (
        <div className="space-y-1">
          <Label
            htmlFor={id("hf-prompt")}
            className="text-muted-foreground text-xs"
          >
            Labels to look for (comma-separated; editable per run)
          </Label>
          <Input
            id={id("hf-prompt")}
            placeholder="weed, crop, soil"
            value={model.hf_prompt}
            onChange={(e) => set({ hf_prompt: e.target.value })}
          />
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        “On this machine” downloads the model into the processing worker on
        first use (cached afterwards). “Hugging Face cloud” sends each image to
        Hugging Face and needs a token.
        {model.hf_zero_shot &&
          model.task_type === "detection" &&
          " Zero-shot detectors score low (often 0.1–0.5), so keep the confidence threshold low."}
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

  const upload = async (file: File) => {
    const lower = file.name.toLowerCase()
    if (!WEIGHTS_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      setError("Pick an Ultralytics .pt checkpoint or an .onnx export.")
      return
    }
    setError(null)
    setProgress(0)
    const objectName = weightsObjectPath(file.name)
    try {
      await uploadFileChunked({
        file,
        fileIdentifier: `${objectName}-${file.size}`,
        objectName,
        onProgress: (p) => setProgress(p.fraction),
      })
      set({ weights_path: objectName, weights_name: file.name })
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
        <Button
          variant="outline"
          size="sm"
          disabled={progress !== null}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-1 h-4 w-4" />
          {model.weights_path ? "Replace…" : "Upload…"}
        </Button>
        <span
          className="text-muted-foreground truncate text-sm"
          data-testid={`inference-model-${index}-weights-name`}
        >
          {progress !== null
            ? `Uploading… ${Math.round(progress * 100)}%`
            : model.weights_name || model.weights_path || "No file uploaded"}
        </span>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}
