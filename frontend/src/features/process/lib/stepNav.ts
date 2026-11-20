/**
 * Moving between a run's steps one card at a time: whether the next step can
 * be opened yet, and if not, what the person has to finish first.
 */

export type NavStatus =
  | "completed"
  | "running"
  | "failed"
  | "ready"
  | "locked"
  | "skipped"
  | "unavailable"

export interface NavStep {
  key: string
  label: string
  kind: "compute" | "interactive" | "optional"
  needs?: string[]
}

export const STATUS_LABEL: Record<NavStatus, string> = {
  completed: "Done",
  running: "Running",
  failed: "Failed",
  ready: "To do",
  locked: "Locked",
  skipped: "Skipped",
  unavailable: "Not available",
}

/** What finishing a step means, in the words of its card. */
const TO_FINISH: Record<string, string> = {
  data_sync: "Run Data Sync",
  image_review: "Review the images and save, or skip this optional step",
  gcp_selection: "Mark the ground control points, or skip this optional step",
  orthomosaic: "Generate the orthomosaic (or import one)",
  plot_boundary_prep:
    "Open the tool, then save and activate the plot boundaries",
  split_orthomosaic: "Make the plot images",
  trait_extraction: "Run the trait extraction",
  plot_marking: "Mark the start and end of each plot, then save",
  stitching: "Stitch the plots",
  associate_boundaries: "Associate the plots with the boundaries",
  inference: "Run a model on the plot images",
}

/**
 * Why the step after `step` cannot be opened yet; null when it can (the step
 * is done or skipped).
 */
export function nextLockReason(
  step: NavStep,
  status: NavStatus,
): string | null {
  if (status === "completed" || status === "skipped") return null
  const finish =
    TO_FINISH[step.key] ??
    (step.kind === "compute" ? `Run ${step.label}` : `Finish ${step.label}`)
  switch (status) {
    case "running":
      return `${step.label} is running: the next step opens when it finishes.`
    case "failed":
      return `${step.label} failed: fix it and run it again to continue.`
    case "unavailable":
      return `This backend cannot do ${step.label} yet, so the steps after it stay locked.`
    case "locked":
      return `${step.label} is locked: finish the steps before it first.`
    default:
      return `${finish} to continue.`
  }
}

/** The unfinished steps a locked step waits on (by default every earlier required step). */
export function waitingOn(
  steps: NavStep[],
  key: string,
  statusOf: (key: string) => NavStatus,
): string[] {
  const idx = steps.findIndex((s) => s.key === key)
  if (idx < 0) return []
  const needs = steps[idx].needs
  const before = needs
    ? steps.filter((s) => needs.includes(s.key))
    : steps.slice(0, idx).filter((s) => s.kind !== "optional")
  return before
    .filter((s) => !["completed", "skipped"].includes(statusOf(s.key)))
    .map((s) => s.label)
}
