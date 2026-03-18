import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { Process, ProcessItem } from "@/types/process"
import { subscribe, closeRun } from "@/lib/sseManager"

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

  // Subscribe to SSE for any running process with a runId.
  // Uses the module-level sseManager so the connection survives navigation.
  // Uses a Map so terminated runs can be re-subscribed if the step is restarted.
  useEffect(() => {
    const activeRunIds = new Set(
      processes
        .filter((p) => p.runId && (p.status === "running" || p.status === "pending"))
        .map((p) => p.runId!),
    )

    // Subscribe to newly active runIds
    for (const runId of activeRunIds) {
      if (activeSubs.current.has(runId)) continue

      const unsub = subscribe(runId, (evt) => {
        setProcesses((prev) =>
          prev.map((p) => {
            if (p.runId !== runId) return p
            // Don't overwrite already-finished entries (e.g. a previous completed
            // run sitting alongside a newly re-started run with the same runId)
            if (p.status === "completed" || p.status === "error") return p
            if (evt.event === "complete") {
              return { ...p, status: "completed", progress: 100, message: "Done" }
            }
            if (evt.event === "error") {
              return { ...p, status: "error", message: evt.message ?? "Failed" }
            }
            if (evt.event === "cancelled") {
              return { ...p, status: "error", message: "Cancelled" }
            }
            if (evt.event === "progress") {
              return {
                ...p,
                ...(typeof evt.progress === "number" ? { progress: evt.progress } : {}),
                ...(evt.message ? { message: evt.message } : {}),
              }
            }
            return p
          }),
        )
      })

      activeSubs.current.set(runId, unsub)
    }

    // Unsubscribe from runIds that are no longer active (completed/error/removed)
    // so they can be re-subscribed if the same step is restarted, and close the
    // SSE connection so the retry loop doesn't keep polling the backend.
    for (const [runId, unsub] of activeSubs.current) {
      if (!activeRunIds.has(runId)) {
        unsub()
        activeSubs.current.delete(runId)
        closeRun(runId)
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
