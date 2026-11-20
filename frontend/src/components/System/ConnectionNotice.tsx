/**
 * ConnectionNotice — when the processing stack is not reachable the app still
 * opens; this pill at the bottom of the window says so, and expands to what
 * is wrong, what still works, and the one thing to do about it.
 *
 * What it says depends on what the agent service on this computer knows:
 * no stack set up at all, a cluster session that is not running, a session
 * that is running but not connected, or (no agent service) only that the
 * API does not answer.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronUp, Loader2, PlugZap } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { agentApi } from "@/features/agent/lib/agentApi"
import { isLoggedIn } from "@/lib/auth"
import { autoSignIn } from "@/lib/autoSignIn"
import { backendHealthUrl, useBackendUp } from "@/lib/connection"

type Fix = {
  title: string
  detail: string
  action?: { label: string; run: () => void; busy?: boolean }
}

export function ConnectionNotice() {
  const queryClient = useQueryClient()
  const up = useBackendUp()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const down = up === false

  const mode = useQuery({
    queryKey: ["agent", "mode", "notice"],
    queryFn: agentApi.mode,
    enabled: down,
    retry: false,
    refetchInterval: 8_000,
  })
  const compute = useQuery({
    queryKey: ["agent", "compute"],
    queryFn: () => agentApi.compute(),
    enabled: down && Boolean(mode.data?.cluster),
    retry: false,
    refetchInterval: 10_000,
  })
  const refresh = () => {
    setError(null)
    queryClient.invalidateQueries({ queryKey: ["agent", "compute"] })
    queryClient.invalidateQueries({ queryKey: ["backend", "up"] })
  }
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e))
  const reconnect = useMutation({
    mutationFn: agentApi.computeReconnect,
    onSuccess: refresh,
    onError: fail,
  })
  const startCore = useMutation({
    mutationFn: () => agentApi.computeStart("core"),
    onSuccess: refresh,
    onError: fail,
  })

  // The stack came back: sign in quietly and reload what the pages hold.
  const wasDown = useRef(false)
  useEffect(() => {
    if (down) wasDown.current = true
    if (up && wasDown.current) {
      wasDown.current = false
      void (isLoggedIn() ? Promise.resolve(true) : autoSignIn()).then(() =>
        queryClient.invalidateQueries(),
      )
    }
  }, [up, down, queryClient])

  if (!down) return null

  const core = compute.data?.parts.find((p) => p.name === "core")
  const cluster = mode.data?.cluster
  let fix: Fix
  if (mode.isError) {
    fix = {
      title: "The processing services are not answering",
      detail:
        "GEMI's services (the REST API) did not answer. If they run in Docker on this computer, make sure Docker Desktop is running and the stack is up; `docker logs geminibase-rest-api` shows why it is not answering.",
    }
  } else if (mode.isLoading) {
    fix = {
      title: "Not connected to the processing stack",
      detail: "Checking what is set up on this computer…",
    }
  } else if (!cluster) {
    fix = {
      title: "No processing stack is set up yet",
      detail:
        "Choose where GEMI does its work: Docker on this computer, or a cluster. On this page, tell the agent your cluster's SSH login and it sets it up with you.",
    }
  } else if (core?.busy || startCore.isPending) {
    fix = {
      title: `Starting the session on ${cluster}`,
      detail:
        "The core services are being submitted to the cluster. This takes the queue wait plus about two minutes; the app connects by itself when it is up.",
    }
  } else if (core?.state === "queued" || core?.state === "starting") {
    fix = {
      title: `The session on ${cluster} is starting`,
      detail:
        core.state === "queued"
          ? `The core is waiting in the cluster's queue${core.reason ? ` (${core.reason})` : ""}. The app connects by itself when it is up.`
          : "The core job is running and its services are coming up. About two minutes.",
    }
  } else if (core?.state === "running") {
    fix = {
      title: `Not connected to the session on ${cluster}`,
      detail:
        "The session is running on the cluster, but this computer's connection to it is closed (this happens after sleep or a network change).",
      action: {
        label: "Reconnect",
        run: () => reconnect.mutate(),
        busy: reconnect.isPending,
      },
    }
  } else if (core?.state === "stopped") {
    fix = {
      title: `The session on ${cluster} is not running`,
      detail:
        "Your data is on the cluster, but the services that serve it are stopped. Starting the session submits one job under your account; it takes the queue wait plus about two minutes.",
      action: {
        label: "Start the session",
        run: () => startCore.mutate(),
        busy: startCore.isPending,
      },
    }
  } else {
    fix = {
      title: `Checking the session on ${cluster}`,
      detail:
        compute.data?.error ??
        "Asking the cluster what is running. If this stays, check your network and that you can log in to the cluster from a terminal.",
    }
  }

  return (
    <div
      className="bg-background fixed bottom-3 left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-amber-400/70 shadow-lg"
      data-testid="connection-notice"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        data-testid="connection-notice-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        <PlugZap className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 truncate font-medium">{fix.title}</span>
        <span className="text-muted-foreground text-xs">
          {open ? "Hide" : "What to do"}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronUp className="h-4 w-4" />
        )}
      </button>
      {open && (
        <div
          className="space-y-2 border-t px-3 py-3 text-sm"
          data-testid="connection-notice-detail"
        >
          <p>{fix.detail}</p>
          {fix.action && (
            <Button
              size="sm"
              disabled={fix.action.busy}
              onClick={fix.action.run}
            >
              {fix.action.busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {fix.action.label}
            </Button>
          )}
          {error && <p className="text-red-700 dark:text-red-400">{error}</p>}
          <div className="text-muted-foreground space-y-1 text-xs">
            <p>
              <span className="text-foreground font-medium">
                Works without it:
              </span>{" "}
              the agent on the home page (setting up and starting compute), the
              Compute panel, the model settings.
            </p>
            <p>
              <span className="text-foreground font-medium">
                Needs the stack:
              </span>{" "}
              Files, Process, Analyze and anything that reads or writes your
              data. Those pages are empty or show errors until it is back.
            </p>
            <p>
              Checked every few seconds: <code>{backendHealthUrl()}</code>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
