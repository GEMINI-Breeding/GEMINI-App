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
 */

export type ModelSource = "roboflow" | "huggingface" | "local_weights"
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
}

export const SOURCE_LABELS: Record<ModelSource, string> = {
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
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "")

/** Fill defaults for an entry saved by any version of the wizard. */
export function normalizeModel(raw: unknown): InferenceModel {
  const r = (raw ?? {}) as Record<string, unknown>
  const base = emptyModel(
    r.source === "huggingface" || r.source === "local_weights"
      ? r.source
      : "roboflow",
  )
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
  }
  const task = r.task_type as TaskType
  model.task_type = tasksFor(model).includes(task) ? task : "detection"
  return model
}

/** The identifier that makes an entry runnable (empty → skipped on save). */
export function modelKey(m: InferenceModel): string {
  if (m.source === "huggingface") return m.hf_model_id.trim()
  if (m.source === "local_weights") return m.weights_path.trim()
  return m.roboflow_model_id.trim()
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
  } else if (!m.weights_path.trim()) {
    return "Upload a .pt or .onnx weights file."
  }
  if (!tasksFor(m).includes(m.task_type))
    return `${TASK_LABELS[m.task_type]} isn't available for this model.`
  return null
}

export function modelDisplayName(m: InferenceModel): string {
  if (m.label.trim()) return m.label.trim()
  if (m.source === "local_weights")
    return m.weights_name || m.weights_path.split("/").pop() || "Local weights"
  return modelKey(m) || SOURCE_LABELS[m.source]
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
    ...(opts.localServerUrl ? { api_url: opts.localServerUrl } : {}),
  }
}

/** Storage path for uploaded weights. Timestamped so re-uploads never collide. */
export function weightsObjectPath(fileName: string, now = Date.now()): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "_")
  return `Models/weights/${now}-${safe}`
}
