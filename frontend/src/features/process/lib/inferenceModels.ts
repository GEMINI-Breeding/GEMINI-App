/**
 * Inference model entries — one per model a pipeline can run on its plot
 * images. Saved in `pipeline.params.roboflow_models` (the key predates the
 * other sources and is kept so existing pipelines load unchanged).
 *
 * Sources, all run by the ML worker's LOCATE_PLANTS job:
 *   - roboflow       Roboflow cloud, or a self-hosted Roboflow server
 *                    (`pipeline.params.local_server_url`).
 *   - huggingface    A Hub model, run inside the ML worker ("local") or
 *                    through Hugging Face's hosted inference ("cloud").
 *   - local_weights  An Ultralytics .pt / .onnx file uploaded into storage
 *                    (`weights_path` is the object path).
 *   - anything else  A provider this app has no form for yet (added by the
 *                    agent, or a newer worker): its settings stay in `extra`
 *                    and are passed to the worker unchanged, so it is listed
 *                    and can be run again.
 *
 * The agent registers every model it runs in the same shape
 * (agent/gemi_agent/process_runs.py `model_entry`).
 */

export type KnownSource = "roboflow" | "huggingface" | "local_weights"
export type ModelSource = KnownSource | (string & {})
export type TaskType = "detection" | "segmentation" | "classification"

export interface InferenceModel {
  label: string
  source: ModelSource
  task_type: TaskType
  roboflow_api_key: string
  roboflow_model_id: string
  /** Storage object path of the uploaded weights (no bucket prefix). */
  weights_path: string
  /** The uploaded file's original name, for display. */
  weights_name: string
  hf_model_id: string
  hf_token: string
  hf_mode: "local" | "cloud"
  hf_zero_shot: boolean
  /** Comma-separated candidate labels for zero-shot models. */
  hf_prompt: string
  /** Provider settings with no field of their own (sent to the worker as is). */
  extra: Record<string, unknown>
}

export function isKnownSource(s: string): s is KnownSource {
  return s === "roboflow" || s === "huggingface" || s === "local_weights"
}

export const SOURCE_LABELS: Record<KnownSource, string> = {
  roboflow: "Roboflow",
  huggingface: "Hugging Face",
  local_weights: "Local weights",
}

export const TASK_LABELS: Record<TaskType, string> = {
  detection: "Detection",
  segmentation: "Segmentation",
  classification: "Classification",
}

/** Task types each source supports (the worker rejects the rest). */
export function tasksFor(
  m: Pick<InferenceModel, "source" | "hf_zero_shot">,
): TaskType[] {
  if (m.source === "roboflow") return ["detection", "segmentation"]
  if (m.source === "huggingface" && m.hf_zero_shot)
    return ["detection", "classification"]
  return ["detection", "segmentation", "classification"]
}

export const WEIGHTS_EXTENSIONS = [".pt", ".onnx"]

export function sourceLabel(s: ModelSource): string {
  return isKnownSource(s) ? SOURCE_LABELS[s] : s
}

