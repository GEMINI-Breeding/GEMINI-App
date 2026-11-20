/**
 * WorkersNotice — while the desktop app's processing workers download in the
 * background (the first start opens on the core services alone), a small
 * note says so: the app can be used meanwhile, and a job submitted before
 * its worker is up waits for it. Gone once they are ready.
 */
import { AlertTriangle, Check, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { isDesktopApp, onStackProgress } from "@/lib/stack"

type State =
  | { kind: "idle" }
  | { kind: "working"; line: string }
  | { kind: "ready" }
  | { kind: "error"; message: string }

export function WorkersNotice() {
  const [state, setState] = useState<State>({ kind: "idle" })

  useEffect(() => {
    if (!isDesktopApp()) return
    let off: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    void onStackProgress((p) => {
      if (p.phase === "workers") setState({ kind: "working", line: p.message })
      else if (p.phase === "workers_ready") {
        setState((s) => (s.kind === "working" ? { kind: "ready" } : s))
        timer = setTimeout(() => setState({ kind: "idle" }), 6_000)
      } else if (p.phase === "workers_error")
        setState({ kind: "error", message: p.message })
    }).then((u) => {
      off = u
    })
    return () => {
      off?.()
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (state.kind === "idle") return null
  return (
    <div
      className="bg-background fixed bottom-3 left-3 z-40 w-[min(26rem,calc(100vw-2rem))] rounded-lg border p-3 text-xs shadow-lg"
      data-testid="workers-notice"
    >
      {state.kind === "working" && (
        <>
          <div className="flex items-center gap-2 font-medium">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Getting the processing workers ready
          </div>
          <p className="text-muted-foreground mt-1">
            The first time this downloads about 6 GB. Upload and look around
            meanwhile; a job started now waits until its worker is up.
          </p>
          <p className="text-muted-foreground mt-1 truncate font-mono">
            {state.line}
          </p>
        </>
      )}
      {state.kind === "ready" && (
        <div className="flex items-center gap-2 font-medium text-green-700 dark:text-green-400">
          <Check className="h-3.5 w-3.5" /> Processing workers are ready
        </div>
      )}
      {state.kind === "error" && (
        <>
          <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" /> Some processing workers
            could not start
          </div>
          <p className="text-muted-foreground mt-1 line-clamp-4 whitespace-pre-wrap font-mono">
            {state.message}
          </p>
          <p className="text-muted-foreground mt-1">
            Settings → Data &amp; services → Restart tries again.
          </p>
        </>
      )}
    </div>
  )
}
