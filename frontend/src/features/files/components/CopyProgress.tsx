/**
 * Copies from online storage followed wherever the person is: a watcher (in
 * the process panel, on every page) polls the unfinished ones and announces
 * each ending once; a row per copy opens its progress and log.
 */
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { agentApi, type CloudFetch } from "@/features/agent/lib/agentApi"
import {
  copyShortState,
  copyStateLabel,
  copyTracker,
  isFailure,
  isFinished,
  type TrackedCopy,
  useTrackedCopies,
} from "@/features/files/lib/copyTracker"

/** Where a copy is now: polled until it ends, then its recorded end. */
export function useCopyState(
  copy: TrackedCopy,
  every = 15_000,
  /** Already known (the panel's list of work): not asked again. */
  known?: Partial<CloudFetch>,
) {
  const q = useQuery({
    queryKey: ["agent", "cloud", "fetch", copy.id],
    queryFn: () => agentApi.cloudFetchState(copy.id),
    enabled: !copy.final && !known,
    refetchInterval: (s) =>
      s.state.data && isFinished(s.state.data) ? false : every,
    retry: false,
  })
  const data: Partial<CloudFetch> | undefined = copy.final ?? known ?? q.data
  return { data, error: copy.final ? null : q.error }
}

function WatchOne({ copy }: { copy: TrackedCopy }) {
  const { data } = useCopyState(copy, 15_000)
  useEffect(() => {
    if (!data?.state || !isFinished({ state: data.state })) return
    const ended = { state: data.state, line: data.line, error: data.error }
    if (!copyTracker.finish(copy.id, ended)) return
    if (isFailure(ended))
      toast.error(
        `The copy of ${copy.date} did not finish. Open it in the processes panel for the details.`,
      )
    else
      toast.success(
        `${copy.date}: copied and uploaded. The run shows on the Process tab.`,
      )
  }, [data, copy])
  return null
}

/** Follows every unfinished copy of this browser, on any page. */
export function CopyWatcher() {
  const copies = useTrackedCopies()
  return (
    <>
      {copies
        .filter((c) => !c.final)
        .map((c) => (
          <WatchOne key={c.id} copy={c} />
        ))}
    </>
  )
}

const dot = (d: Partial<CloudFetch> | undefined) =>
  !d?.state
    ? "bg-muted-foreground/40"
    : isFinished({ state: d.state })
      ? isFailure({ state: d.state })
        ? "bg-red-500"
        : "bg-green-500"
      : d.state === "RUNNING" ||
          d.state === "copying" ||
          d.state === "uploading"
        ? "bg-green-500 animate-pulse"
        : "bg-amber-500 animate-pulse"

/** One copy in the process panel: its state; click for the details. */
export function CopyRow({
  copy,
  title,
  known,
}: {
  copy: TrackedCopy
  /** Instead of "Copy · <date>". */
  title?: string
  known?: Partial<CloudFetch>
}) {
  const { data } = useCopyState(copy, 15_000, known)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="hover:bg-muted/60 block w-full px-3 py-1.5 text-left text-xs"
        data-testid={`copy-row-${copy.id}`}
        onClick={() => setOpen(true)}
      >
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot(data)}`} />
          <span className="min-w-0 flex-1 truncate font-medium">
            {title ?? `Copy · ${copy.date}`}
          </span>
          <span className="text-muted-foreground shrink-0">
            {data?.state ? copyShortState({ state: data.state }) : "…"}
          </span>
        </span>
        {data?.line && (
          <span className="text-muted-foreground ml-4 block truncate">
            {data.line}
          </span>
        )}
      </button>
      {open && <CopyDialog copy={copy} onClose={() => setOpen(false)} />}
    </>
  )
}

/** A copy's progress, its log's last lines, and dismissing it once it ended. */
export function CopyDialog({
  copy,
  onClose,
}: {
  copy: TrackedCopy
  onClose: () => void
}) {
  // Asked fresh while open, for the log (the end recorded has no log).
  const live = useQuery({
    queryKey: ["agent", "cloud", "fetch", copy.id, "log"],
    queryFn: () => agentApi.cloudFetchState(copy.id),
    refetchInterval: (s) =>
      s.state.data && isFinished(s.state.data) ? false : 5000,
    retry: false,
  })
  const data: Partial<CloudFetch> | undefined = live.data ?? copy.final
  const ended = data?.state ? isFinished({ state: data.state }) : false
  // The newest lines in view.
  const logRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = logRef.current
    if (el && data?.log) el.scrollTop = el.scrollHeight
  }, [data?.log])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="copy-dialog">
        <DialogHeader>
          <DialogTitle>
            Copy from online storage{copy.date ? ` · ${copy.date}` : ""}
          </DialogTitle>
          <DialogDescription className="break-all">
            {copy.source ?? data?.source ?? ""}
            {copy.source || data?.source ? " · " : ""}
            {copy.started
              ? `started ${new Date(copy.started).toLocaleString()}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-2 font-medium">
            {!ended && <Loader2 className="size-4 animate-spin" />}
            {data?.state
              ? copyStateLabel({ state: data.state })
              : live.isLoading
                ? "Asking where it is…"
                : "Not known"}
          </p>
          {data?.line && <p className="text-xs">{data.line}</p>}
          {data?.note && (
            <p className="text-muted-foreground text-xs">{data.note}</p>
          )}
          {data?.error && (
            <p className="text-destructive text-xs">{data.error}</p>
          )}
          {live.error && (
            <p className="text-destructive text-xs">
              Could not ask where it is:{" "}
              {live.error instanceof Error
                ? live.error.message
                : String(live.error)}
            </p>
          )}
        </div>
        {data?.log && (
          <pre
            ref={logRef}
            className="bg-muted max-h-64 overflow-auto rounded p-2 text-[11px] leading-snug whitespace-pre-wrap"
            data-testid="copy-log"
          >
            {data.log.split("\n").slice(-30).join("\n")}
          </pre>
        )}
        {ended && copyTracker.list().some((c) => c.id === copy.id) && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              data-testid="copy-dismiss"
              onClick={() => {
                copyTracker.remove(copy.id)
                onClose()
              }}
            >
              Remove from the list
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