export function emptyModel(source: ModelSource = "roboflow"): InferenceModel {
  return {
    label: "",
    source,
    task_type: "detection",
    roboflow_api_key: "",
    roboflow_model_id: "",
    weights_path: "",
    weights_name: "",
    hf_model_id: "",
    hf_token: "",
    hf_mode: "local",
    hf_zero_shot: false,
    hf_prompt: "",
    extra: {},
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "")

/** Fill defaults for an entry saved by any version of the wizard. */
export function normalizeModel(raw: unknown): InferenceModel {
  const r = (raw ?? {}) as Record<string, unknown>
  const source =
    typeof r.source === "string" && r.source.trim()
      ? r.source.trim()
      : "roboflow"
  const base = emptyModel(source)
  const model: InferenceModel = {
    ...base,
    label: str(r.label),
    roboflow_api_key: str(r.roboflow_api_key),
    roboflow_model_id: str(r.roboflow_model_id),
    weights_path: str(r.weights_path),
    weights_name: str(r.weights_name),
    hf_model_id: str(r.hf_model_id),
    hf_token: str(r.hf_token),
    hf_mode: r.hf_mode === "cloud" ? "cloud" : "local",
    hf_zero_shot: r.hf_zero_shot === true,
    hf_prompt: str(r.hf_prompt),
    extra:
      r.extra && typeof r.extra === "object"
        ? { ...(r.extra as Record<string, unknown>) }
        : {},
  }
  const task = r.task_type as TaskType
  model.task_type = tasksFor(model).includes(task) ? task : "detection"
  return model
}

/** The identifier that makes an entry runnable (empty → skipped on save). */
export function modelKey(m: InferenceModel): string {
  if (m.source === "huggingface") return m.hf_model_id.trim()
  if (m.source === "local_weights") return m.weights_path.trim()
  if (m.source === "roboflow") return m.roboflow_model_id.trim()
  const id = m.extra.model_id ?? m.extra.model ?? m.extra.id ?? m.extra.version
  return typeof id === "string" && id
    ? id
    : Object.keys(m.extra).length
      ? m.label || m.source
      : ""
}

/** Why an entry can't run yet, or null when it can. */
export function modelProblem(m: InferenceModel): string | null {
  if (m.source === "roboflow") {
    if (!m.roboflow_model_id.trim()) return "Enter a Roboflow model ID."
    if (!m.roboflow_api_key.trim()) return "Enter a Roboflow API key."
  } else if (m.source === "huggingface") {
    if (!m.hf_model_id.trim()) return "Enter a Hugging Face model ID."
    if (m.hf_mode === "cloud" && !m.hf_token.trim())
      return "Hugging Face cloud inference needs an access token."
    if (m.hf_zero_shot && !m.hf_prompt.trim())
      return "Zero-shot models need labels to look for."
  } else if (m.source === "local_weights" && !m.weights_path.trim()) {
    return "Upload a .pt or .onnx weights file."
  } else if (!isKnownSource(m.source) && !modelKey(m)) {
    return `No settings for ${m.source}.`
  }
  if (!tasksFor(m).includes(m.task_type))
    return `${TASK_LABELS[m.task_type]} isn't available for this model.`
  return null
}

export function modelDisplayName(m: InferenceModel): string {
  if (m.label.trim()) return m.label.trim()
  if (m.source === "local_weights")
    return m.weights_name || m.weights_path.split("/").pop() || "Local weights"
  return modelKey(m) || sourceLabel(m.source)
}

/** True when running this model needs the self-hosted Roboflow server URL. */
export function usesRoboflowServer(m: InferenceModel): boolean {
  return m.source === "roboflow"
}

/**
 * LOCATE_PLANTS parameters for one model. `localServerUrl` applies to
 * Roboflow models only; `prompt` overrides a zero-shot model's saved labels
 * for one run.
 */
export function modelJobParams(
  m: InferenceModel,
  opts: { localServerUrl?: string; prompt?: string } = {},
): Record<string, unknown> {
  const common = { source: m.source, task_type: m.task_type }
  if (!isKnownSource(m.source)) return { ...m.extra, ...common }
  if (m.source === "huggingface") {
    const prompt = (opts.prompt ?? m.hf_prompt).trim()
    return {
      ...common,
      hf_model_id: m.hf_model_id.trim(),
      hf_mode: m.hf_mode,
      ...(m.hf_token.trim() ? { hf_token: m.hf_token.trim() } : {}),
      ...(m.hf_zero_shot ? { hf_zero_shot: true, hf_prompt: prompt } : {}),
    }
  }
  if (m.source === "local_weights") {
    return { ...common, weights_path: m.weights_path.trim() }
  }
  return {
    ...common,
    api_key: m.roboflow_api_key.trim(),
    model_id: m.roboflow_model_id.trim(),
    ...(opts.localServerUrl
      ? { api_url: opts.localServerUrl }
      : typeof m.extra.api_url === "string"
        ? { api_url: m.extra.api_url }
        : {}),
  }
}

// Parameters that describe the job, not the model.
const JOB_ONLY = new Set([
  "image_path",
  "images_prefix",
  "output_predictions_path",
  "count_label",
  "confidence_threshold",
  "iou_threshold",
  "boundaries",
  "source",
  "task_type",
  "model_source",
  "per_plot",
  "recount",
  "recount_of",
])

/**
 * The model a LOCATE_PLANTS job ran, as a pipeline entry: lets the results of
 * any job (the agent's included) be named, and the model be added to the
 * pipeline to run again. Mirrors `model_entry` in the agent.
 */
export function modelFromJobParams(
  params: Record<string, unknown>,
): InferenceModel | null {
  const source = str(params.source) || str(params.model_source)
  if (!source) return null
  const m = emptyModel(source)
  m.label = str(params.count_label)
  m.task_type = (str(params.task_type) || "detection") as TaskType
  if (source === "huggingface") {
    m.hf_model_id = str(params.hf_model_id)
    m.hf_mode = params.hf_mode === "cloud" ? "cloud" : "local"
    m.hf_token = str(params.hf_token)
    m.hf_zero_shot = params.hf_zero_shot === true
    m.hf_prompt = str(params.hf_prompt)
  } else if (source === "roboflow") {
    m.roboflow_model_id = str(params.model_id)
    m.roboflow_api_key = str(params.api_key)
    if (str(params.api_url)) m.extra = { api_url: str(params.api_url) }
  } else if (source === "local_weights") {
    m.weights_path = str(params.weights_path)
    m.weights_name = m.weights_path.split("/").pop() ?? ""
  } else {
    m.extra = Object.fromEntries(
      Object.entries(params).filter(([k]) => !JOB_ONLY.has(k)),
    )
  }
  return modelKey(m) ? m : null
}

/** Same source and model (and zero-shot labels): one entry. */
export function sameModel(a: InferenceModel, b: InferenceModel): boolean {
  return (
    a.source === b.source &&
    modelKey(a) === modelKey(b) &&
    (a.hf_zero_shot ? a.hf_prompt : "") === (b.hf_zero_shot ? b.hf_prompt : "")
  )
}

/** Storage path for uploaded weights. Timestamped so re-uploads never collide. */
export function weightsObjectPath(fileName: string, now = Date.now()): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "_")
  return `Models/weights/${now}-${safe}`
}

