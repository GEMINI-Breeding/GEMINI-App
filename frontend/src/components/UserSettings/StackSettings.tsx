/**
 * Settings → Data & services: where the local stack keeps its data (D5:
 * chosen at first run, changeable here) and controls for the services.
 *
 * Moving the data copies it, checks the copy, switches over and restarts;
 * the old folder is left exactly as it was for the user to remove once
 * they're satisfied — GEMINI never deletes data for them (D1).
 *
 * In the browser / dev builds the stack is `docker compose` run by hand, so
 * this only explains where those settings live.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getToken } from "@/lib/auth"
import {
  isManagedStack,
  moveStackData,
  onStackProgress,
  restartStack,
  stackDataSize,
  stackLogs,
  stackStatus,
  stopStackAndQuit,
} from "@/lib/stack"

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`

/** Jobs that a stop would interrupt (running or waiting for a worker). */
async function activeJobCount(apiUrl: string): Promise<number> {
  let n = 0
  for (const status of ["RUNNING", "PENDING"]) {
    const res = await fetch(`${apiUrl}/api/jobs/all?status=${status}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (res.ok) n += ((await res.json()) as unknown[]).length
  }
  return n
}

export function StackSettings() {
  return isManagedStack() ? <ManagedStackSettings /> : <DevStackNotice />
}

function DevStackNotice() {
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <h2 className="text-lg font-medium">Data & services</h2>
      <p className="text-muted-foreground text-sm">
        In the desktop app this is where you choose the data folder and restart
        GEMINI's services. Here the services are the development Docker Compose
        stack: its data lives in Docker volumes, configured in
        <code className="bg-muted mx-1 rounded px-1">
          backend/gemini/pipeline/.env
        </code>
        and the root
        <code className="bg-muted mx-1 rounded px-1">docker-compose.yaml</code>.
      </p>
    </div>
  )
}

function ManagedStackSettings() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const status = useQuery({
    queryKey: ["stack", "status"],
    queryFn: stackStatus,
  })
  const size = useQuery({
    queryKey: ["stack", "size"],
    queryFn: stackDataSize,
    staleTime: 60_000,
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [moved, setMoved] = useState<{ from: string; to: string } | null>(null)
  const [logs, setLogs] = useState<string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["stack"] })

  /** Run a long stack operation with its progress lines on screen. */
  const withProgress = async (label: string, op: () => Promise<unknown>) => {
    setBusy(label)
    setLines([])
    const unlisten = await onStackProgress((p) =>
      setLines((l) => [...l.slice(-199), p.message]),
    )
    try {
      await op()
      return true
    } catch (e) {
      setError(String(e))
      return false
    } finally {
      unlisten()
      setBusy(null)
      void refresh()
    }
  }

  /** Warn before interrupting jobs; true to go ahead. */
  const okToStop = async (what: string) => {
    const apiUrl = status.data?.api_url
    const n = apiUrl ? await activeJobCount(apiUrl).catch(() => 0) : 0
    if (n === 0) return true
    return confirm({
      title: `${n} job${n === 1 ? " is" : "s are"} still running`,
      description: `${what} stops GEMINI's services, which interrupts ${n === 1 ? "it" : "them"}; you'd have to run ${n === 1 ? "it" : "them"} again. Wait until they finish unless you're sure.`,
      confirmLabel: "Stop them anyway",
      variant: "destructive",
    })
  }

  const move = async () => {
    const from = status.data?.config?.data_dir
    if (!from) return
    const { open } = await import("@tauri-apps/plugin-dialog")
    const to = await open({ directory: true, title: "Move GEMINI's data to…" })
    if (typeof to !== "string") return
    if (!(await okToStop("Moving the data"))) return
    const ok = await confirm({
      title: "Move GEMINI's data?",
      description: `GEMINI's services stop while ${size.data ? gb(size.data) : "the data"} is copied to ${to}, then restart from there. The copy is checked before GEMINI switches to it. The current folder (${from}) is left exactly as it is — delete it yourself once you're satisfied.`,
      confirmLabel: "Move",
    })
    if (!ok) return
    if (await withProgress("Moving data", () => moveStackData(to)))
      setMoved({ from, to })
  }

  const s = status.data
  return (
    <div className="flex max-w-2xl flex-col gap-8" data-testid="stack-settings">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Data folder</h2>
        <p className="text-muted-foreground text-sm">
          Uploads, results and the database. Choose a drive with room to grow.
        </p>
        <div className="flex items-center gap-3">
          <code className="bg-muted rounded px-2 py-1 text-sm">
            {s?.config?.data_dir ?? "…"}
          </code>
          <span className="text-muted-foreground text-sm">
            {size.data !== undefined ? gb(size.data) : ""}
          </span>
        </div>
        <Button
          variant="outline"
          className="w-fit"
          disabled={!s?.config || !!busy}
          onClick={() => void move()}
        >
          Move to another folder…
        </Button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Services</h2>
        <dl className="text-muted-foreground grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt>Status</dt>
          <dd>{s ? (s.healthy ? "Running" : "Not responding") : "…"}</dd>
          <dt>Release</dt>
          <dd className="font-mono">{s?.version ?? "…"}</dd>
          <dt>Docker</dt>
          <dd>
            {s?.docker.state === "ready" ? s.docker.version : s?.docker.state}
          </dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={async () => {
              if (await okToStop("Restarting"))
                await withProgress("Restarting services", restartStack)
            }}
          >
            Restart services
          </Button>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={async () => setLogs(await stackLogs(300).catch(String))}
          >
            Show service logs
          </Button>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={async () => {
              if (await okToStop("Quitting this way"))
                await withProgress("Stopping services", stopStackAndQuit)
            }}
          >
            Stop services and quit
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Closing the window leaves the services running so jobs finish; they
          use little when idle. “Stop services and quit” frees that memory.
        </p>
      </section>

      <Dialog open={!!busy}>
        <DialogContent
          className="max-w-lg"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          data-testid="stack-busy"
        >
          <DialogHeader>
            <DialogTitle>{busy}…</DialogTitle>
            <DialogDescription>
              Keep GEMINI open until this finishes.
            </DialogDescription>
          </DialogHeader>
          <pre className="bg-muted max-h-48 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
            {lines.at(-1) ?? ""}
          </pre>
        </DialogContent>
      </Dialog>

      <Dialog open={!!error} onOpenChange={(o) => !o && setError(null)}>
        <DialogContent className="max-w-lg" data-testid="stack-settings-error">
          <DialogHeader>
            <DialogTitle>That didn't work</DialogTitle>
          </DialogHeader>
          <pre className="bg-muted max-h-60 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
            {error}
          </pre>
          <DialogFooter>
            <Button onClick={() => setError(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!moved} onOpenChange={(o) => !o && setMoved(null)}>
        <DialogContent className="max-w-lg" data-testid="stack-moved">
          <DialogHeader>
            <DialogTitle>Data moved</DialogTitle>
            <DialogDescription>
              GEMINI now uses {moved?.to}. The previous folder, {moved?.from},
              is untouched: check your data here, then delete it yourself to
              free the space.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setMoved(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logs !== null} onOpenChange={(o) => !o && setLogs(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Service logs</DialogTitle>
          </DialogHeader>
          <pre className="bg-muted max-h-[60vh] overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
            {logs}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}
