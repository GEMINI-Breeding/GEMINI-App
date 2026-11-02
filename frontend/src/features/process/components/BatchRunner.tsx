/**
 * BatchRunner — works through "Run across dates" while the app is open: a
 * step waiting on another of its batch's steps starts once that one's jobs
 * have finished (or stops, with the reason, if they failed). Renders nothing.
 */
import { useEffect } from "react"

import { JobsService } from "@/client"
import { isLoggedIn } from "@/lib/auth"
import {
  nextActions,
  type QueuedStep,
  readQueue,
  updateQueued,
} from "../lib/batchQueue"
import { startStep } from "../lib/batchSubmit"

const EVERY_MS = 20_000

async function statuses(q: QueuedStep[]): Promise<Map<string, string>> {
  const ids = new Set<string>()
  for (const s of q)
    if (s.status === "started") for (const j of s.jobIds) ids.add(j)
  const out = new Map<string, string>()
  await Promise.all(
    [...ids].map(async (jobId) => {
      try {
        const j = await JobsService.apiJobsJobIdGetJob({ jobId })
        out.set(jobId, String(j?.status ?? ""))
      } catch {
        // unknown for now; asked again next round
      }
    }),
  )
  return out
}

let busy = false

export async function workBatchQueue() {
  if (busy || !isLoggedIn()) return
  const q = readQueue()
  if (!q.some((s) => s.status === "waiting" || s.status === "started")) return
  busy = true
  try {
    const st = await statuses(q)
    // Started steps whose jobs all finished are done.
    for (const s of q)
      if (
        s.status === "started" &&
        s.jobIds.length &&
        s.jobIds.every((j) => st.get(j) === "COMPLETED")
      )
        updateQueued(s.id, { status: "done" })
      else if (
        s.status === "started" &&
        s.jobIds.some((j) => ["FAILED", "CANCELLED"].includes(st.get(j) ?? ""))
      )
        updateQueued(s.id, { status: "failed", error: "its job failed" })
    const { start, fail } = nextActions(readQueue(), (j) => st.get(j))
    for (const f of fail)
      updateQueued(f.step.id, { status: "failed", error: f.reason })
    for (const s of start) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const jobIds = await startStep(s.runId, s.step, s.options)
        updateQueued(s.id, { status: "started", jobIds })
      } catch (e) {
        updateQueued(s.id, {
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  } finally {
    busy = false
  }
}

export function BatchRunner() {
  useEffect(() => {
    void workBatchQueue()
    const t = setInterval(() => void workBatchQueue(), EVERY_MS)
    return () => clearInterval(t)
  }, [])
  return null
}
