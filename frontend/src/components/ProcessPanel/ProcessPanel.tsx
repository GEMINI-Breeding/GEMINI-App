import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Ban, ChevronDown, ChevronUp, ExternalLink, X } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { useProcess } from "@/contexts/ProcessContext"
import { agentApi } from "@/features/agent/lib/agentApi"
import { CopyRow, CopyWatcher } from "@/features/files/components/CopyProgress"
import { isFinished, useTrackedCopies } from "@/features/files/lib/copyTracker"
import {
  mapUploadProgress,
  mapWorkerProgress,
} from "@/features/files/lib/uploadProgressSplit"
import { CANCEL_WHILE_RUNNING } from "@/features/process/lib/jobTitle"
import { useWhere } from "@/lib/where"
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
    return Math.round(mapUploadProgress(((done + running * 0.5) / total) * 100))
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
  queued = false,
  onDismiss,
  onCancel,
}: {
  process: Process
  /** Waiting for a worker: any job can be called off then. */
  queued?: boolean
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
            type="button"
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="Go to page"
            onClick={() => navigate({ to: process.link! as any })}
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
        <span className={`shrink-0 text-xs ${statusColor}`}>{statusLabel}</span>
        {process.cancel &&
          !isDone &&
          // A job on the cluster: while queued, or while running for the
          // steps whose worker stops on a cancel. Uploads always.
          (process.type !== "processing" ||
            queued ||
            process.status === "pending" ||
            CANCEL_WHILE_RUNNING.has(process.stepKey ?? "")) && (
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              title={queued ? "Cancel (not started yet)" : "Cancel"}
              aria-label={`Cancel ${process.title}`}
              onClick={onCancel}
            >
              <Ban className="h-3.5 w-3.5" />
            </button>
          )}
        <button
          type="button"
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

export const AUTO_DISMISS_MS = 10_000

/** "2 running · 3 queued": jobs waiting their turn are not said to run. */
function activeLabel(active: number, queued: number): string {
  const running = active - queued
  return [running > 0 && `${running} running`, queued > 0 && `${queued} queued`]
    .filter(Boolean)
    .join(" · ")
}

export function ProcessPanel() {
  const where = useWhere()
  const {
    processes,
    hasBeenActive,
    removeProcess,
    clearCompleted,
    updateProcess,
    queuedJobIds,
  } = useProcess()
  // Jobs started here open the panel; jobs found running elsewhere (the
  // agent's, another tab's) only show the pill, so the panel does not cover
  // the page the person is on.
  const startedHere = processes.filter((p) => !p.background).length
  const [isOpen, setIsOpen] = useState(startedHere > 0)

  useEffect(() => {
    if (startedHere > 0) setIsOpen(true)
  }, [startedHere])

  // Uploads and copies the app's service runs (on the cluster, or waiting for
  // a free cluster job slot): they are work in flight too.
  const work = useQuery({
    queryKey: ["agent", "work"],
    queryFn: () => agentApi.work(),
    refetchInterval: 20_000,
    retry: false,
  })
  // Copies started in this browser: their own rows (progress, details on a
  // click), kept after they end until dismissed.
  const copies = useTrackedCopies()
  const copyIds = new Set(copies.map((c) => c.id))
  const transfers = (work.data ?? []).filter(
    (t) => !copyIds.has(t.id) && !(t.fetch_id && copyIds.has(t.fetch_id)),
  )
  const copiesActive = copies.filter(
    (c) => !c.final || !isFinished(c.final),
  ).length
  const queuedCount =
    processes.filter((p) => p.status === "pending").length +
    transfers.filter((t) => t.state !== "running").length
  const runningCount =
    processes.filter((p) => p.status === "running" || p.status === "pending")
      .length +
    transfers.length +
    copiesActive

  // A job that finished successfully leaves the panel after a while: the
  // open panel (or its pill) sits over the bottom-right of every page — it
  // covered Plot Marking's and the GCP picker's Save buttons — and the
  // result is on the page it belongs to. Failures stay until dismissed.
  const doneIds = processes
    .filter((p) => p.status === "completed")
    .map((p) => p.id)
    .join(",")
  // biome-ignore lint/correctness/useExhaustiveDependencies: doneIds stands in for the finished set
  useEffect(() => {
    if (!doneIds) return
    const t = setTimeout(() => {
      for (const id of doneIds.split(",")) removeProcess(id)
    }, AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [doneIds])

  if (
    (!hasBeenActive || processes.length === 0) &&
    transfers.length === 0 &&
    copies.length === 0
  )
    return <CopyWatcher />

  if (!isOpen) {
    return (
      <div
        className="fixed right-4 bottom-4 z-50"
        data-onboarding="process-panel"
      >
        <Button
          variant="outline"
          size="sm"
          className="shadow-md"
          onClick={() => setIsOpen(true)}
        >
          <ChevronUp className="mr-1.5 h-4 w-4" />
          {runningCount > 0
            ? activeLabel(runningCount, queuedCount)
            : `${processes.length + copies.length} processes`}
        </Button>
        <CopyWatcher />
      </div>
    )
  }

  return (
    <div
      className="fixed right-4 bottom-4 z-50 w-80"
      data-onboarding="process-panel"
    >
      <Card className="shadow-lg overflow-hidden">
        <CardHeader className="p-3">
          <div className="flex items-center gap-1">
            <p className="text-foreground flex-1 text-sm font-medium">
              {runningCount > 0
                ? activeLabel(runningCount, queuedCount)
                : "Processes"}
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
          {/* Where each piece of work happens: processing jobs run where the
              app's data is (this computer or the cluster); uploads and exports
              run from this computer. */}
          {(
            [
              [
                `Jobs on ${where.place === "cluster" ? `the cluster ${where.cluster ?? ""}`.trim() : "this computer"}`,
                processes.filter((p) => p.type === "processing"),
                "process-section-jobs",
              ],
              [
                "From this computer",
                processes.filter((p) => p.type !== "processing"),
                "process-section-local",
              ],
            ] as const
          ).map(([title, list, testId]) =>
            list.length === 0 ? null : (
              <div key={testId} data-testid={testId}>
                <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">
                  {title}
                </p>
                {list.map((p) => (
                  <ProcessItem
                    key={p.id}
                    process={p}
                    queued={Boolean(p.runId && queuedJobIds.has(p.runId))}
                    onDismiss={() => removeProcess(p.id)}
                    onCancel={() => {
                      p.cancel?.()
                      updateProcess(p.id, { cancel: undefined })
                    }}
                  />
                ))}
              </div>
            ),
          )}
          {copies.length > 0 && (
            <div className="border-t" data-testid="process-copies">
              <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">
                Copies from online storage
              </p>
              {copies.map((c) => (
                <CopyRow key={c.id} copy={c} />
              ))}
            </div>
          )}
          {transfers.length > 0 && (
            <div className="border-t" data-testid="process-transfers">
              <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">
                Uploads and copies
              </p>
              {transfers.map((t) =>
                t.kind === "fetch" ? (
                  // A copy started elsewhere (another browser, the agent): its
                  // progress and log on a click too.
                  <CopyRow
                    key={t.id}
                    title={t.title}
                    copy={{ id: t.fetch_id ?? t.id, date: "", started: 0 }}
                    known={{
                      state: t.state === "running" ? "RUNNING" : "QUEUED",
                      line: t.detail,
                    }}
                  />
                ) : (
                  <div key={t.id} className="px-3 py-1.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${t.state === "running" ? "bg-green-500" : "bg-amber-500 animate-pulse"}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {t.title}
                      </span>
                      <span className="text-muted-foreground">
                        {/* Uploads send files from this computer; copies and
                          folder uploads are jobs on the cluster. */}
                        {t.kind === "upload"
                          ? "from this computer"
                          : "on the cluster"}
                        {" · "}
                        {t.state}
                      </span>
                    </div>
                    {t.detail && (
                      <p className="ml-4 truncate text-muted-foreground">
                        {t.detail}
                      </p>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <CopyWatcher />
    </div>
  )
}
