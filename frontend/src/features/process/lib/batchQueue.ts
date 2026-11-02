/**
 * The steps a "Run across dates" batch started, and those waiting on another
 * of its steps (inference on a date waits for that date's plot images). Kept
 * in this browser, and worked through while the app is open: a waiting step
 * starts when everything it waits on has finished, and stops (with the
 * reason) if one of them failed.
 */
import type { BatchStep } from "./batchPlan"
import type { StartOptions } from "./batchSubmit"

export interface QueuedStep {
  id: string
  batchId: string
  runId: string
  date: string
  population: string
  step: BatchStep
  options: StartOptions
  /** Steps of this batch (by id) to finish first. */
  after: string[]
  status: "waiting" | "started" | "done" | "failed"
  jobIds: string[]
  error?: string
  createdAt: string
}

const KEY = "gemini.process.batchQueue.v1"
const listeners = new Set<() => void>()

export function readQueue(): QueuedStep[] {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as QueuedStep[]) : []
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

let snapshot: QueuedStep[] | null = null

/** The queue as one stable value until it changes (for useSyncExternalStore). */
export function queueSnapshot(): QueuedStep[] {
  if (!snapshot) snapshot = readQueue()
  return snapshot
}

export function writeQueue(q: QueuedStep[]) {
  snapshot = null
  try {
    // A week's batches are plenty to look back on.
    const cutoff = Date.now() - 7 * 864e5
    localStorage.setItem(
      KEY,
      JSON.stringify(q.filter((x) => Date.parse(x.createdAt) > cutoff)),
    )
  } catch {
    // private mode: the queue lives only as long as this page
  }
  for (const l of listeners) l()
}

export function updateQueued(id: string, patch: Partial<QueuedStep>) {
  writeQueue(readQueue().map((x) => (x.id === id ? { ...x, ...patch } : x)))
}

export function subscribeQueue(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

type JobState = "COMPLETED" | "FAILED" | "CANCELLED" | string

/**
 * What to do with each waiting step, given the statuses of the jobs its
 * prerequisites started: start it, give up (a prerequisite failed), or wait.
 */
export function nextActions(
  q: QueuedStep[],
  jobStatus: (jobId: string) => JobState | undefined,
): { start: QueuedStep[]; fail: { step: QueuedStep; reason: string }[] } {
  const byId = new Map(q.map((x) => [x.id, x]))
  const start: QueuedStep[] = []
  const fail: { step: QueuedStep; reason: string }[] = []
  for (const s of q) {
    if (s.status !== "waiting") continue
    let ready = true
    for (const pid of s.after) {
      const p = byId.get(pid)
      if (!p || p.status === "failed") {
        fail.push({ step: s, reason: `${p?.step ?? "an earlier step"} failed` })
        ready = false
        break
      }
      if (p.status === "waiting") {
        ready = false
        continue
      }
      const states = p.jobIds.map(jobStatus)
      if (states.some((x) => x === "FAILED" || x === "CANCELLED")) {
        fail.push({ step: s, reason: `${p.step.replace("_", " ")} failed` })
        ready = false
        break
      }
      if (!p.jobIds.length || !states.every((x) => x === "COMPLETED"))
        ready = false
    }
    if (ready) start.push(s)
  }
  return { start, fail }
}
