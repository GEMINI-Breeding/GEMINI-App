/**
 * Starting the worker a job waits for, where the job is submitted: a queued
 * job whose worker is not running would otherwise sit there until someone
 * finds Settings → Compute.
 *
 * - `WorkerStartDialog` asks right after a job from this tab is queued with
 *   its worker stopped (once per worker, until it runs again).
 * - `WorkerStartButton` starts it from a queued step's note.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Play } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  agentApi,
  type ComputeOverview,
  type ComputePart,
} from "@/features/agent/lib/agentApi"
import useAuth from "@/hooks/useAuth"

/** What each job type is, in the words of the run page. */
const JOB_WORDS: Record<string, string> = {
  RUN_ODM: "orthomosaic",
  CREATE_COG: "map tiles",
  SPLIT_ORTHOMOSAIC: "plot images",
  EXTRACT_TRAITS: "trait extraction",
  LOCATE_PLANTS: "model (inference)",
  RUN_STITCH: "stitching",
  ASSOCIATE_BOUNDARIES: "boundary association",
  EXTRACT_BINARY: "rover extraction",
  SYNC_METADATA: "data sync",
}

export const jobWords = (type: string) =>
  JOB_WORDS[type] ?? type.toLowerCase().replace(/_/g, " ")

/**
 * The worker a job of `type` waits for, when it is stopped and nobody will
 * start it on their own (automatic start is off); null otherwise.
 */
export function stoppedWorkerFor(
  c: ComputeOverview | undefined,
  type: string,
): ComputePart | null {
  if (!c || c.error || c.connection?.api === false || c.auto_start) return null
  const part = c.parts.find((p) => p.job_types.includes(type))
  return part && part.state === "stopped" ? part : null
}

/**
 * With "start workers automatically" on: the stopped worker a job of `type`
 * waits for, to start right away from the page that queued it (rather than at
 * the service's next look, up to a minute later); null otherwise.
 */
export function workerToAutoStart(
  c: ComputeOverview | undefined,
  type: string,
): ComputePart | null {
  if (!c || c.error || c.connection?.api === false || !c.auto_start) return null
  const part = c.parts.find((p) => p.job_types.includes(type))
  return part && part.state === "stopped" && !part.busy ? part : null
}

function useCanManage(c: ComputeOverview | undefined) {
  const { user } = useAuth()
  return Boolean(user?.is_superuser) || Boolean(c?.you_can_manage)
}

function useStartWorker(onDone?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      part,
      always,
    }: {
      part: ComputePart
      always?: boolean
    }) => {
      if (always) await agentApi.computePrefs({ auto_start: true })
      return agentApi.computeStart(part.name, part.where)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent", "compute"] })
      onDone?.()
    },
  })
}

/** Start the stopped worker a queued step waits for (or say who can). */
export function WorkerStartButton({
  part,
  compute,
}: {
  part: ComputePart
  compute: ComputeOverview | undefined
}) {
  const canManage = useCanManage(compute)
  const start = useStartWorker()
  if (!canManage) {
    const owner = compute?.share?.owner
    return (
      <span className="block pt-1" data-testid="worker-start-ask">
        Only {owner ? `the session's owner (${owner})` : "an administrator"} can
        start it.
      </span>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-2 pt-1">
      <Button
        size="sm"
        className="h-6 gap-1 px-2 text-xs"
        disabled={start.isPending}
        data-testid="worker-start-button"
        onClick={() => start.mutate({ part })}
      >
        {start.isPending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Play className="size-3" />
        )}
        Start the {part.label} worker
      </Button>
      {start.isError && (
        <span className="text-red-700 dark:text-red-400">
          {start.error instanceof Error
            ? start.error.message
            : String(start.error)}
        </span>
      )}
    </span>
  )
}

/**
 * Asks to start the worker once a job submitted from this tab is queued and
 * its worker is stopped. `queued` maps the queued job ids this tab
 * submitted to their job type.
 */
