import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { JobsService, type JobOutput } from "@/client"
import { useProcessScope } from "@/features/process/lib/processScope"
import { findRunByJobId } from "@/features/process/lib/runStore"
import useAuth from "@/hooks/useAuth"
import type { Process, ProcessItem } from "@/types/process"
// Phase 6: ProcessContext subscribes over the new WebSocket-based manager
// (/api/jobs/{id}/progress) instead of the pre-migration SSE channel.
// The `runId` field on Process is now any subscription key — typically a
// Job UUID submitted via /api/jobs/submit. sseManager stays in tree until
// Phase 12 so any Phase-7+ feature still importing it fails loudly rather
// than silently; every new subscriber must go through wsManager.
import { closeJob, subscribe } from "@/lib/wsManager"
import type { JobProgressEvent } from "@/lib/wsManager"

type ProcessContextState = {
  processes: Process[]
  history: Process[]
  hasBeenActive: boolean
  addProcess: (process: Omit<Process, "id" | "createdAt">) => string
  updateProcess: (id: string, updates: Partial<Process>) => void
  updateProcessItem: (
    processId: string,
    itemId: string,
    updates: Partial<ProcessItem>,
  ) => void
  removeProcess: (id: string) => void
  clearCompleted: () => void
  clearHistory: () => void
}

const ProcessContext = createContext<ProcessContextState | undefined>(undefined)

