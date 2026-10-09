/**
 * ComputePanel — what is running on the cluster, and the switches for it.
 *
 * One row per part of the processing stack: the core, each worker (one per
 * kind of job) and the agent's own model. Each row shows its state, where it
 * runs and how many of the app's jobs wait for it, with Start / Stop and a
 * choice of placement. The same state and actions are the agent's
 * `processes` / `start_process` / `stop_process` tools, so the page and the
 * agent never disagree about what is up.
 *
 * Placements are limited to the ones the cluster's configuration names; the
 * cluster-side gate enforces the same list and the job size limits.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Play, RefreshCw, Square } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  agentApi,
  type ComputePart,
  type ComputeState,
} from "@/features/agent/lib/agentApi"

const DOT: Record<ComputeState, string> = {
  running: "bg-emerald-500",
  starting: "bg-amber-500 animate-pulse",
  queued: "bg-amber-500 animate-pulse",
  stopping: "bg-amber-500 animate-pulse",
  stopped: "bg-muted-foreground/40",
  unknown: "bg-muted-foreground/40",
}

function stateLine(p: ComputePart): string {
  if (p.busy) return p.busy.action === "starting" ? "Submitting…" : "Stopping…"
  const at = p.partition ? ` on ${p.partition}` : ""
  switch (p.state) {
    case "running":
      return `Running${p.node ? ` on ${p.node}` : at} · ${p.elapsed} of ${p.time_limit}`
    case "starting":
      return p.name === "llm"
        ? `Loading the model${p.node ? ` on ${p.node}` : at}`
        : `Starting${at}`
    case "queued":
      return `Waiting in the queue${at}${p.reason ? ` (${p.reason})` : ""}`
    case "stopping":
      return "Stopping"
    case "stopped":
      return "Not running"
    default:
      return "State unknown"
  }
}

/** What stopping this part costs, said before it happens. */
function stopWarning(p: ComputePart): string {
  if (p.name === "core")
    return "This ends the session: every worker is stopped, then the database and storage shut down cleanly. The app will not be reachable until the core is started again. Data is kept."
  if (p.name === "llm")
    return "The agent on this page uses this model. Its conversations stop answering until the model is started again or another model is chosen in the settings."
  if (p.jobs_running > 0)
    return `This worker is in the middle of ${p.jobs_running} job${p.jobs_running === 1 ? "" : "s"}. Stopping it now makes ${p.jobs_running === 1 ? "that job" : "those jobs"} fail; ${p.jobs_running === 1 ? "it" : "they"} must be submitted again.`
  if (p.jobs_waiting > 0)
    return `${p.jobs_waiting} job${p.jobs_waiting === 1 ? " is" : "s are"} waiting for this worker and will stay waiting until it is started again.`
  if (p.state !== "running")
    return "It has not started yet. Stopping takes it out of the cluster's queue."
  return "The worker is idle. Stopping it frees its allocation on the cluster."
}

