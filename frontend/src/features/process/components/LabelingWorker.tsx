/**
 * LabelingWorker — where the labelling models stand, and a button to get
 * them ready ahead of time.
 *
 * Prompts (find similar, outlines) run on the ML worker on the cluster.
 * When none is running, the first prompt waits for Slurm to start one and
 * for the models to download (YOLOE ~28 MB, SAM 2 ~160 MB, once). "Start
 * labelling worker" starts the worker and sends a warm-up job that fetches
 * and loads both models; the person can leave and come back. The warm-up
 * job is remembered in this browser so its progress shows on return.
 */
import { useMutation, useQuery } from "@tanstack/react-query"
import { CircleCheck, Loader2, Power, TriangleAlert } from "lucide-react"
import { useState } from "react"

import { type JobOutput, JobsService } from "@/client"
import { Button } from "@/components/ui/button"
import { agentApi, type ComputePart } from "@/features/agent/lib/agentApi"

const KEY = "gemi.labelingWarmup"

function readWarmup(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function writeWarmup(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch {
    // private window: the warm-up still runs, only not remembered
  }
}

/** What the cluster says about the worker that runs labelling prompts. */
export function workerLine(
  part: ComputePart | undefined,
  error: string | null,
): { text: string; ready: boolean; tone: "ok" | "wait" | "off" | "bad" } {
  if (error)
    return {
      text: `Cannot reach the cluster from this computer (${error}).`,
      ready: false,
      tone: "bad",
    }
  if (!part)
    return { text: "Checking the ML worker…", ready: false, tone: "wait" }
  switch (part.state) {
    case "running":
      return {
        text: `ML worker running${part.node ? ` on ${part.node}` : ""}${
          part.jobs_running ? `, busy with ${part.jobs_running} job(s)` : ""
        }.`,
        ready: true,
        tone: "ok",
      }
    case "starting":
      return {
        text: "ML worker starting on the cluster…",
        ready: false,
        tone: "wait",
      }
    case "queued":
      return {
        text: `ML worker waiting for the cluster to give it a node${
          part.reason ? ` (Slurm: ${part.reason})` : ""
        }…`,
        ready: false,
        tone: "wait",
      }
    case "stopping":
      return { text: "ML worker stopping.", ready: false, tone: "off" }
    case "stopped":
      return { text: "No ML worker running.", ready: false, tone: "off" }
    default:
      return {
        text: "ML worker state unknown.",
        ready: false,
        tone: "wait",
      }
  }
}

export function LabelingWorker({ experimentId }: { experimentId?: string }) {
  const [warmupId, setWarmupId] = useState<string | null>(readWarmup)

  const compute = useQuery({
    queryKey: ["agent", "compute"],
    queryFn: () => agentApi.compute(),
    refetchInterval: 10_000,
    retry: false,
  })
  const part = compute.data?.parts.find((p) =>
    p.job_types.includes("LOCATE_PLANTS"),
  )
  const line = workerLine(
    part,
    compute.isError
      ? "the app's link to the cluster is down"
      : (compute.data?.error ?? null),
  )

  const warmup = useQuery({
    queryKey: ["labeling-warmup", warmupId],
    queryFn: async () =>
      (await JobsService.apiJobsJobIdGetJob({
        jobId: warmupId as string,
      })) as JobOutput,
    enabled: Boolean(warmupId),
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === "COMPLETED" || s === "FAILED" || s === "CANCELLED"
        ? false
        : 3000
    },
    retry: false,
  })
  const w = warmup.data
  const wDetail = (w as { progress_detail?: { stage?: string } } | undefined)
    ?.progress_detail
  // A warm-up from before the worker last stopped loaded models that are gone.
  const warmed = w?.status === "COMPLETED" && line.ready
  const warming =
    w && (w.status === "PENDING" || w.status === "RUNNING") ? w : null

  const start = useMutation({
    mutationFn: async () => {
      // Ask the cluster again: another page or person may have started it.
      const now = (await agentApi.compute(true)).parts.find((p) =>
        p.job_types.includes("LOCATE_PLANTS"),
      )
      if (now && now.state !== "stopped") {
        await compute.refetch()
        throw new Error("the ML worker is already up")
      }
      if (now) await agentApi.computeStart(now.name)
      const job = (await JobsService.apiJobsSubmitSubmitJob({
        requestBody: {
          job_type: "LOCATE_PLANTS",
          parameters: { prompted: { mode: "warmup" } },
          ...(experimentId ? { experiment_id: experimentId } : {}),
        } as Parameters<
          typeof JobsService.apiJobsSubmitSubmitJob
        >[0]["requestBody"],
      })) as JobOutput
      return String(job?.id ?? "")
    },
    onSuccess: (id) => {
      if (!id) return
      writeWarmup(id)
      setWarmupId(id)
    },
  })

  let models: string
  if (warmed) models = "Models loaded: prompts answer in seconds."
  else if (warming?.status === "RUNNING")
    models = wDetail?.stage ?? "Getting the models ready…"
  else if (warming)
    models =
      "Warm-up queued: it starts once the worker is up. You can leave this page and come back."
  else if (w?.status === "FAILED")
    models = `Warm-up failed: ${(w as { error_message?: string }).error_message ?? "unknown error"}`
  else if (line.ready)
    models =
      "Models load on the first prompt (the first time also downloads them, about 190 MB)."
  else
    models =
      "Start the worker now and come back: the first start takes a few minutes, with the model download."

  const pct = warming?.status === "RUNNING" ? (warming.progress ?? 0) : null
  const busy = start.isPending || Boolean(warming)
  // Offered only while no worker is running, starting or queued: one is
  // enough, and a second click would only queue another.
  const canStart = part?.state === "stopped" && !compute.isError && !busy

  return (
    <div
      className="bg-muted/30 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs"
      data-testid="labeling-worker"
    >
      <span className="flex items-center gap-1.5">
        {line.tone === "ok" ? (
          <CircleCheck className="h-3.5 w-3.5 text-emerald-500" />
        ) : line.tone === "bad" ? (
          <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
        ) : line.tone === "wait" ? (
          <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
        ) : (
          <Power className="text-muted-foreground h-3.5 w-3.5" />
        )}
        {line.text}
      </span>
      <span className="text-muted-foreground flex min-w-0 items-center gap-2">
        {models}
        {pct !== null && (
          <span className="bg-muted inline-block h-1.5 w-28 overflow-hidden rounded">
            <span
              className="bg-primary block h-full transition-all"
              style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
            />
          </span>
        )}
      </span>
      {(canStart || start.isPending || warming) && (
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7"
          disabled={!canStart}
          onClick={() => {
            if (canStart) start.mutate()
          }}
          title="Start the ML worker on the cluster and load the labelling models, so prompts answer quickly. Runs on without this page."
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Power className="mr-1 h-3.5 w-3.5" />
          )}
          {warming ? "Getting ready…" : "Start labelling worker"}
        </Button>
      )}
      {start.isError && (
        <span className="text-destructive">
          Could not start: {(start.error as Error).message}
        </span>
      )}
    </div>
  )
}