export function ProcessProvider({ children }: { children: React.ReactNode }) {
  const [processes, setProcesses] = useState<Process[]>([])
  const [history, setHistory] = useState<Process[]>([])
  const [hasBeenActive, setHasBeenActive] = useState(false)
  // Map of runId → unsubscribe fn for active SSE subscriptions
  const activeSubs = useRef<Map<string, () => void>>(new Map())

  const addProcess = useCallback(
    (process: Omit<Process, "id" | "createdAt">) => {
      const id = crypto.randomUUID()
      const newProcess: Process = { ...process, id, createdAt: new Date() }
      setProcesses((prev) => [...prev, newProcess])
      setHasBeenActive(true)
      return id
    },
    [],
  )

  const updateProcess = useCallback(
    (id: string, updates: Partial<Process>) => {
      setProcesses((prev) =>
        prev.map((p) => (p.id !== id ? p : { ...p, ...updates })),
      )
    },
    [],
  )

  const updateProcessItem = useCallback(
    (processId: string, itemId: string, updates: Partial<ProcessItem>) => {
      setProcesses((prev) =>
        prev.map((p) => {
          if (p.id !== processId) return p
          return {
            ...p,
            items: p.items.map((item) =>
              item.id === itemId ? { ...item, ...updates } : item,
            ),
          }
        }),
      )
    },
    [],
  )

  const removeProcess = useCallback((id: string) => {
    setProcesses((prev) => {
      const process = prev.find((p) => p.id === id)
      if (process) setHistory((h) => (h.some((hp) => hp.id === id) ? h : [process, ...h]))
      return prev.filter((p) => p.id !== id)
    })
  }, [])

  const clearCompleted = useCallback(() => {
    setProcesses((prev) => {
      const completed = prev.filter((p) => p.status === "completed" || p.status === "error")
      if (completed.length > 0) {
        setHistory((h) => {
          const existingIds = new Set(h.map((hp) => hp.id))
          return [...completed.filter((c) => !existingIds.has(c.id)), ...h]
        })
      }
      return prev.filter((p) => p.status !== "completed" && p.status !== "error")
    })
  }, [])

  const clearHistory = useCallback(() => setHistory([]), [])

  // ── Crash recovery: rehydrate ProcessPanel from /api/jobs/all ──────────
  // ProcessContext is in-memory: a browser refresh / crash empties
  // `processes`, leaving any RUNNING backend job invisible in the UI even
  // though the worker is still chewing on it. On every mount we ask the
  // backend for jobs in non-terminal states for the active experiment and
  // re-register them via `addProcess({runId})`. The wsManager-subscribe
  // effect below then auto-attaches and the bottom panel + JobDetail
  // resume streaming as if the user had never left.
  //
  // useProcessScope is a module-level store (no Provider needed) so it
  // works the same in app + isolated test mounts. A null experimentId
  // means "rehydrate all running jobs visible to this user".
  const { experimentId } = useProcessScope()
  // Gate the rehydration query on `useAuth().user` rather than the raw
  // `isLoggedIn()` check. `isLoggedIn()` only checks for a token's
  // existence, not its validity — a stale or malformed token would
  // pass that check, fire /api/jobs/all, and produce a 401 that the
  // console-error guard in our E2E suite (correctly) treats as a
  // failure. Waiting for `useAuth` to confirm /api/users/me succeeded
  // means the rehydration only fires when we know the token is good.
  const { user } = useAuth()
  const { data: liveBackendJobs } = useQuery<JobOutput[], Error>({
    queryKey: ["process-rehydrate", "running-jobs", experimentId],
    queryFn: async () => {
      const all = (await JobsService.apiJobsAllGetAllJobs({})) as JobOutput[] | null
      const list = all ?? []
      const live = list.filter(
        (j) => j.status === "RUNNING" || j.status === "PENDING",
      )
      if (!experimentId) return live
      return live.filter((j) => (j as { experiment_id?: string }).experiment_id === experimentId)
    },
    enabled: Boolean(user),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  useEffect(() => {
    if (!liveBackendJobs || liveBackendJobs.length === 0) return
    setProcesses((prev) => {
      const known = new Set(prev.filter((p) => p.runId).map((p) => p.runId!))
      const additions: Process[] = []
      for (const j of liveBackendJobs) {
        const runId = String(j.id ?? "")
        if (!runId || known.has(runId)) continue
        const detail = (j.progress_detail ?? null) as { stage?: string } | null
        // Reverse-lookup which Run owns this job so the panel "View" link
        // drops the user back into the wizard run page rather than a
        // standalone job detail. After R7 there is no /process/jobs/* route,
        // so jobs unknown to runStore (e.g. submitted by an old branch) are
        // silently dropped from rehydration.
        const owningRun = findRunByJobId(runId)
        if (!owningRun) continue
        additions.push({
          id: crypto.randomUUID(),
          type: "processing",
          status: "running",
          title: `${j.job_type} job ${runId.slice(0, 8)}`,
          items: [],
          createdAt: new Date(),
          runId,
          progress: typeof j.progress === "number" ? Math.round(j.progress) : 0,
          message: detail?.stage,
          link: `/process/${owningRun.workspaceId}/run/${owningRun.id}`,
        })
      }
      if (additions.length === 0) return prev
      setHasBeenActive(true)
      return [...prev, ...additions]
    })
  }, [liveBackendJobs])

  // Subscribe via wsManager for every running process that carries a runId
  // (GEMINIbase Job UUID). The WebSocket stays open across navigation thanks
  // to the module-level singleton. Terminal events (`evt.terminal`) roll the
  // process into completed/error; further-progress events keep the bar
  // moving.
  useEffect(() => {
    const activeRunIds = new Set(
      processes
        .filter((p) => p.runId && (p.status === "running" || p.status === "pending"))
        .map((p) => p.runId!),
    )

    for (const runId of activeRunIds) {
      if (activeSubs.current.has(runId)) continue

      const unsub = subscribe(runId, (evt: JobProgressEvent) => {
        setProcesses((prev) =>
          prev.map((p) => {
            if (p.runId !== runId) return p
            // Don't overwrite already-finished entries (e.g. a previous
            // completed run sitting alongside a newly-started run sharing an
            // id in history).
            if (p.status === "completed" || p.status === "error") return p

            if (evt.terminal) {
              if (evt.status === "COMPLETED") {
                return { ...p, status: "completed", progress: 100, message: "Done" }
              }
              if (evt.status === "FAILED") {
                return {
                  ...p,
                  status: "error",
                  message: evt.error_message ?? "Failed",
                }
              }
              if (evt.status === "CANCELLED") {
                return { ...p, status: "error", message: "Cancelled" }
              }
            }

            // Non-terminal progress update — derive a status message from
            // progress_detail.stage when present, otherwise leave unchanged.
            const stage =
              (evt.progress_detail as { stage?: string } | null | undefined)
                ?.stage ?? null
            return {
              ...p,
              status: "running",
              ...(typeof evt.progress === "number"
                ? { progress: evt.progress }
                : {}),
              ...(stage ? { message: String(stage) } : {}),
            }
          }),
        )
      })

      activeSubs.current.set(runId, unsub)
    }

    // Unsubscribe from runIds no longer active so the socket can be GC'd
    // and re-subscribed cleanly if the user restarts the step.
    for (const [runId, unsub] of activeSubs.current) {
      if (!activeRunIds.has(runId)) {
        unsub()
        activeSubs.current.delete(runId)
        closeJob(runId)
      }
    }
  }, [processes])

  return (
    <ProcessContext.Provider
      value={{
        processes,
        history,
        hasBeenActive,
        addProcess,
        updateProcess,
        updateProcessItem,
        removeProcess,
        clearCompleted,
        clearHistory,
      }}
    >
      {children}
    </ProcessContext.Provider>
  )
}

export function useProcess() {
  const context = useContext(ProcessContext)
  if (context === undefined)
    throw new Error("useProcess must be used within a ProcessProvider")
  return context
}
