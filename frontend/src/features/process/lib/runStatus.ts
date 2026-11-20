/**
 * What a run's status tag says, worked out from its steps.
 *
 * The stored `run.status` only records that work began ("draft" until the
 * first job, then "running" for good), so a run whose last job finished
 * weeks ago still read "running". The tag shown is derived instead:
 *
 *   running   a step's job is working now
 *   queued    a step's job is submitted but waiting its turn (a worker, the cluster queue)
 *   failed    a step failed and has not been redone
 *   waiting   some steps are done, none is running: the next one is due
 *   complete  every step is done (or skipped)
 *   new       nothing done yet
 */
import type { Run } from "./runStore"

// Step order and names; mirror GROUND_STEPS / AERIAL_STEPS in RunDetail.tsx.
// Optional aerial steps (image review, GCPs) are left out: they never hold a
// run back.
export const RUN_STEPS: Record<"ground" | "aerial", [string, string][]> = {
  ground: [
    ["data_sync", "Data sync"],
    ["plot_marking", "Plot marking"],
    ["stitching", "Stitching"],
    ["plot_boundary_prep", "Plot boundaries"],
    ["associate_boundaries", "Plot images"],
    ["inference", "Inference"],
  ],
  aerial: [
    ["data_sync", "Data sync"],
    ["orthomosaic", "Orthomosaic"],
    ["plot_boundary_prep", "Plot boundaries"],
    ["split_orthomosaic", "Plot images"],
    ["trait_extraction", "Trait extraction"],
    ["inference", "Inference"],
  ],
}

/** Every stage of a pipeline, in order, as the workspace grid shows them:
 *  short column labels; `optional` stages never hold a run back. Mirrors
 *  GROUND_STEPS / AERIAL_STEPS in RunDetail.tsx. */
export interface Stage {
  key: string
  label: string
  short: string
  optional?: boolean
}

export const RUN_STAGES: Record<"ground" | "aerial", Stage[]> = {
  ground: [
    { key: "data_sync", label: "Data sync", short: "Sync" },
    { key: "plot_marking", label: "Plot marking", short: "Marking" },
    { key: "stitching", label: "Stitching", short: "Stitch" },
    {
      key: "plot_boundary_prep",
      label: "Plot boundaries",
      short: "Bounds",
    },
    { key: "associate_boundaries", label: "Plot images", short: "Plot imgs" },
    { key: "inference", label: "Models", short: "Models", optional: true },
  ],
  aerial: [
    { key: "data_sync", label: "Data sync", short: "Sync" },
    {
      key: "image_review",
      label: "Image review",
      short: "Review",
      optional: true,
    },
    { key: "gcp_selection", label: "GCPs", short: "GCPs", optional: true },
    { key: "orthomosaic", label: "Orthomosaic", short: "Ortho" },
    {
      key: "plot_boundary_prep",
      label: "Plot boundaries",
      short: "Bounds",
    },
    {
      key: "split_orthomosaic",
      label: "Plot images",
      short: "Plot imgs",
      optional: true,
    },
    { key: "trait_extraction", label: "Trait extraction", short: "Traits" },
    { key: "inference", label: "Models", short: "Models", optional: true },
  ],
}

export type RunTag =
  | "running"
  | "queued"
  | "failed"
  | "waiting"
  | "complete"
  | "new"

export interface RunState {
  tag: RunTag
  /** A few words: "Next: Stitching", "Orthomosaic running", … */
  detail: string
}

const DONE = new Set(["completed", "skipped"])

/**
 * `queuedJobIds`: jobs submitted but not started yet (from the jobs list); a
 * step whose latest job is one of them reads "queued", not "running".
 */
export function runState(
  run: Run,
  type: "ground" | "aerial",
  queuedJobIds?: ReadonlySet<string>,
): RunState {
  const steps = RUN_STEPS[type]
  const st = (k: string) => run.steps[k]?.status ?? "pending"
  const running = steps.find(([k]) => st(k) === "running")
  if (running) {
    const last = run.steps[running[0]]?.jobIds?.at(-1)
    if (last && queuedJobIds?.has(last))
      return { tag: "queued", detail: `${running[1]} queued` }
    return { tag: "running", detail: `${running[1]} running` }
  }
  const failed = steps.find(([k]) => st(k) === "failed")
  if (failed) return { tag: "failed", detail: `${failed[1]} failed` }
  // Optional stages (plot images, models) never hold a run back: a run whose
  // traits are extracted is complete; the next optional one is offered.
  const optional = new Set(
    RUN_STAGES[type].filter((x) => x.optional).map((x) => x.key),
  )
  const next = steps.find(([k]) => !DONE.has(st(k)) && !optional.has(k))
  if (!next) {
    const more = steps.find(([k]) => !DONE.has(st(k)))
    return {
      tag: "complete",
      detail: more ? `Done · ${more[1]} optional` : "All steps done",
    }
  }
  const started = steps.some(([k]) => DONE.has(st(k)))
  return {
    tag: started ? "waiting" : "new",
    detail: `Next: ${next[1]}`,
  }
}

export const TAG_LABEL: Record<RunTag, string> = {
  running: "running",
  queued: "queued",
  failed: "failed",
  // The user's turn: the run is between steps and needs someone (the person,
  // or the agent on their behalf) to check a result or start the next step.
  waiting: "input needed",
  complete: "complete",
  new: "new",
}

export const TAG_HINT: Record<RunTag, string> = {
  running: "A job is working on this run now.",
  queued:
    "A job is submitted for this run and waiting its turn (a free worker, or the cluster's queue).",
  failed: "A step failed. Open the run to see why and retry it.",
  waiting:
    "Your turn: nothing is running until you (or the agent) check the last result and start the next step. Open the run to see what it needs.",
  complete: "Every step is done.",
  new: "Nothing has been processed yet.",
}

export const TAG_CLASS: Record<RunTag, string> = {
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  queued: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  failed: "bg-red-500/10 text-red-700 dark:text-red-300",
  waiting: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  complete: "bg-green-500/10 text-green-700 dark:text-green-300",
  new: "bg-gray-500/10 text-gray-700 dark:text-gray-300",
}
