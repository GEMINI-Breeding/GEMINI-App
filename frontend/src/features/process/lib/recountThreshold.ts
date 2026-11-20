/**
 * Saving the confidence threshold chosen in a run's results as the one its
 * counts in Analyze use, and applying it to the same model's other runs in
 * the experiment. A recount is a LOCATE_PLANTS job with `recount: true`: the
 * worker counts the run's saved predictions again at the threshold (no
 * model runs) and replaces that flight's counts for the model.
 */
import type { JobOutput } from "@/client"
import { modelFromJobParams, sameModel } from "./inferenceModels"

type Params = Record<string, unknown>

const params = (j: JobOutput): Params => (j.parameters ?? {}) as Params
const result = (j: JobOutput): Params =>
  ((j as { result?: unknown }).result ?? {}) as Params
const str = (v: unknown) => (typeof v === "string" ? v : "")

/** `Processed/{year}/{exp}/{site}/{pop}/{date}/{platform}/{sensor}/` of a
 *  run's output: the flight it counted (and where its boundaries live). */
export function flightDir(path: string): string | null {
  const parts = path.split("/")
  if (parts[0] !== "Processed" || parts.length < 9) return null
  return `${parts.slice(0, 8).join("/")}/`
}

export function flightDate(path: string): string {
  return path.split("/")[5] ?? ""
}

/** The trait label its counts went under in Analyze. */
export function countLabelOf(j: JobOutput): string {
  return str(params(j).count_label) || str(result(j).model_id)
}

/** A finished count over a field's plot images, with saved predictions. */
export function recountable(j: JobOutput): boolean {
  const p = params(j)
  return (
    j.job_type === "LOCATE_PLANTS" &&
    j.status === "COMPLETED" &&
    Boolean(str(p.output_predictions_path)) &&
    (Boolean(p.recount) || Boolean(str(p.images_prefix))) &&
    str(p.task_type || result(j).task_type) !== "classification" &&
    Boolean(countLabelOf(j)) &&
    flightDir(str(p.output_predictions_path)) !== null
  )
}

/** The worker's threshold when a job names none. */
export const WORKER_DEFAULT_THRESHOLD = 0.1

/** The threshold a job's counts are at: what it ran (or recounted) with. */
export function thresholdOf(j: JobOutput): number {
  const v = params(j).confidence_threshold
  return typeof v === "number" ? v : WORKER_DEFAULT_THRESHOLD
}

function sameModelRun(a: JobOutput, b: JobOutput): boolean {
  if (countLabelOf(a) !== countLabelOf(b)) return false
  const ma = modelFromJobParams(params(a))
  const mb = modelFromJobParams(params(b))
  return ma && mb ? sameModel(ma, mb) : true
}

const created = (j: JobOutput) => String(j.created_at ?? "")

/**
 * The same model's latest count on each other flight of the experiment
 * (the one whose counts Analyze shows), oldest flight first.
 */
export function otherRuns(job: JobOutput, all: JobOutput[]): JobOutput[] {
  const here = flightDir(str(params(job).output_predictions_path))
  const latest = new Map<string, JobOutput>()
  for (const j of all) {
    if (String(j.id) === String(job.id) || !recountable(j)) continue
    if (String(j.experiment_id ?? "") !== String(job.experiment_id ?? ""))
      continue
    if (!sameModelRun(job, j)) continue
    const flight = flightDir(str(params(j).output_predictions_path))
    if (!flight || flight === here) continue
    const prev = latest.get(flight)
    if (!prev || created(j) > created(prev)) latest.set(flight, j)
  }
  return [...latest.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, j]) => j)
}

/** The job that recounts `job` at `threshold`. */
export function recountParams(
  job: JobOutput,
  threshold: number,
  boundaries: unknown,
): Params {
  const p = params(job)
  const keep = [
    "source",
    "model_source",
    "model_id",
    "weights_path",
    "hf_model_id",
    "hf_prompt",
    "hf_zero_shot",
    "images_prefix",
  ]
  const model: Params = {}
  for (const k of keep) if (p[k] != null) model[k] = p[k]
  return {
    ...model,
    recount: true,
    recount_of: String(p.recount_of ?? job.id),
    output_predictions_path: p.output_predictions_path,
    boundaries,
    confidence_threshold: Math.round(threshold * 100) / 100,
    count_label: countLabelOf(job),
    task_type: str(p.task_type || result(job).task_type) || "detection",
  }
}
