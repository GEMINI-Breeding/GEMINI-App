/**
 * A job's name in the processes panel: its step, the flight date (and run of
 * the day / treatment) and the pipeline — "Trait extraction · 2023-08-03 ·
 * Kearney 2023" rather than "trait_extraction — pipeline", so jobs of several
 * dates can be told apart.
 */
import { RUN_STEPS } from "./runStatus"
import type { Run } from "./runStore"

const STEP_LABEL: Record<string, string> = Object.fromEntries([
  ...RUN_STEPS.ground,
  ...RUN_STEPS.aerial,
  ["image_review", "Image exclusion"],
  ["gcp_selection", "GCP selection"],
])

/** The run step a job belongs to. */
export function stepOfJob(run: Run, jobId: string): string | undefined {
  return Object.entries(run.steps ?? {}).find(([, s]) =>
    s?.jobIds?.includes(jobId),
  )?.[0]
}

export function jobTitle(
  run: Run | undefined,
  jobId: string,
  pipelineName: string | undefined,
  fallback: string,
): string {
  if (!run) return fallback
  const step = stepOfJob(run, jobId)
  const u = run.uploadScope
  const when = [u?.date, u?.batchLabel].filter(Boolean).join(" ")
  return [step ? (STEP_LABEL[step] ?? step) : fallback, when, pipelineName]
    .filter(Boolean)
    .join(" · ")
}

/** Jobs that can be stopped while a worker runs them, not only while queued. */
export const CANCEL_WHILE_RUNNING = new Set(["trait_extraction"])