export function WorkerStartDialog({
  queued,
}: {
  queued: ReadonlyMap<string, string>
}) {
  const types = useMemo(() => [...new Set(queued.values())], [queued])
  const compute = useQuery({
    queryKey: ["agent", "compute"],
    queryFn: () => agentApi.compute(),
    enabled: types.length > 0,
    refetchInterval: types.length > 0 ? 30_000 : false,
    retry: false,
  })
  const canManage = useCanManage(compute.data)
  // Workers already asked about; asked again only after they ran meanwhile.
  const asked = useRef(new Set<string>())
  const [ask, setAsk] = useState<{ part: ComputePart; type: string } | null>(
    null,
  )
  const [always, setAlways] = useState(false)
  const start = useStartWorker(() => close())
  function close() {
    start.reset()
    setAsk(null)
  }

  // Started from here because the setting says so: once per worker until it runs.
  const autoStarted = useRef(new Set<string>())
  const queryClient = useQueryClient()
  useEffect(() => {
    const c = compute.data
    if (!c || !canManage) return
    for (const p of c.parts)
      if (p.state !== "stopped") autoStarted.current.delete(p.name)
    for (const type of types) {
      const part = workerToAutoStart(c, type)
      if (!part || autoStarted.current.has(part.name)) continue
      autoStarted.current.add(part.name)
      agentApi
        .computeStart(part.name, part.where)
        .then(() => {
          toast.info(
            `Starting the ${part.label} worker for your ${jobWords(type)} job.`,
          )
          queryClient.invalidateQueries({ queryKey: ["agent", "compute"] })
        })
        .catch(() => {
          // Already starting (the service got there first): nothing to do.
        })
    }
  }, [compute.data, types, canManage, queryClient])

  useEffect(() => {
    const c = compute.data
    if (!c) return
    for (const p of c.parts)
      if (p.state !== "stopped") asked.current.delete(p.name)
    if (ask || !canManage) return
    for (const type of types) {
      const part = stoppedWorkerFor(c, type)
      if (part && !asked.current.has(part.name)) {
        asked.current.add(part.name)
        setAlways(false)
        setAsk({ part, type })
        return
      }
    }
  }, [compute.data, types, ask, canManage])

  if (!ask) return null
  const waiting = ask.part.jobs_waiting
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md" data-testid="worker-start-dialog">
        <DialogHeader>
          <DialogTitle>Start the {ask.part.label} worker?</DialogTitle>
          <DialogDescription>
            Your {jobWords(ask.type)} job is queued, but no {ask.part.label}{" "}
            worker is running on the cluster, so it will not start until one is.
            {waiting > 1 && ` ${waiting} jobs are waiting for it.`}
          </DialogDescription>
        </DialogHeader>
        {ask.part.resources && (
          <p className="text-muted-foreground text-xs">
            It asks the cluster for {ask.part.resources}
            {ask.part.where && ask.part.where !== "auto"
              ? ` on ${ask.part.where}`
              : ""}
            .
            {compute.data?.idle_stop_minutes
              ? ` It stops on its own after ${compute.data.idle_stop_minutes} min with nothing to do.`
              : ""}
          </p>
        )}
        <label
          htmlFor="worker-start-always"
          className="flex items-center gap-2 text-sm"
        >
          <Checkbox
            id="worker-start-always"
            checked={always}
            onCheckedChange={(v) => setAlways(v === true)}
            data-testid="worker-start-always"
          />
          Start workers automatically when a job needs one
        </label>
        {start.isError && (
          <p className="text-xs text-red-700 dark:text-red-400">
            {start.error instanceof Error
              ? start.error.message
              : String(start.error)}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            data-testid="worker-start-later"
            onClick={close}
          >
            Leave it queued
          </Button>
          <Button
            disabled={start.isPending}
            data-testid="worker-start-confirm"
            onClick={() => start.mutate({ part: ask.part, always })}
          >
            {start.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            Start worker
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
