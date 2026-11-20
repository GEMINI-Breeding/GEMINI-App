/**
 * Bring every run's steps up to date with their jobs while the app is open,
 * not only the run whose page is showing. Jobs the agent (or a closed tab)
 * started otherwise leave their step "running" in the run list until someone
 * opens that run.
 *
 * Also: a run whose plot images or trait extraction finished had boundaries
 * (those jobs read them), so its boundaries step is done even when they were
 * saved another way (moved from another date, by the agent).
 */
import { JobsService } from "@/client"
import { getState, type Run, setStepState } from "./runStore"

/** Steps whose finish needs the run page's own bookkeeping (orthomosaic
 *  versions): left to that page and the agent. */
const LEFT_TO_PAGE = new Set(["orthomosaic"])
/** Jobs of a step looked at: the latest few (one per treatment flown apart). */
const RECENT = 10

export type StepPatch = {
  step: string
  status: "completed" | "failed"
  error?: string
}

/** What to change on one run, given the status of its jobs. */
export function settlePlan(
  run: Pick<Run, "steps">,
  jobStatus: (id: string) => string | undefined,
): StepPatch[] {
  const out: StepPatch[] = []
  for (const [key, step] of Object.entries(run.steps ?? {})) {
    if (step?.status !== "running" || LEFT_TO_PAGE.has(key)) continue
    const ids = (step.jobIds ?? []).slice(-RECENT)
    if (!ids.length) continue
    const st = ids.map(jobStatus)
    if (st.some((s) => s === undefined || s === "PENDING" || s === "RUNNING"))
      continue
    // The latest job decides (an earlier attempt may have failed and been
    // run again), as the agent's settle does.
    const last = st[st.length - 1]
    if (last === "COMPLETED") out.push({ step: key, status: "completed" })
    else if (last === "FAILED" || last === "CANCELLED")
      out.push({ step: key, status: "failed", error: "its latest job failed" })
  }
  const done = (k: string) =>
    run.steps?.[k]?.status === "completed" ||
    out.some((p) => p.step === k && p.status === "completed")
  if (
    (done("trait_extraction") || done("split_orthomosaic")) &&
    run.steps?.plot_boundary_prep?.status !== "completed"
  )
    out.push({ step: "plot_boundary_prep", status: "completed" })
  return out
}

let busy = false

export async function settleRuns(): Promise<void> {
  if (busy) return
  busy = true
  try {
    const runs = getState().runs
    const ids = new Set<string>()
    for (const r of runs)
      for (const [key, s] of Object.entries(r.steps ?? {}))
        if (s?.status === "running" && !LEFT_TO_PAGE.has(key))
          for (const j of (s.jobIds ?? []).slice(-RECENT)) ids.add(j)
    const status = new Map<string, string>()
    await Promise.all(
      [...ids].map(async (jobId) => {
        try {
          const j = await JobsService.apiJobsJobIdGetJob({ jobId })
          status.set(jobId, String(j?.status ?? ""))
        } catch {
          // unknown now; asked again next round
        }
      }),
    )
    const now = new Date().toISOString()
    for (const r of getState().runs)
      for (const p of settlePlan(r, (id) => status.get(id)))
        setStepState(r.id, p.step, {
          status: p.status,
          ...(p.status === "completed" ? { completedAt: now } : {}),
          ...(p.error ? { error: p.error } : {}),
        })
  } finally {
    busy = false
  }
}