/**
 * Why a weights file can't be run, read from its bytes before uploading
 * (null when it looks whole). A PyTorch .pt checkpoint is a zip archive,
 * which ends with an end-of-archive record: a file cut short (an unfinished
 * download or copy) lacks it and fails on the worker with "not a loadable
 * checkpoint" — only after the upload and a queued run.
 */
async function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function")
    return new Uint8Array(await blob.arrayBuffer())
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}

export async function weightsFileProblem(file: File): Promise<string | null> {
  if (file.size === 0) return `${file.name} is empty.`
  if (!file.name.toLowerCase().endsWith(".pt")) return null
  const head = await bytesOf(file.slice(0, 4))
  const isZip =
    head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
  if (!isZip)
    return `${file.name} isn't a PyTorch checkpoint (a .pt saved by Ultralytics / torch.save).`
  // The end record sits in the last 22 bytes, plus a comment of up to 64 KB.
  const tailSize = Math.min(file.size, 22 + 65_535)
  const tail = await bytesOf(file.slice(file.size - tailSize))
  for (let i = tail.length - 22; i >= 0; i--)
    if (
      tail[i] === 0x50 &&
      tail[i + 1] === 0x4b &&
      tail[i + 2] === 0x05 &&
      tail[i + 3] === 0x06
    )
      return null
  return `${file.name} is incomplete (cut short, ${(file.size / 1e6).toFixed(1)} MB): copy or download it again, then upload.`
}
