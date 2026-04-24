import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
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
