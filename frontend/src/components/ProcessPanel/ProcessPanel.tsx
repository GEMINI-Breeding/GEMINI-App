import { useNavigate } from "@tanstack/react-router"
import { Ban, ChevronDown, ChevronUp, ExternalLink, X } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { useProcess } from "@/contexts/ProcessContext"
import {
  mapUploadProgress,
  mapWorkerProgress,
} from "@/features/files/lib/uploadProgressSplit"
import type { Process } from "@/types/process"

/**
 * Bytes-weighted percent across all items in a file_upload Process.
 * Returns null if no item carries byte counters (legacy non-chunked
 * callers); the caller falls back to count-based progress in that
 * case.
 */
function uploadBytesPercent(process: Process): number | null {
  const totalBytes = process.items.reduce(
    (acc, i) => acc + (i.totalBytes ?? 0),
    0,
  )
  if (totalBytes <= 0) return null
  const uploaded = process.items.reduce(
    (acc, i) => acc + (i.uploadedBytes ?? 0),
    0,
  )
  return Math.round((uploaded / totalBytes) * 100)
}

function processProgress(process: Process): number {
  if (process.type === "processing") {
    // Workers report progress as float percentages (e.g. ODM streams
    // 3.27299...% during image upload); round to keep the bar width
    // and the visible label sane.
    const raw = process.progress ?? (process.status === "completed" ? 100 : 0)
    return Math.round(raw)
  }
  if (process.type === "file_upload") {
    // Unified 0→100 bar split into two bands:
    //   • Browser → MinIO chunk upload: [0, UPLOAD_PHASE_END]
    //   • Worker job (download → extract → upload → register):
    //     [UPLOAD_PHASE_END, 100]
    //
    // The bar never resets at the phase handoff — previously it
    // filled to 100% during chunk upload and then reset to 0 when
    // runId was set, which read like "done, then started over."
    if (process.runId !== undefined) {
      // Worker phase. process.progress is written by the WS
      // handler from the worker's report_progress (0–100).
      return Math.round(mapWorkerProgress(process.progress ?? 0))
    }
    const total = process.items.length
    if (total === 0) return process.status === "completed" ? 100 : 0
    const bytesPct = uploadBytesPercent(process)
    if (bytesPct !== null) return Math.round(mapUploadProgress(bytesPct))
    // Fallback for callers that don't populate byte counters.
    const done = process.items.filter(
      (i) => i.status === "completed" || i.status === "skipped",
    ).length
    const running = process.items.filter((i) => i.status === "running").length
    return Math.round(
      mapUploadProgress(((done + running * 0.5) / total) * 100),
    )
  }
  const total = process.items.length
  if (total === 0) return process.status === "completed" ? 100 : 0
  const done = process.items.filter(
    (i) => i.status === "completed" || i.status === "skipped",
  ).length
  const running = process.items.filter((i) => i.status === "running").length
  return Math.round(((done + running * 0.5) / total) * 100)
}

function processStatusLabel(process: Process): string {
  if (process.status === "completed") return "Done"
  if (process.status === "error") return "Failed"
  if (process.type === "processing") {
    return `${Math.round(process.progress ?? 0)}%`
  }
  if (process.type === "file_upload") {
    // Label matches the bar exactly — same mapped 0→100 percent
    // across both phases. processProgress is the single source of
    // truth, called twice with the same Process so the values
    // can't drift.
    return `${processProgress(process)}%`
  }
  const total = process.items.length
  const done = process.items.filter(
    (i) => i.status === "completed" || i.status === "skipped",
  ).length
  const running = process.items.filter((i) => i.status === "running").length
  if (running > 0) return `${done}/${total} (${running} uploading)`
  return `${done}/${total}`
}

function ProcessItem({
  process,
  onDismiss,
  onCancel,
}: {
  process: Process
  onDismiss: () => void
  onCancel: () => void
}) {
  const navigate = useNavigate()
  const pct = processProgress(process)
  const statusLabel = processStatusLabel(process)
  const isDone = process.status === "completed" || process.status === "error"
  const statusColor =
    process.status === "completed"
      ? "text-green-600"
      : process.status === "error"
        ? "text-red-500"
        : "text-muted-foreground"

  return (
    <div className="px-3 py-2.5 border-b last:border-b-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {process.title}
        </span>
        {process.link && (
          <button
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="Go to page"
            onClick={() => navigate({ to: process.link! as any })}
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
        <span className={`shrink-0 text-xs ${statusColor}`}>{statusLabel}</span>
        {process.cancel && !isDone && (
          <button
            className="shrink-0 text-muted-foreground hover:text-destructive"
            title="Cancel"
            onClick={onCancel}
          >
            <Ban className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          className={`shrink-0 text-muted-foreground hover:text-foreground ${isDone ? "" : "invisible pointer-events-none"}`}
          title="Dismiss"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {process.message && (
        <p className="text-muted-foreground mt-0.5 truncate text-xs">
          {process.message}
        </p>
      )}
      {!isDone && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

export function ProcessPanel() {
  const {
    processes,
    hasBeenActive,
    removeProcess,
    clearCompleted,
    updateProcess,
  } = useProcess()
  const [isOpen, setIsOpen] = useState(true)

  useEffect(() => {
    if (processes.length > 0) setIsOpen(true)
  }, [processes.length])

  if (!hasBeenActive || processes.length === 0) return null

  const runningCount = processes.filter(
    (p) => p.status === "running" || p.status === "pending",
  ).length

  if (!isOpen) {
    return (
      <div className="fixed right-4 bottom-4 z-50">
        <Button
          variant="outline"
          size="sm"
          className="shadow-md"
          onClick={() => setIsOpen(true)}
        >
          <ChevronUp className="mr-1.5 h-4 w-4" />
          {runningCount > 0
            ? `${runningCount} running`
            : `${processes.length} processes`}
        </Button>
      </div>
    )
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 w-80">
      <Card className="shadow-lg overflow-hidden">
        <CardHeader className="p-3">
          <div className="flex items-center gap-1">
            <p className="text-foreground flex-1 text-sm font-medium">
              {runningCount > 0 ? `${runningCount} running` : "Processes"}
            </p>
            {processes.some(
              (p) => p.status === "completed" || p.status === "error",
            ) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={clearCompleted}
              >
                Clear all
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setIsOpen(false)}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-0 pt-0 pb-0 max-h-64 overflow-y-auto">
          {processes.map((p) => (
            <ProcessItem
              key={p.id}
              process={p}
              onDismiss={() => removeProcess(p.id)}
              onCancel={() => {
                p.cancel?.()
                updateProcess(p.id, { cancel: undefined })
              }}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