function Row({
  part,
  canManage,
  onError,
}: {
  part: ComputePart
  canManage: boolean
  onError: (message: string | null) => void
}) {
  const queryClient = useQueryClient()
  const [where, setWhere] = useState(part.where)
  const [confirmStop, setConfirmStop] = useState(false)
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["agent", "compute"] })
  const start = useMutation({
    mutationFn: () => agentApi.computeStart(part.name, where),
    onSuccess: () => {
      onError(null)
      refresh()
    },
    onError: (e) => onError(e instanceof Error ? e.message : String(e)),
  })
  const stop = useMutation({
    mutationFn: () => agentApi.computeStop(part.name),
    onSuccess: () => {
      onError(null)
      setConfirmStop(false)
      refresh()
    },
    onError: (e) => {
      setConfirmStop(false)
      onError(e instanceof Error ? e.message : String(e))
    },
  })
  const off = part.state === "stopped"
  const working = Boolean(part.busy) || start.isPending || stop.isPending
  const needed = off && part.jobs_waiting > 0
  const idle =
    part.state === "running" &&
    typeof part.idle_minutes === "number" &&
    part.idle_minutes >= 5

  return (
    <div
      className="border-b py-2 last:border-b-0"
      data-testid={`compute-${part.name}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${DOT[part.state]}`}
          aria-hidden
        />
        <span className="text-sm font-medium">{part.label}</span>
        <div className="ml-auto">
          {working ? (
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          ) : off ? (
            <Button
              size="sm"
              variant={needed ? "default" : "outline"}
              className="h-7 px-2"
              disabled={!canManage || part.state === "unknown"}
              onClick={() => start.mutate()}
            >
              <Play className="h-3 w-3" /> Start
            </Button>
          ) : part.state !== "unknown" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              disabled={!canManage || part.state === "stopping"}
              onClick={() => setConfirmStop(true)}
            >
              <Square className="h-3 w-3" /> Stop
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-muted-foreground mt-0.5 text-xs">{part.does}</p>
      <p className="mt-1 text-xs" data-testid={`compute-${part.name}-state`}>
        {stateLine(part)}
      </p>
      {(part.jobs_running > 0 || part.jobs_waiting > 0) && (
        <p
          className={`text-xs ${needed ? "text-amber-700 dark:text-amber-400" : ""}`}
        >
          {part.jobs_running > 0 && `${part.jobs_running} running`}
          {part.jobs_running > 0 && part.jobs_waiting > 0 && " · "}
          {part.jobs_waiting > 0 &&
            `${part.jobs_waiting} waiting${needed ? " for this worker to start" : ""}`}
        </p>
      )}
      {idle && (
        <p className="text-muted-foreground text-xs">
          Nothing to do for {part.idle_minutes} min
        </p>
      )}
      {part.last && !part.last.ok && !part.busy && (
        <p className="text-xs text-red-700 dark:text-red-400">
          {part.last.message}
        </p>
      )}
      {off && canManage && part.options.length > 0 && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-muted-foreground shrink-0 text-xs">Run on</span>
          <Select value={where} onValueChange={setWhere}>
            <SelectTrigger
              className="h-7 min-w-0 flex-1 text-xs"
              data-testid={`compute-${part.name}-where`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                {part.name === "core"
                  ? `Default (${part.options[0]})`
                  : "Whichever can start soonest"}
              </SelectItem>
              {part.options.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {off && (
        <p className="text-muted-foreground mt-1 text-[11px]">
          Asks for {part.resources}
        </p>
      )}
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={`Stop ${part.label.toLowerCase()}?`}
        description={stopWarning(part)}
        confirmLabel="Stop"
        variant={
          part.jobs_running > 0 || part.name === "core"
            ? "destructive"
            : "default"
        }
        loading={stop.isPending}
        onConfirm={() => stop.mutate()}
      />
    </div>
  )
}

export function ComputePanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const compute = useQuery({
    queryKey: ["agent", "compute"],
    queryFn: () => agentApi.compute(),
    refetchInterval: 10_000,
    retry: false,
  })
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["agent", "compute"] })
  const reconnect = useMutation({
    mutationFn: agentApi.computeReconnect,
    onSuccess: () => {
      setError(null)
      refresh()
      queryClient.invalidateQueries({ queryKey: ["agent", "status"] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })
  const prefs = useMutation({
    mutationFn: agentApi.computePrefs,
    onSuccess: refresh,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })
  const data = compute.data
  const core = data?.parts.find((p) => p.name === "core")
  const tunnelDown =
    core?.state === "running" && data?.connection && !data.connection.api

  return (
    <Card
      className="flex w-80 shrink-0 flex-col overflow-hidden"
      data-testid="agent-compute"
    >
      <CardContent className="flex min-h-0 flex-1 flex-col p-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">Compute</div>
            <div className="text-muted-foreground truncate text-xs">
              {data?.cluster
                ? `${data.cluster}${data.host ? ` · ${data.host}` : ""}`
                : "This computer"}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7"
            aria-label="Refresh compute status"
            onClick={() =>
              queryClient.fetchQuery({
                queryKey: ["agent", "compute"],
                queryFn: () => agentApi.compute(true),
              })
            }
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${compute.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>

        {compute.isLoading && (
          <p className="text-muted-foreground mt-2 text-xs">
            Asking the cluster…
          </p>
        )}
        {compute.isError && (
          <p className="mt-2 text-xs text-red-700 dark:text-red-400">
            {compute.error instanceof Error
              ? compute.error.message
              : "Compute status unavailable"}
          </p>
        )}
        {data?.note && (
          <p className="text-muted-foreground mt-2 text-xs">{data.note}</p>
        )}
        {data?.error && (
          <p className="mt-2 text-xs text-red-700 dark:text-red-400">
            The cluster did not answer: {data.error}
          </p>
        )}
        {tunnelDown && (
          <div className="mt-2 rounded border border-amber-300 p-2 text-xs">
            The core is running but this computer's connection to it is closed.
            <Button
              size="sm"
              variant="outline"
              className="mt-1 h-7 w-full"
              disabled={!canManage || reconnect.isPending}
              onClick={() => reconnect.mutate()}
            >
              {reconnect.isPending && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              Reconnect
            </Button>
          </div>
        )}
        {error && (
          <p className="mt-2 text-xs text-red-700 dark:text-red-400">{error}</p>
        )}

        <div className="mt-1 min-h-0 flex-1 overflow-y-auto pr-1">
          {(data?.parts ?? []).map((p) => (
            <Row
              // The saved placement arrives with the data; remount when it changes.
              key={`${p.name}:${p.where}`}
              part={p}
              canManage={canManage}
              onError={setError}
            />
          ))}
        </div>

        {data?.cluster && (
          <div className="mt-2 space-y-1.5 border-t pt-2 text-xs">
            <div className="flex items-start gap-2">
              <Checkbox
                id="compute-auto-start"
                className="mt-0.5"
                checked={data.auto_start}
                disabled={!canManage || prefs.isPending}
                onCheckedChange={(v) =>
                  prefs.mutate({ auto_start: v === true })
                }
              />
              <label htmlFor="compute-auto-start">
                Start a worker when a job needs it
              </label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="compute-idle-stop"
                className="mt-0.5"
                checked={(data.idle_stop_minutes ?? 0) > 0}
                disabled={!canManage || prefs.isPending}
                onCheckedChange={(v) =>
                  prefs.mutate({ idle_stop_minutes: v === true ? 60 : 0 })
                }
              />
              <label htmlFor="compute-idle-stop">
                Stop a worker after 60 min with no jobs
              </label>
            </div>
            {!canManage && (
              <p className="text-muted-foreground">
                Only an administrator can start or stop these.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
